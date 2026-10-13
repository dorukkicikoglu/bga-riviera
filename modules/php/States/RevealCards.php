<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class RevealCards extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 22,
            type: StateType::GAME,
        );
    }

    /**
     * Applies every pending play choice clockwise from the Start token holder, reveals the played cards (card-1
     * chains included) and Last Chances in one notification, then one notification per crash. A player whose hand
     * is now empty made a Grand Slam, which ends the game before any power. Otherwise last turn's dice effects
     * expire and this turn's powers are resolved, owner by owner.
     */
    function onEnteringState() {
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $playChoicesDB = $this->game->getCollectionFromDB("SELECT `player_id`, `play_choice`, `play_choice_card_id` FROM `player` WHERE `round_status` = 'in'");

        $reveals = [];
        $revealLogParts = [];
        $crashedPlayerIDs = [];
        $cardPlayerIDs = [];
        $lastCardValueByPlayer = [];

        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(!isset($playChoicesDB[$playerID]))
                continue;

            $playChoice = $playChoicesDB[$playerID]['play_choice'];
            $playerName = $this->game->getPlayerNameById($playerID);

            if($playChoice === 'card'){
                $cardID = (int) $playChoicesDB[$playerID]['play_choice_card_id'];
                $cardDB = $this->game->getObjectFromDB("SELECT * FROM `cards` WHERE `card_id` = $cardID AND `card_location` = 'hand' AND `card_location_arg` = $playerID");
                if(!$cardDB)
                    throw new \Bga\GameFramework\SystemException("Chosen card $cardID is not in the hand of player $playerID");

                $chainCardIDs = $this->game->tableManager->getChainCardIDsPOWER1($playerID); //read before the first card leaves the hand
                $card = $this->moveCardToColumn($cardDB, $playerID);

                $extraCards = [];
                foreach($chainCardIDs as $chainCardID){
                    $chainCardDB = $this->game->getObjectFromDB("SELECT * FROM `cards` WHERE `card_id` = $chainCardID AND `card_location` = 'hand' AND `card_location_arg` = $playerID");
                    if(!$chainCardDB)
                        throw new \Bga\GameFramework\SystemException("Chained card $chainCardID is not in the hand of player $playerID");

                    $extraCards[] = $this->moveCardToColumn($chainCardDB, $playerID);
                }

                $reveals[] = ['player_id' => $playerID, 'choice' => 'card', 'card' => $card, 'extra_cards_POWER1' => $extraCards];
                $revealLogParts[] = $playerName.': '.implode(' + ', array_map(fn(array $revealedCard) => $this->game->getCardLogHTML($revealedCard), [$card, ...$extraCards]));
                $cardPlayerIDs[] = $playerID;
                $lastCardValueByPlayer[$playerID] = empty($extraCards) ? $card['value'] : end($extraCards)['value'];
            } else if($playChoice === 'last_chance'){
                $this->game->DbQuery("UPDATE `player` SET `last_chance_used` = 'yes' WHERE `player_id` = $playerID");

                $reveals[] = ['player_id' => $playerID, 'choice' => 'last_chance', 'card' => null, 'extra_cards_POWER1' => []];
                $revealLogParts[] = $playerName.': Last Chance';
            } else if($playChoice === 'crash'){
                $this->game->DbQuery("UPDATE `player` SET `round_status` = 'crashed' WHERE `player_id` = $playerID");
                $this->game->tableManager->discardPlayerCards($playerID);

                $crashedPlayerIDs[] = $playerID;
            }
        }

        $this->game->DbQuery("UPDATE `player` SET `play_choice` = NULL, `play_choice_card_id` = NULL");
        $this->game->tableManager->clearChainPOWER1();

        if(count($reveals) > 0){
            //only the revealing players' counts: a crashed player's count drops with their own notification below
            $allHandCounts = $this->game->tableManager->getHandCounts();
            $handCounts = [];
            foreach($reveals as $reveal)
                $handCounts[$reveal['player_id']] = $allHandCounts[$reveal['player_id']];

            $this->bga->notify->all('cardsRevealed', '${REVEAL_LOG_STR}', [
                'preserve' => ['reveals'],
                'reveals' => $reveals,
                'hand_counts' => $handCounts,
                'REVEAL_LOG_STR' => implode(', ', $revealLogParts),
            ]);
        }

        foreach($crashedPlayerIDs as $playerID){
            $this->bga->notify->all('playerCrashed', '${CRASH_LOG_STR}', [
                'preserve' => ['player_id'],
                'player_id' => $playerID,
                'CRASH_LOG_STR' => $this->game->getPlayerNameById($playerID).' crashes',
            ]);
        }

        $handCounts = $this->game->tableManager->getHandCounts();
        $grandSlamPlayerIDs = array_values(array_filter($cardPlayerIDs, fn(int $playerID) => $handCounts[$playerID] === 0));
        if(count($grandSlamPlayerIDs) > 0){
            $this->game->applyGrandSlam($grandSlamPlayerIDs);
            return EndScore::class;
        }

        $this->game->powerManager->expireDiceEffects();
        $this->game->powerManager->markPendingPowers($lastCardValueByPlayer);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    private function moveCardToColumn(array $cardDB, int $playerID): array {
        $locationInColumn = $this->game->tableManager->getNextLocationInColumn($playerID);
        $this->game->DbQuery("UPDATE `cards` SET `card_location` = 'played', `location_in_column` = $locationInColumn, `chain_position_POWER1` = NULL WHERE `card_id` = ".$cardDB['card_id']);

        $card = $this->game->tableManager->formatCard($cardDB);
        $card['location_in_column'] = $locationInColumn;
        return $card;
    }
}
