/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Everyone still in the round secretly chooses a card (select, then confirm), or, only when no card is
 * playable, their Last Chance or a crash. The choice stays pending until the last player has chosen, and
 * "Change my mind" takes it back.
 */
class PlayCard {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.playCardButton = null;
        this.pendingChoice = null;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.setPendingChoice(args?._private?.pendingPlayChoice ?? null); //restores a set-aside card after F5
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     * The chosen card keeps its set-aside look: notif_cardsRevealed comes after the state change and moves it.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.handHandler?.clearPlayableCards();
        this.playCardButton = null;
    }
    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        this.game.handHandler?.clearPlayableCards();
        this.playCardButton = null;
        const privateArgs = args?._private;
        if (isCurrentPlayerActive && privateArgs) {
            if (privateArgs.playableCardIDs.length > 0) {
                this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
                this.game.handHandler?.setPlayableCards(privateArgs.playableCardIDs);
                //hidden until a card is selected, like Fugu's swap button
                this.playCardButton = this.bga.statusBar.addActionButton(_('confirm'), () => this.playCardClicked(), { id: 'play-card-button' });
                this.selectionChanged();
            }
            else {
                this.bga.statusBar.setTitle(_('${you} cannot play any card'));
                if (privateArgs.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), { id: 'last-chance-button' });
                //no confirm dialog: Change my mind is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), { id: 'crash-button', color: 'alert' });
            }
        }
        else if (this.pendingChoice) {
            const pendingChoiceTitles = {
                card: _('${you} chose a card. Waiting for other players'),
                last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                crash: _('${you} chose to crash. Waiting for other players'),
            };
            this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            this.game.changeMindHandler.addChangeMindButton('actChangeMindPlayCard');
        }
        else {
            this.bga.statusBar.setTitle(_('Other players must choose a card'));
        }
    }
    //called by HandHandler when a playable card is selected or unselected
    selectionChanged() {
        if (!this.playCardButton)
            return;
        const selectedCard = this.game.handHandler?.getSelectedCardData();
        this.playCardButton.style.display = selectedCard ? null : 'none';
        if (selectedCard) {
            const cardIcon = `<span class="status-card-icon" data-color="${selectedCard.color}" aria-label="${selectedCard.value} ${selectedCard.color}">${selectedCard.value}</span>`;
            this.bga.statusBar.setTitle(_('Play ${card}?').replace('${card}', cardIcon));
        }
        else {
            this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
        }
    }
    playCardClicked() {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if (!selectedCardID)
            return;
        this.bga.actions.performAction('actPlayCard', { cardID: selectedCardID });
    }
    //pendingPlayChoice from the args on entry and F5, then playChoiceConfirmed / playChoiceReverted; the status bar follows through onPlayerActivationChange
    setPendingChoice(pendingChoice) {
        this.pendingChoice = pendingChoice;
        this.game.handHandler?.setChosenCard((pendingChoice && pendingChoice.choice === 'card') ? pendingChoice.card_id : null);
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
        if (!['PlayCard'].includes(this.game.getGameStateName()))
            return;
        if (this.game.isInterfaceLocked())
            return;
        if (!event.target.classList.contains(HandHandler.PLAYABLE_CARD_CLASS))
            return;
        this.handCardClicked(event.target);
    }
    //selecting a playable card only raises it; the status-bar confirmation sends it
    handCardClicked(cardDiv) {
        const cardWasAlreadySelected = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);
        this.clearSelection();
        if (!cardWasAlreadySelected)
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
        this.game.playCard.selectionChanged();
    }
    clearSelection() {
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }
    getSelectedCardID() {
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }
    getSelectedCardData() {
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.handData.find(card => card.card_id === selectedCardID) ?? null;
    }
    //playable cards glow, the others keep their normal look
    setPlayableCards(playableCardIDs) {
        for (let card of this.getCardDivs())
            card.classList.toggle(HandHandler.PLAYABLE_CARD_CLASS, playableCardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }
    clearPlayableCards() {
        this.clearSelection();
        for (let card of this.getCardDivs())
            card.classList.remove(HandHandler.PLAYABLE_CARD_CLASS);
    }
    //the card chosen this turn stays set aside in the hand until the reveal, or until "Change my mind"
    setChosenCard(cardID) {
        for (let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardID !== null && parseInt(card.getAttribute('data-card-id')) === cardID);
    }
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
    setHand(handData) {
        this.handData = handData;
        this.displayHand();
        this.cardsContainer.classList.remove('cards-fading-in');
        void this.cardsContainer.offsetWidth; //restart the animation if it's already running
        this.cardsContainer.classList.add('cards-fading-in');
    }
    getCardDivs() { return Array.from(this.cardsContainer.querySelectorAll('.a-card')); }
    getCardDiv(cardID) { return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }
    getCardCount() { return this.cardsContainer.querySelectorAll('.a-card').length; }
    getHandContainer() { return this.handContainer; }
}
HandHandler.SELECTED_CARD_CLASS = 'selected-hand-card';
HandHandler.CHOSEN_CARD_CLASS = 'chosen-card';
HandHandler.PLAYABLE_CARD_CLASS = 'playable-card';
HandHandler.FADE_ANIM_TIME = 400;

