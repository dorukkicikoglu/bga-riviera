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
     * Everyone sees the new hand counts; each player privately gets their own hand.
     */
    function onEnteringState() {
        $roundNumber = $this->game->bga->globals->inc('roundNumber', 1);

        $this->game->DbQuery("UPDATE `player` SET `round_status` = 'in', `play_choice` = NULL, `play_choice_card_id` = NULL, `stop_or_more_choice` = NULL");
        $this->game->tableManager->resetDice();
        $this->game->tableManager->shuffleAndDealCards();

        $this->bga->notify->all('newRound', '${NEW_ROUND_LOG_STR}', [
            'preserve' => ['round_number'],
            'round_number' => $roundNumber,
            'hand_counts' => $this->game->tableManager->getHandCounts(),
            'dice' => $this->game->tableManager->getDice(),
            'NEW_ROUND_LOG_STR' => 'Round '.$roundNumber,
        ]);

        $playerIDs = $this->game->getObjectListFromDB("SELECT `player_id` FROM `player`", true);
        foreach($playerIDs as $playerID)
            $this->bga->notify->player((int) $playerID, 'newHand', '', ['cards' => $this->game->tableManager->getHandCards((int) $playerID)]);

        return RollDice::class;
    }
}
