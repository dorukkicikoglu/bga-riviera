import { Game } from "../Game";

/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Everyone still in the round secretly chooses a card (select, then confirm), or, only when no card is
 * playable, their Last Chance or a crash. The choice stays pending until the last player has chosen, and
 * "Change my mind" takes it back.
 * [BGA] Card 1: confirming a 1 keeps me active to add another playable card or finish, again after each extra 1.
 * The args only arrive on entering the state, so the private notifications keep a local copy of what I see next.
 */
export class PlayCard {
    private confirmButton: HTMLButtonElement | null = null;
    private pendingChoice: PendingPlayChoice | null = null;
    private chainCardIDs: number[] = [];
    private chainOpen: boolean = false;
    private playableCardIDs: number[] = [];
    private canUseLastChance: boolean = false;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        const privateArgs = args?._private;
        this.playableCardIDs = privateArgs?.playableCardIDs ?? [];
        this.canUseLastChance = privateArgs?.canUseLastChance ?? false;
        this.chainCardIDs = privateArgs?.chainCardIDs_POWER1 ?? [];
        this.chainOpen = privateArgs?.chainOpen_POWER1 ?? false;
        this.setPendingChoice(privateArgs?.pendingPlayChoice ?? null); //restores the set-aside cards after F5

        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     * The chosen cards keep their set-aside look: notif_cardsRevealed comes after the state change and moves them.
     */
    onLeavingState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.game.handHandler?.clearSelectableCards();
        this.confirmButton = null;
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.updateStatusBar(isCurrentPlayerActive);
    }

    private updateStatusBar(isCurrentPlayerActive: boolean): void {
        this.bga.statusBar.removeActionButtons();
        this.game.handHandler?.clearSelectableCards();
        this.confirmButton = null;

        if(!this.game.handHandler){
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
            return;
        }

        if(isCurrentPlayerActive && this.pendingChoice && this.chainOpen){
            this.bga.statusBar.setTitle(_('${you} may add another card to your 1, or finish'));
            this.game.handHandler.setSelectableCards(this.playableCardIDs);

            //hidden until a card is selected, like Fugu's swap button
            this.confirmButton = this.bga.statusBar.addActionButton(_('Add this card'), () => this.confirmClicked('actAddChainCard_POWER1'), {id: 'add-chain-card-button'});
            this.bga.statusBar.addActionButton(_('Finish'), () => this.bga.actions.performAction('actFinishChain_POWER1'), {id: 'finish-chain-button', color: 'secondary'});
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
            this.selectionChanged();
        } else if(isCurrentPlayerActive && !this.pendingChoice){
            if(this.playableCardIDs.length > 0){
                this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
                this.game.handHandler.setSelectableCards(this.playableCardIDs);

                //hidden until a card is selected, like Fugu's swap button
                this.confirmButton = this.bga.statusBar.addActionButton(_('Confirm'), () => this.confirmClicked('actPlayCard'), {id: 'confirm-selected-card-button'});
                this.selectionChanged();
            } else {
                this.bga.statusBar.setTitle(_('${you} cannot play any card'));

                if(this.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), {id: 'last-chance-button'});

                //no confirm dialog: Change my mind is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), {id: 'crash-button', color: 'alert'});
            }
        } else if(this.pendingChoice){
            if(this.pendingChoice.choice === 'card'){
                const cardsIcons = this.getChosenCardIDs().map(cardID => this.getCardIconHTML(this.game.handHandler.getCardData(cardID))).join('');
                this.bga.statusBar.setTitle(_('${you} chose ${card}. Waiting for other players').replace('${card}', cardsIcons || _('a card')));
            } else {
                const pendingChoiceTitles: Record<Exclude<PlayChoice, 'card'>, string> = {
                    last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                    crash: _('${you} chose to crash. Waiting for other players'),
                };
                this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            }
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
        } else {
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
        }
    }

    //called through Game.handSelectionChanged when a card is selected or unselected
    public selectionChanged(): void {
        if(!this.confirmButton)
            return;

        const selectedCard = this.game.handHandler?.getSelectedCardData();
        this.confirmButton.style.display = selectedCard ? null : 'none';

        const isAddingToChain = this.pendingChoice !== null;
        if(selectedCard)
            this.bga.statusBar.setTitle((isAddingToChain ? _('Add ${card}?') : _('Play ${card}?')).replace('${card}', this.getCardIconHTML(selectedCard)));
        else this.bga.statusBar.setTitle(isAddingToChain ? _('${you} may add another card to your 1, or finish') : _('${you} must choose a card to play'));
    }

    private confirmClicked(actionName: 'actPlayCard' | 'actAddChainCard_POWER1'): void {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if(!selectedCardID)
            return;

        this.bga.actions.performAction(actionName, { cardID: selectedCardID });
    }

    private getCardIconHTML(card: RivieraCard | null): string {
        if(!card)
            return '';
        return `<span class="status-card-icon" data-color="${card.color}" aria-label="${card.value} ${card.color}">${card.value}</span>`;
    }

    private getChosenCardIDs(): number[] {
        const firstCardID = (this.pendingChoice && this.pendingChoice.choice === 'card') ? this.pendingChoice.card_id : null;
        return firstCardID === null ? [] : [firstCardID, ...this.chainCardIDs];
    }

    private setPendingChoice(pendingChoice: PendingPlayChoice | null): void {
        this.pendingChoice = pendingChoice;
        this.game.handHandler?.setChosenCards(this.getChosenCardIDs());
    }

    //the private notifications land while the state is unchanged, so they redraw the status bar themselves
    private refresh(): void {
        if(this.game.getGameStateName() === 'PlayCard')
            this.updateStatusBar(this.bga.players.isCurrentPlayerActive());
    }

    public onChoiceConfirmed(args: PlayChoiceConfirmedArgs): void {
        this.chainCardIDs = args.chainCardIDs_POWER1;
        this.chainOpen = args.chainOpen_POWER1;
        this.playableCardIDs = args.playableCardIDs;
        this.setPendingChoice({ choice: args.choice, card_id: args.card_id });
        this.refresh();
    }

    public onChainUpdated(args: PlayChainUpdatedPOWER1Args): void {
        this.chainCardIDs = args.chainCardIDs_POWER1;
        this.chainOpen = args.chainOpen_POWER1;
        this.playableCardIDs = args.playableCardIDs;
        this.setPendingChoice(this.pendingChoice);
        this.refresh();
    }

    public onChoiceReverted(args: PlayChoiceRevertedArgs): void {
        this.chainCardIDs = [];
        this.chainOpen = false;
        this.playableCardIDs = args.playableCardIDs ?? this.playableCardIDs;
        this.setPendingChoice(null);
        this.refresh();
    }
}
