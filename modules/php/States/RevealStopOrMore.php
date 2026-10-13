<?php

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
     * A player who stops loses the card 2 or 11 power they just used for the next turn.
     * Anyone still in (they chose More) means another turn; otherwise the round ends.
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

        //with nobody left the round ends, and RoundSetup clears every dice effect anyway
        if(count($this->game->getPlayerIDsInRound()) > 0){
            $this->game->powerManager->cancelPowersOfStoppingPlayers($stoppingPlayerIDs);
            return RollDice::class;
        }

        return EndRound::class;
    }
}
