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
 * PlayCard.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\Actions\CheckAction;
use Bga\GameFramework\UserException;
use Bga\Games\Riviera\Game;

/**
 * Every player still in the round secretly picks a playable card, or (only when none is playable) uses their
 * Last Chance or crashes. Choices stay pending, and can be changed, until the last player has chosen;
 * RevealCards then applies them all at once.
 * [BGA] Card 1: confirming a 1 keeps the player active to add another playable card (same roll) or finish,
 * again after each extra 1. The whole chain is one pending choice: the extra cards are marked with
 * chain_position_POWER1, and Undo takes the whole chain back.
 */
class PlayCard extends GameState
{
    private const CHOICE_COLUMNS = ['play_choice', 'play_choice_card_id'];

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 20,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    function onEnteringState() {
        $this->game->undoManager->resetChoices(self::CHOICE_COLUMNS);
        $this->game->tableManager->clearChainPOWER1();

        $inRoundIDs = $this->game->getPlayerIDsInRound();
        if(empty($inRoundIDs))
            return RevealCards::class;

        $this->game->gamestate->setPlayersMultiactive($inRoundIDs, RevealCards::class, true);
    }

    /**
     * Playable cards and pending choices are private: each player only gets their own.
     * playableCardIDs leaves out the cards already chosen, so in the middle of a chain it lists the possible next cards.
     */
    public function getArgs(): array
    {
        $playersDB = $this->game->getCollectionFromDB("SELECT `player_id`, `last_chance_used`, `play_choice`, `play_choice_card_id` FROM `player` WHERE `round_status` = 'in'");

        $privateArgs = [];
        foreach($playersDB as $playerID => $playerDB){
            $playerID = (int) $playerID;

            $pendingPlayChoice = null;
            if($playerDB['play_choice'] !== null){
                $pendingPlayChoice = [
                    'choice' => $playerDB['play_choice'],
                    'card_id' => ($playerDB['play_choice_card_id'] === null) ? null : (int) $playerDB['play_choice_card_id'],
                ];
            }

            $privateArgs[$playerID] = [
                'playableCardIDs' => $this->getRemainingPlayableCardIDs($playerID),
                'canUseLastChance' => $playerDB['last_chance_used'] === 'no',
                'pendingPlayChoice' => $pendingPlayChoice,
                'chainCardIDs_POWER1' => $this->game->tableManager->getChainCardIDsPOWER1($playerID),
                'chainOpen_POWER1' => $this->isMidChainPOWER1($playerID),
            ];
        }

        return ['_private' => $privateArgs];
    }

    #[PossibleAction]
    public function actPlayCard(int $cardID, int $currentPlayerId)
    {
        $this->playCard($cardID, $currentPlayerId);
    }

    #[PossibleAction]
    public function actAddChainCard_POWER1(int $cardID, int $currentPlayerId)
    {
        if(!$this->isMidChainPOWER1($currentPlayerId))
            throw new UserException(clienttranslate('You are not adding cards to a 1'));

        if(!in_array($cardID, $this->getRemainingPlayableCardIDs($currentPlayerId), true))
            throw new UserException(clienttranslate('This card cannot be played with these dice'));

        $chainPosition = count($this->game->tableManager->getChainCardIDsPOWER1($currentPlayerId)) + 1;
        $this->game->DbQuery("UPDATE `cards` SET `chain_position_POWER1` = $chainPosition WHERE `card_id` = $cardID AND `card_location` = 'hand' AND `card_location_arg` = $currentPlayerId");

        $nextPlayableCardIDs = $this->getRemainingPlayableCardIDs($currentPlayerId);
        $chainOpen = $this->getCardValue($cardID) === CHAIN_CARD_VALUE_POWER1 && count($nextPlayableCardIDs) > 0;

        $this->game->bga->notify->player($currentPlayerId, 'playChainUpdated_POWER1', '', [
            'chainCardIDs_POWER1' => $this->game->tableManager->getChainCardIDsPOWER1($currentPlayerId),
            'playableCardIDs' => $nextPlayableCardIDs,
            'chainOpen_POWER1' => $chainOpen,
        ]);

        if(!$chainOpen)
            $this->game->gamestate->setPlayerNonMultiactive($currentPlayerId, RevealCards::class);
    }

