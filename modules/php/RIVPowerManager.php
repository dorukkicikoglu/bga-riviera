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
 * RIVPowerManager.php
 */

namespace Bga\Games\Riviera;

use Bga\Games\Riviera\Game;
use Bga\Games\Riviera\States\ModifyDie;
use Bga\Games\Riviera\States\PlayCard;
use Bga\Games\Riviera\States\ResolvePowers;
use Bga\Games\Riviera\States\SwapCards;
use Bga\Games\Riviera\States\PassStartToken;

/**
 * Powers of cards 2, 9, 10 and 11. Each player reveals at most one of them per turn (a card-1 chain only goes on
 * with 1s), so the last card a player reveals leaves a pending_POWER<n> marker, and owners are walked one by one
 * clockwise from the Start token holder, like Fugu's NextPlayer: change the active player, then go to the state.
 * Card 1 lives in PlayCard: its chain is part of the player's choice.
 */
class RIVPowerManager{
    public Game $game;

    function __construct(Game $game) {
        $this->game = $game;
    }

    /**
     * RevealCards: $lastCardValueByPlayer is the value of the last card each player revealed this turn.
     */
    function markPendingPowers(array $lastCardValueByPlayer): void{
        foreach($lastCardValueByPlayer as $playerID => $cardValue){
            if(in_array($cardValue, POWER_CARD_VALUES, true))
                $this->game->DbQuery("UPDATE `player` SET `pending_POWER$cardValue` = 'yes' WHERE `player_id` = $playerID");
        }
    }

    function clearPendingPowers(): void{
        $this->game->DbQuery("UPDATE `player` SET `pending_POWER2` = 'no', `pending_POWER9` = 'no', `pending_POWER10` = 'no', `pending_POWER11` = 'no', `added_golden_die_POWER11` = 'no'");
    }

    /**
     * [BGA] A card-2 reservation and the golden die only last for the turn after the power is used: they are
     * cleared after that turn's reveal, before this turn's powers can set them again.
     */
    function expireDiceEffects(): void{
        $activeEffectCount = (int) $this->game->getUniqueValueFromDB("SELECT COUNT(*) FROM `dice` WHERE `reserved_by_POWER2` IS NOT NULL OR `in_use_by_POWER11` = 'yes'");
        if($activeEffectCount === 0)
            return;

        $this->game->DbQuery("UPDATE `dice` SET `reserved_by_POWER2` = NULL");
        $this->game->DbQuery("UPDATE `dice` SET `in_use_by_POWER11` = 'no', `die_value` = NULL WHERE `die_color` = 'gold'");
        $this->game->DbQuery("UPDATE `player` SET `added_golden_die_POWER11` = 'no'");

        $this->game->bga->notify->all('diceUpdated', '', ['dice' => $this->game->tableManager->getDice()]);
    }

    /**
     * Pre-roll powers (2, 10, 11), clockwise from the Start token holder. Card 2 is applied on the spot; a card-10
     * or card-11 owner becomes the active player of SwapCards or ResolvePowers. Every action of those states
     * returns this again, so the walk goes on until nobody has a pending pre-roll power.
     */
    function goToNextPreRollPower(): string{
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $pendingPowersDB = $this->game->getCollectionFromDB("SELECT `player_id`, `pending_POWER2`, `pending_POWER10`, `pending_POWER11` FROM `player`");

        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            $pendingPowers = $pendingPowersDB[$playerID];

            if($pendingPowers['pending_POWER2'] === 'yes'){
                $this->applyReservationPOWER2($playerID);
                continue;
            }

            //a second 11 this turn is asked too: the golden die stays as long as one player who added it doesn't stop
            if($pendingPowers['pending_POWER11'] === 'yes'){
                $this->game->gamestate->changeActivePlayer($playerID);
                return ResolvePowers::class;
            }

            if($pendingPowers['pending_POWER10'] === 'yes'){
                $handCount = $this->game->tableManager->getHandCounts()[$playerID] ?? 0;
                if($handCount < CARDS_SWAPPED_BY_POWER10){ //[BGA] the power needs 2 cards of your own
                    $this->skipPower($playerID, 10, 'not_enough_cards');
                    continue;
                }

                if(empty($this->getSwapTargetsPOWER10($playerID)) && $this->game->tableManager->getDrawableCountPOWER10() === 0){
                    $this->skipPower($playerID, 10, 'nothing_to_draw');
                    continue;
                }

                $this->game->gamestate->changeActivePlayer($playerID);
                return SwapCards::class;
            }
        }

