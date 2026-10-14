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
 * EndRound.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class EndRound extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 60,
            type: StateType::GAME,
        );
    }

    /**
     * The round is over: nobody is still in. Stoppers already banked their stars when their Stop was revealed
     * (RevealStopOrMore) and crashes are recorded at the reveal (RevealCards), so all that is left is the 40-point check:
     * anyone at WINNING_SCORE or more ends the game (highest score wins, equal scores share the win).
     */
    function onEnteringState() {
        $maxScore = (int) $this->game->getUniqueValueFromDB("SELECT MAX(`player_score`) FROM `player`");
        if($maxScore >= WINNING_SCORE)
            return EndScore::class;

        return RoundSetup::class;
    }
}
