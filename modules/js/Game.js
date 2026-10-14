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
class PlayCard {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.confirmButton = null;
        this.confirmActionName = 'actPlayCard';
        this.pendingChoice = null;
        this.chainCardIDs = [];
        this.chainOpen = false;
        this.playableCardIDs = [];
        this.canUseLastChance = false;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
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
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.handHandler?.clearSelectableCards();
        this.confirmButton = null;
    }
    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.updateStatusBar(isCurrentPlayerActive);
    }
    updateStatusBar(isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        this.game.handHandler?.clearSelectableCards();
        this.confirmButton = null;
        if (!this.game.handHandler) {
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
            return;
        }
        if (isCurrentPlayerActive && this.pendingChoice && this.chainOpen) {
            this.bga.statusBar.setTitle(_('${you} may add another card to your 1, or finish'));
            this.game.handHandler.setSelectableCards(this.playableCardIDs);
            //hidden until a card is selected, like Fugu's swap button
            this.confirmActionName = 'actAddChainCard_POWER1';
            this.confirmButton = this.bga.statusBar.addActionButton(_('Add this card'), () => this.confirmClicked(this.confirmActionName), { id: 'add-chain-card-button' });
            this.bga.statusBar.addActionButton(_('Finish'), () => this.bga.actions.performAction('actFinishChain_POWER1'), { id: 'finish-chain-button', color: 'secondary' });
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
            this.selectionChanged();
        }
        else if (isCurrentPlayerActive && !this.pendingChoice) {
            if (this.playableCardIDs.length > 0) {
                this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
                this.game.handHandler.setSelectableCards(this.playableCardIDs);
                //hidden until a card is selected, like Fugu's swap button
                this.confirmActionName = 'actPlayCard';
                this.confirmButton = this.bga.statusBar.addActionButton(_('Confirm'), () => this.confirmClicked(this.confirmActionName), { id: 'confirm-selected-card-button' });
                this.selectionChanged();
            }
            else {
                this.bga.statusBar.setTitle(_('${you} cannot play any card'));
                if (this.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), { id: 'last-chance-button' });
                //no confirm dialog: Change my mind is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), { id: 'crash-button', color: 'alert' });
            }
        }
        else if (this.pendingChoice) {
            if (this.pendingChoice.choice === 'card') {
                const cardsIcons = this.getChosenCardIDs().map(cardID => this.getCardIconHTML(this.game.handHandler.getCardData(cardID))).join('');
                this.bga.statusBar.setTitle(_('${you} chose ${card}. Waiting for other players').replace('${card}', cardsIcons || _('a card')));
            }
            else {
                const pendingChoiceTitles = {
                    last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                    crash: _('${you} chose to crash. Waiting for other players'),
                };
                this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            }
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
        }
        else {
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
        }
    }
    //called through Game.handSelectionChanged when a card is selected or unselected
    selectionChanged() {
        if (!this.confirmButton)
            return;
        const selectedCard = this.game.handHandler?.getSelectedCardData();
        const oneClickPlay = this.game.prefHandler?.isOneClickPlay() ?? false;
        this.confirmButton.style.display = (selectedCard && !oneClickPlay) ? null : 'none';
        //"One-click card play" preference: the click that selected the card plays it
        if (selectedCard && oneClickPlay) {
            this.confirmClicked(this.confirmActionName);
            return;
        }
        const isAddingToChain = this.pendingChoice !== null;
        if (selectedCard)
            this.bga.statusBar.setTitle((isAddingToChain ? _('Add ${card}?') : _('Play ${card}?')).replace('${card}', this.getCardIconHTML(selectedCard)));
        else
            this.bga.statusBar.setTitle(isAddingToChain ? _('${you} may add another card to your 1, or finish') : _('${you} must choose a card to play'));
    }
    confirmClicked(actionName) {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if (!selectedCardID)
            return;
        this.bga.actions.performAction(actionName, { cardID: selectedCardID });
    }
    //the number is drawn from img/card_icon_numbers.webp, so screen readers (and copy-paste) get the visually hidden text instead
    getCardIconHTML(card) {
        if (!card)
            return '';
        const cardText = _('${value} ${color}').replace('${value}', card.value.toString()).replace('${color}', this.game.getColorName(card.color));
        return `<span class="status-card-icon" data-color="${card.color}" data-value="${card.value}"><span class="status-card-icon-number" aria-hidden="true"></span><span class="status-card-icon-text">${cardText}</span></span>`;
    }
    getChosenCardIDs() {
        const firstCardID = (this.pendingChoice && this.pendingChoice.choice === 'card') ? this.pendingChoice.card_id : null;
        return firstCardID === null ? [] : [firstCardID, ...this.chainCardIDs];
    }
    setPendingChoice(pendingChoice) {
        this.pendingChoice = pendingChoice;
        this.game.handHandler?.setChosenCards(this.getChosenCardIDs());
    }
    //PrefHandler: "One-click card play" was switched while choosing
    preferenceChanged() {
        this.refresh();
    }
    //the private notifications land while the state is unchanged, so they redraw the status bar themselves
    refresh() {
        if (this.game.getGameStateName() === 'PlayCard')
            this.updateStatusBar(this.bga.players.isCurrentPlayerActive());
    }
    onChoiceConfirmed(args) {
        this.chainCardIDs = args.chainCardIDs_POWER1;
        this.chainOpen = args.chainOpen_POWER1;
        this.playableCardIDs = args.playableCardIDs;
        this.setPendingChoice({ choice: args.choice, card_id: args.card_id });
        this.refresh();
    }
    onChainUpdated(args) {
        this.chainCardIDs = args.chainCardIDs_POWER1;
        this.chainOpen = args.chainOpen_POWER1;
        this.playableCardIDs = args.playableCardIDs;
        this.setPendingChoice(this.pendingChoice);
        this.refresh();
    }
    onChoiceReverted(args) {
        this.chainCardIDs = [];
        this.chainOpen = false;
        this.playableCardIDs = args.playableCardIDs ?? this.playableCardIDs;
        this.setPendingChoice(null);
        this.refresh();
    }
}

/**
 * [BGA] Simultaneous Stop or More: everyone still in the round chooses at the same time. The choice stays
 * pending until the last player has chosen, and "Change my mind" takes it back.
 */
class StopOrMore {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.pendingChoice = null;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.pendingChoice = args?._private?.pendingStopOrMoreChoice ?? null; //restores the choice after F5
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
    }
    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        if (isCurrentPlayerActive && this.game.myself) {
            this.bga.statusBar.setTitle(_('${you} must choose: Stop or More'));
            const starsTotal = this.game.myself.getPlayedColumn().getStarsTotal();
            this.bga.statusBar.addActionButton(_('Stop and bank ${stars} ★').replace('${stars}', starsTotal.toString()), () => this.bga.actions.performAction('actStop'), { id: 'stop-button' });
            this.bga.statusBar.addActionButton(_('More'), () => this.bga.actions.performAction('actMore'), { id: 'more-button' });
        }
        else if (this.pendingChoice) {
            const pendingChoiceTitles = {
                stop: _('${you} chose to stop. Waiting for other players'),
                more: _('${you} chose to continue. Waiting for other players'),
            };
            this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice]);
            this.game.changeMindHandler.addChangeMindButton('actChangeMindStopOrMore');
        }
        else {
            this.bga.statusBar.setTitle(_('Other players must choose: Stop or More'));
        }
    }
    //stopOrMoreChoiceConfirmed / stopOrMoreChoiceReverted; the status bar follows through onPlayerActivationChange
    setPendingChoice(pendingChoice) {
        this.pendingChoice = pendingChoice;
    }
}

/**
 * Card 9, after the roll: the active owner picks a die that hasn't been changed this roll, then turns it by 1
 * (6 wraps to 1, 1 wraps to 6), or skips.
 */
class ModifyDie {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.modifiableDice = [];
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.modifiableDice = args?.modifiableDice ?? [];
        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('${actplayer} may change a die (card 9)'));
            return;
        }
        this.game.diceHandler.setSelectableDice(this.modifiableDice.map(die => die.color));
        this.updateStatusBar();
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.diceHandler.clearSelectableDice();
    }
    //called by DiceHandler when a die is selected or unselected
    dieSelectionChanged() {
        this.updateStatusBar();
    }
    updateStatusBar() {
        this.bga.statusBar.removeActionButtons();
        const selectedColor = this.game.diceHandler.getSelectedDieColor();
        const selectedDie = this.modifiableDice.find(die => die.color === selectedColor);
        if (selectedDie) {
            this.bga.statusBar.setTitle(_('${you} may turn this die by 1'));
            const lowerValue = (selectedDie.value === 1) ? 6 : selectedDie.value - 1;
            const higherValue = (selectedDie.value === 6) ? 1 : selectedDie.value + 1;
            this.bga.statusBar.addActionButton(_('Turn to ${value}').replace('${value}', lowerValue.toString()), () => this.modifyDie(selectedDie.color, -1), { id: 'die-minus-button' });
            this.bga.statusBar.addActionButton(_('Turn to ${value}').replace('${value}', higherValue.toString()), () => this.modifyDie(selectedDie.color, 1), { id: 'die-plus-button' });
        }
        else {
            this.bga.statusBar.setTitle(_('${you} may choose a die to turn by 1 (card 9)'));
        }
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER9'), { id: 'skip-power-button', color: 'secondary' });
    }
    modifyDie(dieColor, delta) {
        this.bga.actions.performAction('actModifyDie_POWER9', { dieColor: dieColor, delta: delta });
    }
}

/**
 * Card 11, after Stop or More (the owner chose More), before the next roll: the active owner may add the golden die
 * to the next roll, or skip. (Card 2 needs no choice and card 10 has its own SwapCards state.)
 * The server skips a second 11 when the golden die is already added, so this always offers to add it.
 */
class ResolvePowers {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('${actplayer} may add the golden die to the next roll (card 11)'));
            return;
        }
        this.bga.statusBar.setTitle(_('${you} may add the golden die to the next roll (card 11)'));
        this.bga.statusBar.addActionButton(_('Add the golden die'), () => this.bga.actions.performAction('actAddGoldenDie_POWER11'), { id: 'add-golden-die-button' });
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER11'), { id: 'skip-power-button', color: 'secondary' });
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
    }
}

/**
 * Card 10, after Stop or More (the owner chose More), before the next roll: the active owner selects 2 cards from
 * their hand, then the opponent to swap them with (the opponent's cards are random). Only opponents who chose More
 * and have at least 2 cards can be chosen.
 * With none, the owner discards and draws instead; when only 1 card can be drawn, a confirmation explains it first.
 */
