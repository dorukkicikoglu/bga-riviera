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
 * SwapCards.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\Actions\Types\IntArrayParam;
use Bga\GameFramework\UserException;
use Bga\Games\Riviera\Game;

/**
 * Card 10, before the next roll: the owner swaps 2 cards of their choice with 2 random cards from the hand of an
 * opponent still in the round with at least 2 cards (a player who stopped can't be targeted). The victim is passive.
 * With no such opponent, the owner discards and draws instead, [BGA] only as many cards as can be drawn (the
 * discard pile is reshuffled into a short draw pile), so card 10 never changes a hand size. Owners with fewer than
 * 2 cards never get here: RIVPowerManager skips their power.
 * Hidden information: the owner and victim get a private notification with the cards; everyone else gets a public
 * one with the count only (the owner and victim hide that public row, so everyone sees exactly one row).
 */
class SwapCards extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 35,
            type: StateType::ACTIVE_PLAYER,
        );
    }

    //public: hand counts are public, and the owner already knows their own hand
    public function getArgs(): array
    {
        $activePlayerID = (int) $this->game->getActivePlayerId();
        $myHandCount = $this->game->tableManager->getHandCounts()[$activePlayerID] ?? 0;
        $targets = $this->game->powerManager->getSwapTargetsPOWER10($activePlayerID);
        $drawableCount = $this->game->tableManager->getDrawableCountPOWER10();

        $mode = empty($targets) ? 'redraw' : 'swap';

        return [
            'mode' => $mode,
            'targets' => $targets,
            'myHandCount' => $myHandCount,
            'drawableCount' => $drawableCount,
            'maxCards' => ($mode === 'swap') ? CARDS_SWAPPED_BY_POWER10 : min(CARDS_SWAPPED_BY_POWER10, $myHandCount, $drawableCount),
        ];
    }

    #[PossibleAction]
    public function actSwapCards_POWER10(#[IntArrayParam] array $cardIDs, int $targetPlayerId, int $activePlayerId)
    {
        $this->checkPendingPower($activePlayerId);

        $targetHandCounts = array_column($this->game->powerManager->getSwapTargetsPOWER10($activePlayerId), 'hand_count', 'player_id');
        if(!isset($targetHandCounts[$targetPlayerId]))
            throw new UserException(clienttranslate('You can only swap with an opponent still in the round who has at least 2 cards'));

        $swapCount = CARDS_SWAPPED_BY_POWER10;
        $this->checkOwnCards($cardIDs, $swapCount, $activePlayerId);

        $ownerGives = $this->getCards($cardIDs);
        $targetGives = $this->game->tableManager->getRandomHandCards($targetPlayerId, $swapCount);
        $targetCardIDs = array_column($targetGives, 'card_id');

        $this->game->DbQuery("UPDATE `cards` SET `card_location_arg` = $targetPlayerId WHERE `card_id` IN (".implode(',', $cardIDs).")");
        $this->game->DbQuery("UPDATE `cards` SET `card_location_arg` = $activePlayerId WHERE `card_id` IN (".implode(',', $targetCardIDs).")");
        $this->game->powerManager->clearPendingPower($activePlayerId, 10);
        $this->game->bga->playerStats->inc('powerUsed_POWER10', $swapCount, $activePlayerId);

        $swapLogStr = $this->game->getPlayerNameById($activePlayerId).' swaps '.$swapCount.' cards with '.$this->game->getPlayerNameById($targetPlayerId);

        //the owner and victim both know both sides of the swap
        $privateArgs = [
            'preserve' => ['owner_id', 'target_id', 'owner_gives', 'target_gives', 'count'],
            'owner_id' => $activePlayerId,
            'target_id' => $targetPlayerId,
            'owner_gives' => $ownerGives,
            'target_gives' => $targetGives,
            'count' => $swapCount,
            'CARDS_SWAPPED_POWER10_LOG_STR' => $swapLogStr,
        ];
        $this->bga->notify->player($activePlayerId, 'cardsSwapped_POWER10', '${CARDS_SWAPPED_POWER10_LOG_STR}', $privateArgs);
        $this->bga->notify->player($targetPlayerId, 'cardsSwapped_POWER10', '${CARDS_SWAPPED_POWER10_LOG_STR}', $privateArgs);

        $this->bga->notify->all('cardsSwappedPublic_POWER10', '${CARDS_SWAPPED_POWER10_LOG_STR}', [
            'preserve' => ['owner_id', 'target_id', 'count'],
            'owner_id' => $activePlayerId,
            'target_id' => $targetPlayerId,
            'count' => $swapCount,
            'CARDS_SWAPPED_POWER10_LOG_STR' => $swapLogStr,
        ]);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    #[PossibleAction]
    public function actRedrawCards_POWER10(#[IntArrayParam] array $cardIDs, int $activePlayerId)
    {
        $this->checkPendingPower($activePlayerId);

        if(!empty($this->game->powerManager->getSwapTargetsPOWER10($activePlayerId)))
            throw new UserException(clienttranslate('An opponent still in the round has 2 cards: swap with them'));

        $myHandCount = $this->game->tableManager->getHandCounts()[$activePlayerId] ?? 0;
        $redrawCount = min(CARDS_SWAPPED_BY_POWER10, $myHandCount, $this->game->tableManager->getDrawableCountPOWER10());
        if($redrawCount === 0)
            throw new UserException(clienttranslate('There is no card to draw'));

        $this->checkOwnCards($cardIDs, $redrawCount, $activePlayerId);
        $discarded = $this->getCards($cardIDs);

        //draw first: a reshuffled discard pile must not hand back the cards discarded now
        $drawn = $this->game->tableManager->drawCardsPOWER10($activePlayerId, $redrawCount);
        $this->game->DbQuery("UPDATE `cards` SET `card_location` = 'discard', `location_in_column` = NULL, `chain_position_POWER1` = NULL WHERE `card_id` IN (".implode(',', $cardIDs).")");
        $this->game->powerManager->clearPendingPower($activePlayerId, 10);
        $this->game->bga->playerStats->inc('powerUsed_POWER10', $redrawCount, $activePlayerId);

        $redrawLogStr = $this->game->getPlayerNameById($activePlayerId).' discards '.$redrawCount.' cards and draws '.count($drawn);

        $this->bga->notify->player($activePlayerId, 'cardsRedrawn_POWER10', '${CARDS_REDRAWN_POWER10_LOG_STR}', [
            'preserve' => ['player_id', 'discarded', 'drawn', 'count'],
            'player_id' => $activePlayerId,
            'discarded' => $discarded,
            'drawn' => $drawn,
            'count' => $redrawCount,
            'CARDS_REDRAWN_POWER10_LOG_STR' => $redrawLogStr,
        ]);

        $this->bga->notify->all('cardsRedrawnPublic_POWER10', '${CARDS_REDRAWN_POWER10_LOG_STR}', [
            'preserve' => ['player_id', 'count'],
            'player_id' => $activePlayerId,
            'count' => $redrawCount,
            'CARDS_REDRAWN_POWER10_LOG_STR' => $redrawLogStr,
        ]);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    #[PossibleAction]
    public function actSkip_POWER10(int $activePlayerId)
    {
        $this->game->powerManager->skipPower($activePlayerId, 10);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    private function checkPendingPower(int $playerID): void
    {
        if(!$this->game->powerManager->hasPendingPower($playerID, 10))
            throw new UserException(clienttranslate('You have no card 10 to use'));
    }

    //exactly $expectedCount distinct cards, all in $playerID's hand
    private function checkOwnCards(array $cardIDs, int $expectedCount, int $playerID): void
    {
        $cardIDs = array_values(array_unique(array_map('intval', $cardIDs)));
        if($expectedCount === 0 || count($cardIDs) !== $expectedCount)
            throw new UserException(clienttranslate('Choose the right number of cards'));

        $ownedCount = (int) $this->game->getUniqueValueFromDB("SELECT COUNT(*) FROM `cards` WHERE `card_id` IN (".implode(',', $cardIDs).") AND `card_location` = 'hand' AND `card_location_arg` = $playerID");
        if($ownedCount !== $expectedCount)
            throw new UserException(clienttranslate('These cards are not in your hand'));
    }

    private function getCards(array $cardIDs): array
    {
        $cardsDB = $this->game->getObjectListFromDB("SELECT * FROM `cards` WHERE `card_id` IN (".implode(',', array_map('intval', $cardIDs)).") ORDER BY `color` ASC, `value` ASC");
        return array_map(fn(array $cardDB) => $this->game->tableManager->formatCard($cardDB), $cardsDB);
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * Zombie level 1: a random choice among skipping and every target, giving 2 random cards of its own;
     * in the discard and draw fallback, a random choice between redrawing random cards and skipping.
     */
    function zombie(int $playerId) {
        $targetIDs = array_column($this->game->powerManager->getSwapTargetsPOWER10($playerId), 'player_id');

        if(!empty($targetIDs)){
            $choice = $this->getRandomZombieChoice(['skip', ...array_map('strval', $targetIDs)]);
            if($choice === 'skip')
                return $this->actSkip_POWER10($playerId);

            return $this->actSwapCards_POWER10($this->getRandomOwnCardIDs($playerId, CARDS_SWAPPED_BY_POWER10), (int) $choice, $playerId);
        }

        $myHandCount = $this->game->tableManager->getHandCounts()[$playerId] ?? 0;
        $redrawCount = min(CARDS_SWAPPED_BY_POWER10, $myHandCount, $this->game->tableManager->getDrawableCountPOWER10());
        if($redrawCount === 0 || $this->getRandomZombieChoice(['redraw', 'skip']) === 'skip')
            return $this->actSkip_POWER10($playerId);

        return $this->actRedrawCards_POWER10($this->getRandomOwnCardIDs($playerId, $redrawCount), $playerId);
    }

    private function getRandomOwnCardIDs(int $playerID, int $count): array
    {
        return array_column($this->game->tableManager->getRandomHandCards($playerID, $count), 'card_id');
    }
}
