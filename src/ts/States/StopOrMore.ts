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
    private static readonly POWER_ICON_ID = 'more-button-power-icon';
    private powerTooltipIDs: string[] = []; //the disc's and its power icon's, removed before the buttons go

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
            //stopping now most likely wins: the button says the score I'd reach and gets the finishing look
            //(.stop-button-finishing in Game.scss). Worked out again every time the buttons are drawn
            const totalAfterBanking = this.game.myself.getScore() + starsTotal;
            const isFinishing = this.isLikelyWinningStop(totalAfterBanking);
            const stopText = isFinishing ? _('Stop and reach ${total}★').replace('${total}', totalAfterBanking.toString()) : _('Stop and bank ${stars}★').replace('${stars}', starsTotal.toString());
            //the ★ gets its own span so its fallback font can't make this button taller than the others (see #stop-button in Game.scss)
            //the bank icon goes in front of the translated label, so translators never see its HTML
            const stopLabel = this.game.getBankIconHtml('button-bank-icon') + stopText.replace('★', '<span class="button-star">★</span>');
            const stopButton = this.bga.statusBar.addActionButton(stopLabel, () => this.bga.actions.performAction('actStop'), {id: 'stop-button'});
            stopButton.classList.toggle('stop-button-finishing', isFinishing);
            //the logs' More icon, in front of the translated label like the Stop button's bank icon
            //after the label, the card whose power only resolves if I keep going (nothing when there is none)
            const moreLabel = '<i class="fa6 fa-forward button-forward-icon" aria-hidden="true"></i>' + _('Keep Going') + this.game.getStatusCardIconHTML(this.powerCardNeedingMore);
            const moreButton = this.bga.statusBar.addActionButton(moreLabel, () => this.bga.actions.performAction('actMore'), {id: 'more-button'});
            const powerDisc = moreButton.querySelector('.status-card-icon') as HTMLElement | null;
            if(powerDisc){
                //that card's power icon (the power reference's .power-icon), hanging under the disc, added with it, so it shows
                //exactly when the disc does. Beside the disc, not in it, in an anchor with the disc's box (Game.scss,
                //#more-button .more-button-power-icon-anchor): the disc's tooltip can open below the disc, over the icon, and BGA
                //closes a tooltip as soon as the pointer enters it, so the icon gets its own tooltip, placed around the icon.
                //BGA's single tooltip popup means only one of the two is ever open
                powerDisc.insertAdjacentHTML('afterend', `<span class="more-button-power-icon-anchor"><span id="${StopOrMore.POWER_ICON_ID}" class="power-icon more-button-power-icon" data-power-value="${this.powerCardNeedingMore.value}" aria-hidden="true"></span></span>`);
                const powerIcon = document.getElementById(StopOrMore.POWER_ICON_ID);
                //it mostly hangs below the button, so a click on it never reaches the button: no Keep Going from a misclick.
                //In the capture phase, and stopped there, so BGA's own click listener on the icon (which closes its tooltip)
                //doesn't run either, and a tap can open the tooltip like a hover
                powerIcon.addEventListener('click', (event: Event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }, true);
                for(const element of [powerDisc, powerIcon]){
                    this.powerTooltipIDs.push(element.id);
                    this.game.tooltipHandler?.addPowerNeedingMoreTooltip(element);
                }
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

    //"if I stop now, I most likely win": my total after banking reaches the end-game target and is strictly more than every
    //other player's best possible total this round (a tie doesn't count). That best is their score plus their column stars
    //while they are still in the round (they could still bank them), and their score alone once they have stopped (the
    //column is already in it) or crashed (the column is gone)
    private isLikelyWinningStop(totalAfterBanking: number): boolean {
        if(totalAfterBanking < this.game.getWinningScore())
            return false;

        return Object.values(this.game.players).every(player => {
            if(player === this.game.myself)
                return true;
            const bestTotal = player.getScore() + (player.getRoundStatus() === 'in' ? player.getPlayedColumn().getStarsTotal() : 0);
            return totalAfterBanking > bestTotal;
        });
    }

    //the disc is inside the button, so the pointer is on it when it is clicked, and no mouseleave comes once the button is
    //gone: without this, its tooltip would stay on screen. The same for the power icon under it
    private removePowerIconTooltip(): void {
        this.powerTooltipIDs.forEach(id => this.bga.gameui.removeTooltip(id));
        this.powerTooltipIDs = [];
    }

    //stopOrMoreChoiceConfirmed / stopOrMoreChoiceReverted; the status bar follows through onPlayerActivationChange
    public setPendingChoice(pendingChoice: StopOrMoreChoice | null): void {
        this.pendingChoice = pendingChoice;
    }
}