class SwapCards {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.args = null;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.args = args;
        if (!isCurrentPlayerActive || !this.game.handHandler) {
            this.bga.statusBar.setTitle(_('${actplayer} may swap cards with an opponent'));
            return;
        }
        this.game.handHandler.setSelectableCards(this.game.handHandler.getHandCardIDs(), args.maxCards);
        this.updateStatusBar();
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.handHandler?.clearSelectableCards();
        this.args = null;
    }
    //called through Game.handSelectionChanged when a card is selected or unselected
    selectionChanged() {
        this.updateStatusBar();
    }
    updateStatusBar() {
        if (!this.args)
            return;
        this.bga.statusBar.removeActionButtons();
        const selectedCardIDs = this.game.handHandler.getSelectedCardIDs();
        if (this.args.mode === 'swap') {
            this.bga.statusBar.setTitle(_('${you} may choose 2 cards to swap with an opponent'));
            if (selectedCardIDs.length === this.args.maxCards) {
                for (let target of this.args.targets) {
                    const label = _('Swap with ${player_name}').replace('${player_name}', this.game.getPlayerName(target.player_id));
                    this.bga.statusBar.addActionButton(label, () => this.swapClicked(target, selectedCardIDs), { id: 'swap-with-' + target.player_id + '-button' });
                }
            }
        }
        else {
            this.bga.statusBar.setTitle(_('No opponent who chose More has 2 cards: ${you} may discard ${count} card(s) and draw as many (card 10)').replace('${count}', this.args.maxCards.toString()));
            if (selectedCardIDs.length === this.args.maxCards)
                this.bga.statusBar.addActionButton(_('Discard and draw'), () => this.redrawClicked(selectedCardIDs), { id: 'redraw-button' });
        }
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER10'), { id: 'skip-power-button', color: 'secondary' });
    }
    swapClicked(target, cardIDs) {
        this.bga.actions.performAction('actSwapCards_POWER10', { cardIDs: cardIDs.join(','), targetPlayerId: target.player_id });
    }
    async redrawClicked(cardIDs) {
        if (cardIDs.length < 2) {
            if (!(await this.bga.dialogs.confirmation(_('Only 1 card is left to draw, so only 1 card will be discarded and replaced. Continue?'))))
                return;
        }
        this.bga.actions.performAction('actRedrawCards_POWER10', { cardIDs: cardIDs.join(',') });
    }
}

class PlayedColumnHandler {
    constructor(game, owner, playedCardsData) {
        this.game = game;
        this.owner = owner;
        this.playedCardsData = playedCardsData;
        const parent = document.querySelector('#played-columns-container');
        if (parent) {
            this.columnContainer = document.createElement('div');
            this.columnContainer.className = 'a-played-column';
            this.columnContainer.setAttribute('data-owner-id', `${this.owner.getPlayerID()}`);
            this.columnContainer.setAttribute('data-is-myself', 'false');
            this.columnContainer.style.setProperty('--column-owner-color', '#' + this.owner.getPlayerColor());
            this.columnContainer.innerHTML = `
                <div class="played-column-title">
                    <span class="played-column-name"></span>
                    <span class="played-column-stars"></span>
                </div>
                <div class="cards-column"></div>
            `;
            this.columnContainer.querySelector('.played-column-name').textContent = this.owner.getPlayerName();
            this.columnContainer.querySelector('.played-column-name').setAttribute('title', this.owner.getPlayerName()); //full name on hover when it's cut
            parent.appendChild(this.columnContainer);
        }
        this.cardsColumn = this.columnContainer.querySelector('.cards-column');
        this.starsText = this.columnContainer.querySelector('.played-column-stars');
        this.starsText.id = 'column-stars-' + this.owner.getPlayerID(); //for TooltipHandler
        this.displayColumn();
    }
    displayColumn() {
        this.cardsColumn.innerHTML = ''; // Clear existing cards
        const sortedCards = [...this.playedCardsData].sort((a, b) => a.location_in_column - b.location_in_column);
        for (let cardData of sortedCards)
            this.insertCardToColumn(cardData);
        this.updateStarsTotal();
    }
    //cards are stacked top to bottom in play order, each later card covering all but the star strip of the one before
    insertCardToColumn(cardData) {
        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());
        this.cardsColumn.appendChild(aCard);
    }
    addCard(cardData) {
        this.playedCardsData.push(cardData);
        this.insertCardToColumn(cardData);
        this.updateStarsTotal();
    }
    //a revealed card slides in from fromElement (my hand card, or another player's hand count on their board).
    //The sliding copy is placed on fromElement before the first await, so the caller can remove fromElement right after calling this
    async animateCardIn(cardData, fromElement) {
        this.playedCardsData.push(cardData);
        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());
        await this.game.animateSlide(aCard, fromElement, this.cardsColumn, PlayedColumnHandler.SLIDE_ANIM_TIME);
        this.updateStarsTotal();
    }
    //a crash or a new round empties the column
    async clear() {
        this.playedCardsData = [];
        if (this.cardsColumn.children.length > 0) {
            this.cardsColumn.classList.add('cards-fading-out');
            await this.game.bga.gameui.wait(PlayedColumnHandler.CLEAR_ANIM_TIME);
            this.cardsColumn.classList.remove('cards-fading-out');
        }
        this.cardsColumn.innerHTML = '';
        this.updateStarsTotal();
    }
    getStarsTotal() {
        return this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
    }
    updateStarsTotal() {
        this.starsText.textContent = `★ ${this.getStarsTotal()}`;
    }
    setMyColumn(isMyColumn) {
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if (isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }
    setRoundStatus(roundStatus) { this.columnContainer.setAttribute('data-round-status', roundStatus); }
    getColumnContainer() { return this.columnContainer; }
}
PlayedColumnHandler.SLIDE_ANIM_TIME = 600;
PlayedColumnHandler.CLEAR_ANIM_TIME = 400;

class PlayerHandler {
    constructor(game, playerID, playerName, playerColor, playerNo, handCount, roundStatus, lastChanceUsed, playedCardsData) {
        this.game = game;
        this.playerID = playerID;
        this.playerName = playerName;
        this.playerColor = playerColor;
        this.playerNo = playerNo;
        this.handCount = handCount;
        this.roundStatus = roundStatus;
        this.lastChanceUsed = lastChanceUsed;
        this.playedCardsData = playedCardsData;
        this.createPlayerBoardContainer();
        this.setHandCount(this.handCount);
        this.setLastChanceUsed(this.lastChanceUsed);
        this.playedColumn = new PlayedColumnHandler(this.game, this, this.playedCardsData);
        this.setRoundStatus(this.roundStatus);
    }
    //every player board, spectators included, shows the hand count, Last Chance, round status and a slot for the Start token
    createPlayerBoardContainer() {
        this.playerBoardContainer = document.createElement('div');
        this.playerBoardContainer.classList.add('riviera-player-board');
        this.playerBoardContainer.innerHTML = `
            <div class="player-board-cards-row">
                <div class="hand-count-backs"></div>
                <div class="last-chance-indicator"></div>
            </div>
            <div class="player-board-status-row">
                <div class="round-status-indicator"></div>
                <div class="start-token-slot"></div>
            </div>
        `;
        this.game.bga.playerPanels.getElement(this.playerID).appendChild(this.playerBoardContainer);
        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.roundStatusIndicator = this.playerBoardContainer.querySelector('.round-status-indicator');
        this.startTokenSlot = this.playerBoardContainer.querySelector('.start-token-slot');
        //ids for TooltipHandler
        this.handCountBacks.id = 'hand-count-backs-' + this.playerID;
        this.roundStatusIndicator.id = 'round-status-' + this.playerID;
        const lastChanceCard = this.game.createLastChanceDiv();
        lastChanceCard.classList.add('mini-card');
        this.lastChanceIndicator.prepend(lastChanceCard);
    }
    setHandCount(handCount) {
        this.handCount = handCount;
        this.handCountBacks.setAttribute('data-count', handCount.toString());
        this.handCountBacks.innerHTML = '';
        const individualBackCount = (handCount > PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS) ? 1 : handCount;
        for (let i = 0; i < individualBackCount; i++) {
            const cardBack = this.game.createCardBackDiv();
            cardBack.classList.add('mini-card-back');
            this.handCountBacks.appendChild(cardBack);
        }
        if (handCount > PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS)
            this.handCountBacks.insertAdjacentHTML('beforeend', `<span class="hand-count-text">x ${handCount}</span>`);
    }
    //a used Last Chance card disappears from the board; live, it shrinks and fades out first
    async setLastChanceUsed(lastChanceUsed, animate = false) {
        this.lastChanceUsed = lastChanceUsed;
        if (lastChanceUsed && animate) {
            this.lastChanceIndicator.classList.add('last-chance-fading');
            await this.game.bga.gameui.wait(PlayerHandler.LAST_CHANCE_FADE_ANIM_TIME);
            this.lastChanceIndicator.classList.remove('last-chance-fading');
        }
        this.lastChanceIndicator.setAttribute('data-used', lastChanceUsed ? 'true' : 'false');
    }
    setGrandSlam() {
        this.playerBoardContainer.classList.add('grand-slam-player-board');
        this.playedColumn.getColumnContainer().classList.add('grand-slam-column');
    }
    setRoundStatus(roundStatus) {
        this.roundStatus = roundStatus;
        const roundStatusTexts = {
            in: { icon: 'fa-play', text: _('In') },
            stopped: { icon: 'fa-flag-checkered', text: _('Stopped') },
            crashed: { icon: 'fa-bomb', text: _('Crashed') },
        };
        const { icon, text } = roundStatusTexts[roundStatus];
        this.roundStatusIndicator.setAttribute('data-round-status', roundStatus);
        this.roundStatusIndicator.innerHTML = `<i class="fa6 ${icon}"></i>&nbsp;${text}`;
        this.playedColumn.setRoundStatus(roundStatus);
    }
    getPlayerID() { return this.playerID; }
    getPlayerName() { return this.playerName; }
    getPlayerColor() { return this.playerColor; }
    getHandCount() { return this.handCount; }
    getPlayedColumn() { return this.playedColumn; }
    getStartTokenSlot() { return this.startTokenSlot; }
    getHandCountElement() { return this.handCountBacks; }
}
PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS = 6; //above this, the hand count shows a single card back followed by "x N"
PlayerHandler.LAST_CHANCE_FADE_ANIM_TIME = 400;