    #[PossibleAction]
    public function actFinishChain_POWER1(int $currentPlayerId)
    {
        if(!$this->isMidChainPOWER1($currentPlayerId))
            throw new UserException(clienttranslate('You are not adding cards to a 1'));

        $this->game->gamestate->setPlayerNonMultiactive($currentPlayerId, RevealCards::class);
    }

    #[PossibleAction]
    public function actUseLastChance(int $currentPlayerId)
    {
        $this->checkNoPendingChoice($currentPlayerId);

        if(count($this->game->tableManager->getPlayableCardIDs($currentPlayerId)) > 0)
            throw new UserException(clienttranslate('You can only use your Last Chance when no card is playable'));

        $lastChanceUsed = $this->game->getUniqueValueFromDB("SELECT `last_chance_used` FROM `player` WHERE `player_id` = $currentPlayerId");
        if($lastChanceUsed === 'yes')
            throw new UserException(clienttranslate('You already used your Last Chance'));

        $this->game->undoManager->recordChoice($currentPlayerId, ['play_choice' => 'last_chance', 'play_choice_card_id' => null], 'playChoiceConfirmed', $this->getChoiceNotifArgs('last_chance', null, [], false), RevealCards::class);
    }

    #[PossibleAction]
    public function actCrash(int $currentPlayerId)
    {
        $this->checkNoPendingChoice($currentPlayerId);

        if(count($this->game->tableManager->getPlayableCardIDs($currentPlayerId)) > 0)
            throw new UserException(clienttranslate('You can only crash when no card is playable'));

        $this->game->undoManager->recordChoice($currentPlayerId, ['play_choice' => 'crash', 'play_choice_card_id' => null], 'playChoiceConfirmed', $this->getChoiceNotifArgs('crash', null, [], false), RevealCards::class);
    }

    //also takes a whole card-1 chain back, so the player chooses a first card again
    #[PossibleAction]
    #[CheckAction(false)]
    public function actUndoPlayCard(int $currentPlayerId)
    {
        $notifArgs = ['playableCardIDs' => $this->game->tableManager->getPlayableCardIDs($currentPlayerId)];
        $this->game->undoManager->undo('actUndoPlayCard', $currentPlayerId, self::CHOICE_COLUMNS, 'playChoiceReverted', $notifArgs);
        $this->game->tableManager->clearChainPOWER1($currentPlayerId);
    }

    /**
     * Saves a first card. A 1 keeps the player active to chain another card, unless nothing else is playable.
     * Returns whether the chain is open.
     */
    private function playCard(int $cardID, int $playerID): bool
    {
        $this->checkNoPendingChoice($playerID);

        if(!in_array($cardID, $this->game->tableManager->getPlayableCardIDs($playerID), true))
            throw new UserException(clienttranslate('This card cannot be played with these dice'));

        $choiceValues = ['play_choice' => 'card', 'play_choice_card_id' => $cardID];

        if($this->getCardValue($cardID) !== CHAIN_CARD_VALUE_POWER1){
            $this->game->undoManager->recordChoice($playerID, $choiceValues, 'playChoiceConfirmed', $this->getChoiceNotifArgs('card', $cardID, [], false), RevealCards::class);
            return false;
        }

        $nextPlayableCardIDs = array_values(array_diff($this->game->tableManager->getPlayableCardIDs($playerID), [$cardID]));
        $chainOpen = count($nextPlayableCardIDs) > 0;

        $this->game->undoManager->savePendingChoice($playerID, $choiceValues, 'playChoiceConfirmed', $this->getChoiceNotifArgs('card', $cardID, $nextPlayableCardIDs, $chainOpen));
        if(!$chainOpen) //nothing else to add: the chain finishes on its own
            $this->game->gamestate->setPlayerNonMultiactive($playerID, RevealCards::class);

        return $chainOpen;
    }

