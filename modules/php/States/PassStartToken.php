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
     * [BGA, confirmed with publisher] The Start token passes once every turn, after Stop or More is revealed (or right
     * after the card reveal when everyone crashed), so this turn's card 2, 10 and 11 powers and the next roll's card 9
     * powers resolve clockwise from the new holder. It also passes when the round ends.
     */
    function onEnteringState() {
        $this->game->tableManager->passStartToken();

        //with nobody left the round ends, and RoundSetup clears every pending power anyway
        if(count($this->game->getPlayerIDsInRound()) > 0){
            $this->game->powerManager->clearPreRollPowersOfPlayersOut();
            return $this->game->powerManager->goToNextPreRollPower();
        }

        return EndRound::class;
    }
}
