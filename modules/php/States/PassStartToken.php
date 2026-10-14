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
 * PassStartToken.php
 */

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
     * The Start token passes to the next player in turn order every turn, even when everyone crashed. It passes right
     * after the reveal, before Stop or More, so this turn's card 2, 10 and 11 powers (after Stop or More) and the
     * next roll's card 9 powers resolve clockwise from the new holder.
     */
    function onEnteringState() {
        $this->game->tableManager->passStartToken();

        return StopOrMore::class;
    }
}
