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
     * [BGA, confirmed with publisher] The Start token passes once every turn, after Stop or More is revealed and
     * [BGA] after this turn's card 10 powers (they resolve clockwise from the holder before the pass, see
     * RevealStopOrMore), or right after the card reveal when everyone crashed. This turn's card 2 and 11 powers and
     * the next roll's card 9 powers resolve clockwise from the new holder. When the round ends it passes in EndRound
     * instead, after the 40-point check, so it isn't passed if the game just ended.
     */
    function onEnteringState() {
        //with nobody left the round ends, and RoundSetup clears every pending power anyway
        if(count($this->game->getPlayerIDsInRound()) === 0)
            return EndRound::class;

        $this->game->tableManager->passStartToken();
        return $this->game->powerManager->goToNextPreRollPower();
    }
}