class HandHandler {
    constructor(game, handData) {
        this.game = game;
        this.handData = handData;
        this.maxSelectedCards = 1;
        this.handFadeInCount = 0;
        this.resizeDebounceTimeout = null;
        // my hand only: spectators never get one, other players' hands are only counts on their player boards
        this.handContainer = document.querySelector('#my-hand-container');
        this.handContainer.classList.add('a-hand-container');
        this.handContainer.setAttribute('data-owner-id', `${this.game.getMyPlayerID()}`);
        this.handContainer.style.setProperty('--hand-owner-color', '#' + this.game.getPlayerColor(this.game.getMyPlayerID()));
        this.handContainer.innerHTML = `
            <div class="my-hand-title">
                <div class="my-hand-title-text">${_('Your hand')}</div>
            </div>
            <div class="cards-container"></div>
        `;
        this.cardsContainer = this.handContainer.querySelector('.cards-container');
        this.cardsContainer.addEventListener('click', (event) => { this.cardsContainerClicked(event); });
        this.displayHand();
    }
    displayHand() {
        this.cardsContainer.innerHTML = ''; // Clear existing cards
        for (let cardData of this.getSortedHandData())
            this.insertCardToHand(cardData);
        this.recomputeCardSpacing();
    }
    //called by Game.onScreenWidthChange (BGA's resize hook, covers orientation changes too): the screen can change without
    //the hand changing, so the spacing is recomputed on its own trigger too, debounced like Fugu's recomputeMobileCardSpacing
    recomputeCardSpacingAfterResize() {
        if (this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => this.recomputeCardSpacing(), HandHandler.RESIZE_DEBOUNCE_TIME);
    }
    //the hand always fits on one row. Desktop: cards overlap more only when they wouldn't fit. Mobile: Fugu's spacing
    recomputeCardSpacing() {
        if (this.game.isMobile())
            this.applyMobileCardSpacing();
        else
            this.applyDesktopCardSpacing();
    }
    applyDesktopCardSpacing() {
        const cards = this.getCardDivs();
        cards.forEach(card => { card.style.marginLeft = null; card.style.marginRight = null; }); //left over from the mobile layout
        if (cards.length < 2 || this.cardsContainer.clientWidth === 0) {
            this.cardsContainer.style.removeProperty('--hand-card-overlap');
            return;
        }
        const cardWidth = cards[0].offsetWidth;
        const neededOverlap = (cardWidth * cards.length - this.cardsContainer.clientWidth) / (cards.length - 1);
        const overlap = Math.min(cardWidth * HandHandler.MAX_CARD_OVERLAP, Math.max(cardWidth * HandHandler.DEFAULT_CARD_OVERLAP, neededOverlap));
        this.cardsContainer.style.setProperty('--hand-card-overlap', `${-overlap}px`);
    }
    //Fugu's applyMobileCardSpacing: every card but the last gets the same negative margin-right, in % of the container,
    //so the row (one line, every card at the same height) spans MOBILE_HAND_SPAN_PERCENT of it and stays centered. A short hand keeps the default overlap instead of
    //spreading out. Widths come from offsetWidth / clientWidth, so transforms and BGA's mobile scaling don't affect them
    applyMobileCardSpacing() {
        this.cardsContainer.style.removeProperty('--hand-card-overlap');
        const cards = this.getCardDivs();
        if (cards.length === 0 || this.cardsContainer.clientWidth === 0)
            return;
        const cardWidthPercent = cards[0].offsetWidth / this.cardsContainer.clientWidth * 100;
        let marginPercent = (cards.length > 1) ? (HandHandler.MOBILE_HAND_SPAN_PERCENT - cards.length * cardWidthPercent) / (cards.length - 1) : 0;
        marginPercent = Math.min(marginPercent, -cardWidthPercent * HandHandler.DEFAULT_CARD_OVERLAP);
        marginPercent = Math.max(marginPercent, -cardWidthPercent * HandHandler.MOBILE_MAX_CARD_OVERLAP);
        cards.forEach((card, i) => {
            card.style.marginLeft = '0%';
            card.style.marginRight = (i === cards.length - 1) ? '0%' : `${marginPercent.toFixed(3)}%`;
        });
    }
    //sorted like the sprite: by color index, then value
    getSortedHandData() {
        return [...this.handData].sort((a, b) => (this.game.getColorIndex(a.color) - this.game.getColorIndex(b.color)) || (a.value - b.value));
    }
    insertCardToHand(cardData) {
        let aCard = this.game.createCardDiv(cardData);
        this.cardsContainer.appendChild(aCard);
    }
    cardsContainerClicked(event) {
        if (!this.game.bga.players.isCurrentPlayerActive())
            return;
        if (!HandHandler.SELECTION_STATES.includes(this.game.getGameStateName()))
            return;
        if (this.game.isInterfaceLocked())
            return;
        if (!event.target.classList.contains(HandHandler.SELECTABLE_CARD_CLASS))
            return;
        this.handCardClicked(event.target);
    }
    //selecting a card only raises it; the status-bar confirmation sends it. With one card at most (card play),
    //a click moves the selection; with more (card 10), clicks add cards until the limit
    handCardClicked(cardDiv) {
        const cardWasAlreadySelected = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);
        if (cardWasAlreadySelected) {
            cardDiv.classList.remove(HandHandler.SELECTED_CARD_CLASS);
        }
        else if (this.maxSelectedCards === 1) {
            this.clearSelection();
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
        }
        else if (this.getSelectedCardIDs().length < this.maxSelectedCards) {
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
        }
        this.game.handSelectionChanged();
    }
    clearSelection() {
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }
    getSelectedCardID() {
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }
    getSelectedCardIDs() {
        return Array.from(this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS)).map(card => parseInt(card.getAttribute('data-card-id')));
    }
    getSelectedCardData() {
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.getCardData(selectedCardID);
    }
    getCardData(cardID) {
        return this.handData.find(card => card.card_id === cardID) ?? null;
    }
    //selectable cards glow, the others keep their normal look
    setSelectableCards(selectableCardIDs, maxSelectedCards = 1) {
        this.clearSelection();
        this.maxSelectedCards = maxSelectedCards;
        for (let card of this.getCardDivs())
            card.classList.toggle(HandHandler.SELECTABLE_CARD_CLASS, selectableCardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }
    clearSelectableCards() {
        this.clearSelection();
        for (let card of this.getCardDivs())
            card.classList.remove(HandHandler.SELECTABLE_CARD_CLASS);
    }
    //the cards chosen this turn (a first card, then any card-1 chain) stay set aside in the hand until the reveal, or until "Change my mind"
    setChosenCards(cardIDs) {
        for (let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }
    //card 10: cards leaving my hand fade out
    async removeCards(cardIDs) {
        this.handData = this.handData.filter(handCard => !cardIDs.includes(handCard.card_id));
        const leavingCards = cardIDs.map(cardID => this.getCardDiv(cardID)).filter(card => card);
        leavingCards.forEach(card => card.classList.add('card-fading-out'));
        await this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME);
        leavingCards.forEach(card => card.remove());
        this.recomputeCardSpacing();
    }
    //card 10: cards joining my hand take their sorted place and slide in from fromElement (the other player's board), or fade in
    async addCards(cardsData, fromElement) {
        this.handData = [...this.handData, ...cardsData];
        this.displayHand();
        const arrivals = cardsData.map(cardData => {
            const card = this.getCardDiv(cardData.card_id);
            if (!card)
                return Promise.resolve();
            if (fromElement)
                return this.game.animateSlide(card, fromElement, null, HandHandler.SLIDE_ANIM_TIME);
            card.classList.add('card-fading-in');
            return this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME).then(() => card.classList.remove('card-fading-in'));
        });
        await Promise.all(arrivals);
    }
    getHandCardIDs() { return this.handData.map(cardData => cardData.card_id); }
    //the card leaves the hand at once while a copy of it slides into the played column
    async animateCardToColumn(cardData, column) {
        this.handData = this.handData.filter(handCard => handCard.card_id !== cardData.card_id);
        const handCard = this.getCardDiv(cardData.card_id);
        if (!handCard) {
            column.addCard(cardData);
            return;
        }
        const slidePromise = column.animateCardIn(cardData, handCard); //places the sliding copy on handCard before its first await,
        handCard.remove(); //so the hand card can go right away
        this.recomputeCardSpacing();
        await slidePromise;
    }
    //a crash discards the whole hand
    async discardAll() {
        this.handData = [];
        this.cardsContainer.classList.add('cards-fading-out');
        await this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME);
        this.cardsContainer.innerHTML = '';
        this.cardsContainer.classList.remove('cards-fading-out');
    }
    //a new round's hand
    //the fade-in class must come off once it has played: left on, card-fade-in stays every card's fallback animation
    //and replays whenever another animation stops applying (the playable glow when I confirm a card, for example)
    setHand(handData) {
        this.cardsContainer.classList.remove(HandHandler.HAND_FADE_IN_CLASS);
        this.handData = handData;
        this.displayHand();
        void this.cardsContainer.offsetWidth; //restart the animation if it's already running
        this.cardsContainer.classList.add(HandHandler.HAND_FADE_IN_CLASS);
        const handFadeInID = ++this.handFadeInCount; //a newer hand restarts the fade-in: only its own timer may end it
        this.game.bga.gameui.wait(HandHandler.HAND_FADE_IN_ANIM_TIME).then(() => {
            if (handFadeInID === this.handFadeInCount)
                this.cardsContainer.classList.remove(HandHandler.HAND_FADE_IN_CLASS);
        });
    }
    getCardDivs() { return Array.from(this.cardsContainer.querySelectorAll('.a-card')); }
    getCardDiv(cardID) { return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }
    getCardCount() { return this.cardsContainer.querySelectorAll('.a-card').length; }
    getHandContainer() { return this.handContainer; }
}
HandHandler.SELECTED_CARD_CLASS = 'selected-hand-card';
HandHandler.CHOSEN_CARD_CLASS = 'chosen-card';
HandHandler.SELECTABLE_CARD_CLASS = 'selectable-card';
HandHandler.FADE_ANIM_TIME = 400;
HandHandler.HAND_FADE_IN_CLASS = 'cards-fading-in';
HandHandler.HAND_FADE_IN_ANIM_TIME = 500; //card-fade-in on .cards-fading-in in Game.scss
HandHandler.SLIDE_ANIM_TIME = 600;
HandHandler.SELECTION_STATES = ['PlayCard', 'SwapCards'];
HandHandler.DEFAULT_CARD_OVERLAP = 0.1; //share of a card width each card covers of the one before
HandHandler.MAX_CARD_OVERLAP = 0.7;
HandHandler.MOBILE_HAND_SPAN_PERCENT = 99; //like Fugu: on mobile the hand spans 99% of its container's width
HandHandler.MOBILE_MAX_CARD_OVERLAP = 0.85; //on mobile a card may cover this share of the one before
HandHandler.RESIZE_DEBOUNCE_TIME = 100;

class DiceHandler {
    constructor(game, diceData) {
        this.game = game;
        this.diceData = diceData;
        this.diceContainer = document.querySelector('#dice-container');
        //only the dice in the game area get an id (for their tooltip), never the copies in log rows
        for (let dieData of this.diceData) {
            const aDie = this.createDieDiv(dieData);
            aDie.id = 'die-' + dieData.color;
            this.diceContainer.appendChild(aDie);
        }
        this.diceContainer.addEventListener('click', (event) => { this.diceContainerClicked(event); });
    }
    //card 9: the active owner picks one die, then turns it with the status bar buttons
    diceContainerClicked(event) {
        if (!this.game.bga.players.isCurrentPlayerActive())
            return;
        if (this.game.getGameStateName() !== 'ModifyDie')
            return;
        if (this.game.isInterfaceLocked())
            return;
        const aDie = event.target.closest('.a-die');
        if (!aDie || !aDie.classList.contains(DiceHandler.SELECTABLE_DIE_CLASS))
            return;
        const dieWasAlreadySelected = aDie.classList.contains(DiceHandler.SELECTED_DIE_CLASS);
        this.clearDieSelection();
        if (!dieWasAlreadySelected)
            aDie.classList.add(DiceHandler.SELECTED_DIE_CLASS);
        this.game.modifyDie.dieSelectionChanged();
    }
    setSelectableDice(colors) {
        this.clearSelectableDice();
        for (let color of colors)
            this.getDieDiv(color)?.classList.add(DiceHandler.SELECTABLE_DIE_CLASS);
    }
    clearSelectableDice() {
        this.clearDieSelection();
        this.diceContainer.querySelectorAll('.a-die.' + DiceHandler.SELECTABLE_DIE_CLASS).forEach(aDie => aDie.classList.remove(DiceHandler.SELECTABLE_DIE_CLASS));
    }
    clearDieSelection() {
        this.diceContainer.querySelectorAll('.a-die.' + DiceHandler.SELECTED_DIE_CLASS).forEach(aDie => aDie.classList.remove(DiceHandler.SELECTED_DIE_CLASS));
    }
    getSelectedDieColor() {
        const selectedDie = this.diceContainer.querySelector('.a-die.' + DiceHandler.SELECTED_DIE_CLASS);
        return selectedDie ? selectedDie.getAttribute('data-color') : null;
    }
    //also used for the mini dice in logs
    createDieDiv(dieData) {
        const aDie = document.createElement('div');
        aDie.className = 'a-die';
        aDie.setAttribute('data-color', dieData.color);
        aDie.innerHTML = '<span class="die-pip"></span>'.repeat(DiceHandler.PIPS_PER_DIE);
        this.applyDieData(aDie, dieData);
        return aDie;
    }
    //a die that has not been rolled yet (value null) shows a blank face
    applyDieData(aDie, dieData) {
        aDie.setAttribute('data-value', dieData.value === null ? '' : dieData.value.toString());
        aDie.setAttribute('data-modified-by-power9', dieData.modified_by_POWER9 ? 'true' : 'false');
        aDie.setAttribute('data-in-use-by-power11', dieData.in_use_by_POWER11 ? 'true' : 'false');
        const reserverID = dieData.reserved_by_POWER2;
        aDie.setAttribute('data-reserved-by-power2', reserverID === null ? '' : reserverID.toString());
        if (reserverID !== null)
            aDie.style.setProperty('--reserver-color', '#' + this.game.getPlayerColor(reserverID));
        else
            aDie.style.removeProperty('--reserver-color');
    }
    updateDice(diceData) {
        for (let dieData of diceData) {
            const aDie = this.getDieDiv(dieData.color);
            if (!aDie)
                continue;
            this.diceData = this.diceData.map(knownDie => (knownDie.color === dieData.color) ? dieData : knownDie);
            this.game.tooltipHandler?.updateDieTooltip(dieData);
            const previousValue = aDie.getAttribute('data-value');
            this.applyDieData(aDie, dieData);
            if (previousValue !== aDie.getAttribute('data-value'))
                this.playChangeAnimation(aDie);
        }
    }
    playChangeAnimation(aDie) {
        aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
        void aDie.offsetWidth; // restart the animation if it's already running
        aDie.classList.add(DiceHandler.CHANGE_ANIM_CLASS);
        aDie.addEventListener('animationend', () => aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS), { once: true });
    }
    getDieDiv(color) { return this.diceContainer.querySelector(`.a-die[data-color="${color}"]`); }
    getDiceContainer() { return this.diceContainer; }
    getDiceData() { return this.diceData; }
}
DiceHandler.PIPS_PER_DIE = 9; //3x3 layout, Game.scss shows the right pips for each data-value
DiceHandler.CHANGE_ANIM_CLASS = 'die-changed';
DiceHandler.SELECTABLE_DIE_CLASS = 'selectable-die';
DiceHandler.SELECTED_DIE_CLASS = 'selected-die';

