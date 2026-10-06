<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class PassStartToken extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 40,
            type: StateType::GAME,
        );
    }

    /**
     * The Start token passes to the next player in turn order every turn, even when everyone crashed.
     */
    function onEnteringState() {
        $this->game->tableManager->passStartToken();

        return StopOrMore::class;
    }
}
