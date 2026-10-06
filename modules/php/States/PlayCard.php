<?php

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
        $this->game->changeMindManager->resetChoices(self::CHOICE_COLUMNS);

        $inRoundIDs = $this->game->getPlayerIDsInRound();
        if(empty($inRoundIDs))
            return RevealCards::class;

        $this->game->gamestate->setPlayersMultiactive($inRoundIDs, RevealCards::class, true);
    }

    /**
     * Playable cards and pending choices are private: each player only gets their own.
     */
    public function getArgs(): array
    {
        $playersDB = $this->game->getCollectionFromDB("SELECT `player_id`, `last_chance_used`, `play_choice`, `play_choice_card_id` FROM `player` WHERE `round_status` = 'in'");

        $privateArgs = [];
        foreach($playersDB as $playerID => $playerDB){
            $pendingPlayChoice = null;
            if($playerDB['play_choice'] !== null){
                $pendingPlayChoice = [
                    'choice' => $playerDB['play_choice'],
                    'card_id' => ($playerDB['play_choice_card_id'] === null) ? null : (int) $playerDB['play_choice_card_id'],
                ];
            }

            $privateArgs[(int) $playerID] = [
                'playableCardIDs' => $this->game->tableManager->getPlayableCardIDs((int) $playerID),
                'canUseLastChance' => $playerDB['last_chance_used'] === 'no',
                'pendingPlayChoice' => $pendingPlayChoice,
            ];
        }

        return ['_private' => $privateArgs];
    }

    #[PossibleAction]
    public function actPlayCard(int $cardID, int $currentPlayerId)
    {
        if(!in_array($cardID, $this->game->tableManager->getPlayableCardIDs($currentPlayerId), true))
            throw new UserException(clienttranslate('This card cannot be played with these dice'));

        $this->game->changeMindManager->recordChoice($currentPlayerId, ['play_choice' => 'card', 'play_choice_card_id' => $cardID], 'playChoiceConfirmed', ['choice' => 'card', 'card_id' => $cardID], RevealCards::class);
    }

    #[PossibleAction]
    public function actUseLastChance(int $currentPlayerId)
    {
        if(count($this->game->tableManager->getPlayableCardIDs($currentPlayerId)) > 0)
            throw new UserException(clienttranslate('You can only use your Last Chance when no card is playable'));

        $lastChanceUsed = $this->game->getUniqueValueFromDB("SELECT `last_chance_used` FROM `player` WHERE `player_id` = $currentPlayerId");
        if($lastChanceUsed === 'yes')
            throw new UserException(clienttranslate('You already used your Last Chance'));

        $this->game->changeMindManager->recordChoice($currentPlayerId, ['play_choice' => 'last_chance', 'play_choice_card_id' => null], 'playChoiceConfirmed', ['choice' => 'last_chance', 'card_id' => null], RevealCards::class);
    }

    #[PossibleAction]
    public function actCrash(int $currentPlayerId)
    {
        if(count($this->game->tableManager->getPlayableCardIDs($currentPlayerId)) > 0)
            throw new UserException(clienttranslate('You can only crash when no card is playable'));

        $this->game->changeMindManager->recordChoice($currentPlayerId, ['play_choice' => 'crash', 'play_choice_card_id' => null], 'playChoiceConfirmed', ['choice' => 'crash', 'card_id' => null], RevealCards::class);
    }

    #[PossibleAction]
    #[CheckAction(false)]
    public function actChangeMindPlayCard(int $currentPlayerId)
    {
        $this->game->changeMindManager->changeMind('actChangeMindPlayCard', $currentPlayerId, self::CHOICE_COLUMNS, 'playChoiceReverted');
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * A random playable card, else the Last Chance if still available, else a crash.
     * Never use getCurrentPlayerId() here: there is no current player in a zombie call.
     */
    function zombie(int $playerId) {
        $playableCardIDs = $this->game->tableManager->getPlayableCardIDs($playerId);
        if(count($playableCardIDs) > 0)
            return $this->actPlayCard((int) $this->getRandomZombieChoice($playableCardIDs), $playerId);

        $lastChanceUsed = $this->game->getUniqueValueFromDB("SELECT `last_chance_used` FROM `player` WHERE `player_id` = $playerId");
        if($lastChanceUsed === 'no')
            return $this->actUseLastChance($playerId);

        return $this->actCrash($playerId);
    }
}
