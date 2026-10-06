<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\Riviera\Game;

/**
 * Milestone 1 stub: every player still in the round is active and the game rests here.
 * Card play (simultaneous, with change my mind) arrives in Milestone 2.
 */
class PlayCard extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 20,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    function onEnteringState() {
        $this->game->gamestate->setPlayersMultiactive($this->game->getPlayerIDsInRound(), '', true);
    }

    public function getArgs(): array
    {
        return [];
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * Milestone 2 makes the zombie play a random valid card (or crash).
     */
    function zombie(int $playerId) {
    }
}
