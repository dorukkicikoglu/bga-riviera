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
     * Applies every Stop choice and reveals all choices in one notification.
     * [BGA, confirmed with publisher] A player who stops doesn't benefit from their powers: card 2, 10 and 11 powers
     * from this turn now resolve only for owners who chose More, clockwise from the Start token holder, before the
     * next roll. Anyone still in (they chose More) means another turn; otherwise the round ends.
     */
    function onEnteringState() {
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $choicesDB = $this->game->getCollectionFromDB("SELECT `player_id`, `stop_or_more_choice` FROM `player` WHERE `round_status` = 'in' AND `stop_or_more_choice` IS NOT NULL", true);

        $choices = [];
        $stopNames = [];
        $moreNames = [];
        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(!isset($choicesDB[$playerID]))
                continue;

            $choices[$playerID] = $choicesDB[$playerID];
            if($choicesDB[$playerID] === 'stop'){
                $stopNames[] = $this->game->getPlayerNameById($playerID);
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

        //with nobody left the round ends, and RoundSetup clears every pending power anyway
        if(count($this->game->getPlayerIDsInRound()) > 0){
            $this->game->powerManager->clearPreRollPowersOfPlayersOut();
            return $this->game->powerManager->goToNextPreRollPower();
        }

        return EndRound::class;
    }
}
