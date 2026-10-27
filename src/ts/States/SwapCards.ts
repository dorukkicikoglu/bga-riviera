/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * SwapCards.ts
 */
import { Game } from "../Game";

/**
 * Card 10, after the reveal and before Stop or More (the owner is still in the round): the active owner selects 2 cards
 * from their hand, then the opponent to swap them with (the opponent's cards are random). Only opponents still in the
 * round with at least 2 cards can be chosen.
 * With none, the owner discards and draws instead; when only 1 card can be drawn, a confirmation explains it first.
 * Everyone else sees the power prompt ("<name> may use [10]") throughout.
 */
export class SwapCards {
    private args: SwapCardsArgs | null = null;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: SwapCardsArgs, isCurrentPlayerActive: boolean) {
        this.args = args;

        if(!isCurrentPlayerActive || !this.game.handHandler){
            this.game.setPowerPromptTitle(args?.powerCard ?? null, false);
            return;
        }

        this.game.handHandler.setSelectableCards(this.game.handHandler.getHandCardIDs(), args.maxCards);
        this.updateStatusBar();
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: SwapCardsArgs, isCurrentPlayerActive: boolean) {
        this.game.handHandler?.clearSelectableCards();
        this.args = null;
    }

    //called through Game.handSelectionChanged when a card is selected or unselected
    public selectionChanged(): void {
        this.updateStatusBar();
    }

    //step 1, fewer cards selected than the power takes: "You may choose 2 cards to swap [10]" (or to discard) with Skip alone.
    //Step 2, all selected: the selected cards' circular icons in the title, then one button per opponent (swap) or Confirm
    //(discard and draw), plus Skip. Rebuilt from the selection on every change, so unselecting a card goes back to step 1
    private updateStatusBar(): void {
        if(!this.args)
            return;

        this.bga.statusBar.removeActionButtons();
        const selectedCardIDs = this.game.handHandler.getSelectedCardIDs();
        const isSwap = this.args.mode === 'swap';

        if(selectedCardIDs.length < this.args.maxCards){
            let title = _('${you} may choose 2 cards to swap ${card}');
            if(!isSwap)
                title = (this.args.maxCards === 1) ? _('${you} may choose 1 card to discard ${card}') : _('${you} may choose 2 cards to discard ${card}');
            this.bga.statusBar.setTitle(title, { card: this.game.getStatusCardWithPowerHTML(this.args.powerCard) });
        } else {
            const cardsIcons = selectedCardIDs.map(cardID => this.game.getStatusCardIconHTML(this.game.handHandler.getCardData(cardID))).join('');

            if(isSwap){
                this.bga.statusBar.setTitle(_('Choose an opponent to swap ${cards}'), { cards: cardsIcons });
                for(let target of this.args.targets){
                    const label = _('Swap with ${player_name}').replace('${player_name}', '<b>' + this.game.getPlayerName(target.player_id) + '</b>');
                    this.game.addPlayerChoiceButton(target.player_id, label, () => this.swapClicked(target, selectedCardIDs), {id: 'swap-with-' + target.player_id + '-button'});
                }
            } else {
                this.bga.statusBar.setTitle((this.args.maxCards === 1) ? _('Discard ${cards} and draw 1?') : _('Discard ${cards} and draw 2?'), { cards: cardsIcons });
                this.bga.statusBar.addActionButton(_('Confirm'), () => this.redrawClicked(selectedCardIDs), {id: 'redraw-button'});
            }
        }
        this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));

        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER10'), {id: 'skip-power-button', color: 'secondary'});
    }

    private swapClicked(target: SwapTargetPOWER10, cardIDs: number[]): void {
        this.bga.actions.performAction('actSwapCards_POWER10', { cardIDs: this.game.getCardIDsParam(cardIDs), targetPlayerId: target.player_id });
    }

    private async redrawClicked(cardIDs: number[]): Promise<void> {
        if(cardIDs.length < 2){
            if(!(await this.bga.dialogs.confirmation(_('Only 1 card is left to draw, so only 1 card will be discarded and replaced. Continue?'))))
                return;
        }

        this.bga.actions.performAction('actRedrawCards_POWER10', { cardIDs: this.game.getCardIDsParam(cardIDs) });
    }
}