    private function getChoiceNotifArgs(string $choice, ?int $cardID, array $playableCardIDs, bool $chainOpen): array
    {
        return [
            'choice' => $choice,
            'card_id' => $cardID,
            'chainCardIDs_POWER1' => [],
            'playableCardIDs' => $playableCardIDs,
            'chainOpen_POWER1' => $chainOpen,
        ];
    }

    //the player is still active with a card chosen: they confirmed a 1 and are adding cards to it
    private function isMidChainPOWER1(int $playerID): bool
    {
        $playChoice = $this->game->getUniqueValueFromDB("SELECT `play_choice` FROM `player` WHERE `player_id` = $playerID");
        return $playChoice === 'card' && $this->game->gamestate->isPlayerActive($playerID);
    }

    //a player still choosing in a chain is active too, so the active-player check doesn't stop them from choosing twice
    private function checkNoPendingChoice(int $playerID): void
    {
        $playChoice = $this->game->getUniqueValueFromDB("SELECT `play_choice` FROM `player` WHERE `player_id` = $playerID");
        if($playChoice !== null)
            throw new UserException(clienttranslate('You already chose. Change your mind first'));
    }

    //playable cards minus the first card and the chain cards already chosen
    private function getRemainingPlayableCardIDs(int $playerID): array
    {
        $chosenCardIDs = $this->game->tableManager->getChainCardIDsPOWER1($playerID);
        $firstCardID = $this->game->getUniqueValueFromDB("SELECT `play_choice_card_id` FROM `player` WHERE `player_id` = $playerID");
        if($firstCardID !== null)
            $chosenCardIDs[] = (int) $firstCardID;

        return array_values(array_diff($this->game->tableManager->getPlayableCardIDs($playerID), $chosenCardIDs));
    }

    private function getCardValue(int $cardID): int
    {
        return (int) $this->game->getUniqueValueFromDB("SELECT `value` FROM `cards` WHERE `card_id` = $cardID");
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * Zombie level 1: a random possible action. A random playable card; after a 1, each step of the chain is random
     * between every playable extra card and Skip. With no playable card, random between the buttons a player would
     * see: Last Chance (if still available) and Crash.
     * Never use getCurrentPlayerId() here: there is no current player in a zombie call.
     */
    function zombie(int $playerId) {
        if($this->isMidChainPOWER1($playerId)){
            $this->zombieChainPOWER1($playerId);
            return;
        }

        $playableCardIDs = $this->game->tableManager->getPlayableCardIDs($playerId);
        if(count($playableCardIDs) > 0){
            if($this->playCard((int) $this->getRandomZombieChoice($playableCardIDs), $playerId))
                $this->zombieChainPOWER1($playerId);
            return;
        }

        $choices = ['crash'];
        if($this->game->getUniqueValueFromDB("SELECT `last_chance_used` FROM `player` WHERE `player_id` = $playerId") === 'no')
            $choices[] = 'last_chance';

        if($this->getRandomZombieChoice($choices) === 'last_chance')
            return $this->actUseLastChance($playerId);

        return $this->actCrash($playerId);
    }

    //the whole chain happens in this one call: the framework doesn't call zombie() again for a player who stays active
    private function zombieChainPOWER1(int $playerID): void
    {
        for($step = 0; $step < CARDS_PER_HAND && $this->isMidChainPOWER1($playerID); $step++){
            $nextCardIDs = $this->getRemainingPlayableCardIDs($playerID);
            $choice = empty($nextCardIDs) ? 'skip' : $this->getRandomZombieChoice(['skip', ...array_map('strval', $nextCardIDs)]);
            if($choice === 'skip'){
                $this->actFinishChain_POWER1($playerID);
                return;
            }

            $this->actAddChainCard_POWER1((int) $choice, $playerID);
        }

        if($this->isMidChainPOWER1($playerID))
            $this->actFinishChain_POWER1($playerID);
    }
}
