<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class RoundSetup extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 5,
            type: StateType::GAME,
        );
    }

    /**
     * Starts a new round: everyone is back in, dice are cleared and new hands are dealt (with the silent redeal).
     */
    function onEnteringState() {
        $this->game->bga->globals->inc('roundNumber', 1);

        $this->game->DbQuery("UPDATE `player` SET `round_status` = 'in'");
        $this->game->tableManager->resetDice();
        $this->game->tableManager->shuffleAndDealCards();

        return PlayCard::class;
    }
}
