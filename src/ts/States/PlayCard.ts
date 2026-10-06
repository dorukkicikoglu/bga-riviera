import { Game } from "../Game";

/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Everyone still in the round secretly chooses a card (select, then confirm), or, only when no card is
 * playable, their Last Chance or a crash. The choice stays pending until the last player has chosen, and
 * "Change my mind" takes it back.
 */
export class PlayCard {
    private playCardButton: HTMLButtonElement | null = null;
    private pendingChoice: PendingPlayChoice | null = null;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.setPendingChoice(args?._private?.pendingPlayChoice ?? null); //restores a set-aside card after F5
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     * The chosen card keeps its set-aside look: notif_cardsRevealed comes after the state change and moves it.
     */
    onLeavingState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.game.handHandler?.clearPlayableCards();
        this.playCardButton = null;
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.bga.statusBar.removeActionButtons();
        this.game.handHandler?.clearPlayableCards();
        this.playCardButton = null;

        const privateArgs = args?._private;

        if(isCurrentPlayerActive && privateArgs){
            if(privateArgs.playableCardIDs.length > 0){
                this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
                this.game.handHandler?.setPlayableCards(privateArgs.playableCardIDs);

                //hidden until a card is selected, like Fugu's swap button
                this.playCardButton = this.bga.statusBar.addActionButton(_('confirm'), () => this.playCardClicked(), {id: 'play-card-button'});
                this.selectionChanged();
            } else {
                this.bga.statusBar.setTitle(_('${you} cannot play any card'));

                if(privateArgs.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), {id: 'last-chance-button'});

                //no confirm dialog: Change my mind is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), {id: 'crash-button', color: 'alert'});
            }
        } else if(this.pendingChoice){
            const pendingChoiceTitles: Record<PlayChoice, string> = {
                card: _('${you} chose a card. Waiting for other players'),
                last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                crash: _('${you} chose to crash. Waiting for other players'),
            };
            this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
        } else {
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
        }
    }

    //called by HandHandler when a playable card is selected or unselected
    public selectionChanged(): void {
        if(!this.playCardButton)
            return;

        const selectedCard = this.game.handHandler?.getSelectedCardData();
        this.playCardButton.style.display = selectedCard ? null : 'none';

        if(selectedCard){
            const cardIcon = `<span class="status-card-icon" data-color="${selectedCard.color}" aria-label="${selectedCard.value} ${selectedCard.color}">${selectedCard.value}</span>`;
            this.bga.statusBar.setTitle(_('Play ${card}?').replace('${card}', cardIcon));
        } else {
            this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
        }
    }

    private playCardClicked(): void {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if(!selectedCardID)
            return;

        this.bga.actions.performAction('actPlayCard', { cardID: selectedCardID });
    }

    //pendingPlayChoice from the args on entry and F5, then playChoiceConfirmed / playChoiceReverted; the status bar follows through onPlayerActivationChange
    public setPendingChoice(pendingChoice: PendingPlayChoice | null): void {
        this.pendingChoice = pendingChoice;
        this.game.handHandler?.setChosenCard((pendingChoice && pendingChoice.choice === 'card') ? pendingChoice.card_id : null);
    }
}
