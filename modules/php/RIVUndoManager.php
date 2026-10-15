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
 * RIVUndoManager.php
 */

namespace Bga\Games\Riviera;

use Bga\Games\Riviera\Game;
use Bga\GameFramework\UserException;

/**
 * Undo, shared by the PlayCard and StopOrMore multiactive states.
 * A choice is only a pending value in the player's choice columns until the state's reveal state applies it,
 * so changing your mind just sets those columns back to NULL and re-activates you.
 * The last player to choose ends the state at once, which locks every choice in.
 */
class RIVUndoManager{
    public Game $game;

    function __construct(Game $game) {
        $this->game = $game;
    }

    /**
     * Called on entering the state: nobody has a pending choice, nobody chose yet.
     */
    function resetChoices(array $choiceColumns): void{
        $columnUpdates = array_map(fn(string $column) => "`$column` = NULL", $choiceColumns);
        $columnUpdates[] = "`made_choice_this_state` = 'no'";

        $this->game->DbQuery("UPDATE `player` SET ".implode(', ', $columnUpdates));
    }

    /**
     * Saves the choice as pending, tells only that player, and makes them inactive (the last one ends the state).
     * $choiceValues maps a column to an int, an ENUM literal or null; never a user string.
     */
    function recordChoice(int $playerID, array $choiceValues, string $notifName, array $notifArgs, string $nextState): void{
        $this->savePendingChoice($playerID, $choiceValues, $notifName, $notifArgs);

        $this->game->gamestate->setPlayerNonMultiactive($playerID, $nextState);
    }

    /**
     * Saves the choice as pending and tells only that player, who stays active (a card-1 chain goes on choosing).
     */
    function savePendingChoice(int $playerID, array $choiceValues, string $notifName, array $notifArgs): void{
        $madeChoiceThisState = $this->game->getUniqueValueFromDB("SELECT `made_choice_this_state` FROM `player` WHERE `player_id` = $playerID");
        if($madeChoiceThisState === 'no')
            $this->game->giveExtraTime($playerID); //only on the first choice, so changing your mind can't farm time

        $columnUpdates = [];
        foreach($choiceValues as $column => $value){
            if($value === null)
                $columnUpdates[] = "`$column` = NULL";
            else if(is_int($value))
                $columnUpdates[] = "`$column` = $value";
            else $columnUpdates[] = "`$column` = '$value'";
        }
        $columnUpdates[] = "`made_choice_this_state` = 'yes'";

        $this->game->DbQuery("UPDATE `player` SET ".implode(', ', $columnUpdates)." WHERE `player_id` = $playerID");

        $this->game->bga->notify->player($playerID, $notifName, '', $notifArgs);
    }

    /**
     * Callable by an inactive player: the action carries #[CheckAction(false)], so the state is checked here instead.
     * The first column of $choiceColumns tells whether the player has a pending choice to take back.
     * A player still choosing (in the middle of a card-1 chain) can take it back too: re-activating them changes nothing.
     */
    function undo(string $actionName, int $playerID, array $choiceColumns, string $notifName, array $notifArgs = []): void{
        $this->game->gamestate->checkPossibleAction($actionName);

        if($this->isPlayerZombie($playerID))
            return;

        $pendingChoice = $this->game->getUniqueValueFromDB("SELECT `{$choiceColumns[0]}` FROM `player` WHERE `player_id` = $playerID");
        if($pendingChoice === null)
            throw new UserException(clienttranslate('You have no choice to change'));

        $columnUpdates = array_map(fn(string $column) => "`$column` = NULL", $choiceColumns);
        $this->game->DbQuery("UPDATE `player` SET ".implode(', ', $columnUpdates)." WHERE `player_id` = $playerID");

        $this->game->bga->notify->player($playerID, $notifName, '', $notifArgs);

        //non-exclusive: adds the player back to the active set, so the transition is never used
        $this->game->gamestate->setPlayersMultiactive([$playerID], '', false);
    }

    function isPlayerZombie(int $playerID): bool{
        return (int) $this->game->getUniqueValueFromDB("SELECT `player_zombie` FROM `player` WHERE `player_id` = $playerID") === 1;
    }
}

?>
