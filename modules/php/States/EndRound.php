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
 * EndRound.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class EndRound extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 60,
            type: StateType::GAME,
        );
    }

    /**
     * Every player who stopped banks the stars of their played column; crashed players score 0.
     * Each player's round goes into round_scores for the end-game table.
     * Anyone at WINNING_SCORE or more ends the game (highest score wins, equal scores share the win).
     * Game progression is recomputed by the next RoundSetup, once the banked columns are cleared.
     */
    function onEnteringState() {
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $roundNumber = (int) $this->game->bga->globals->get('roundNumber');
        $stoppedPlayerIDs = array_map('intval', $this->game->getObjectListFromDB("SELECT `player_id` FROM `player` WHERE `round_status` = 'stopped'", true));

        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(!in_array($playerID, $stoppedPlayerIDs, true)){
                $this->game->tableManager->saveRoundScore($roundNumber, $playerID, 'crashed', 0);
                continue;
            }

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

        $maxScore = (int) $this->game->getUniqueValueFromDB("SELECT MAX(`player_score`) FROM `player`");
        if($maxScore >= WINNING_SCORE)
            return EndScore::class;

        return RoundSetup::class;
    }
}
