<?php

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
     * Rolls every die in play, then everyone still in the round picks a card.
     */
    function onEnteringState() {
        $this->game->tableManager->rollDice();
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

        return PlayCard::class;
    }
}
