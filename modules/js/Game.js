/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Milestone 1 stub: the game rests here after the deal. Card play arrives in Milestone 2.
 */
class PlayCard {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.bga.statusBar.setTitle(_('Card play is not available yet'));
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
    updateStarsTotal() {
        const starsTotal = this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
        this.starsText.textContent = `★ ${starsTotal}`;
    }
    setMyColumn(isMyColumn) {
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if (isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }
    setRoundStatus(roundStatus) { this.columnContainer.setAttribute('data-round-status', roundStatus); }
    getColumnContainer() { return this.columnContainer; }
}

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
                <div class="last-chance-indicator">
                    <i class="last-chance-used-icon fa6 fa-times"></i>
                </div>
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
    setLastChanceUsed(lastChanceUsed) {
        this.lastChanceUsed = lastChanceUsed;
        this.lastChanceIndicator.setAttribute('data-used', lastChanceUsed ? 'true' : 'false');
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
}
PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS = 6; //above this, the hand count shows a single card back followed by "x N"

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
        if (!event.target.classList.contains('a-card'))
            return;
        this.handCardClicked(event.target);
    }
    handCardClicked(cardDiv) {
        //card play arrives in Milestone 2
    }
    getCardCount() { return this.cardsContainer.querySelectorAll('.a-card').length; }
    getHandContainer() { return this.handContainer; }
}

class DiceHandler {
    constructor(game, diceData) {
        this.game = game;
        this.diceData = diceData;
        this.diceContainer = document.querySelector('#dice-container');
        for (let dieData of this.diceData)
            this.diceContainer.appendChild(this.createDieDiv(dieData));
    }
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
    //slides the token from its current player board to playerID's, the same way Fugu moves cards between containers:
    //a clone flies over the page while the real token waits hidden in its new slot
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
        const tokenClone = this.startToken.cloneNode(true);
        tokenClone.removeAttribute('id');
        tokenClone.classList.add('cloned-start-token');
        document.body.appendChild(tokenClone);
        this.game.placeOnObject(tokenClone, this.startToken, true);
        this.startToken.style.visibility = 'hidden';
        targetSlot.appendChild(this.startToken);
        const tokenRect = this.startToken.getBoundingClientRect();
        const cloneRect = tokenClone.getBoundingClientRect();
        const targetLeft = parseFloat(tokenClone.style.left || '0') + (tokenRect.left - cloneRect.left);
        const targetTop = parseFloat(tokenClone.style.top || '0') + (tokenRect.top - cloneRect.top);
        await this.game.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in
        tokenClone.style.transition = `left ${StartTokenHandler.SLIDE_ANIM_TIME}ms ease-in-out, top ${StartTokenHandler.SLIDE_ANIM_TIME}ms ease-in-out`;
        tokenClone.style.left = targetLeft + 'px';
        tokenClone.style.top = targetTop + 'px';
        await this.game.bga.gameui.wait(StartTokenHandler.SLIDE_ANIM_TIME);
        this.startToken.style.visibility = null;
        tokenClone.remove();
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
                // list of special keys we want to replace with images, filled in from Milestone 2
                const keys = [];
                for (let key of keys) {
                    if (key in args) {
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
    async notif_startTokenPassed(args) {
        await this.startTokenHandler.moveTo(args.player_id);
    }
}

export { Game };
