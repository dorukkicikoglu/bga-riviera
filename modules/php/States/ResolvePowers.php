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
 * ResolvePowers.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\Riviera\Game;

/**
 * Card 11, before the next roll: the owner may add the golden die to the next roll, for everyone.
 * Card 2 needs no choice ([BGA] its reservation is automatic) and card 10 has SwapCards, so this state only asks
 * card-11 owners. RIVPowerManager::goToNextPreRollPower() walks the owners and picks the next state.
 * [UNCONFIRMED with publisher] The golden die is dropped if every player who added it chooses Stop, so a second
 * 11 in the same turn is asked too: adding it keeps the golden die if the first owner stops.
 */
class ResolvePowers extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 30,
            type: StateType::ACTIVE_PLAYER,
        );
    }

    public function getArgs(): array
    {
        return ['goldenDieAlreadyAdded' => $this->game->powerManager->isGoldenDieInUsePOWER11()];
    }

    #[PossibleAction]
    public function actAddGoldenDie_POWER11(int $activePlayerId)
    {
        if(!$this->game->powerManager->hasPendingPower($activePlayerId, 11))
            throw new UserException(clienttranslate('You have no card 11 to use'));

        //blank until the next roll; the dice expire it again after the reveal of that turn
        $this->game->DbQuery("UPDATE `dice` SET `in_use_by_POWER11` = 'yes', `die_value` = NULL WHERE `die_color` = 'gold'");
        $this->game->DbQuery("UPDATE `player` SET `added_golden_die_POWER11` = 'yes' WHERE `player_id` = $activePlayerId");
        $this->game->powerManager->clearPendingPower($activePlayerId, 11);
        $this->game->bga->playerStats->inc('powerUsed_POWER11', 1, $activePlayerId);

        $goldenDieLogStr = $this->game->getPlayerNameById($activePlayerId).' adds the golden die to the next roll';
        $this->bga->notify->all('goldenDieAdded_POWER11', '${GOLDEN_DIE_POWER11_LOG_STR}', [
            'preserve' => ['player_id'],
            'player_id' => $activePlayerId,
            'dice' => $this->game->tableManager->getDice(),
            'GOLDEN_DIE_POWER11_LOG_STR' => $goldenDieLogStr,
        ]);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    #[PossibleAction]
    public function actSkip_POWER11(int $activePlayerId)
    {
        $this->game->powerManager->skipPower($activePlayerId, 11);

        return $this->game->powerManager->goToNextPreRollPower();
    }

    /**
     * This method is called each time it is the turn of a player who has quit the game (= "zombie" player).
     * Zombie level 1: adds the golden die or skips, at random.
     */
    function zombie(int $playerId) {
        if($this->getRandomZombieChoice(['add', 'skip']) === 'add')
            return $this->actAddGoldenDie_POWER11($playerId);

        return $this->actSkip_POWER11($playerId);
    }
}
