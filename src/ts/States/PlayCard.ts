/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * PlayCard.ts
 */
import { Game } from "../Game";

/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Everyone still in the round secretly chooses a card (select, then confirm), or, only when no card is
 * playable, their Last Chance or a crash. The choice stays pending until the last player has chosen, and
 * "Undo" takes it back.
 * [BGA] Card 1: confirming a 1 keeps me active to add another playable card or finish, again after each extra 1.
 * [BGA] Card 9: when I am the only player still in and just turned a die, "Undo" takes me back to the card 9 prompt
 * until I confirm a card (then Undo takes the card back, as usual).
 * The args only arrive on entering the state, so the private notifications keep a local copy of what I see next.
 * [BGA] Expert mode ("Highlight playable cards" Off): every card in hand looks and behaves the same (no glow, no dice
 * highlight), and a click on an unplayable card is rejected here before it is selected. The server checks stay as a backstop.
 */
export class PlayCard {
    private confirmButton: HTMLButtonElement | null = null;
    private confirmActionName: 'actPlayCard' | 'actAddChainCard_POWER1' = 'actPlayCard';
    private pendingChoice: PendingPlayChoice | null = null;
    private chainCardIDs: number[] = [];
    private chainOpen: boolean = false;
    private playableCardIDs: number[] = [];
    private playableCardDice: Record<number, DieColor[]> = {}; //from the server, fixed for the whole state: the dice that make each card playable
    private hasNoPlayableCard: boolean = false; //from the server, fixed for the whole state (the dice and the hand don't change in it)
    private canUseLastChance: boolean = false;
    private canUndoDieChange: boolean = false;
    private cardIDToSelectAfterUndo: number | null = null; //another playable card clicked while waiting: the Undo is in flight, and this card is selected once I choose again
    private switchedCardID: number | null = null; //that card, while it stays selected: it waits for Confirm even with "One-click card play"

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        const privateArgs = args?._private;
        this.playableCardIDs = privateArgs?.playableCardIDs ?? [];
        this.playableCardDice = privateArgs?.playableCardDice ?? {};
        this.hasNoPlayableCard = privateArgs?.hasNoPlayableCard ?? false;
        this.canUseLastChance = privateArgs?.canUseLastChance ?? false;
        this.chainCardIDs = privateArgs?.chainCardIDs_POWER1 ?? [];
        this.chainOpen = privateArgs?.chainOpen_POWER1 ?? false;
        this.canUndoDieChange = privateArgs?.canUndoDieChange_POWER9 ?? false;
        this.cardIDToSelectAfterUndo = null;
        this.switchedCardID = null;
        this.setPendingChoice(privateArgs?.pendingPlayChoice ?? null); //restores the set-aside cards after F5

        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     * The chosen cards keep their set-aside look: notif_cardsRevealed comes after the state change and moves them.
     */
    onLeavingState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.game.handHandler?.clearSelectableCards();
        this.game.handHandler?.setChosenCardsUndoable(false); //the choices are locked in
        this.game.diceHandler.setComboHighlight([]);
        this.confirmButton = null;
        this.cardIDToSelectAfterUndo = null; //never carried into a later turn
        this.switchedCardID = null;
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.updateStatusBar(isCurrentPlayerActive);
    }

    private updateStatusBar(isCurrentPlayerActive: boolean): void {
        const handHandler = this.game.handHandler;

        this.bga.statusBar.removeActionButtons();
        handHandler?.clearSelectableCards();
        this.game.diceHandler.setComboHighlight([]);
        this.confirmButton = null;

        //spectator, or a player who isn't choosing and has nothing pending
        if(!handHandler || (!isCurrentPlayerActive && !this.pendingChoice)){
            handHandler?.setChosenCardsUndoable(false);
            this.bga.statusBar.setTitle(_('Others must choose a card'));
            return;
        }

        //clicking a set-aside card is the Undo button only while waiting for the others (set once per rebuild, so the cards' tooltips aren't redone)
        const isWaiting = !isCurrentPlayerActive || !this.chainOpen;
        handHandler.setChosenCardsUndoable(isWaiting && !!this.pendingChoice && !this.game.isReplay());

        //in the two choosing branches, selectionChanged() sets the title (no card is selected yet)
        if(isCurrentPlayerActive && this.pendingChoice && this.chainOpen){
            this.setSelectableCards();

            //hidden until a card is selected, like Fugu's swap button
            this.confirmActionName = 'actAddChainCard_POWER1';
            this.confirmButton = this.bga.statusBar.addActionButton(_('Add card'), () => this.confirmClicked(this.confirmActionName), {id: 'add-chain-card-button'});
            this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actFinishChain_POWER1'), {id: 'finish-chain-button', color: 'secondary'});
            this.game.undoHandler.addUndoButton('actUndoPlayCard');
            this.selectionChanged();
        } else if(isCurrentPlayerActive && !this.pendingChoice){
            if(!this.hasNoPlayableCard){
                this.setSelectableCards();

                //hidden until a card is selected, like Fugu's swap button
                this.confirmActionName = 'actPlayCard';
                this.confirmButton = this.bga.statusBar.addActionButton(_('Confirm'), () => this.confirmClicked(this.confirmActionName), {id: 'confirm-selected-card-button'});
                this.selectCardClickedBeforeUndo();
                this.selectionChanged();
            } else {
                //only the current player ever sees this: others see "Others must choose a card", since who has no playable card is hidden until the reveal
                this.bga.statusBar.setTitle(_('${you} cannot play any cards'));

                if(this.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), {id: 'last-chance-button'});

                //no confirm dialog: Undo is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), {id: 'crash-button', color: 'alert'});
            }

            if(this.canUndoDieChange)
                this.game.undoHandler.addUndoButton('actUndoDieChange_POWER9');
        } else {
            if(this.pendingChoice.choice === 'card'){
                //each chosen card with its power icon, like "Play [card]?"
                const cardsIcons = this.getChosenCardIDs().map(cardID => this.game.getStatusCardWithPowerHTML(handHandler.getCardData(cardID))).join('');
                this.bga.statusBar.setTitle(_('${you} chose ${card}. Waiting for other players'), { card: cardsIcons || _('a card') });
                this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
            } else {
                //a crash is only a choice when Last Chance was there too: with no Last Chance left, Crash was the only button
                const pendingChoiceTitles: Record<Exclude<PlayChoice, 'card'>, string> = {
                    last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                    crash: this.canUseLastChance ? _('${you} chose to crash. Waiting for other players') : _('${you} will crash. Waiting for other players'),
                };
                this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            }
            this.game.undoHandler.addUndoButton('actUndoPlayCard');
        }
    }

    //the playable cards glow (power cards cream); in Expert mode every card not chosen yet is selectable, none glows, and
    //canSelectCard() rejects the unplayable ones on click
    private setSelectableCards(): void {
        const handHandler = this.game.handHandler;
        if(!this.game.isExpertMode()){
            handHandler.setSelectableCards(this.playableCardIDs, 1, true);
            return;
        }

        const chosenCardIDs = this.getChosenCardIDs();
        handHandler.setSelectableCards(handHandler.getHandCardIDs().filter(cardID => !chosenCardIDs.includes(cardID)), 1, false, false);
    }

    //HandHandler, through Game.canSelectHandCard, before selecting a card: only Expert mode lets an unplayable card be clicked
    public canSelectCard(cardID: number): boolean {
        return !this.game.isExpertMode() || this.playableCardIDs.includes(cardID);
    }

    //HandHandler, through Game.undoableChosenCardClicked: only marked while the Undo button is there
    public chosenCardClicked(): void {
        if(this.game.isReplay() || !this.pendingChoice || this.cardIDToSelectAfterUndo !== null)
            return;

        this.game.undoHandler.undo('actUndoPlayCard');
    }

    //HandHandler, through Game.otherCardClickedWhileUndoable: a card that isn't set aside, while waiting for the others.
    //A card I could play as my first card takes my choice back (the Undo button's own action) and is selected, not
    //confirmed, once I choose again; any other card does nothing. Further clicks wait until the Undo has gone through
    public otherCardClickedWhileWaiting(cardID: number): void {
        if(this.game.isReplay() || !this.pendingChoice || this.cardIDToSelectAfterUndo !== null)
            return;

        if(!this.getFirstCardPlayableIDs().includes(cardID))
            return;

        const undoRequest = this.game.undoHandler.undo('actUndoPlayCard');
        if(!undoRequest)
            return;

        this.cardIDToSelectAfterUndo = cardID;
        undoRequest.catch(() => { this.cardIDToSelectAfterUndo = null; }); //refused (the others locked the choices in first): clicks work again
    }

    //the cards I could play as my first card, the list Undo sends back as playableCardIDs (the server's getPlayableCardIDs()
    //is the keys of the same getPlayableCardDice()). While waiting, playableCardIDs itself is empty or a chain's remainder
    private getFirstCardPlayableIDs(): number[] {
        return Object.keys(this.playableCardDice).map(cardID => parseInt(cardID));
    }

    //I am choosing a first card again after the Undo: the card clicked while waiting is selected, through the same checks
    //as a click (selectable, and canSelectCard in Expert mode). Applied once, whatever happens
    private selectCardClickedBeforeUndo(): void {
        const cardID = this.cardIDToSelectAfterUndo;
        if(cardID === null)
            return;

        this.cardIDToSelectAfterUndo = null;
        if(this.canSelectCard(cardID) && this.game.handHandler.selectCardByID(cardID))
            this.switchedCardID = cardID;
    }

    //called through Game.handSelectionChanged when a card is selected or unselected
    public selectionChanged(): void {
        if(!this.confirmButton)
            return;

        const selectedCard = this.game.handHandler?.getSelectedCardData();
        if(selectedCard?.card_id !== this.switchedCardID)
            this.switchedCardID = null; //a click moved or cleared the selection: back to the usual behaviour

        //"One-click card play" preference: the click that selected the card plays it. Not the card selected after an Undo:
        //that click was made while waiting, so it keeps the Confirm button
        const playsOnClick = (this.game.prefHandler?.isOneClickPlay() ?? false) && this.switchedCardID === null;
        this.confirmButton.style.display = (selectedCard && !playsOnClick) ? null : 'none';
        this.updateConfirmButtonLook(selectedCard);

        if(selectedCard && playsOnClick){
            this.confirmClicked(this.confirmActionName);
            return;
        }

        //the dice that make the selected card playable, so it is clear why it glows. Not in Expert mode, where players find their own plays
        this.game.diceHandler.setComboHighlight((selectedCard && !this.game.isExpertMode()) ? (this.playableCardDice[selectedCard.card_id] ?? []) : []);

        const isAddingToChain = this.pendingChoice !== null;
        //[BGA] my first card can only be a Grand Slam: the same title for the whole turn, selected card or not. Not in a
        //card-1 chain, where adding the last card is optional (its power prompt stays), and not in a replay
        if(!isAddingToChain && this.isGrandSlamTurn() && !this.game.isReplay())
            this.bga.statusBar.setTitle(_('${you} must GRAND SLAM!'));
        else if(selectedCard){
            this.bga.statusBar.setTitle(isAddingToChain ? _('Add ${card}?') : _('Play ${card}?'), { card: this.game.getStatusCardWithPowerHTML(selectedCard) });
            this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
        }
        else if(isAddingToChain){
            //the chain only stays open after a 1, so the last chosen card is the 1 that gives the extra card
            const chosenCardIDs = this.getChosenCardIDs();
            const lastChosenCard = this.game.handHandler?.getCardData(chosenCardIDs[chosenCardIDs.length - 1]);
            this.game.setPowerPromptTitle(lastChosenCard ?? null, true);
        }
        else this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
    }

    //[BGA] the selected card is the last one in hand not chosen yet, so playing it empties my hand: a Grand Slam at the reveal.
    //The button then gets the finishing look (.play-button-grand-slam in Game.scss) and its own label; any other selection, or
    //none, gets the usual ones back. In Expert mode an unplayable card can't be selected, so this never hints at playability
    private updateConfirmButtonLook(selectedCard: RivieraCard | null): void {
        const isGrandSlam = !!selectedCard && this.isGrandSlamCard(selectedCard.card_id);

        const normalLabel = (this.confirmActionName === 'actAddChainCard_POWER1') ? _('Add card') : _('Confirm');
        this.confirmButton.innerHTML = isGrandSlam ? _('Play card to Grand Slam!') : normalLabel;
        this.confirmButton.classList.toggle('play-button-grand-slam', isGrandSlam);
    }

    //[BGA] the one Grand Slam check: this card is the last one in my hand not chosen yet, so playing it empties my hand
    private isGrandSlamCard(cardID: number): boolean {
        const handHandler = this.game.handHandler;
        if(!handHandler)
            return false;

        const chosenCardIDs = this.getChosenCardIDs();
        const remainingCardIDs = handHandler.getHandCardIDs().filter(handCardID => !chosenCardIDs.includes(handCardID));
        return remainingCardIDs.length === 1 && remainingCardIDs[0] === cardID;
    }

    //[BGA] every card I can play now is a Grand Slam (in practice: my last card is playable), so it doesn't depend on the selection
    private isGrandSlamTurn(): boolean {
        const chosenCardIDs = this.getChosenCardIDs();
        const playableCardIDs = this.playableCardIDs.filter(cardID => !chosenCardIDs.includes(cardID));
        return playableCardIDs.length > 0 && playableCardIDs.every(cardID => this.isGrandSlamCard(cardID));
    }

    private confirmClicked(actionName: 'actPlayCard' | 'actAddChainCard_POWER1'): void {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if(!selectedCardID)
            return;

        this.game.diceHandler.setComboHighlight([]);
        this.bga.actions.performAction(actionName, { cardID: selectedCardID });
    }

    private getChosenCardIDs(): number[] {
        const firstCardID = (this.pendingChoice && this.pendingChoice.choice === 'card') ? this.pendingChoice.card_id : null;
        return firstCardID === null ? [] : [firstCardID, ...this.chainCardIDs];
    }

    private setPendingChoice(pendingChoice: PendingPlayChoice | null): void {
        this.pendingChoice = pendingChoice;
        this.game.handHandler?.setChosenCards(this.getChosenCardIDs());
    }

    //PrefHandler: "One-click card play" was switched while choosing
    public preferenceChanged(): void {
        this.refresh();
    }

    //the private notifications land while the state is unchanged, so they redraw the status bar themselves
    public refresh(): void {
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
