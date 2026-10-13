<?php

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\Actions\Types\IntParam;
use Bga\GameFramework\Actions\Types\StringParam;
use Bga\GameFramework\UserException;
use Bga\Games\Riviera\Game;

/**
 * Card 9, after the roll that follows it: the owner may turn one die by +1 or -1 (6 wraps to 1, 1 wraps to 6),
 * for everyone. A die changed this roll can't be changed again. Owners still in the round go one by one,
 * clockwise from the Start token holder; [BGA] the golden die is a valid target [UNCONFIRMED with publisher].
 */
class ModifyDie extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 15,
            type: StateType::ACTIVE_PLAYER,
        );
    }

    //the dice are public, so are the dice that can still be changed
    public function getArgs(): array
    {
        return ['modifiableDice' => $this->game->tableManager->getModifiableDicePOWER9()];
    }

    #[PossibleAction]
    public function actModifyDie_POWER9(#[StringParam(enum: ['red', 'green', 'purple', 'blue', 'orange', 'gold'])] string $dieColor, #[IntParam(min: -1, max: 1)] int $delta, int $activePlayerId)
    {
        if(!$this->game->powerManager->hasPendingPower($activePlayerId, 9))
            throw new UserException(clienttranslate('You have no card 9 to use'));

        if($delta === 0)
            throw new UserException(clienttranslate('A die must be turned by 1'));

        $modifiableDice = array_column($this->game->tableManager->getModifiableDicePOWER9(), 'value', 'color');
        if(!isset($modifiableDice[$dieColor]))
            throw new UserException(clienttranslate('This die cannot be changed'));

        $oldValue = (int) $modifiableDice[$dieColor];
        $newValue = (($oldValue - 1 + $delta + DIE_FACES) % DIE_FACES) + 1; //6 + 1 wraps to 1, 1 - 1 wraps to 6

        $this->game->DbQuery("UPDATE `dice` SET `die_value` = $newValue, `modified_by_POWER9` = 'yes' WHERE `die_color` = '$dieColor'");
        $this->game->powerManager->clearPendingPower($activePlayerId, 9);

        $dieModifiedLogStr = $this->game->getPlayerNameById($activePlayerId).' turns the '.$dieColor.' die from '.$oldValue.' to '.$newValue;
        $this->bga->notify->all('dieModified_POWER9', '${DIE_MODIFIED_POWER9_LOG_STR}', [
            'preserve' => ['player_id', 'die_color', 'old_value', 'new_value'],
            'player_id' => $activePlayerId,
            'die_color' => $dieColor,
            'old_value' => $oldValue,
            'new_value' => $newValue,
            'dice' => $this->game->tableManager->getDice(),
            'DIE_MODIFIED_POWER9_LOG_STR' => $dieModifiedLogStr,
        ]);

        return $this->game->powerManager->goToNextPOWER9Owner();
    }

    #[PossibleAction]
    public function actSkip_POWER9(int $activePlayerId)
    {
        $this->game->powerManager->skipPower($activePlayerId, 9);

        return $this->game->powerManager->goToNextPOWER9Owner();
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * A zombie doesn't use the power.
     */
    function zombie(int $playerId) { return $this->actSkip_POWER9($playerId); }
}
