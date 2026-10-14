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
 * Card 10, before the next roll: the active owner selects 2 cards from their hand, then the opponent to swap them
 * with (the opponent's cards are random). Only opponents still in the round with at least 2 cards can be chosen.
 * With none, the owner discards and draws instead; when only 1 card can be drawn, a confirmation explains it first.
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
            this.bga.statusBar.setTitle(_('${actplayer} may swap cards with an opponent'));
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

    private updateStatusBar(): void {
        if(!this.args)
            return;

        this.bga.statusBar.removeActionButtons();
        const selectedCardIDs = this.game.handHandler.getSelectedCardIDs();

        if(this.args.mode === 'swap'){
            this.bga.statusBar.setTitle(_('${you} may choose 2 cards to swap with an opponent'));

            if(selectedCardIDs.length === this.args.maxCards){
                for(let target of this.args.targets){
                    const label = _('Swap with ${player_name}').replace('${player_name}', this.game.getPlayerName(target.player_id));
                    this.bga.statusBar.addActionButton(label, () => this.swapClicked(target, selectedCardIDs), {id: 'swap-with-' + target.player_id + '-button'});
                }
            }
        } else {
            this.bga.statusBar.setTitle(_('No opponent still in the round has 2 cards: ${you} may discard ${count} card(s) and draw as many (card 10)').replace('${count}', this.args.maxCards.toString()));

            if(selectedCardIDs.length === this.args.maxCards)
                this.bga.statusBar.addActionButton(_('Discard and draw'), () => this.redrawClicked(selectedCardIDs), {id: 'redraw-button'});
        }

        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER10'), {id: 'skip-power-button', color: 'secondary'});
    }

    private swapClicked(target: SwapTargetPOWER10, cardIDs: number[]): void {
        this.bga.actions.performAction('actSwapCards_POWER10', { cardIDs: cardIDs.join(','), targetPlayerId: target.player_id });
    }

    private async redrawClicked(cardIDs: number[]): Promise<void> {
        if(cardIDs.length < 2){
            if(!(await this.bga.dialogs.confirmation(_('Only 1 card is left to draw, so only 1 card will be discarded and replaced. Continue?'))))
                return;
        }

        this.bga.actions.performAction('actRedrawCards_POWER10', { cardIDs: cardIDs.join(',') });
    }
}
