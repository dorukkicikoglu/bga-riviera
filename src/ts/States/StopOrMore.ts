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
    private powerCardNeedingMore: RivieraCard | null = null; //kept: the args only arrive on entering the state, and Undo rebuilds the buttons
    private powerIconID: string | null = null;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
        this.pendingChoice = args?._private?.pendingStopOrMoreChoice ?? null; //restores the choice after F5
        this.powerCardNeedingMore = args?._private?.powerCardNeedingMore ?? null;
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
        this.removePowerIconTooltip();
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args: StopOrMoreArgs, isCurrentPlayerActive: boolean) {
        this.removePowerIconTooltip();
        this.bga.statusBar.removeActionButtons();

        if(isCurrentPlayerActive && this.game.myself){
            this.bga.statusBar.setTitle(_('${you} must choose an action'));

            const starsTotal = this.game.myself.getPlayedColumn().getStarsTotal();
            //the ★ gets its own span so its fallback font can't make this button taller than the others (see #stop-button in Game.scss)
            //the piggy bank goes in front of the translated label, so translators never see the SVG
            const stopLabel = this.game.getPiggyBankSVG('button-piggy-bank') + _('Stop and bank ${stars}★').replace('${stars}', starsTotal.toString()).replace('★', '<span class="button-star">★</span>');
            this.bga.statusBar.addActionButton(stopLabel, () => this.bga.actions.performAction('actStop'), {id: 'stop-button'});
            //the logs' More icon, in front of the translated label like the Stop button's piggy bank
            //after the label, the card whose power only resolves if I keep going (nothing when there is none)
            const moreLabel = '<i class="fa6 fa-forward button-forward-icon" aria-hidden="true"></i>' + _('Keep Going') + this.game.getStatusCardIconHTML(this.powerCardNeedingMore);
            const moreButton = this.bga.statusBar.addActionButton(moreLabel, () => this.bga.actions.performAction('actMore'), {id: 'more-button'});
            const powerIcon = moreButton.querySelector('.status-card-icon') as HTMLElement | null;
            if(powerIcon){
                this.powerIconID = powerIcon.id;
                this.game.tooltipHandler?.addPowerNeedingMoreTooltip(powerIcon);
            }
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

    //the icon is inside the button, so the pointer is on it when it is clicked, and no mouseleave comes once the button is
    //gone: without this, its tooltip would stay on screen
    private removePowerIconTooltip(): void {
        if(this.powerIconID !== null)
            this.bga.gameui.removeTooltip(this.powerIconID);
        this.powerIconID = null;
    }

    //stopOrMoreChoiceConfirmed / stopOrMoreChoiceReverted; the status bar follows through onPlayerActivationChange
    public setPendingChoice(pendingChoice: StopOrMoreChoice | null): void {
        this.pendingChoice = pendingChoice;
    }
}
