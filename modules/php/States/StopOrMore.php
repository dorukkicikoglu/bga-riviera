<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\Actions\CheckAction;
use Bga\Games\Riviera\Game;

/**
 * [BGA] Simultaneous Stop or More: every player still in the round chooses at the same time. Choices stay
 * pending, and can be changed, until the last player has chosen; RevealStopOrMore then applies them all at once.
 */
class StopOrMore extends GameState
{
    private const CHOICE_COLUMNS = ['stop_or_more_choice'];

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 50,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    function onEnteringState() {
        $this->game->changeMindManager->resetChoices(self::CHOICE_COLUMNS);

        $inRoundIDs = $this->game->getPlayerIDsInRound();
        if(empty($inRoundIDs)) //everyone crashed
            return EndRound::class;

        $this->game->gamestate->setPlayersMultiactive($inRoundIDs, RevealStopOrMore::class, true);
    }

    /**
     * Pending choices are private: each player only gets their own.
     */
    public function getArgs(): array
    {
        $pendingChoices = $this->game->getCollectionFromDB("SELECT `player_id`, `stop_or_more_choice` FROM `player` WHERE `round_status` = 'in'", true);

        $privateArgs = [];
        foreach($pendingChoices as $playerID => $pendingChoice)
            $privateArgs[(int) $playerID] = ['pendingStopOrMoreChoice' => $pendingChoice];

        return ['_private' => $privateArgs];
    }

    #[PossibleAction]
    public function actStop(int $currentPlayerId)
    {
        $this->game->changeMindManager->recordChoice($currentPlayerId, ['stop_or_more_choice' => 'stop'], 'stopOrMoreChoiceConfirmed', ['choice' => 'stop'], RevealStopOrMore::class);
    }

    #[PossibleAction]
    public function actMore(int $currentPlayerId)
    {
        $this->game->changeMindManager->recordChoice($currentPlayerId, ['stop_or_more_choice' => 'more'], 'stopOrMoreChoiceConfirmed', ['choice' => 'more'], RevealStopOrMore::class);
    }

    #[PossibleAction]
    #[CheckAction(false)]
    public function actChangeMindStopOrMore(int $currentPlayerId)
    {
        $this->game->changeMindManager->changeMind('actChangeMindStopOrMore', $currentPlayerId, self::CHOICE_COLUMNS, 'stopOrMoreChoiceReverted');
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * A zombie banks what it has.
     */
    function zombie(int $playerId) { return $this->actStop($playerId); }
}
