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
use Bga\Games\Riviera\States\PassStartToken;
use Bga\Games\Riviera\States\PlayCard;
use Bga\Games\Riviera\States\ResolvePowers;
use Bga\Games\Riviera\States\SwapCards;
use Bga\Games\Riviera\States\RollDice;

/**
 * Powers of cards 2, 9, 10 and 11. Each player reveals at most one of them per turn (a card-1 chain only goes on
 * with 1s), so the last card a player reveals leaves a pending_POWER<n> marker, and owners are walked one by one
 * clockwise from the Start token holder, like Fugu's NextPlayer: change the active player, then go to the state.
 * [BGA, confirmed with publisher] A player who stops doesn't benefit from their powers: cards 2, 10 and 11 resolve
 * after Stop or More, only for owners who chose More. [BGA] Card 10 goes first, clockwise from the holder before the
 * Start token passes (RevealStopOrMore starts that walk); cards 2 and 11 after the pass, clockwise from the new holder
 * (PassStartToken starts that walk); card 9 after the next roll, only for owners still in. Card 1 lives in PlayCard:
 * its chain is part of the player's choice.
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
        $this->game->DbQuery("UPDATE `player` SET `pending_POWER2` = 'no', `pending_POWER9` = 'no', `pending_POWER10` = 'no', `pending_POWER11` = 'no'");
    }

    /**
     * Owners who stopped (or crashed) lose their pending card 2, 10 and 11 powers, silently. RevealStopOrMore, once
     * the Stops are applied, before any of them resolves: everyone still 'in' chose More.
     */
    function clearPreRollPowersOfPlayersOut(): void{
        $this->game->DbQuery("UPDATE `player` SET `pending_POWER2` = 'no', `pending_POWER10` = 'no', `pending_POWER11` = 'no' WHERE `round_status` <> 'in'");
    }

    /**
     * [BGA] A card-2 reservation and the golden die only last for the turn after the power is used: they are
     * cleared after that turn's reveal, before this turn's powers (after Stop or More) can set them again.
     */
    function expireDiceEffects(): void{
        $activeEffectCount = (int) $this->game->getUniqueValueFromDB("SELECT COUNT(*) FROM `dice` WHERE `reserved_by_POWER2` IS NOT NULL OR `in_use_by_POWER11` = 'yes'");
        if($activeEffectCount === 0)
            return;

        $this->game->DbQuery("UPDATE `dice` SET `reserved_by_POWER2` = NULL");
        $this->game->DbQuery("UPDATE `dice` SET `in_use_by_POWER11` = 'no', `die_value` = NULL WHERE `die_color` = 'gold'");

        $this->game->bga->notify->all('diceUpdated', '', ['dice' => $this->game->tableManager->getDice()]);
    }

    /**
     * [BGA] Card 10 resolves after Stop or More and before the Start token passes, clockwise from the holder before the
     * pass. RevealStopOrMore computes that order once, here, from the owners who chose More (still 'in' once the Stops
     * are applied), and stores it: goToNextPOWER10Owner() only walks the stored order, it never reads the holder again.
     */
    function saveOwnerOrderPOWER10(): void{
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $pendingPOWER10DB = $this->game->getCollectionFromDB("SELECT `player_id`, `pending_POWER10` FROM `player` WHERE `round_status` = 'in'", true);

        $ownerOrder = [];
        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            if(($pendingPOWER10DB[$playerID] ?? 'no') === 'yes')
                $ownerOrder[] = $playerID;
        }

        $this->game->bga->globals->set('ownerOrder_POWER10', $ownerOrder);
    }

    /**
     * Card 10 owners in the order saveOwnerOrderPOWER10() stored: the next one still pending becomes the active player
     * of SwapCards, whose every action returns this again. Once nobody is left, the Start token passes (PassStartToken),
     * which starts the card 2 and 11 walk. With nobody who chose More, the order is empty and it goes straight there.
     */
    function goToNextPOWER10Owner(): string{
        $ownerOrder = $this->game->bga->globals->get('ownerOrder_POWER10', []);
        $pendingPOWER10DB = $this->game->getCollectionFromDB("SELECT `player_id`, `pending_POWER10` FROM `player`", true);

        foreach($ownerOrder as $playerID){
            $playerID = (int) $playerID;
            if(($pendingPOWER10DB[$playerID] ?? 'no') !== 'yes')
                continue;

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

        $this->game->bga->globals->set('ownerOrder_POWER10', []);
        return PassStartToken::class;
    }

    /**
     * Cards 2 and 11, after the Start token pass, for owners who chose More (still 'in'), clockwise from the new holder.
     * Card 2 is applied on the spot; a card-11 owner becomes the active player of ResolvePowers, whose every action
     * returns this again, so the walk goes on until nobody has a pending card 2 or 11, then the next roll.
     * Card 10 has already resolved, before the pass (goToNextPOWER10Owner()).
     */
    function goToNextPreRollPower(): string{
        $startPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $pendingPowersDB = $this->game->getCollectionFromDB("SELECT `player_id`, `round_status`, `pending_POWER2`, `pending_POWER11` FROM `player`");

        foreach($this->game->tableManager->getPlayerIDsInTurnOrderFrom($startPlayerID) as $playerID){
            $pendingPowers = $pendingPowersDB[$playerID];
            if($pendingPowers['round_status'] !== 'in') //a player who stopped doesn't benefit from their powers
                continue;

            if($pendingPowers['pending_POWER2'] === 'yes'){
                $this->applyReservationPOWER2($playerID);
                continue;
            }

            if($pendingPowers['pending_POWER11'] === 'yes'){
                if($this->isGoldenDieInUsePOWER11()){ //[BGA] a second 11 this turn adds nothing: skipped without a prompt or log row
                    $this->clearPendingPower($playerID, 11);
                    continue;
                }

                $this->game->gamestate->changeActivePlayer($playerID);
                return ResolvePowers::class;
            }
        }

        return RollDice::class;
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
     * Card 10 targets: opponents who chose More (still 'in' once the Stops are applied) with at least 2 cards in hand.
     * With none, the owner discards and draws instead.
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
