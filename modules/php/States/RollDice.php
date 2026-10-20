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
     * [BGA] With the OPTION_FIRST_ROLL_REROLLS option on, the first roll of a round is silently re-rolled (up to FIRST_ROLL_MAX_REROLLS times)
     * while a player has no playable card: only the last roll is notified.
     */
    function onEnteringState() {
        $this->game->tableManager->rollDice();

        if($this->game->bga->globals->get('isFirstRollOfRound', false)){
            $this->game->bga->globals->set('isFirstRollOfRound', false);

            //null on a table created before the option existed: the default (on)
            $maxRerolls = $this->game->bga->tableOptions->get(OPTION_FIRST_ROLL_REROLLS) === FIRST_ROLL_REROLLS_OFF ? 0 : FIRST_ROLL_MAX_REROLLS;

            for($reroll = 1; $reroll <= $maxRerolls; $reroll++){
                $playerIDsWithNoPlayableCard = $this->game->tableManager->getPlayerIDsWithNoPlayableCard();
                if(empty($playerIDsWithNoPlayableCard))
                    break;

                if($this->game->getBgaEnvironment() === 'studio')
                    $this->game->trace("First roll re-rolled ($reroll/".FIRST_ROLL_MAX_REROLLS."): no playable card for player(s) ".implode(', ', $playerIDsWithNoPlayableCard));

                $this->game->tableManager->rollDice();
            }
        }

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