class StartTokenHandler {
    constructor(game, startPlayerID) {
        this.game = game;
        this.startPlayerID = startPlayerID;
        this.startToken = document.createElement('div');
        this.startToken.id = 'start-token';
        this.startToken.className = 'start-token';
        const startTokenSlot = this.game.players[this.startPlayerID]?.getStartTokenSlot();
        if (startTokenSlot)
            startTokenSlot.appendChild(this.startToken);
    }
    //slides the token from its current player board to playerID's, the same way cards move between containers
    async moveTo(playerID) {
        const targetSlot = this.game.players[playerID]?.getStartTokenSlot();
        if (!targetSlot)
            return;
        this.startPlayerID = playerID;
        if (this.startToken.parentElement === targetSlot)
            return;
        if (!this.startToken.parentElement) { //nothing to slide from
            targetSlot.appendChild(this.startToken);
            return;
        }
        await this.game.animateSlide(this.startToken, this.startToken, targetSlot, StartTokenHandler.SLIDE_ANIM_TIME);
    }
    getStartPlayerID() { return this.startPlayerID; }
}
StartTokenHandler.SLIDE_ANIM_TIME = 600;

class LogMutationObserver {
    constructor(game) {
        this.game = game;
        this.nextTimestampValue = '';
        this.observeLogs();
    }
    observeLogs() {
        let observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.tagName.toLowerCase() === 'div' && node.classList.contains('log')) {
                            this.processLogDiv(node);
                        }
                    });
                }
            });
        });
        // Configure the MutationObserver to observe changes to the container's child nodes
        const config = {
            childList: true,
            subtree: true // Set to true if you want to observe all descendants of the container
        };
        // Start observing the container
        observer.observe($('logs'), config);
        observer.observe($('chatbar'), config); //mobile notifs
        if (g_archive_mode) { //to observe replayLogs that appears at the bottom of the page on replays
            let replayLogsObserverStarted = false;
            const replayLogsObserver = new MutationObserver((mutations, obs) => {
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach((node) => {
                            if (!replayLogsObserverStarted && node instanceof HTMLElement && node.id.startsWith('replaylogs')) {
                                this.processLogDiv(node);
                            }
                        });
                    }
                }
            });
            replayLogsObserver.observe(document.body, { childList: true, subtree: true });
        }
    }
    processLogDiv(node) {
        const classTags = Array.from(node.querySelectorAll('*[log-class-tag]'));
        for (const classTag of classTags) {
            const logClassName = classTag.getAttribute('log-class-tag');
            let parentLog = null;
            let current = classTag;
            while (current) {
                if (current.classList.contains('gamelogreview') || current.classList.contains('log')) {
                    parentLog = current;
                    break;
                }
                current = current.parentElement;
            }
            if (parentLog)
                parentLog.classList.add('a-game-log', logClassName);
        }
        classTags.forEach(classTag => classTag.remove());
        this.game.tooltipHandler?.addTooltipsToCardsIn(node); //power cards and Last Chance shown in this row
        node.querySelectorAll('.playername').forEach((playerName) => {
            playerName.setAttribute('player-color', this.game.rgbToHex(window.getComputedStyle(playerName).color));
        });
        if (this.game.isDesktop() && node.classList.contains('a-game-log')) {
            let timestamp = Array.from(node.querySelectorAll('.timestamp'));
            if (timestamp.length > 0) {
                this.nextTimestampValue = timestamp[0].innerText;
            }
            else if (this.observeLogs.hasOwnProperty('nextTimestampValue')) {
                let newTimestamp = document.createElement('div');
                newTimestamp.classList.add('timestamp');
                newTimestamp.innerHTML = this.nextTimestampValue;
                node.appendChild(newTimestamp);
            }
        }
    }
    addLogClassTag(logHTML, logClass) { return { log_html: logHTML + `<div log-class-tag="${logClass}"></div>`, log_class: logClass }; }
    //create specific log types
    createLogNewRound(roundNumber) {
        let logHTML = `
            <div class="new-round-row">
                ${_('Round ${roundNumber}').replace('${roundNumber}', roundNumber.toString())}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'new-round-log');
    }
    createLogDiceRolled(dice) {
        const diceHTML = dice.filter(dieData => dieData.value !== null).map(dieData => this.game.diceHandler.createDieDiv(dieData).outerHTML).join('');
        let logHTML = `
            <div class="dice-rolled-row">
                ${diceHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'dice-rolled-log');
    }
    createLogCardsRevealed(reveals) {
        const revealsHTML = reveals.map(reveal => {
            const cardDiv = (reveal.choice === 'card' && reveal.card) ? this.game.createCardDiv(reveal.card) : this.game.createLastChanceDiv();
            //a card-1 chain: the first card, then "+" and each card added to it
            const chainHTML = (reveal.extra_cards_POWER1 ?? []).map(extraCard => `<span class="reveal-chain-plus">+</span>${this.getMiniCardsHTML([extraCard])}`).join('');
            return `
                <div class="reveal-entry">
                    ${this.game.divColoredPlayer(reveal.player_id, { class: 'playername' })}
                    <div class="minimised-card-icon">${cardDiv.outerHTML}</div>${chainHTML}
                </div>`;
        }).join('');
        let logHTML = `
            <div class="cards-revealed-row">
                ${revealsHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'cards-revealed-log');
    }
    createLogPlayerCrashed(player_id) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const crashText = player_id === this.game.getMyPlayerID()
            ? _('${you} crash').replace('${you}', playerNameHTML)
            : _('${playerName} crashes').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="player-crashed-row">
                <i class="fa6 fa-bomb"></i>&nbsp;${crashText}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'crash-log');
    }
    createLogGrandSlam(player_id) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const grandSlamText = player_id === this.game.getMyPlayerID()
            ? _('${you} play all 10 cards: Grand Slam!').replace('${you}', playerNameHTML)
            : _('${playerName} plays all 10 cards: Grand Slam!').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="grand-slam-row">
                ${grandSlamText}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'grand-slam-log');
    }
    createLogStartTokenPassed(player_id) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const startTokenText = player_id === this.game.getMyPlayerID()
            ? _('${you} receive the Start token').replace('${you}', playerNameHTML)
            : _('${playerName} receives the Start token').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="start-token-row">
                <div class="start-token mini-start-token"></div>&nbsp;${startTokenText}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'start-token-log');
    }
    createLogStopOrMoreRevealed(choices) {
        const namesByChoice = { stop: [], more: [] };
        for (const player_id in choices)
            namesByChoice[choices[player_id]].push(this.game.divColoredPlayer(player_id, { class: 'playername' }));
        let choiceLinesHTML = '';
        if (namesByChoice.stop.length > 0)
            choiceLinesHTML += `<div class="stop-or-more-line"><i class="fa6 fa-flag-checkered"></i>&nbsp;${_('Stop:')} ${namesByChoice.stop.join(', ')}</div>`;
        if (namesByChoice.more.length > 0)
            choiceLinesHTML += `<div class="stop-or-more-line"><i class="fa6 fa-play"></i>&nbsp;${_('More:')} ${namesByChoice.more.join(', ')}</div>`;
        let logHTML = `
            <div class="stop-or-more-row">
                ${choiceLinesHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'stop-or-more-log');
    }
    createLogStarsBanked(player_id, stars) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const starsBankedText = player_id === this.game.getMyPlayerID()
            ? _('${you} bank ${stars} ★').replace('${you}', playerNameHTML)
            : _('${playerName} banks ${stars} ★').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="stars-banked-row">
                ${starsBankedText.replace('${stars}', `<b>${stars}</b>`)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'stars-banked-log');
    }
    createLogDieReservedPOWER2(player_id, die) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const reservedText = player_id === this.game.getMyPlayerID()
            ? _('${you} reserve ${die} for the next roll').replace('${you}', playerNameHTML)
            : _('${playerName} reserves ${die} for the next roll').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="die-reserved-row">
                ${reservedText.replace('${die}', this.getMiniDieHTML(die))}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'die-reserved-power2-log');
    }
    createLogGoldenDiePOWER11(player_id) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const goldenDieText = player_id === this.game.getMyPlayerID()
            ? _('${you} add ${die} to the next roll').replace('${you}', playerNameHTML)
            : _('${playerName} adds ${die} to the next roll').replace('${playerName}', playerNameHTML);
        const goldenDie = { color: 'gold', value: null, reserved_by_POWER2: null, modified_by_POWER9: false, in_use_by_POWER11: true };
        let logHTML = `
            <div class="golden-die-row">
                ${goldenDieText.replace('${die}', this.getMiniDieHTML(goldenDie))}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'golden-die-power11-log');
    }
    createLogDieModifiedPOWER9(player_id, dieColor, oldValue, newValue) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const modifiedText = player_id === this.game.getMyPlayerID()
            ? _('${you} turn ${oldDie} to ${newDie}').replace('${you}', playerNameHTML)
            : _('${playerName} turns ${oldDie} to ${newDie}').replace('${playerName}', playerNameHTML);
        const oldDie = { color: dieColor, value: oldValue, reserved_by_POWER2: null, modified_by_POWER9: false, in_use_by_POWER11: true };
        const newDie = { ...oldDie, value: newValue };
        let logHTML = `
            <div class="die-modified-row">
                ${modifiedText.replace('${oldDie}', this.getMiniDieHTML(oldDie)).replace('${newDie}', this.getMiniDieHTML(newDie))}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'die-modified-power9-log');
    }
    //card 10: the owner and the victim get the private row with the cards (ownerGives / targetGives set); everyone else
    //gets the public row with card backs. The owner and victim get the public row too, and hide it (duplicate-log)
    createLogCardsSwappedPOWER10(owner_id, target_id, ownerGives, targetGives, count) {
        const ownerCardsHTML = ownerGives ? this.getMiniCardsHTML(ownerGives) : this.getMiniCardBacksHTML(count);
        const targetCardsHTML = targetGives ? this.getMiniCardsHTML(targetGives) : this.getMiniCardBacksHTML(count);
        let logHTML = `
            <div class="cards-swapped-row">
                ${this.game.divColoredPlayer(owner_id, { class: 'playername' })} ${ownerCardsHTML}
                <span class="log-arrow">⇄</span>
                ${this.game.divColoredPlayer(target_id, { class: 'playername' })} ${targetCardsHTML}
            </div>` + ' &nbsp;';
        const isPublicRow = ownerGives === null;
        const isInvolved = [owner_id, target_id].includes(this.game.getMyPlayerID());
        let logRow = this.addLogClassTag(logHTML, 'cards-swapped-power10-log');
        if (isPublicRow && isInvolved)
            logRow = this.addLogClassTag(logRow.log_html, 'duplicate-log');
        return logRow;
    }
    //card 10 with no opponent left: the owner sees the cards, everyone else card backs (the owner hides the public row)
    createLogCardsRedrawnPOWER10(player_id, discarded, drawn, count) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const redrawnText = player_id === this.game.getMyPlayerID()
            ? _('${you} discard ${discarded} and draw ${drawn}').replace('${you}', playerNameHTML)
            : _('${playerName} discards ${discarded} and draws ${drawn}').replace('${playerName}', playerNameHTML);
        const discardedHTML = discarded ? this.getMiniCardsHTML(discarded) : this.getMiniCardBacksHTML(count);
        const drawnHTML = drawn ? this.getMiniCardsHTML(drawn) : this.getMiniCardBacksHTML(count);
        let logHTML = `
            <div class="cards-redrawn-row">
                ${redrawnText.replace('${discarded}', discardedHTML).replace('${drawn}', drawnHTML)}
            </div>` + ' &nbsp;';
        let logRow = this.addLogClassTag(logHTML, 'cards-redrawn-power10-log');
        if (discarded === null && player_id === this.game.getMyPlayerID())
            logRow = this.addLogClassTag(logRow.log_html, 'duplicate-log');
        return logRow;
    }
    createLogPowerSkipped(player_id, value, card, reason) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const cardHTML = card ? this.getMiniCardsHTML([card]) : `<b>${value}</b>`;
        let skippedText = player_id === this.game.getMyPlayerID()
            ? _('${you} do not use ${card}').replace('${you}', playerNameHTML)
            : _('${playerName} does not use ${card}').replace('${playerName}', playerNameHTML);
        if (reason === 'nothing_to_draw')
            skippedText += ' ' + _('(no card left to draw)');
        else if (reason === 'not_enough_cards')
            skippedText += ' ' + _('(fewer than 2 cards in hand)');
        let logHTML = `
            <div class="power-skipped-row">
                ${skippedText.replace('${card}', cardHTML)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'power-skipped-log');
    }
    //the game ends: everyone at the top score wins (a Grand Slam, or equal scores, share the win)
    createLogGameEnd(winner_ids, winningScore) {
        const iWin = winner_ids.includes(this.game.getMyPlayerID());
        const otherWinnersHTML = winner_ids.filter(player_id => player_id !== this.game.getMyPlayerID()).map(player_id => this.game.divColoredPlayer(player_id, { class: 'playername' }));
        const winnersHTML = [...(iWin ? [this.game.divYou({ class: 'playername' })] : []), ...otherWinnersHTML].join(', ');
        const gameEndText = (iWin || winner_ids.length > 1)
            ? _('${players} win with ${stars} ★')
            : _('${players} wins with ${stars} ★');
        let logHTML = `
            <div class="game-end-row">
                <i class="fa6 fa-trophy"></i>&nbsp;${gameEndText.replace('${players}', winnersHTML).replace('${stars}', `<b>${winningScore}</b>`)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'game-end-log');
    }
    getMiniCardsHTML(cards) {
        return cards.map(card => `<div class="minimised-card-icon">${this.game.createCardDiv(card).outerHTML}</div>`).join('');
    }
    getMiniCardBacksHTML(count) {
        let backsHTML = '';
        for (let i = 0; i < count; i++)
            backsHTML += `<div class="minimised-card-icon">${this.game.createCardBackDiv().outerHTML}</div>`;
        return backsHTML;
    }
    getMiniDieHTML(die) {
        return this.game.diceHandler.createDieDiv(die).outerHTML;
    }
}

