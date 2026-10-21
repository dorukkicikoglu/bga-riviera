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
 * RevealCards.php
 */

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
            updateGameProgression: true,
        );
    }

    /**
     * Applies every pending play choice clockwise from the Start token holder, reveals the played cards (card-1
     * chains included) and Last Chances in one notification, then one notification per crash. A player whose hand
     * is now empty made a Grand Slam, which ends the game before any power. Otherwise last turn's dice effects
     * expire and this turn's powers are marked pending. [BGA, confirmed with publisher] Card 10 resolves right away,
     * before Stop or More, for owners still in the round, clockwise from the Start token holder (NextPOWER10Owner, then
     * StopOrMore); cards 2 and 11 after Stop or More and the token pass, only for owners who chose More (see
     * PassStartToken); card 9 after the next roll.
     */
    function onEnteringState() {
        $this->game->bga->globals->delete('undoableDieChange_POWER9'); //card 9's undo ends with PlayCard

        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $playChoicesDB = $this->game->getCollectionFromDB("SELECT `player_id`, `play_choice`, `play_choice_card_id` FROM `player` WHERE `round_status` = 'in'");

        $reveals = [];
        $revealLogParts = [];
        $crashedPlayerIDs = [];
        $lastChancePlayerIDs = [];
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

                $this->game->bga->playerStats->inc('cardsPlayed', 1 + count($extraCards), $playerID);
                if(count($extraCards) > 0)
                    $this->game->bga->playerStats->inc('powerUsed_POWER1', count($extraCards), $playerID);
            } else if($playChoice === 'last_chance'){
                $this->game->DbQuery("UPDATE `player` SET `last_chance_used` = 'yes' WHERE `player_id` = $playerID");
                $this->game->bga->playerStats->set('lastChanceUsed', true, $playerID);
                $this->game->bga->playerStats->set('lastChanceRound', (int) $this->game->bga->globals->get('roundNumber'), $playerID);

                $reveals[] = ['player_id' => $playerID, 'choice' => 'last_chance', 'card' => null, 'extra_cards_POWER1' => []];
                $revealLogParts[] = $playerName.': Last Chance';
                $lastChancePlayerIDs[] = $playerID;
            } else if($playChoice === 'crash'){
                $this->game->DbQuery("UPDATE `player` SET `round_status` = 'crashed' WHERE `player_id` = $playerID");
                $this->game->tableManager->discardPlayerCards($playerID);
                $this->game->tableManager->saveRoundScore((int) $this->game->bga->globals->get('roundNumber'), $playerID, 'crashed', 0);
                $this->game->bga->playerStats->inc('crashes', 1, $playerID);

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

            //only Last Chances: no reveal row (an empty message makes no log row), their own rows below are enough. The
            //notification still goes out, so the client updates exactly as for any reveal
            $onlyLastChances = count(array_filter($reveals, fn(array $reveal) => $reveal['choice'] !== 'last_chance')) === 0;
            $this->bga->notify->all('cardsRevealed', $onlyLastChances ? '' : '${REVEAL_LOG_STR}', [
                'preserve' => ['reveals'],
                'reveals' => $reveals,
                'hand_counts' => $handCounts,
                'REVEAL_LOG_STR' => implode(', ', $revealLogParts),
            ]);
        }

        //one row per Last Chance, under the reveal row, clockwise from the Start token holder like the reveal
        foreach($lastChancePlayerIDs as $playerID){
            $this->bga->notify->all('lastChanceUsed', '${LAST_CHANCE_LOG_STR}', [
                'preserve' => ['player_id'],
                'player_id' => $playerID,
                'LAST_CHANCE_LOG_STR' => $this->game->getPlayerNameById($playerID).' uses Last Chance',
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

        //this turn's crashes are already 'crashed' (set in the loop above), so a player who just crashed is neither a
        //card 10 owner nor a target
        $this->game->powerManager->saveOwnerOrderPOWER10();
        return NextPOWER10Owner::class;
    }

    private function moveCardToColumn(array $cardDB, int $playerID): array {
        $locationInColumn = $this->game->tableManager->getNextLocationInColumn($playerID);
        $this->game->DbQuery("UPDATE `cards` SET `card_location` = 'played', `location_in_column` = $locationInColumn, `chain_position_POWER1` = NULL WHERE `card_id` = ".$cardDB['card_id']);

        $card = $this->game->tableManager->formatCard($cardDB);
        $card['location_in_column'] = $locationInColumn;
        return $card;
    }
}
