<?php
/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * RevealStopOrMore.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class RevealStopOrMore extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 55,
            type: StateType::GAME,
        );
    }

    /**
     * Applies every Stop choice and reveals all choices in one notification. [BGA] Each player who stops banks the stars
     * of their played column at once (score, "banks N stars" row, round_scores, stats): a stopped column can't change,
     * so the stars are final. The 40-point check still waits for EndRound.
     * Then the Start token passes (PassStartToken), which starts this turn's cards 2 and 11, [BGA, confirmed with
     * publisher] only for owners who chose More, clockwise from the new holder, before the next roll. Card 10 has
     * resolved already, before Stop or More. With nobody who chose More, PassStartToken ends the round.
     */
    function onEnteringState() {
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $choicesDB = $this->game->getCollectionFromDB("SELECT `player_id`, `stop_or_more_choice` FROM `player` WHERE `round_status` = 'in' AND `stop_or_more_choice` IS NOT NULL", true);

        $choices = [];
        $stopNames = [];
        $moreNames = [];
        $stoppingPlayerIDs = [];
        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(!isset($choicesDB[$playerID]))
                continue;

            $choices[$playerID] = $choicesDB[$playerID];
            if($choicesDB[$playerID] === 'stop'){
                $stopNames[] = $this->game->getPlayerNameById($playerID);
                $stoppingPlayerIDs[] = $playerID;
                $this->game->bga->playerStats->inc('roundsStopped', 1, $playerID);
            } else $moreNames[] = $this->game->getPlayerNameById($playerID);
        }

        $this->game->DbQuery("UPDATE `player` SET `round_status` = 'stopped' WHERE `round_status` = 'in' AND `stop_or_more_choice` = 'stop'");
        $this->game->DbQuery("UPDATE `player` SET `stop_or_more_choice` = NULL");

        if(count($choices) > 0){
            $this->bga->notify->all('stopOrMoreRevealed', '${STOP_OR_MORE_LOG_STR}', [
                'preserve' => ['choices'],
                'choices' => $choices,
                'STOP_OR_MORE_LOG_STR' => 'Stop: '.implode(', ', $stopNames).' / More: '.implode(', ', $moreNames),
            ]);
        }

        $roundNumber = (int) $this->game->bga->globals->get('roundNumber');
        foreach($stoppingPlayerIDs as $playerID)
            $this->bankStars($playerID, $roundNumber);

        $this->game->powerManager->clearPreRollPowersOfPlayersOut();
        return PassStartToken::class;
    }

    //the stopper's column goes into their score now, clockwise from the Start token holder like the Stop/More row
    private function bankStars(int $playerID, int $roundNumber): void {
        $stars = $this->game->tableManager->getStarsInColumn($playerID);
        $score = $this->game->bga->playerScore->inc($playerID, $stars, null); //null: no framework notif, starsBanked updates the counter

        $this->game->tableManager->saveRoundScore($roundNumber, $playerID, 'stopped', $stars);
        $this->game->bga->playerStats->inc('starsBanked', $stars, $playerID);
        if($stars > (int) $this->game->bga->playerStats->get('bestRound', $playerID))
            $this->game->bga->playerStats->set('bestRound', $stars, $playerID);

        $this->bga->notify->all('starsBanked', '${STARS_BANKED_LOG_STR}', [
            'preserve' => ['player_id', 'stars', 'score'],
            'player_id' => $playerID,
            'stars' => $stars,
            'score' => $score,
            'STARS_BANKED_LOG_STR' => $this->game->getPlayerNameById($playerID).' banks '.$stars.' stars',
        ]);
    }
}