//"Change my mind", shared by every multiactive state where a choice stays pending until the last player has chosen.
//The player is inactive by then, so the action skips the active-player check (checkAction: false) and the
//server checks the state itself (#[CheckAction(false)] + checkPossibleAction)
class ChangeMindHandler {
    constructor(game) {
        this.game = game;
    }
    addChangeMindButton(actionName) {
        return this.game.bga.statusBar.addActionButton(_('Change my mind'), () => this.changeMindClicked(actionName), {
            id: 'change-mind-button',
            color: 'secondary',
        });
    }
    changeMindClicked(actionName) {
        if (!this.game.bga.actions.checkPossibleActions(actionName))
            return;
        this.game.bga.actions.performAction(actionName, {}, { checkAction: false });
    }
}

//every card value with a power; Game.createCardDiv gives those cards the power-card-POWER<n> class (used by the log row tooltips)
const POWER_CARD_VALUES = [1, 2, 9, 10, 11];
class TooltipHandler {
    constructor(game) {
        this.game = game;
        this.powerReferenceHTMLByValue = {}; //0: no entry highlighted
        this.addTooltipsToCards();
        this.addTooltipsToBoards();
        //log rows written before this handler existed; later rows come through LogMutationObserver
        const logs = document.getElementById('logs');
        if (logs)
            this.addTooltipsToCardsIn(logs);
        for (let dieData of this.game.diceHandler.getDiceData())
            this.updateDieTooltip(dieData);
    }
    //every card in the game area (my hand, every played column) shows the power reference, with the hovered card's power
    //highlighted. Tooltips only reach the cards already on the page, so this runs again whenever cards are created
    addTooltipsToCards() {
        if (this.isSafariMobile()) {
            this.addTooltipToBottomForSafari();
            return;
        }
        document.querySelectorAll(TooltipHandler.GAME_AREA_CARDS_SELECTOR).forEach((card) => {
            const value = parseInt(card.getAttribute('data-value'));
            this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerReferenceHTML(POWER_CARD_VALUES.includes(value) ? value : 0), TooltipHandler.TOOLTIP_DELAY);
        });
        this.game.bga.gameui.addTooltipToClass('last-chance-card', this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
    }
    //a log row: its mini cards keep the single-power tooltip. Only that row is queried, so loading a long log stays cheap
    addTooltipsToCardsIn(container) {
        if (this.isSafariMobile())
            return;
        container.querySelectorAll('.a-card[id]').forEach((card) => {
            const value = parseInt(card.getAttribute('data-value'));
            if (card.classList.contains(TooltipHandler.getPowerCardClass(value)))
                this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerTooltipHTML(value), TooltipHandler.TOOLTIP_DELAY);
            else if (card.classList.contains('last-chance-card'))
                this.game.bga.gameui.addTooltip(card.id, this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
        });
    }
    //player boards and played columns: the parts that aren't self-explanatory
    addTooltipsToBoards() {
        this.game.bga.gameui.addTooltip('start-token', _('Start token: powers resolve clockwise from this player. It passes to the next player every turn.'), '', TooltipHandler.TOOLTIP_DELAY);
        for (let player_id in this.game.players) {
            this.game.bga.gameui.addTooltip('hand-count-backs-' + player_id, _('Cards in hand'), '', TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltipHtml('round-status-' + player_id, this.getRoundStatusTooltipHTML(), TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltip('column-stars-' + player_id, _('Stars of the cards played this round. A player who stops banks them; a crash loses them.'), '', TooltipHandler.TOOLTIP_DELAY);
        }
    }
    //a die's tooltip follows its card 2 reservation, card 9 change and, for gold, card 11
    updateDieTooltip(dieData) {
        const dieID = 'die-' + dieData.color;
        if (!document.getElementById(dieID))
            return;
        const dieNames = {
            red: _('Red die'),
            green: _('Green die'),
            purple: _('Purple die'),
            blue: _('Blue die'),
            orange: _('Orange die'),
            gold: _('Golden die (card 11): it only counts in a sum with a colored die and never gives its color'),
        };
        const lines = [dieNames[dieData.color]];
        if (dieData.reserved_by_POWER2 !== null)
            lines.push(_('Reserved by ${player_name} (card 2): only they can use it on this roll').replace('${player_name}', this.game.getPlayerName(dieData.reserved_by_POWER2)));
        if (dieData.modified_by_POWER9)
            lines.push(_('Turned by a card 9 this roll: it cannot be turned again'));
        this.game.bga.gameui.addTooltipHtml(dieID, `<div class="die-tooltip">${lines.join('<br>')}</div>`, TooltipHandler.TOOLTIP_DELAY);
    }
    addTooltipToBottomForSafari() {
        if (document.querySelector('.safari-mobile-power-reference-container'))
            return;
        const safariMobilePowerReferenceContainer = document.createElement('div');
        safariMobilePowerReferenceContainer.className = 'safari-mobile-power-reference-container';
        safariMobilePowerReferenceContainer.innerHTML = this.getPowerReferenceHTML(0);
        document.getElementById('game_play_area').appendChild(safariMobilePowerReferenceContainer);
    }
    /**
     * The power reference, laid out like the rulebook's powers page: entries grouped by timing, each with its icon
     * (img/power_icons_sprite.webp) floated left. Two columns on desktop (left: card 1, then cards 2 and 10; right:
     * card 11, then card 9), one on narrow screens. $highlightedValue's entry is highlighted; 0 highlights none.
     * The text follows our BGA rules (SPEC.md), not the rulebook's wording.
     */
    getPowerReferenceHTML(highlightedValue) {
        if (this.powerReferenceHTMLByValue[highlightedValue])
            return this.powerReferenceHTMLByValue[highlightedValue];
        const powerTexts = {
            1: _('Play one more card from your hand on the same roll, revealed with it. It must be playable too, and another 1 lets you add again.'),
            2: _('Automatic: on the next roll, the die of this card\'s color is reserved for you. Opponents can\'t use it, alone or in a sum. Only if you choose More.'),
            10: _('Swap 2 cards of your choice for 2 random cards of an opponent who chose More and has at least 2 cards. If there is none, discard up to 2 cards and draw as many instead. Only if you choose More.'),
            11: _('Add the golden die to the next roll, for everyone. It has no color and only counts in a sum with a colored die. Only if you choose More.'),
            9: _('Turn one die by 1 up or down (a 6 becomes a 1, and a 1 a 6), for everyone. The golden die and a reserved die can be turned. Each die only once per roll. Only if you are still in the round.'),
        };
        const entryHTML = (value) => `
            <div class="power-reference-entry highlighted-power-entry">
                <span class="power-icon" data-power-value="${value}"></span><b>${_('Card ${value}:').replace('${value}', value.toString())}</b> ${powerTexts[value]}
            </div>`;
        const headingHTML = (heading) => `<div class="power-reference-heading">${heading}</div>`;
        const referenceHTML = `
            <div class="tooltip-wrapper power-reference">
                <div class="power-reference-column">
                    ${headingHTML(_('Power activated immediately after playing the card:'))}
                    ${entryHTML(1)}
                    ${headingHTML(_('Powers activated before the next dice roll:'))}
                    ${entryHTML(2)}
                    ${entryHTML(10)}
                </div>
                <div class="power-reference-column">
                    ${entryHTML(11)}
                    ${headingHTML(_('Power activated after the next dice roll and before playing a card:'))}
                    ${entryHTML(9)}
                </div>
            </div>
        `;
        this.powerReferenceHTMLByValue[highlightedValue] = referenceHTML;
        return referenceHTML;
    }
    //a single power, for the mini cards in log rows
    getPowerTooltipHTML(value) {
        const powerTexts = {
            1: { timing: _('Right away'), effect: _('Add one more playable card from your hand on the same dice. Another 1 lets you add again.') },
            2: { timing: _('After Stop or More, if you choose More'), effect: _('The die of this card\'s color is reserved for you on the next roll: opponents can\'t use it, alone or in a sum.') },
            9: { timing: _('After the next roll'), effect: _('You may turn one die by 1 up or down (6 becomes 1, 1 becomes 6), for everyone. Each die can be turned once per roll. Only if you are still in the round.') },
            10: { timing: _('After Stop or More, if you choose More'), effect: _('You may swap 2 cards of your choice for 2 random cards of an opponent who chose More. If none can be chosen, discard and draw instead.') },
            11: { timing: _('After Stop or More, if you choose More'), effect: _('You may add the golden die to the next roll, for everyone. It only counts in a sum with a colored die and never gives its color.') },
        };
        const { timing, effect } = powerTexts[value];
        const stars = '★'.repeat(this.game.getStarsForValue(value));
        const tooltipHTML = `
            <div class="tooltip-wrapper power-tooltip">
                <div class="power-tooltip-title">${_('Card ${value}').replace('${value}', value.toString())} <span class="power-tooltip-stars">${stars}</span></div>
                <div class="power-tooltip-timing">${timing}</div>
                <div class="power-tooltip-text">${effect}</div>
            </div>
        `;
        return tooltipHTML;
    }
    getLastChanceTooltipText() {
        return _('Last Chance: once per game, when you can\'t play any card, play nothing this turn and stay in the round.');
    }
    getRoundStatusTooltipHTML() {
        return `
            <div class="round-status-tooltip">
                <div><i class="fa6 fa-play"></i>&nbsp;${_('In: still playing this round')}</div>
                <div><i class="fa6 fa-flag-checkered"></i>&nbsp;${_('Stopped: banks their stars at the end of the round')}</div>
                <div><i class="fa6 fa-bomb"></i>&nbsp;${_('Crashed: scores nothing this round')}</div>
            </div>
        `;
    }
    isSafariMobile() { return document.body.classList.contains('safari-browser') && this.game.isMobile(); }
    static getPowerCardClass(value) { return 'power-card-POWER' + value; }
}
TooltipHandler.TOOLTIP_DELAY = 1000;
TooltipHandler.GAME_AREA_CARDS_SELECTOR = '#my-hand-container .a-card[id], #played-columns-container .a-card[id]';

//Fugu's end-game table: one row per round (stars banked, a bomb for a crash, a gold cell for a Grand Slam,
//"-" for a round a Grand Slam cut short), then the total. Cells fade in one by one; a click fast-forwards
class EndGameScoringHandler {
    constructor(game) {
        this.game = game;
        this.bodyClickHandler = null;
        this.delayAfterFadeIns = 10000;
    }
    async displayEndGameScore(endGameScoring) {
        this.endGameScoring = endGameScoring;
        if (this.scoreContainer) {
            console.error('end-game-score-container already exists');
            return;
        }
        document.body.classList.add('displaying-end-game-score');
        this.winner_ids = endGameScoring.winner_ids;
        this.scoreContainer = document.createElement('div');
        this.scoreContainer.classList.add('end-game-score-container');
        this.scoreContainer.style.opacity = '0';
        this.scoreContainer.innerHTML = `
            <div class="show-table-button" style="display: none;" title="${_('Show Scoreboard')}">
                <i class="fa6 fa6-ranking-star"></i>
            </div>
            <div class="maximized-content">
                <i class="fa6 fa6-chevron-circle-left collapse-table-button" title="${_('Collapse Scoreboard')}"></i>
                <table>
                    <thead></thead>
                    <tbody></tbody>
                </table>
                <div class="fast-forward-text"></div>
            </div>
        `;
        document.querySelector('#game_play_area').appendChild(this.scoreContainer);
        this.thead = this.scoreContainer.querySelector('thead');
        this.tbody = this.scoreContainer.querySelector('tbody');
        this.showButton = this.scoreContainer.querySelector('.show-table-button');
        this.hideButton = this.scoreContainer.querySelector('.collapse-table-button');
        this.fastForwardButton = this.scoreContainer.querySelector('.fast-forward-text');
        this.fillTable();
        this.bindShowHideButtons();
        this.fastForwardButton.innerHTML = this.game.isDesktop() ? _('* Click anywhere to fast forward') : _('* Tap anywhere to fast forward');
        const instantFadeIn = this.isInstantFadeIn();
        const fadeInDuration = instantFadeIn ? 0 : 1000;
        const fadeInDelay = instantFadeIn ? 0 : 100;
        this.scoreContainer.style.transition = `opacity ${fadeInDuration}ms ease ${fadeInDelay}ms`;
        this.scoreContainer.style.opacity = '1';
        await this.game.bga.gameui.wait(fadeInDelay + fadeInDuration);
        this.scoreContainer.style.opacity = null;
        this.scoreContainer.style.transition = null;
        this.bindBodyScroll();
        await this.fadeInNextCell();
        document.body.classList.remove('displaying-end-game-score');
    }
    fillTable() {
        const playerIDs = this.game.getPlayerOrder();
        // Create header row with player names
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th class="corner-no-border-cell"></th>'; // Empty corner cell
        for (let player_id of playerIDs) {
            const playerNameDiv = this.game.divColoredPlayer(player_id, {}, false);
            headerRow.innerHTML += `<th class="player-name-cell" player-id="${player_id}">${playerNameDiv}</th>`;
        }
        this.thead.appendChild(headerRow);
        // One row per round
        const roundNumbers = Object.keys(this.endGameScoring.rounds).map(roundNumber => parseInt(roundNumber)).sort((a, b) => a - b);
        for (let roundNumber of roundNumbers) {
            const row = document.createElement('tr');
            row.innerHTML = `<td class="row-label-cell">${_('Round ${roundNumber}').replace('${roundNumber}', roundNumber.toString())}</td>`;
            for (let player_id of playerIDs) {
                const roundScore = this.endGameScoring.rounds[roundNumber][player_id] ?? null;
                row.innerHTML += `<td>${this.getRoundCellHTML(roundScore, player_id)}</td>`;
            }
            this.tbody.appendChild(row);
        }
        // Total row: it builds up as the round cells appear, then shows the final score
        const totalRow = document.createElement('tr');
        totalRow.classList.add('total-row');
        totalRow.innerHTML = `<td class="row-label-cell">${_('Total')}</td>`;
        for (let player_id of playerIDs)
            totalRow.innerHTML += `<td><div class="cell-text cell-total" style="opacity: 0;" player-id="${player_id}">0</div></td>`;
        this.tbody.appendChild(totalRow);
    }
    //the text of a round cell is its points (parsed by addColumnTotal); a crash or an unfinished round adds nothing
    getRoundCellHTML(roundScore, player_id) {
        const result = roundScore?.result ?? 'unfinished';
        let cellContent;
        if (result === 'stopped')
            cellContent = `${roundScore.stars} ★`;
        else if (result === 'crashed')
            cellContent = '<i class="fa6 fa-bomb"></i>';
        else if (result === 'grand_slam')
            cellContent = `+${roundScore.stars}`;
        else
            cellContent = '-';
        return `<div class="cell-text cell-${result}" style="opacity: 0;" player-id="${player_id}">${cellContent}</div>`;
    }
    bindShowHideButtons() {
        this.hideButton.addEventListener('click', () => {
            this.hideButton.style.display = 'none';
            this.scoreContainer.querySelectorAll('.maximized-content').forEach((node) => { node.style.display = 'none'; });
            this.showButton.style.display = null;
            this.scoreContainer.setAttribute('collapsed', 'true');
        });
        this.showButton.addEventListener('click', () => {
            this.hideButton.style.display = null;
            this.scoreContainer.querySelectorAll('.maximized-content').forEach((node) => { node.style.display = null; });
            this.showButton.style.display = 'none';
            this.scoreContainer.removeAttribute('collapsed');
        });
    }
    bindBodyScroll() {
        this.scoreContainer.style.transition = 'opacity 300ms ease';
        let fadeInGeneration = 0;
        // Bind scroll event listener to the body
        window.addEventListener('scroll', () => {
            const generation = ++fadeInGeneration;
            this.scoreContainer.style.opacity = '0.3';
            this.game.bga.gameui.wait(100).then(() => {
                if (generation === fadeInGeneration)
                    this.scoreContainer.style.opacity = '1';
            });
        });
    }
    async fadeInNextCell() {
        const cells = Array.from(this.tbody.querySelectorAll('.cell-text:not(.displayed)'));
        const overallContent = document.getElementById('overall-content');
        overallContent.removeEventListener('click', this.bodyClickHandler);
        if (cells.length <= Object.keys(this.game.players).length * 2) {
            this.fastForwardButton.style.transition = 'opacity 400ms ease';
            this.fastForwardButton.style.opacity = '0';
        }
        if (cells.length <= 0) { //end of score display
            const allCells = Array.from(this.tbody.querySelectorAll('.cell-text'));
            allCells.forEach((cell) => { cell.style.opacity = ''; });
            this.makeWinnersJump();
            this.setEndGamePlayerScores();
            await this.game.bga.gameui.wait(this.delayAfterFadeIns);
            return;
        }
        let cell = cells[0];
        const instantFadeIn = this.isInstantFadeIn();
        cell.classList.add('displayed');
        const fadeInDuration = instantFadeIn ? 0 : 500;
        const fadeInDelay = instantFadeIn ? 0 : 100;
        let fastForwardFadeIn;
        const fastForwarded = new Promise(resolve => { fastForwardFadeIn = resolve; });
        this.bodyClickHandler = async (event) => {
            cell.style.transition = null;
            cell.style.opacity = '1';
            fastForwardFadeIn();
        };
        overallContent.addEventListener('click', this.bodyClickHandler);
        this.addColumnTotal(cell.getAttribute('player-id'));
        cell.style.transition = `opacity ${fadeInDuration}ms ease ${fadeInDelay}ms`;
        cell.style.opacity = '1';
        await Promise.race([
            this.game.bga.gameui.wait(fadeInDelay + fadeInDuration),
            fastForwarded
        ]);
        await this.fadeInNextCell();
    }
    addColumnTotal(playerID) {
        const cells = Array.from(this.tbody.querySelectorAll(`.cell-text.displayed[player-id="${playerID}"]:not(.cell-total)`));
        let total = 0;
        cells.forEach(cell => {
            const value = parseInt(cell.textContent || '0');
            if (!isNaN(value))
                total += value;
        });
        const totalCell = this.tbody.querySelector(`.cell-total[player-id="${playerID}"]`);
        if (totalCell) {
            totalCell.textContent = total.toString();
            totalCell.classList.add('displayed');
            totalCell.style.opacity = '1';
        }
    }
    makeWinnersJump() {
        let delay = 0;
        for (let winner_id of this.winner_ids) {
            this.game.bga.gameui.wait(delay).then(() => {
                this.thead.querySelector(`.player-name-cell[player-id="${winner_id}"]`)?.classList.add('jumping-text');
            });
            delay += 100 + Math.random() * 50;
        }
    }
    //the totals end on the real scores, so they always match BGA's ranking
    setEndGamePlayerScores() {
        for (let player_id in this.endGameScoring.scores) {
            const score = this.endGameScoring.scores[player_id];
            const totalCell = this.tbody.querySelector(`.cell-total[player-id="${player_id}"]`);
            if (totalCell)
                totalCell.textContent = score.toString();
            this.game.bga.playerPanels.getScoreCounter(parseInt(player_id))?.toValue(score);
        }
    }
    isInstantFadeIn() { return this.game.getGameStateName() === 'gameEnd'; }
}

class PrefHandler {
    constructor(game, prefNameToIndex) {
        this.game = game;
        this.prefNameToIndex = prefNameToIndex;
        this.oneClickPlay = false;
        this.game.bga.userPreferences.onChange = (prefIndex, prefValue) => this.onGameUserPreferenceChanged(prefIndex, prefValue);
        for (const prefName in this.prefNameToIndex) {
            const prefIndex = this.prefNameToIndex[prefName];
            this.onGameUserPreferenceChanged(prefIndex, this.game.bga.userPreferences.get(prefIndex), true);
        }
    }
    //on page load (isInitialLoad) the state classes haven't received their args yet, so nothing is redrawn
    onGameUserPreferenceChanged(prefIndex, prefValue, isInitialLoad = false) {
        switch (prefIndex) {
            case this.prefNameToIndex.one_click_play:
                this.oneClickPlay = prefValue == 1;
                if (!isInitialLoad)
                    this.game.playCard.preferenceChanged();
                break;
        }
    }
    //game specific functions
    //clicking a playable card plays it at once, with no Confirm step
    isOneClickPlay() { return this.oneClickPlay; }
}

/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * Game.ts
 */
class Game {
    constructor(bga) {
        this.players = {};
        this.localCardIDCounter = 1;
        this.bga = bga;
        // Declare the State classes
        this.playCard = new PlayCard(this, bga);
        this.bga.states.register('PlayCard', this.playCard);
        this.stopOrMore = new StopOrMore(this, bga);
        this.bga.states.register('StopOrMore', this.stopOrMore);
        this.modifyDie = new ModifyDie(this, bga);
        this.bga.states.register('ModifyDie', this.modifyDie);
        this.resolvePowers = new ResolvePowers(this, bga);
        this.bga.states.register('ResolvePowers', this.resolvePowers);
        this.swapCards = new SwapCards(this, bga);
        this.bga.states.register('SwapCards', this.swapCards);
        // Uncomment the next line to show debug informations about state changes in the console. Remove before going to production!
        // this.bga.states.logger = console.log;
    }
    /*
        setup:

        This method must set up the game user interface according to current game situation specified
        in parameters.

        The method is called each time the game interface is displayed to a player, ie:
        _ when the game starts
        _ when a player refreshes the game page (F5)

        "gamedatas" argument contains all datas retrieved by your "getAllDatas" PHP method.
    */
    setup(gamedatas) {
        this.gamedatas = gamedatas;
        document.body.setAttribute('data-player-count', Object.keys(gamedatas.players).length.toString());
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="dice-container"></div>
            <div id="my-hand-container"></div>
            <div id="played-columns-container"></div>
        `);
        this.myPlayerID = this.bga.players.getCurrentPlayerId();
        this.diceHandler = new DiceHandler(this, gamedatas.dice);
        this.endGameScoringHandler = new EndGameScoringHandler(this);
        // Setting up player boards and played columns
        for (let player_id in gamedatas.players) {
            const { name, color, player_no, hand_count, round_status, last_chance_used } = this.gamedatas.players[player_id];
            const playedCardsData = gamedatas.cardsPlayed[parseInt(player_id)] || [];
            this.players[player_id] = new PlayerHandler(this, parseInt(player_id), name, color, player_no, hand_count, round_status, last_chance_used, playedCardsData);
        }
        //played columns follow turn order, starting with myself (playerorder starts with the current player)
        for (let next_player_id of gamedatas.playerorder) {
            const nextColumnContainer = this.players[next_player_id].getPlayedColumn().getColumnContainer();
            nextColumnContainer.parentElement.append(nextColumnContainer);
        }
        if (this.players.hasOwnProperty(this.myPlayerID)) { //spectators have no hand
            this.myself = this.players[this.myPlayerID];
            this.myself.getPlayedColumn().setMyColumn(true);
            this.handHandler = new HandHandler(this, gamedatas.cardsInMyHand);
        }
        //a Grand Slam ends the game, so this only matters after F5 at the end
        for (let player_id of gamedatas.grandSlamPlayerIds ?? [])
            this.players[player_id]?.setGrandSlam();
        this.startTokenHandler = new StartTokenHandler(this, gamedatas.startPlayerId);
        this.logMutationObserver = new LogMutationObserver(this);
        this.changeMindHandler = new ChangeMindHandler(this);
        this.tooltipHandler = new TooltipHandler(this);
        this.prefHandler = new PrefHandler(this, gamedatas.pref_names);
        this.bga.gameui.onScreenWidthChange = () => this.onScreenWidthChange();
        if (gamedatas.hasOwnProperty('endGameScoring'))
            this.endGameScoringHandler.displayEndGameScore(gamedatas.endGameScoring);
        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();
    }
    ///////////////////////////////////////////////////
    //// Utility methods
    /*

        Here, you can defines some utility methods that you can use everywhere in your javascript
        script. Typically, functions that are used in multiple state classes or outside a state class.

    */
    bgaFormatText(log, args) {
        try {
            log = _(log);
            if (log && args && !args.processed) {
                args.processed = true;
                // list of special keys we want to replace with images
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR', 'STARS_BANKED_LOG_STR',
                    'DIE_RESERVED_POWER2_LOG_STR', 'GOLDEN_DIE_POWER11_LOG_STR', 'DIE_MODIFIED_POWER9_LOG_STR', 'CARDS_SWAPPED_POWER10_LOG_STR', 'CARDS_REDRAWN_POWER10_LOG_STR', 'POWER_SKIPPED_LOG_STR', 'GAME_END_LOG_STR'];
                for (let key of keys) {
                    if (key in args) {
                        if (key == 'NEW_ROUND_LOG_STR')
                            log = this.logMutationObserver.createLogNewRound(args['round_number']).log_html;
                        else if (key == 'DICE_ROLLED_LOG_STR')
                            log = this.logMutationObserver.createLogDiceRolled(args['dice']).log_html;
                        else if (key == 'REVEAL_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRevealed(args['reveals']).log_html;
                        else if (key == 'CRASH_LOG_STR')
                            log = this.logMutationObserver.createLogPlayerCrashed(args['player_id']).log_html;
                        else if (key == 'GRAND_SLAM_LOG_STR')
                            log = this.logMutationObserver.createLogGrandSlam(args['player_id']).log_html;
                        else if (key == 'START_TOKEN_LOG_STR')
                            log = this.logMutationObserver.createLogStartTokenPassed(args['player_id']).log_html;
                        else if (key == 'STOP_OR_MORE_LOG_STR')
                            log = this.logMutationObserver.createLogStopOrMoreRevealed(args['choices']).log_html;
                        else if (key == 'STARS_BANKED_LOG_STR')
                            log = this.logMutationObserver.createLogStarsBanked(args['player_id'], args['stars']).log_html;
                        else if (key == 'DIE_RESERVED_POWER2_LOG_STR')
                            log = this.logMutationObserver.createLogDieReservedPOWER2(args['player_id'], args['die']).log_html;
                        else if (key == 'GOLDEN_DIE_POWER11_LOG_STR')
                            log = this.logMutationObserver.createLogGoldenDiePOWER11(args['player_id']).log_html;
                        else if (key == 'DIE_MODIFIED_POWER9_LOG_STR')
                            log = this.logMutationObserver.createLogDieModifiedPOWER9(args['player_id'], args['die_color'], args['old_value'], args['new_value']).log_html;
                        else if (key == 'CARDS_SWAPPED_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsSwappedPOWER10(args['owner_id'], args['target_id'], args['owner_gives'] ?? null, args['target_gives'] ?? null, args['count']).log_html;
                        else if (key == 'CARDS_REDRAWN_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRedrawnPOWER10(args['player_id'], args['discarded'] ?? null, args['drawn'] ?? null, args['count']).log_html;
                        else if (key == 'POWER_SKIPPED_LOG_STR')
                            log = this.logMutationObserver.createLogPowerSkipped(args['player_id'], args['value'], args['card'] ?? null, args['reason'] ?? '').log_html;
                        else if (key == 'GAME_END_LOG_STR')
                            log = this.logMutationObserver.createLogGameEnd(args['winner_ids'], args['winning_score']).log_html;
                    }
                }
            }
        }
        catch (e) {
            console.error(log, args, "Exception thrown", e.stack);
        }
        return { log, args };
    }
    divYou(attributes = {}) {
        let color = this.gamedatas.players[this.myPlayerID].color;
        attributes['player-color'] = color;
        let html = "<span style=\"font-weight:bold;color:#" + color + ";\" " + this.getAttributesHTML(attributes) + ">" + _("You") + "</span>";
        return html;
    }
    divColoredPlayer(player_id, attributes = {}, detectYou = true) {
        if (detectYou && parseInt(player_id) === this.myPlayerID)
            return this.divYou(attributes);
        player_id = player_id.toString();
        let color = this.gamedatas.players[player_id].color;
        attributes['player-color'] = color;
        let html = "<span style=\"color:#" + color + ";\" " + this.getAttributesHTML(attributes) + ">" + this.gamedatas.players[player_id].name + "</span>";
        return html;
    }
    getAttributesHTML(attributes) { return Object.entries(attributes || {}).map(([key, value]) => `${key}="${value}"`).join(' '); }
    createCardDiv(cardData) {
        let aCard = document.createElement('div');
        aCard.className = 'a-card';
        aCard.setAttribute('id', 'an-id-required-for-tooltips-' + this.localCardIDCounter);
        this.localCardIDCounter++;
        aCard.setAttribute('data-color', cardData.color);
        aCard.setAttribute('data-value', String(cardData.value));
        aCard.setAttribute('data-card-id', String(cardData.card_id));
        if (POWER_CARD_VALUES.includes(cardData.value))
            aCard.classList.add(TooltipHandler.getPowerCardClass(cardData.value)); //power tooltip
        return aCard;
    }
    createCardBackDiv() {
        let aCard = document.createElement('div');
        aCard.className = 'a-card';
        aCard.setAttribute('data-card-kind', 'back');
        return aCard;
    }
    createLastChanceDiv() {
        let aCard = document.createElement('div');
        aCard.className = 'a-card last-chance-card';
        aCard.setAttribute('id', 'an-id-required-for-tooltips-' + this.localCardIDCounter);
        this.localCardIDCounter++;
        aCard.setAttribute('data-card-kind', 'last-chance');
        return aCard;
    }
    cloneCard(card) {
        const cardClone = card.cloneNode(true);
        cardClone.classList.add('cloned-card');
        return cardClone;
    }
    //slides element into the container `to`, starting from where `from` is now (from may be element itself).
    //A copy flies over the page while the real element waits hidden in `to`, like Fugu moves cards between containers.
    //With `to` null, element is already in its place (a card sorted into my hand) and only the copy moves.
    //The copy also changes size on the way: it starts at the size `from` has on screen (a hand card, or the top mini card
    //back of a player board) and lands exactly at the size and place of element, so nothing jumps at the end.
    //Everything is measured on screen (getBoundingClientRect), and the copy (in <body>, outside BGA's mobile scaling of the
    //game area) converts screen px into its own px with its measured zoom, so it matches on desktop and mobile alike.
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    async animateSlide(element, from, to, durationMs) {
        const fromRect = this.getSlideSourceRect(from); //before element moves: from may be element itself
        const slidingClone = element.cloneNode(true);
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        element.style.visibility = 'hidden';
        if (to)
            to.appendChild(element);
        const toRect = element.getBoundingClientRect();
        document.body.appendChild(slidingClone);
        const baseRect = slidingClone.getBoundingClientRect(); //on screen, untransformed at the viewport's top-left corner
        const cssWidth = parseFloat(getComputedStyle(slidingClone).width); //unrounded, unlike offsetWidth
        const zoom = (cssWidth > 0) ? baseRect.width / cssWidth : 1;
        //scaled to rect's height (cards and the token keep their aspect) and centered on rect, so a source wider than the
        //copy, like a row of mini card backs, still sends it off from its middle
        const transformOnto = (rect) => {
            const scale = (baseRect.height > 0) ? rect.height / baseRect.height : 1;
            const left = rect.left + (rect.width - baseRect.width * scale) / 2;
            return `translate(${(left - baseRect.left) / zoom}px, ${(rect.top - baseRect.top) / zoom}px) scale(${scale})`;
        };
        slidingClone.style.transform = transformOnto(fromRect);
        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in
        slidingClone.style.transition = `transform ${durationMs}ms ease-in-out`;
        slidingClone.style.transform = transformOnto(toRect);
        await this.bga.gameui.wait(durationMs);
        element.style.visibility = null;
        slidingClone.remove();
    }
    //a player board's hand count is a row of mini card backs: a card leaving it starts from the top one
    getSlideSourceRect(from) {
        if (!from.classList.contains('a-card')) {
            const cards = from.querySelectorAll('.a-card');
            if (cards.length > 0)
                return cards[cards.length - 1].getBoundingClientRect();
        }
        return from.getBoundingClientRect();
    }
    rgbToHex(rgb) {
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) {
            console.error('-- rgb --', rgb);
            throw new Error("Invalid RGB format");
        }
        // Convert each component to a two-character hexadecimal
        const [, r, g, b] = match;
        return [r, g, b]
            .map((num) => {
            const hex = parseInt(num, 10).toString(16);
            return hex.padStart(2, '0'); // Ensure two digits
        })
            .join(''); // Combine into a single string
    }
    onScreenWidthChange() {
        this.handHandler?.recomputeCardSpacingAfterResize();
    }
    isDesktop() { return document.body.classList.contains('desktop_version'); }
    isMobile() { return document.body.classList.contains('mobile_version'); }
    isInterfaceLocked() { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    updateStatusText(statusText) { $('gameaction_status').innerHTML = statusText; $('pagemaintitletext').innerHTML = statusText; }
    getGameStateName() { return this.gamedatas.gamestate.name; }
    getColorIndex(color) {
        for (const colorIndex in this.gamedatas.cardColors) {
            if (this.gamedatas.cardColors[colorIndex] === color)
                return parseInt(colorIndex);
        }
        return 0;
    }
    getStarsForValue(value) { return this.gamedatas.starsByValue[value] || 0; }
    getColorName(color) {
        const colorNames = { red: _('red'), green: _('green'), purple: _('purple'), blue: _('blue'), orange: _('orange') }; //same strings as CARD_COLOR_NAMES in material.inc.php
        return colorNames[color];
    }
    getPlayerColor(playerID) { return this.gamedatas.players[playerID]?.color; }
    getPlayerName(playerID) { return this.gamedatas.players[playerID]?.name ?? ''; }
    //a hand card was clicked: the current state handles the selection
    handSelectionChanged() {
        const stateName = this.getGameStateName();
        if (stateName === 'PlayCard')
            this.playCard.selectionChanged();
        else if (stateName === 'SwapCards')
            this.swapCards.selectionChanged();
    }
    //card 10, seen by everyone but the two players involved: N card backs slide each way between their boards
    async animateCardBacksBetweenBoards(fromPlayerID, toPlayerID, count) {
        const fromPlayer = this.players[fromPlayerID];
        const toPlayer = this.players[toPlayerID];
        if (!fromPlayer || !toPlayer)
            return;
        const slides = [];
        for (let i = 0; i < count; i++) {
            const cardBack = this.createCardBackDiv();
            cardBack.classList.add('mini-card-back');
            slides.push(this.animateSlide(cardBack, fromPlayer.getHandCountElement(), toPlayer.getHandCountElement(), Game.CARD_BACK_SLIDE_ANIM_TIME).then(() => cardBack.remove()));
        }
        await Promise.all(slides);
        toPlayer.setHandCount(toPlayer.getHandCount()); //a swap keeps hand sizes, this only redraws the backs
    }
    getMyPlayerID() { return this.myPlayerID; }
    getPlayerOrder() { return this.gamedatas.playerorder; } //turn order, starting with myself
    //end utility
    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications
    /*
        setupNotifications:

        In this method, you associate each of your game notifications with your local method to handle it.

        Note: game notification names correspond to "bga->notify->all" calls in your Game.php file.

    */
    setupNotifications() {
        // automatically listen to the notifications, based on the `notif_xxx` function on this class.
        // Uncomment the logger param to see debug information in the console about notifications.
        this.bga.notifications.setupPromiseNotifications({
        // logger: console.log
        });
    }
    // Add the notification handlers
    async notif_newRound(args) {
        const columnsCleared = [];
        for (let player_id in this.players) {
            const player = this.players[player_id];
            columnsCleared.push(player.getPlayedColumn().clear());
            player.setRoundStatus('in');
            player.setHandCount(args.hand_counts[player_id] ?? 0);
        }
        this.diceHandler.updateDice(args.dice);
        await Promise.all(columnsCleared);
    }
    async notif_newHand(args) {
        this.handHandler?.setHand(args.cards);
        this.tooltipHandler.addTooltipsToCards();
    }
    async notif_diceRolled(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_playChoiceConfirmed(args) {
        this.playCard.onChoiceConfirmed(args);
    }
    async notif_playChainUpdated_POWER1(args) {
        this.playCard.onChainUpdated(args);
    }
    async notif_playChoiceReverted(args) {
        this.playCard.onChoiceReverted(args);
    }
    //every revealed card slides at once: mine from my hand, the others from their player board's hand count
    async notif_cardsRevealed(args) {
        await Promise.all(args.reveals.map(reveal => this.animateReveal(reveal)));
        for (let player_id in args.hand_counts)
            this.players[player_id]?.setHandCount(args.hand_counts[player_id]);
        this.tooltipHandler.addTooltipsToCards();
    }
    async animateReveal(reveal) {
        const player = this.players[reveal.player_id];
        if (!player)
            return;
        if (reveal.choice === 'last_chance') {
            await player.setLastChanceUsed(true, true);
            return;
        }
        //a card-1 chain follows its first card into the column, slightly behind it
        const revealedCards = [reveal.card, ...(reveal.extra_cards_POWER1 ?? [])];
        const slides = [];
        for (let i = 0; i < revealedCards.length; i++) {
            if (i > 0)
                await this.bga.gameui.wait(Game.CHAIN_CARD_STAGGER_TIME);
            if (reveal.player_id === this.myPlayerID && this.handHandler)
                slides.push(this.handHandler.animateCardToColumn(revealedCards[i], player.getPlayedColumn()));
            else
                slides.push(player.getPlayedColumn().animateCardIn(revealedCards[i], player.getHandCountElement()));
        }
        await Promise.all(slides);
    }
    async notif_playerCrashed(args) {
        const player = this.players[args.player_id];
        if (!player)
            return;
        const discards = [player.getPlayedColumn().clear()];
        if (args.player_id === this.myPlayerID && this.handHandler)
            discards.push(this.handHandler.discardAll());
        await Promise.all(discards);
        player.setHandCount(0);
        player.setRoundStatus('crashed');
    }
    async notif_grandSlam(args) {
        this.bga.playerPanels.getScoreCounter(args.player_id).toValue(args.score);
        this.players[args.player_id]?.setGrandSlam();
    }
    async notif_startTokenPassed(args) {
        await this.startTokenHandler.moveTo(args.player_id);
    }
    async notif_stopOrMoreChoiceConfirmed(args) {
        this.stopOrMore.setPendingChoice(args.choice);
    }
    async notif_stopOrMoreChoiceReverted(args) {
        this.stopOrMore.setPendingChoice(null);
    }
    async notif_stopOrMoreRevealed(args) {
        for (let player_id in args.choices) {
            if (args.choices[player_id] === 'stop')
                this.players[player_id]?.setRoundStatus('stopped');
        }
    }
    async notif_starsBanked(args) {
        this.bga.playerPanels.getScoreCounter(args.player_id).toValue(args.score);
    }
    //last turn's card-2 reservation and golden die expire after the reveal
    async notif_diceUpdated(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_dieReserved_POWER2(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_goldenDieAdded_POWER11(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_dieModified_POWER9(args) {
        this.diceHandler.updateDice(args.dice);
    }
    //private, to the owner and the victim only: my side of the swap
    async notif_cardsSwapped_POWER10(args) {
        if (!this.handHandler)
            return;
        const iAmOwner = args.owner_id === this.myPlayerID;
        const cardsILose = (iAmOwner ? args.owner_gives : args.target_gives) ?? [];
        const cardsIGet = (iAmOwner ? args.target_gives : args.owner_gives) ?? [];
        const otherPlayerID = iAmOwner ? args.target_id : args.owner_id;
        await this.handHandler.removeCards(cardsILose.map(card => card.card_id));
        await this.handHandler.addCards(cardsIGet, this.players[otherPlayerID]?.getHandCountElement() ?? null);
        this.tooltipHandler.addTooltipsToCards();
    }
    //public: the owner and the victim already animated their private notification
    async notif_cardsSwappedPublic_POWER10(args) {
        if (args.owner_id === this.myPlayerID || args.target_id === this.myPlayerID)
            return;
        await Promise.all([
            this.animateCardBacksBetweenBoards(args.owner_id, args.target_id, args.count),
            this.animateCardBacksBetweenBoards(args.target_id, args.owner_id, args.count),
        ]);
    }
    //private, to the owner only
    async notif_cardsRedrawn_POWER10(args) {
        if (!this.handHandler)
            return;
        await this.handHandler.removeCards((args.discarded ?? []).map(card => card.card_id));
        await this.handHandler.addCards(args.drawn ?? [], null);
        this.tooltipHandler.addTooltipsToCards();
    }
    //public: hand sizes don't change, the log row is all there is
    async notif_cardsRedrawnPublic_POWER10(args) {
    }
    async notif_powerSkipped(args) {
    }
    async notif_displayEndGameScoring(args) {
        this.updateStatusText(_('Final scores'));
        await this.endGameScoringHandler.displayEndGameScore(args.endGameScoring);
    }
}
Game.CARD_BACK_SLIDE_ANIM_TIME = 600;
Game.CHAIN_CARD_STAGGER_TIME = 150;

export { Game };
