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
 * RollDice.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

class RollDice extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 10,
            type: StateType::GAME,
        );
    }

    /**
     * Rolls every die in play, then card-9 owners may change a die, then everyone still in the round picks a card.
     */
    function onEnteringState() {
        $this->game->tableManager->rollDice();
        $this->game->bga->tableStats->inc('turns', 1);
        $dice = $this->game->tableManager->getDice();

        $diceLogParts = [];
        foreach($dice as $die){
            if($die['value'] !== null)
                $diceLogParts[] = $die['color'].' '.$die['value'];
        }

        $this->bga->notify->all('diceRolled', '${DICE_ROLLED_LOG_STR}', [
            'preserve' => ['dice'],
            'dice' => $dice,
            'DICE_ROLLED_LOG_STR' => 'Dice: '.implode(', ', $diceLogParts),
        ]);

        return $this->game->powerManager->goToNextPOWER9Owner();
    }
}
