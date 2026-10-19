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
 * NextPOWER10Owner.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

/**
 * Hands card 10 over to the next owner, like Fugu's NextPlayer between two PlayerTurns: RevealCards and every
 * SwapCards action come here, so SwapCards is always entered from a GAME state and never re-enters itself.
 * RIVPowerManager::goToNextPOWER10Owner() picks the next owner in the stored order (SwapCards) or, once everyone has
 * resolved their 10, Stop or More (StopOrMore).
 */
class NextPOWER10Owner extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 33,
            type: StateType::GAME,
        );
    }

    function onEnteringState() {
        return $this->game->powerManager->goToNextPOWER10Owner();
    }
}
