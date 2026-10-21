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
 * ModifyDie.php
 */

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
 * clockwise from the Start token holder. The golden die and a reserved die are valid targets.
 * [BGA] When the owner is the only player still in the round, PlayCard offers Undo to bring them back here.
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

    //the dice are public, so are the dice that can still be changed; powerCard is the owner's 9, shown in the status bar
    public function getArgs(): array
    {
        return [
            'modifiableDice' => $this->game->tableManager->getModifiableDicePOWER9(),
            'powerCard' => $this->game->tableManager->getLastPlayedCard((int) $this->game->getActivePlayerId()),
        ];
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
        $this->game->bga->playerStats->inc('powerUsed_POWER9', 1, $activePlayerId);

        //the log row's move: an undo removes every log from it (PlayCard::actUndoDieChange_POWER9)
        $moveID = $this->game->bga->logs->getCurrentMoveId();

        $dieModifiedLogStr = $this->game->getPlayerNameById($activePlayerId).' turns the '.$dieColor.' die from '.$oldValue.' to '.$newValue;
        $this->bga->notify->all('dieModified_POWER9', '${DIE_MODIFIED_POWER9_LOG_STR}', [
            'preserve' => ['player_id', 'die_color', 'old_value', 'new_value', 'move_id'],
            'player_id' => $activePlayerId,
            'die_color' => $dieColor,
            'old_value' => $oldValue,
            'new_value' => $newValue,
            'move_id' => $moveID,
            'dice' => $this->game->tableManager->getDice(),
            'DIE_MODIFIED_POWER9_LOG_STR' => $dieModifiedLogStr,
        ]);

        //[BGA] the only player still in the round may take the change back in PlayCard, until they confirm a card. Never a zombie
        if($this->game->getPlayerIDsInRound() === [$activePlayerId] && !$this->game->undoManager->isPlayerZombie($activePlayerId)){
            $this->game->bga->globals->set('undoableDieChange_POWER9', [
                'player_id' => $activePlayerId,
                'die_color' => $dieColor,
                'old_value' => $oldValue,
                'move_id' => $moveID,
            ]);
        }

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
     * Zombie level 1: a random choice among skipping and turning any changeable die by -1 or +1.
     */
    function zombie(int $playerId) {
        $choices = ['skip'];
        foreach($this->game->tableManager->getModifiableDicePOWER9() as $die){
            $choices[] = $die['color'].':-1';
            $choices[] = $die['color'].':1';
        }

        $choice = $this->getRandomZombieChoice($choices);
        if($choice === 'skip')
            return $this->actSkip_POWER9($playerId);

        [$dieColor, $delta] = explode(':', $choice);
        return $this->actModifyDie_POWER9($dieColor, (int) $delta, $playerId);
    }
}