class DiceHandler {
    constructor(game, diceData) {
        this.game = game;
        this.diceData = diceData;
        this.diceContainer = document.querySelector('#dice-container');
        for (let dieData of this.diceData)
            this.diceContainer.appendChild(this.createDieDiv(dieData));
    }
    //also used for the mini dice in logs
    createDieDiv(dieData) {
        const aDie = document.createElement('div');
        aDie.className = 'a-die';
        aDie.setAttribute('data-color', dieData.color);
        aDie.innerHTML = '<span class="pip"></span>'.repeat(DiceHandler.PIPS_PER_DIE);
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
}
DiceHandler.PIPS_PER_DIE = 9; //3x3 grid, Game.scss shows the right pips for each data-value
DiceHandler.CHANGE_ANIM_CLASS = 'die-changed';

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
            return `
                <div class="reveal-entry">
                    ${this.game.divColoredPlayer(reveal.player_id, { class: 'playername' })}
                    <div class="minimised-card-icon">${cardDiv.outerHTML}</div>
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

class Game {
    constructor(bga) {
        this.players = {};
        this.localCardIDCounter = 1;
        console.log('riviera constructor');
        this.bga = bga;
        // Declare the State classes
        this.playCard = new PlayCard(this, bga);
        this.bga.states.register('PlayCard', this.playCard);
        this.stopOrMore = new StopOrMore(this, bga);
        this.bga.states.register('StopOrMore', this.stopOrMore);
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
        console.log("Starting game setup");
        this.gamedatas = gamedatas;
        document.body.setAttribute('data-player-count', Object.keys(gamedatas.players).length.toString());
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="dice-container"></div>
            <div id="my-hand-container"></div>
            <div id="played-columns-container"></div>
        `);
        this.myPlayerID = this.bga.players.getCurrentPlayerId();
        this.diceHandler = new DiceHandler(this, gamedatas.dice);
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
        this.startTokenHandler = new StartTokenHandler(this, gamedatas.startPlayerId);
        this.logMutationObserver = new LogMutationObserver(this);
        this.changeMindHandler = new ChangeMindHandler(this);
        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();
        console.log("Ending game setup");
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
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR', 'STARS_BANKED_LOG_STR'];
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
        aCard.className = 'a-card';
        aCard.setAttribute('data-card-kind', 'last-chance');
        return aCard;
    }
    cloneCard(card) {
        const cardClone = card.cloneNode(true);
        cardClone.classList.add('cloned-card');
        return cardClone;
    }
    placeOnObject(mobileObj, targetObj, forceBoundingClientRect = false) {
        mobileObj.style.left = '0px';
        mobileObj.style.top = '0px';
        // Get current positions
        const mobileWithinPageContent = document.getElementById('page-content').contains(mobileObj);
        const targetWithinPageContent = document.getElementById('page-content').contains(targetObj);
        let targetRect = mobileWithinPageContent ? this.getPos(targetObj) : targetObj.getBoundingClientRect();
        let mobileRect = targetWithinPageContent ? this.getPos(mobileObj) : mobileObj.getBoundingClientRect();
        if (forceBoundingClientRect) {
            targetRect = targetObj.getBoundingClientRect();
            mobileRect = mobileObj.getBoundingClientRect();
        }
        // Calculate the difference in position
        const deltaX = targetRect.left - mobileRect.left;
        const deltaY = targetRect.top - mobileRect.top;
        // Get current position values
        const currentLeft = parseFloat(mobileObj.style.left || '0');
        const currentTop = parseFloat(mobileObj.style.top || '0');
        // Apply the position difference to current position
        mobileObj.style.left = (currentLeft + deltaX) + 'px';
        mobileObj.style.top = (currentTop + deltaY) + 'px';
    }
    //slides element into the container `to`, starting from where `from` is now (from may be element itself).
    //A copy flies over the page while the real element waits hidden in `to`, like Fugu moves cards between containers.
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    async animateSlide(element, from, to, durationMs) {
        const slidingClone = element.cloneNode(true);
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        document.body.appendChild(slidingClone);
        this.placeOnObject(slidingClone, from, true);
        element.style.visibility = 'hidden';
        to.appendChild(element);
        const elementRect = element.getBoundingClientRect();
        const cloneRect = slidingClone.getBoundingClientRect();
        const targetLeft = parseFloat(slidingClone.style.left || '0') + (elementRect.left - cloneRect.left);
        const targetTop = parseFloat(slidingClone.style.top || '0') + (elementRect.top - cloneRect.top);
        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in
        slidingClone.style.transition = `left ${durationMs}ms ease-in-out, top ${durationMs}ms ease-in-out`;
        slidingClone.style.left = targetLeft + 'px';
        slidingClone.style.top = targetTop + 'px';
        await this.bga.gameui.wait(durationMs);
        element.style.visibility = null;
        slidingClone.remove();
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
    getPos(node) {
        let pos = this.bga.gameui.getBoundingClientRectIgnoreZoom(node);
        return pos;
    }
    isDesktop() { return document.body.classList.contains('desktop_version'); }
    isMobile() { return document.body.classList.contains('mobile_version'); }
    isInterfaceLocked() { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    getGameStateName() { return this.gamedatas.gamestate.name; }
    getColorIndex(color) {
        for (const colorIndex in this.gamedatas.cardColors) {
            if (this.gamedatas.cardColors[colorIndex] === color)
                return parseInt(colorIndex);
        }
        return 0;
    }
    getStarsForValue(value) { return this.gamedatas.starsByValue[value] || 0; }
    getPlayerColor(playerID) { return this.gamedatas.players[playerID]?.color; }
    getMyPlayerID() { return this.myPlayerID; }
    //end utility
    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications
    /*
        setupNotifications:

        In this method, you associate each of your game notifications with your local method to handle it.

        Note: game notification names correspond to "bga->notify->all" calls in your Game.php file.

    */
    setupNotifications() {
        console.log('notifications subscriptions setup');
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
    }
    async notif_diceRolled(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_playChoiceConfirmed(args) {
        this.playCard.setPendingChoice({ choice: args.choice, card_id: args.card_id });
    }
    async notif_playChoiceReverted(args) {
        this.playCard.setPendingChoice(null);
    }
    //every revealed card slides at once: mine from my hand, the others from their player board's hand count
    async notif_cardsRevealed(args) {
        await Promise.all(args.reveals.map(reveal => this.animateReveal(reveal)));
        for (let player_id in args.hand_counts)
            this.players[player_id]?.setHandCount(args.hand_counts[player_id]);
    }
    async animateReveal(reveal) {
        const player = this.players[reveal.player_id];
        if (!player)
            return;
        if (reveal.choice === 'last_chance') {
            await player.setLastChanceUsed(true, true);
            return;
        }
        if (reveal.player_id === this.myPlayerID && this.handHandler)
            await this.handHandler.animateCardToColumn(reveal.card, player.getPlayedColumn());
        else
            await player.getPlayedColumn().animateCardIn(reveal.card, player.getHandCountElement());
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
}

export { Game };
