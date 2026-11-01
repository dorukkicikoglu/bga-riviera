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
     * of their played column at once (score, round_scores, stats), before that notification, which carries the stars and
     * the new scores: a stopped column can't change, so the stars are final. The 40-point check still waits for EndRound.
     * The notification's rows also list the players who crashed this round, for the log row only.
     * Then the Start token passes (PassStartToken), which starts this turn's cards 2 and 11, [BGA, confirmed with
     * publisher] only for owners who chose More, clockwise from the new holder, before the next roll. Card 10 has
     * resolved already, before Stop or More. With nobody who chose More, PassStartToken ends the round.
     */
    function onEnteringState() {
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $choicesDB = $this->game->getCollectionFromDB("SELECT `player_id`, `stop_or_more_choice` FROM `player` WHERE `round_status` = 'in' AND `stop_or_more_choice` IS NOT NULL", true);
        $crashedDB = $this->game->getCollectionFromDB("SELECT `player_id` FROM `player` WHERE `round_status` = 'crashed'");

        $roundNumber = (int) $this->game->bga->globals->get('roundNumber');

        //one row per player, clockwise from the Start token holder: 'stop' (with the stars banked and the new score), 'more',
        //or 'crash' (crashed this round, log row only). A list, like cardsRevealed's reveals, so the order survives
        $rows = [];
        $logParts = ['stop' => [], 'more' => [], 'crash' => []];
        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(isset($choicesDB[$playerID]) && $choicesDB[$playerID] === 'stop'){
                $this->game->bga->playerStats->inc('roundsStopped', 1, $playerID);
                $banked = $this->bankStars($playerID, $roundNumber);
                $rows[] = ['player_id' => $playerID, 'choice' => 'stop', 'stars' => $banked['stars'], 'score' => $banked['score']];
                $logParts['stop'][] = $this->game->getPlayerNameById($playerID).' ('.$banked['stars'].' stars)';
            } else if(isset($choicesDB[$playerID])){
                $rows[] = ['player_id' => $playerID, 'choice' => 'more'];
                $logParts['more'][] = $this->game->getPlayerNameById($playerID);
            } else if(isset($crashedDB[$playerID])){
                $rows[] = ['player_id' => $playerID, 'choice' => 'crash'];
                $logParts['crash'][] = $this->game->getPlayerNameById($playerID);
            }
        }

        $this->game->DbQuery("UPDATE `player` SET `round_status` = 'stopped' WHERE `round_status` = 'in' AND `stop_or_more_choice` = 'stop'");
        $this->game->DbQuery("UPDATE `player` SET `stop_or_more_choice` = NULL");

        if(count($choicesDB) > 0){
            $this->bga->notify->all('stopOrMoreRevealed', '${STOP_OR_MORE_LOG_STR}', [
                'preserve' => ['rows'],
                'rows' => $rows,
                'STOP_OR_MORE_LOG_STR' => 'Stop: '.implode(', ', $logParts['stop']).' / More: '.implode(', ', $logParts['more']).' / Crashed: '.implode(', ', $logParts['crash']),
            ]);
        }

        $this->game->powerManager->clearPreRollPowersOfPlayersOut();
        return PassStartToken::class;
    }

    //the stopper's column goes into their score now, clockwise from the Start token holder like the Stop/More row. Returns
    //the stars and the new score, which stopOrMoreRevealed's rows carry
    private function bankStars(int $playerID, int $roundNumber): array {
        $stars = $this->game->tableManager->getStarsInColumn($playerID);
        $score = $this->game->bga->playerScore->inc($playerID, $stars, null); //null: no framework notif, stopOrMoreRevealed updates the counter

        $this->game->tableManager->saveRoundScore($roundNumber, $playerID, 'stopped', $stars);
        $this->game->bga->playerStats->inc('starsBanked', $stars, $playerID);
        if($stars > (int) $this->game->bga->playerStats->get('bestRound', $playerID))
            $this->game->bga->playerStats->set('bestRound', $stars, $playerID);

        return ['stars' => $stars, 'score' => $score];
    }
}
