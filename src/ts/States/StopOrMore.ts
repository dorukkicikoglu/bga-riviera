/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * StopOrMore.ts
 */
import { Game } from "../Game";

/**
 * [BGA] Simultaneous Stop or More: everyone still in the round chooses at the same time. The choice stays
 * pending until the last player has chosen, and "Undo" takes it back.
 */
export class StopOrMore {
    private pendingChoice: StopOrMoreChoice | null = null;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
        this.pendingChoice = args?._private?.pendingStopOrMoreChoice ?? null; //restores the choice after F5
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
        this.bga.statusBar.removeActionButtons();

        if(isCurrentPlayerActive && this.game.myself){
            this.bga.statusBar.setTitle(_('${you} must choose an action'));

            const starsTotal = this.game.myself.getPlayedColumn().getStarsTotal();
            //the ★ gets its own span so its fallback font can't make this button taller than the others (see #stop-button in Game.scss)
            const stopLabel = _('Stop and bank ${stars} ★').replace('${stars}', starsTotal.toString()).replace('★', '<span class="button-star">★</span>');
            this.bga.statusBar.addActionButton(stopLabel, () => this.bga.actions.performAction('actStop'), {id: 'stop-button'});
            this.bga.statusBar.addActionButton(_('Keep Going'), () => this.bga.actions.performAction('actMore'), {id: 'more-button'});
        } else if(this.pendingChoice){
            const pendingChoiceTitles: Record<StopOrMoreChoice, string> = {
                stop: _('${you} chose to stop. Waiting for other players'),
                more: _('${you} chose to continue. Waiting for other players'),
            };
            this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice]);
            this.game.undoHandler.addUndoButton('actUndoStopOrMore');
        } else {
            this.bga.statusBar.setTitle(_('Others must choose: Stop or More'));
        }
    }

    //stopOrMoreChoiceConfirmed / stopOrMoreChoiceReverted; the status bar follows through onPlayerActivationChange
    public setPendingChoice(pendingChoice: StopOrMoreChoice | null): void {
        this.pendingChoice = pendingChoice;
    }
}