        return PassStartToken::class;
    }

    /**
     * Card 9, after the next roll: owners still in the round, clockwise from the Start token holder.
     * [BGA] An owner who stopped since playing the 9 loses the power.
     */
    function goToNextPOWER9Owner(): string{
        $this->game->DbQuery("UPDATE `player` SET `pending_POWER9` = 'no' WHERE `pending_POWER9` = 'yes' AND `round_status` <> 'in'");

        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $pendingPOWER9DB = $this->game->getCollectionFromDB("SELECT `player_id`, `pending_POWER9` FROM `player`", true);

        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if($pendingPOWER9DB[$playerID] !== 'yes')
                continue;

            if(empty($this->game->tableManager->getModifiableDicePOWER9())){ //every die has been changed already
                $this->clearPendingPower($playerID, 9);
                continue;
            }

            $this->game->gamestate->changeActivePlayer($playerID);
            return ModifyDie::class;
        }

        return PlayCard::class;
    }

    function hasPendingPower(int $playerID, int $cardValue): bool{
        return $this->game->getUniqueValueFromDB("SELECT `pending_POWER$cardValue` FROM `player` WHERE `player_id` = $playerID") === 'yes';
    }

    function clearPendingPower(int $playerID, int $cardValue): void{
        $this->game->DbQuery("UPDATE `player` SET `pending_POWER$cardValue` = 'no' WHERE `player_id` = $playerID");
    }

    /**
     * The owner chose not to use the power (or, for card 10, there is nothing to draw): one public log row.
     */
    function skipPower(int $playerID, int $cardValue, string $reason = ''): void{
        $this->clearPendingPower($playerID, $cardValue);

        $powerSkippedLogStr = $this->game->getPlayerNameById($playerID).' does not use their '.$cardValue;
        $this->game->bga->notify->all('powerSkipped', '${POWER_SKIPPED_LOG_STR}', [
            'preserve' => ['player_id', 'value', 'card', 'reason'],
            'player_id' => $playerID,
            'value' => $cardValue,
            'card' => $this->game->tableManager->getLastPlayedCard($playerID),
            'reason' => $reason,
            'POWER_SKIPPED_LOG_STR' => $powerSkippedLogStr,
        ]);
    }

    /**
     * Card 10 targets: opponents still in the round with at least 2 cards in hand. With none, the owner discards and draws instead.
     */
    function getSwapTargetsPOWER10(int $ownerID): array{
        $handCounts = $this->game->tableManager->getHandCounts();

        $targets = [];
        foreach($this->game->getPlayerIDsInRound() as $playerID){
            if($playerID !== $ownerID && ($handCounts[$playerID] ?? 0) >= CARDS_SWAPPED_BY_POWER10)
                $targets[] = ['player_id' => $playerID, 'hand_count' => $handCounts[$playerID]];
        }
        return $targets;
    }

    /**
     * Publisher ruling: a player who stops does not take part in the next turn, so the card they just played does
     * not activate a power meant for that turn. Called by RevealStopOrMore with this turn's stoppers, clockwise:
     * - card 2: the die they reserved is free again;
     * - card 11 [UNCONFIRMED with publisher]: the golden die is not added, unless another player who added it is still in.
     * One public log row per cancelled power.
     */
    function cancelPowersOfStoppingPlayers(array $stoppingPlayerIDs): void{
        if(empty($stoppingPlayerIDs))
            return;

        $stoppingPlayerIDList = implode(',', array_map('intval', $stoppingPlayerIDs));
        $cancellations = []; //player_id => ['value' => 2|11, 'die' => the die before cancelling]

        $reservedDiceDB = $this->game->getCollectionFromDB("SELECT `reserved_by_POWER2`, `die_color` FROM `dice` WHERE `reserved_by_POWER2` IN ($stoppingPlayerIDList)", true);
        foreach($reservedDiceDB as $playerID => $dieColor){
            $cancellations[(int) $playerID] = ['value' => 2, 'die' => $this->game->tableManager->getDie($dieColor)];
            $this->game->DbQuery("UPDATE `dice` SET `reserved_by_POWER2` = NULL WHERE `die_color` = '$dieColor'");
        }

        $stoppingAdderIDs = array_map('intval', $this->game->getObjectListFromDB("SELECT `player_id` FROM `player` WHERE `added_golden_die_POWER11` = 'yes' AND `player_id` IN ($stoppingPlayerIDList)", true));
        if(!empty($stoppingAdderIDs)){
            $this->game->DbQuery("UPDATE `player` SET `added_golden_die_POWER11` = 'no' WHERE `player_id` IN ($stoppingPlayerIDList)");

            $remainingAdderCount = (int) $this->game->getUniqueValueFromDB("SELECT COUNT(*) FROM `player` WHERE `added_golden_die_POWER11` = 'yes'");
            if($remainingAdderCount === 0 && $this->isGoldenDieInUsePOWER11()){
                $goldenDie = $this->game->tableManager->getDie('gold');
                $this->game->DbQuery("UPDATE `dice` SET `in_use_by_POWER11` = 'no', `die_value` = NULL WHERE `die_color` = 'gold'");

                foreach($stoppingAdderIDs as $playerID)
                    $cancellations[$playerID] = ['value' => 11, 'die' => $goldenDie];
            }
        }

        if(empty($cancellations))
            return;

        $dice = $this->game->tableManager->getDice();
        foreach($stoppingPlayerIDs as $playerID){
            if(!isset($cancellations[$playerID]))
                continue;

            $cancellation = $cancellations[$playerID];
            $this->game->bga->playerStats->inc('powerUsed_POWER'.$cancellation['value'], -1, $playerID); //only powers that took effect are counted
            $powerCancelledLogStr = $this->game->getPlayerNameById($playerID).' stops: their '.$cancellation['value'].' has no effect';
            $this->game->bga->notify->all('powerCancelled', '${POWER_CANCELLED_LOG_STR}', [
                'preserve' => ['player_id', 'value', 'card', 'die'],
                'player_id' => $playerID,
                'value' => $cancellation['value'],
                'card' => $this->game->tableManager->getLastPlayedCard($playerID),
                'die' => $cancellation['die'],
                'dice' => $dice,
                'POWER_CANCELLED_LOG_STR' => $powerCancelledLogStr,
            ]);
        }
    }

    function isGoldenDieInUsePOWER11(): bool{
        return $this->game->getUniqueValueFromDB("SELECT `in_use_by_POWER11` FROM `dice` WHERE `die_color` = 'gold'") === 'yes';
    }

    /**
     * [BGA] Card 2 is not optional: the die of the 2's color is reserved for its owner for the next roll.
     * Each color has one 2, so a die can't already be reserved; the WHERE clause guards it anyway.
     */
    private function applyReservationPOWER2(int $playerID): void{
        $this->clearPendingPower($playerID, 2);

        $card = $this->game->tableManager->getLastPlayedCard($playerID);
        if(!$card || $card['value'] !== 2)
            return;

        $dieColor = $card['color'];
        $this->game->DbQuery("UPDATE `dice` SET `reserved_by_POWER2` = $playerID WHERE `die_color` = '$dieColor' AND `die_location` = 'in_play' AND `reserved_by_POWER2` IS NULL");
        if($this->game->DbAffectedRow() === 0)
            return;

        $this->game->bga->playerStats->inc('powerUsed_POWER2', 1, $playerID);

        $dieReservedLogStr = $this->game->getPlayerNameById($playerID).' reserves the '.$dieColor.' die for the next roll';
        $this->game->bga->notify->all('dieReserved_POWER2', '${DIE_RESERVED_POWER2_LOG_STR}', [
            'preserve' => ['player_id', 'die'],
            'player_id' => $playerID,
            'die' => $this->game->tableManager->getDie($dieColor),
            'dice' => $this->game->tableManager->getDice(),
            'DIE_RESERVED_POWER2_LOG_STR' => $dieReservedLogStr,
        ]);
    }
}

?>
