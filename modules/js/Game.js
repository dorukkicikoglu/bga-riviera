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
        this.playableCardDice = {}; //from the server, fixed for the whole state: the dice that make each card playable
        this.hasNoPlayableCard = false; //from the server, fixed for the whole state (the dice and the hand don't change in it)
        this.canUseLastChance = false;
        this.autoGrandSlam = false; //[BGA] the server played my last card for me: nothing to undo
        this.canUndoDieChange = false;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        const privateArgs = args?._private;
        this.playableCardIDs = privateArgs?.playableCardIDs ?? [];
        this.playableCardDice = privateArgs?.playableCardDice ?? {};
        this.hasNoPlayableCard = privateArgs?.hasNoPlayableCard ?? false;
        this.canUseLastChance = privateArgs?.canUseLastChance ?? false;
        this.autoGrandSlam = privateArgs?.autoGrandSlam ?? false;
        this.chainCardIDs = privateArgs?.chainCardIDs_POWER1 ?? [];
        this.chainOpen = privateArgs?.chainOpen_POWER1 ?? false;
        this.canUndoDieChange = privateArgs?.canUndoDieChange_POWER9 ?? false;
        this.setPendingChoice(privateArgs?.pendingPlayChoice ?? null); //restores the set-aside cards after F5
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     * The chosen cards keep their set-aside look: notif_cardsRevealed comes after the state change and moves them.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.handHandler?.clearSelectableCards();
        this.game.handHandler?.setChosenCardsUndoable(false); //the choices are locked in
        this.game.diceHandler.setComboHighlight([]);
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
        const handHandler = this.game.handHandler;
        this.bga.statusBar.removeActionButtons();
        handHandler?.clearSelectableCards();
        this.game.diceHandler.setComboHighlight([]);
        this.confirmButton = null;
        //spectator, or a player who isn't choosing and has nothing pending
        if (!handHandler || (!isCurrentPlayerActive && !this.pendingChoice)) {
            handHandler?.setChosenCardsUndoable(false);
            this.bga.statusBar.setTitle(_('Others must choose a card'));
            return;
        }
        //clicking a set-aside card is the Undo button only while waiting for the others (set once per rebuild, so the cards' tooltips aren't redone)
        const isWaiting = !isCurrentPlayerActive || !this.chainOpen;
        handHandler.setChosenCardsUndoable(isWaiting && !!this.pendingChoice && !this.autoGrandSlam && !this.game.isReplay());
        //in the two choosing branches, selectionChanged() sets the title (no card is selected yet)
        if (isCurrentPlayerActive && this.pendingChoice && this.chainOpen) {
            this.setSelectableCards();
            //hidden until a card is selected, like Fugu's swap button
            this.confirmActionName = 'actAddChainCard_POWER1';
            this.confirmButton = this.bga.statusBar.addActionButton(_('Add card'), () => this.confirmClicked(this.confirmActionName), { id: 'add-chain-card-button' });
            this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actFinishChain_POWER1'), { id: 'finish-chain-button', color: 'secondary' });
            this.game.undoHandler.addUndoButton('actUndoPlayCard');
            this.selectionChanged();
        }
        else if (isCurrentPlayerActive && !this.pendingChoice) {
            if (!this.hasNoPlayableCard) {
                this.setSelectableCards();
                //hidden until a card is selected, like Fugu's swap button
                this.confirmActionName = 'actPlayCard';
                this.confirmButton = this.bga.statusBar.addActionButton(_('Confirm'), () => this.confirmClicked(this.confirmActionName), { id: 'confirm-selected-card-button' });
                this.selectionChanged();
            }
            else {
                this.bga.statusBar.setTitle(_('${you} cannot play any card'));
                if (this.canUseLastChance)
                    this.bga.statusBar.addActionButton(_('Use Last Chance'), () => this.bga.actions.performAction('actUseLastChance'), { id: 'last-chance-button' });
                //no confirm dialog: Undo is the safety net until the last player has chosen
                this.bga.statusBar.addActionButton(_('Crash'), () => this.bga.actions.performAction('actCrash'), { id: 'crash-button', color: 'alert' });
            }
            if (this.canUndoDieChange)
                this.game.undoHandler.addUndoButton('actUndoDieChange_POWER9');
        }
        else {
            if (this.pendingChoice.choice === 'card') {
                //each chosen card with its power icon, like "Play [card]?"
                const cardsIcons = this.getChosenCardIDs().map(cardID => this.game.getStatusCardWithPowerHTML(handHandler.getCardData(cardID))).join('');
                this.bga.statusBar.setTitle(_('${you} chose ${card}. Waiting for other players'), { card: cardsIcons || _('a card') });
                this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
            }
            else {
                const pendingChoiceTitles = {
                    last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                    crash: _('${you} chose to crash. Waiting for other players'),
                };
                this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            }
            if (!this.autoGrandSlam)
                this.game.undoHandler.addUndoButton('actUndoPlayCard');
        }
    }
    //the playable cards glow (power cards cream); in Expert mode every card not chosen yet is selectable, none glows, and
    //canSelectCard() rejects the unplayable ones on click
    setSelectableCards() {
        const handHandler = this.game.handHandler;
        if (!this.game.isExpertMode()) {
            handHandler.setSelectableCards(this.playableCardIDs, 1, true);
            return;
        }
        const chosenCardIDs = this.getChosenCardIDs();
        handHandler.setSelectableCards(handHandler.getHandCardIDs().filter(cardID => !chosenCardIDs.includes(cardID)), 1, false, false);
    }
    //HandHandler, through Game.canSelectHandCard, before selecting a card: only Expert mode lets an unplayable card be clicked
    canSelectCard(cardID) {
        return !this.game.isExpertMode() || this.playableCardIDs.includes(cardID);
    }
    //HandHandler, through Game.undoableChosenCardClicked: only marked while the Undo button is there
    chosenCardClicked() {
        if (this.game.isReplay() || !this.pendingChoice || this.autoGrandSlam)
            return;
        this.game.undoHandler.undo('actUndoPlayCard');
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
        //the dice that make the selected card playable, so it is clear why it glows. Not in Expert mode, where players find their own plays
        this.game.diceHandler.setComboHighlight((selectedCard && !this.game.isExpertMode()) ? (this.playableCardDice[selectedCard.card_id] ?? []) : []);
        const isAddingToChain = this.pendingChoice !== null;
        if (selectedCard) {
            this.bga.statusBar.setTitle(isAddingToChain ? _('Add ${card}?') : _('Play ${card}?'), { card: this.game.getStatusCardWithPowerHTML(selectedCard) });
            this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
        }
        else if (isAddingToChain) {
            //the chain only stays open after a 1, so the last chosen card is the 1 that gives the extra card
            const chosenCardIDs = this.getChosenCardIDs();
            const lastChosenCard = this.game.handHandler?.getCardData(chosenCardIDs[chosenCardIDs.length - 1]);
            this.game.setPowerPromptTitle(lastChosenCard ?? null, true);
        }
        else
            this.bga.statusBar.setTitle(_('${you} must choose a card to play'));
    }
    confirmClicked(actionName) {
        const selectedCardID = this.game.handHandler?.getSelectedCardID();
        if (!selectedCardID)
            return;
        this.game.diceHandler.setComboHighlight([]);
        this.bga.actions.performAction(actionName, { cardID: selectedCardID });
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
    //Game.notif_autoGrandSlamAnnounced, in case the state args came before the server played the card
    onAutoGrandSlam() {
        this.autoGrandSlam = true;
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
 * pending until the last player has chosen, and "Undo" takes it back.
 */
class StopOrMore {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.pendingChoice = null;
        this.powerCardNeedingMore = null; //kept: the args only arrive on entering the state, and Undo rebuilds the buttons
        this.powerIconID = null;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.pendingChoice = args?._private?.pendingStopOrMoreChoice ?? null; //restores the choice after F5
        this.powerCardNeedingMore = args?._private?.powerCardNeedingMore ?? null;
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.removePowerIconTooltip();
    }
    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     */
    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.removePowerIconTooltip();
        this.bga.statusBar.removeActionButtons();
        if (isCurrentPlayerActive && this.game.myself) {
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
            const stopButton = this.bga.statusBar.addActionButton(stopLabel, () => this.bga.actions.performAction('actStop'), { id: 'stop-button' });
            stopButton.classList.toggle('stop-button-finishing', isFinishing);
            //the logs' More icon, in front of the translated label like the Stop button's bank icon
            //after the label, the card whose power only resolves if I keep going (nothing when there is none)
            const moreLabel = '<i class="fa6 fa-forward button-forward-icon" aria-hidden="true"></i>' + _('Keep Going') + this.game.getStatusCardIconHTML(this.powerCardNeedingMore);
            const moreButton = this.bga.statusBar.addActionButton(moreLabel, () => this.bga.actions.performAction('actMore'), { id: 'more-button' });
            const powerIcon = moreButton.querySelector('.status-card-icon');
            if (powerIcon) {
                this.powerIconID = powerIcon.id;
                this.game.tooltipHandler?.addPowerNeedingMoreTooltip(powerIcon);
            }
        }
        else if (this.pendingChoice) {
            const pendingChoiceTitles = {
                stop: _('${you} chose to stop. Waiting for other players'),
                more: _('${you} chose to continue. Waiting for other players'),
            };
            this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice]);
            this.game.undoHandler.addUndoButton('actUndoStopOrMore');
        }
        else {
            this.bga.statusBar.setTitle(_('Others must choose: Stop or More'));
        }
    }
    //"if I stop now, I most likely win": my total after banking reaches the end-game target and is strictly more than every
    //other player's best possible total this round (a tie doesn't count). That best is their score plus their column stars
    //while they are still in the round (they could still bank them), and their score alone once they have stopped (the
    //column is already in it) or crashed (the column is gone)
    isLikelyWinningStop(totalAfterBanking) {
        if (totalAfterBanking < this.game.getWinningScore())
            return false;
        return Object.values(this.game.players).every(player => {
            if (player === this.game.myself)
                return true;
            const bestTotal = player.getScore() + (player.getRoundStatus() === 'in' ? player.getPlayedColumn().getStarsTotal() : 0);
            return totalAfterBanking > bestTotal;
        });
    }
    //the icon is inside the button, so the pointer is on it when it is clicked, and no mouseleave comes once the button is
    //gone: without this, its tooltip would stay on screen
    removePowerIconTooltip() {
        if (this.powerIconID !== null)
            this.bga.gameui.removeTooltip(this.powerIconID);
        this.powerIconID = null;
    }
    //stopOrMoreChoiceConfirmed / stopOrMoreChoiceReverted; the status bar follows through onPlayerActivationChange
    setPendingChoice(pendingChoice) {
        this.pendingChoice = pendingChoice;
    }
}

class DiceHandler {
    constructor(game, diceData) {
        this.game = game;
        this.diceData = diceData;
        this.previewedColorPOWER9 = null;
        this.diceContainer = document.querySelector('#dice-container');
        //each die sits in a slot; during card 9 the slot also gets the die's arrow hit containers (showModifyArrowsPOWER9),
        //absolutely placed over it and in the space #dice-container always reserves, so the dice never move. Only the dice
        //in the game area get an id (for their tooltip), never the copies in log rows
        for (let dieData of this.diceData) {
            const aDie = this.createDieDiv(dieData);
            aDie.id = 'die-' + dieData.color;
            aDie.insertAdjacentHTML('beforeend', DiceHandler.LOCK_BADGE_HTML_POWER2);
            const dieSlot = document.createElement('div');
            dieSlot.className = 'die-slot';
            dieSlot.setAttribute('data-color', dieData.color);
            dieSlot.appendChild(aDie);
            this.diceContainer.appendChild(dieSlot);
        }
        this.diceContainer.addEventListener('click', (event) => { this.diceContainerClicked(event); });
    }
    //card 9: an arrow's hit container (the triangle, the gap and that half of the die) picks that choice
    diceContainerClicked(event) {
        if (!this.game.bga.players.isCurrentPlayerActive())
            return;
        if (this.game.getGameStateName() !== 'ModifyDie')
            return;
        if (this.game.isInterfaceLocked())
            return;
        const dieArrow = event.target.closest('.die-arrow');
        const dieSlot = dieArrow?.closest('.die-slot');
        if (!dieArrow || !dieSlot || !dieSlot.classList.contains(DiceHandler.MODIFIABLE_CLASS_POWER9))
            return;
        this.game.modifyDie.choiceClicked(dieSlot.getAttribute('data-color'), parseInt(dieArrow.getAttribute('data-delta')));
    }
    //card 9, active owner only: each die that can still be turned this roll gets two transparent hit containers on top of
    //it, the up one from its triangle's tip down to the die's middle line, the down one from that line to its triangle's tip,
    //each holding its visible triangle. They only exist during this, so the dice and their tooltips are untouched otherwise.
    //The title shows the result, wrap-around included
    showModifyArrowsPOWER9(modifiableDice) {
        this.hideModifyArrowsPOWER9();
        for (let die of modifiableDice) {
            const dieSlot = this.getDieSlot(die.color);
            if (!dieSlot)
                continue;
            for (let delta of [1, -1]) {
                const resultText = `${die.value} → ${DiceHandler.turnDieValue(die.value, delta)}`;
                dieSlot.insertAdjacentHTML('beforeend', `<div class="die-arrow" data-delta="${delta}" role="button" title="${resultText}" aria-label="${resultText}"><span class="die-arrow-triangle"></span></div>`);
            }
            dieSlot.classList.add(DiceHandler.MODIFIABLE_CLASS_POWER9);
        }
    }
    hideModifyArrowsPOWER9() {
        this.setSelectedChoicePOWER9(null);
        this.diceContainer.querySelectorAll('.die-arrow').forEach(dieArrow => dieArrow.remove());
        this.diceContainer.querySelectorAll('.die-slot').forEach(dieSlot => dieSlot.classList.remove(DiceHandler.MODIFIABLE_CLASS_POWER9));
    }
    //the chosen arrow stays highlighted until it is confirmed, switched or clicked again, and its die previews the result
    setSelectedChoicePOWER9(choice) {
        this.diceContainer.querySelectorAll('.die-arrow.' + DiceHandler.SELECTED_ARROW_CLASS_POWER9).forEach(dieArrow => dieArrow.classList.remove(DiceHandler.SELECTED_ARROW_CLASS_POWER9));
        if (choice)
            this.getDieSlot(choice.color)?.querySelector(`.die-arrow[data-delta="${choice.delta}"]`)?.classList.add(DiceHandler.SELECTED_ARROW_CLASS_POWER9);
        this.previewChoicePOWER9(choice);
    }
    //local only: one die at a time shows the value it would become. Its real value stays in diceData (status bar icon,
    //tooltip), so restoring it is just applying the real data again. Previewing and restoring change the face instantly:
    //the die-changed animation is only for real changes from the server (updateDice)
    previewChoicePOWER9(choice) {
        if (this.previewedColorPOWER9) {
            const previewedDie = this.getDieDiv(this.previewedColorPOWER9);
            const realDieData = this.diceData.find(dieData => dieData.color === this.previewedColorPOWER9);
            this.previewedColorPOWER9 = null;
            if (previewedDie && realDieData) {
                previewedDie.classList.remove(DiceHandler.PREVIEWED_CLASS_POWER9);
                this.applyDieData(previewedDie, realDieData);
            }
        }
        const realDieData = choice ? this.diceData.find(dieData => dieData.color === choice.color) : null;
        const aDie = choice ? this.getDieDiv(choice.color) : null;
        if (!choice || !aDie || !realDieData || realDieData.value === null)
            return;
        aDie.setAttribute('data-value', DiceHandler.turnDieValue(realDieData.value, choice.delta).toString());
        aDie.classList.add(DiceHandler.PREVIEWED_CLASS_POWER9);
        this.previewedColorPOWER9 = choice.color;
    }
    //PlayCard: lights the dice that make the selected card playable ([] for none). Only the class is toggled on the dice
    //already there, so the glow fades both ways, and a die in both the old and the new combination stays lit
    setComboHighlight(colors) {
        this.diceContainer.querySelectorAll('.die-slot > .a-die').forEach((aDie) => aDie.classList.toggle(DiceHandler.COMBO_HIGHLIGHT_CLASS, colors.includes(aDie.getAttribute('data-color'))));
    }
    //6 + 1 wraps to 1, 1 - 1 wraps to 6, like the server
    static turnDieValue(value, delta) { return ((value - 1 + delta + DiceHandler.DIE_FACES) % DiceHandler.DIE_FACES) + 1; }
    //also used for the mini dice in logs
    createDieDiv(dieData) {
        const aDie = document.createElement('div');
        aDie.className = 'a-die';
        aDie.setAttribute('data-color', dieData.color);
        aDie.innerHTML = '<span class="die-pip"></span>'.repeat(DiceHandler.PIPS_PER_DIE);
        this.applyDieData(aDie, dieData);
        return aDie;
    }
    //a die with no value is never displayed (Game.scss hides data-value=""). Only a roll ($isRoll) or a new die takes a
    //face away: any other update without a value (the golden die expiring after the reveal) keeps the last roll's face up,
    //so the dice area shows the last roll until the next one, where it fades out with the others
    applyDieData(aDie, dieData, isRoll = false, withRing = true) {
        if (dieData.value !== null)
            aDie.setAttribute('data-value', dieData.value.toString());
        else if (isRoll || !aDie.getAttribute('data-value'))
            aDie.setAttribute('data-value', '');
        aDie.setAttribute('data-modified-by-power9', dieData.modified_by_POWER9 ? 'true' : 'false');
        aDie.setAttribute('data-in-use-by-power11', dieData.in_use_by_POWER11 ? 'true' : 'false');
        this.applyReservationRingPOWER2(aDie, withRing ? dieData : null, !isRoll);
    }
    //card 2: pending (open padlock in the dice area, dashed ring in log rows) from the reveal until the roll it is for,
    //reserved (closed padlock, solid ring) from then. null: none (a die rolling in gets its padlock once it has landed). The
    //dice area also fades another player's reservation (data-reservation). animateLock: a die already showing its open
    //padlock that is now reserved closes it with an animation. A roll never animates it (the dice roll in with no padlock
    //and get it in its final state once they have landed)
    applyReservationRingPOWER2(aDie, dieData, animateLock = true) {
        const lockWasOpen = animateLock && aDie.classList.contains(DiceHandler.RESERVATION_PENDING_CLASS_POWER2);
        const reserverID = dieData?.reserved_by_POWER2 ?? null;
        const pendingReserverID = dieData?.pending_reserved_by_POWER2 ?? null;
        aDie.setAttribute('data-reserved-by-power2', reserverID === null ? '' : reserverID.toString());
        aDie.setAttribute('data-reservation', this.getReservationForMe(reserverID, pendingReserverID));
        aDie.classList.toggle(DiceHandler.RESERVATION_PENDING_CLASS_POWER2, pendingReserverID !== null);
        //the reserver's color: the log rows' ring (--reserver-color), the dice area's padlock badge (--lock-color) and its icon
        const ringOwnerID = pendingReserverID ?? reserverID;
        if (ringOwnerID !== null) {
            const reserverColor = '#' + this.game.getPlayerColor(ringOwnerID);
            aDie.style.setProperty('--reserver-color', reserverColor);
            aDie.style.setProperty('--lock-color', reserverColor);
            aDie.style.setProperty('--lock-icon-color', DiceHandler.getLockIconColorPOWER2(reserverColor));
        }
        else {
            aDie.style.removeProperty('--reserver-color');
            aDie.style.removeProperty('--lock-color');
            aDie.style.removeProperty('--lock-icon-color');
        }
        if (lockWasOpen && reserverID !== null && pendingReserverID === null)
            this.playLockClosingPOWER2(aDie);
    }
    //white on the player's color, or black when it is too light for white (sRGB relative luminance)
    static getLockIconColorPOWER2(hexColor) {
        const channels = [1, 3, 5].map(start => parseInt(hexColor.substring(start, start + 2), 16) / 255)
            .map(channel => (channel <= 0.04045) ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return (luminance <= DiceHandler.LOCK_ICON_WHITE_MAX_LUMINANCE_POWER2) ? '#ffffff' : '#000000';
    }
    //the padlock badge going from pending to reserved: the badge pops while the open padlock (at 75%) fades out and the
    //closed one drops into place at full opacity. Translate and scale only, never transform. None in replays or with BGA's
    //animations off
    playLockClosingPOWER2(aDie) {
        const badge = aDie.querySelector('.die-lock-badge-power2');
        if (!badge || this.game.isReplay() || !this.game.bga.gameui.bgaAnimationsActive())
            return;
        const timing = { duration: DiceHandler.LOCK_CLOSE_DURATION_POWER2, easing: 'ease-out' };
        badge.animate([{ scale: 1 }, { scale: 1.2, offset: 0.5 }, { scale: 1 }], timing);
        badge.querySelector('.die-lock-open-icon')?.animate([{ opacity: 0.75 }, { opacity: 0, offset: 0.6 }, { opacity: 0 }], timing);
        badge.querySelector('.die-lock-closed-icon')?.animate([
            { opacity: 0, translate: '-50% -75%' },
            { opacity: 1, translate: '-50% -50%' },
        ], timing);
    }
    //a reservation seen by the current player: another player's ('reserved-other', faded most), another player's revealed
    //card 2 not applied yet ('maybe-other') or none ('none', mine included). Reserved wins over pending. A spectator is
    //nobody, so every reservation is another player's
    getReservationForMe(reserverID, pendingReserverID) {
        const myPlayerID = this.game.getMyPlayerID();
        if (reserverID !== null && reserverID !== myPlayerID)
            return 'reserved-other';
        if (pendingReserverID !== null && pendingReserverID !== myPlayerID)
            return 'maybe-other';
        return 'none';
    }
    updateDice(diceData) {
        if (this.previewedColorPOWER9) //real values from the server end any card-9 preview (and its selection)
            this.game.modifyDie.cancelSelection();
        for (let dieData of diceData) {
            const aDie = this.getDieDiv(dieData.color);
            if (!aDie)
                continue;
            this.diceData = this.diceData.map(knownDie => (knownDie.color === dieData.color) ? dieData : knownDie);
            this.game.tooltipHandler?.updateDieTooltip(dieData);
            const previousValue = aDie.getAttribute('data-value');
            this.applyDieData(aDie, dieData);
            //a die losing its value is hidden at once: an animation on a hidden die never ends, and its leftover class would replay
            const newValue = aDie.getAttribute('data-value');
            if (previousValue !== newValue && newValue !== '')
                this.playChangeAnimation(aDie);
        }
    }
    /**
     * diceRolled: the previous roll's dice fade out in place while every die of the new roll rolls in, all at once (a
     * golden die left out of this roll only fades out). Resolves once the last die has stopped, so the notification waits
     * for it. With BGA's animations off (fast replay, hidden tab) the dice just change. A card 9 change is not a roll: it
     * goes through updateDice.
     * No die shows a card 2 padlock while the roll runs: the fading copies drop theirs and the dice rolling in have none.
     * The real dice get their padlocks once the last die has landed (awaiting every rollIn, each die's travel and delay
     * being random), already in their final state: no closing animation, which would flash the old open padlock first.
     */
    async rollDice(diceData) {
        if (this.previewedColorPOWER9)
            this.game.modifyDie.cancelSelection();
        const animate = this.game.bga.gameui.bgaAnimationsActive();
        if (animate)
            this.fadeOutShownDice();
        //every die gets its final face first, so the layout (a golden die joining or leaving) is final before measuring
        const rolledDice = [];
        for (let dieData of diceData) {
            const aDie = this.getDieDiv(dieData.color);
            if (!aDie)
                continue;
            this.diceData = this.diceData.map(knownDie => (knownDie.color === dieData.color) ? dieData : knownDie);
            aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
            const rollsIn = animate && dieData.value !== null;
            this.applyDieData(aDie, dieData, true, !rollsIn);
            this.game.tooltipHandler?.updateDieTooltip(dieData, !rollsIn);
            if (rollsIn)
                rolledDice.push({ aDie: aDie, dieData: dieData });
        }
        if (rolledDice.length > 0 && !this.game.isReplay()) //once per roll, as the dice start rolling in
            setTimeout(() => this.game.bga.sounds.play('dice_roll'), DiceHandler.ROLL_SOUND_DELAY);
        await Promise.all(rolledDice.map(rolledDie => this.rollIn(rolledDie.aDie, rolledDie.dieData)));
        //every die has landed: the card 2 padlocks show together
        for (let rolledDie of rolledDice) {
            this.applyReservationRingPOWER2(rolledDie.aDie, rolledDie.dieData, false);
            this.game.tooltipHandler?.updateDieTooltip(rolledDie.dieData);
        }
    }
    //each shown die leaves a copy at its place, under the dice rolling in (prepended), that fades out and is removed
    fadeOutShownDice() {
        const containerRect = this.diceContainer.getBoundingClientRect();
        this.diceContainer.querySelectorAll('.die-slot > .a-die').forEach((aDie) => {
            if (!aDie.getAttribute('data-value'))
                return;
            const dieRect = aDie.getBoundingClientRect();
            const zoom = this.getZoom(aDie);
            const fadingDie = aDie.cloneNode(true);
            fadingDie.removeAttribute('id');
            fadingDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS, DiceHandler.PREVIEWED_CLASS_POWER9);
            fadingDie.classList.add('fading-out-die');
            fadingDie.querySelector('.die-lock-badge-power2')?.remove(); //the replaced die's padlock goes as the roll starts
            fadingDie.style.left = ((dieRect.left - containerRect.left) / zoom - this.diceContainer.clientLeft) + 'px';
            fadingDie.style.top = ((dieRect.top - containerRect.top) / zoom - this.diceContainer.clientTop) + 'px';
            this.diceContainer.prepend(fadingDie);
            const fade = fadingDie.animate([
                { opacity: 1, scale: 1 },
                { opacity: 0, scale: DiceHandler.FADE_OUT_SCALE },
            ], { duration: DiceHandler.FADE_OUT_DURATION, easing: 'ease-in', fill: 'forwards' });
            Promise.race([
                fade.finished.catch(() => undefined),
                this.game.bga.gameui.wait(DiceHandler.FADE_OUT_DURATION + DiceHandler.FINISH_SAFETY_MARGIN),
            ]).then(() => fadingDie.remove());
        });
    }
    //one die of the new roll, already at its final face and place, hidden there while a copy flies in: the copy starts
    //ROLL_DISTANCE die sizes right of the slot and as many above it, turned ROLL_MIN_SPIN to ROLL_MAX_SPIN either way, and
    //slides and spins into the slot, where the real die shows again. The copy is position: fixed in <body> (.rolling-die),
    //so no ancestor's overflow clips its entry and it adds no scrollable overflow, under the Start token (see Game.scss). It lives outside BGA's mobile
    //scaling of the game area, so it is scaled (scale property, set once) to the die's on-screen size; only translate and
    //rotate animate, never transform. fill 'backwards' keeps it at its start during its delay. Its travel time is
    //ROLL_DURATION give or take ROLL_DURATION_VARIATION. The face changes each time the rotation passes a multiple of
    //FACE_TURN, and is the real value from FACE_LOCK_FRACTION of the travel. Its card 2 padlock waits for rollDice
    async rollIn(aDie, dieData) {
        const dieRect = aDie.getBoundingClientRect();
        const cssSize = parseFloat(window.getComputedStyle(aDie).width) || dieRect.width;
        const zoom = dieRect.width / cssSize;
        //the copy turns and scales around its center, so its unscaled box sits centered on the die's on-screen box
        const endX = dieRect.left + dieRect.width / 2 - cssSize / 2;
        const endY = dieRect.top + dieRect.height / 2 - cssSize / 2;
        const distance = dieRect.width * DiceHandler.ROLL_DISTANCE;
        const spin = this.getRandomSpin();
        const delay = Math.random() * DiceHandler.ROLL_MAX_DELAY;
        const duration = DiceHandler.ROLL_DURATION * (1 + (Math.random() * 2 - 1) * DiceHandler.ROLL_DURATION_VARIATION);
        const rollingDie = aDie.cloneNode(true);
        rollingDie.removeAttribute('id');
        rollingDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS, DiceHandler.PREVIEWED_CLASS_POWER9);
        rollingDie.classList.add('rolling-die');
        rollingDie.style.setProperty('--die-size', cssSize + 'px'); //the game area's die size, wherever --die-size is set
        rollingDie.style.scale = zoom.toString();
        document.body.appendChild(rollingDie);
        aDie.style.visibility = 'hidden';
        const roll = rollingDie.animate([
            { translate: `${endX + distance}px ${endY - distance}px`, rotate: `${spin}deg` },
            { translate: `${endX}px ${endY}px`, rotate: '0deg' },
        ], { duration: duration, delay: delay, easing: DiceHandler.ROLL_EASING, fill: 'backwards' });
        //one face per FACE_TURN the die turns before FACE_LOCK_FRACTION, the last one the real value
        const faceChangeTimes = this.getFaceChangeTimes(spin, duration);
        const faces = this.getTumbleFaces(faceChangeTimes.length, dieData.value);
        rollingDie.setAttribute('data-value', faces[0].toString());
        //scheduled on the animation's own clock once it has started (its currentTime includes the delay)
        const faceTimers = [];
        roll.ready.then(() => {
            const elapsed = Number(roll.currentTime ?? 0);
            faceChangeTimes.forEach((faceChangeTime, faceIndex) => {
                faceTimers.push(window.setTimeout(() => rollingDie.setAttribute('data-value', faces[faceIndex + 1].toString()), Math.max(0, delay + faceChangeTime - elapsed)));
            });
        }).catch(() => undefined);
        await Promise.race([
            roll.finished.catch(() => undefined),
            this.game.bga.gameui.wait(delay + duration + DiceHandler.FINISH_SAFETY_MARGIN),
        ]);
        faceTimers.forEach(faceTimer => window.clearTimeout(faceTimer));
        aDie.style.visibility = null;
        rollingDie.remove();
    }
    //ROLL_MIN_SPIN to ROLL_MAX_SPIN degrees either way, reduced so the die turns at most MAX_SPIN_AFTER_LOCK degrees once
    //its face is locked (the rotation left at FACE_LOCK_FRACTION is spin * (1 - eased progress there))
    getRandomSpin() {
        const spinLeftShareAtLock = 1 - DiceHandler.getRollProgress(DiceHandler.FACE_LOCK_FRACTION);
        const maxSpin = Math.min(DiceHandler.ROLL_MAX_SPIN, DiceHandler.MAX_SPIN_AFTER_LOCK / Math.max(spinLeftShareAtLock, 0.0001));
        const minSpin = Math.min(DiceHandler.ROLL_MIN_SPIN, maxSpin);
        const spinDirection = Math.random() < 0.5 ? -1 : 1;
        return spinDirection * (minSpin + Math.random() * (maxSpin - minSpin));
    }
    //ms into a travel of duration ms at which the rotation, spin * (1 - eased progress), passes each multiple of FACE_TURN
    //before FACE_LOCK_FRACTION, in order. The start angle itself is not a change
    getFaceChangeTimes(spin, duration) {
        const absSpin = Math.abs(spin);
        const spinLeftAtLock = absSpin * (1 - DiceHandler.getRollProgress(DiceHandler.FACE_LOCK_FRACTION));
        const faceChangeTimes = [];
        for (let turn = Math.ceil(absSpin / DiceHandler.FACE_TURN - 1) * DiceHandler.FACE_TURN; turn >= spinLeftAtLock && turn > 0; turn -= DiceHandler.FACE_TURN) {
            if (turn >= absSpin)
                continue;
            faceChangeTimes.push(DiceHandler.getRollTimeFraction(1 - turn / absSpin) * duration);
        }
        return faceChangeTimes;
    }
    //the faces shown during a tumble with faceChangeCount changes: random, never the same twice in a row, ending on the real
    //value (shown from the start when there is no change)
    getTumbleFaces(faceChangeCount, realValue) {
        const faces = [];
        for (let faceIndex = 0; faceIndex < faceChangeCount; faceIndex++) {
            const excludedFaces = [faces[faceIndex - 1], ...(faceIndex === faceChangeCount - 1 ? [realValue] : [])];
            let face;
            do {
                face = Math.floor(Math.random() * DiceHandler.DIE_FACES) + 1;
            } while (excludedFaces.includes(face));
            faces.push(face);
        }
        faces.push(realValue);
        return faces;
    }
    //the roll's cubic-bezier (ROLL_EASING_POINTS): eased progress at a time fraction, and the time fraction of an eased
    //progress. Both axes are monotone (control points within 0..1), so bisection on the curve's parameter solves either
    static getRollProgress(timeFraction) {
        const [x1, y1, x2, y2] = DiceHandler.ROLL_EASING_POINTS;
        return DiceHandler.bezierAxis(y1, y2, DiceHandler.solveBezierParameter(x1, x2, timeFraction));
    }
    static getRollTimeFraction(progress) {
        const [x1, y1, x2, y2] = DiceHandler.ROLL_EASING_POINTS;
        return DiceHandler.bezierAxis(x1, x2, DiceHandler.solveBezierParameter(y1, y2, progress));
    }
    static bezierAxis(p1, p2, t) { return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t; }
    static solveBezierParameter(p1, p2, value) {
        let low = 0, high = 1;
        for (let iteration = 0; iteration < 30; iteration++) {
            const middle = (low + high) / 2;
            if (DiceHandler.bezierAxis(p1, p2, middle) < value)
                low = middle;
            else
                high = middle;
        }
        return (low + high) / 2;
    }
    //on-screen px per px of the game area (below 1 when BGA scales it down on mobile). The unrounded computed width, not
    //offsetWidth, which rounds and drifts by a pixel
    getZoom(aDie) {
        const cssWidth = parseFloat(window.getComputedStyle(aDie).width);
        return cssWidth > 0 ? aDie.getBoundingClientRect().width / cssWidth : 1;
    }
    playChangeAnimation(aDie) {
        aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
        void aDie.offsetWidth; // restart the animation if it's already running
        aDie.classList.add(DiceHandler.CHANGE_ANIM_CLASS);
        aDie.addEventListener('animationend', () => aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS), { once: true });
    }
    getDieDiv(color) { return this.diceContainer.querySelector(`.die-slot > .a-die[data-color="${color}"]`); } //never a fading copy
    getDieSlot(color) { return this.diceContainer.querySelector(`.die-slot[data-color="${color}"]`); }
    getDiceContainer() { return this.diceContainer; }
    getDiceData() { return this.diceData; }
}
DiceHandler.PIPS_PER_DIE = 9; //3x3 layout, Game.scss shows the right pips for each data-value
DiceHandler.CHANGE_ANIM_CLASS = 'die-changed';
DiceHandler.MODIFIABLE_CLASS_POWER9 = 'modifiable-die-power9'; //the die shows its card-9 arrows
DiceHandler.SELECTED_ARROW_CLASS_POWER9 = 'selected-die-arrow-power9';
DiceHandler.PREVIEWED_CLASS_POWER9 = 'previewed-die-power9'; //the die shows the value it would become
DiceHandler.RESERVATION_PENDING_CLASS_POWER2 = 'die-reservation-pending-power2'; //a revealed card 2 will reserve this die: its padlock, open
//card 2 padlock badge on the dice area's dice (Game.scss shows it per reservation): both icons are always there, so a
//pending reservation becoming reserved can crossfade from one to the other. Inline SVGs of Font Awesome 6's lock and
//lock-open (the card 2 log row's fa-lock glyph; BGA's fa6 font has no lock-open, which drew nothing). Both are 576 x
//512 viewBoxes at the same scale with the same body (x 0 to 448): the closed one's is centered on the body, the open
//one's covers its whole drawing (the shackle swings out to x 576, which the closed viewBox clipped), and Game.scss
//shifts it so the two bodies overlap exactly
DiceHandler.LOCK_CLOSED_ICON_VIEWBOX_POWER2 = '-64 0 576 512';
DiceHandler.LOCK_OPEN_ICON_VIEWBOX_POWER2 = '0 0 576 512';
DiceHandler.LOCK_BADGE_HTML_POWER2 = '<span class="die-lock-badge-power2" aria-hidden="true">'
    + `<svg class="die-lock-open-icon" viewBox="${DiceHandler.LOCK_OPEN_ICON_VIEWBOX_POWER2}"><path d="M352 144c0-44.2 35.8-80 80-80s80 35.8 80 80v48c0 17.7 14.3 32 32 32s32-14.3 32-32V144C576 64.5 511.5 0 432 0S288 64.5 288 144v48H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H352V144z"/></svg>`
    + `<svg class="die-lock-closed-icon" viewBox="${DiceHandler.LOCK_CLOSED_ICON_VIEWBOX_POWER2}"><path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/></svg>`
    + '</span>';
DiceHandler.LOCK_ICON_WHITE_MAX_LUMINANCE_POWER2 = 0.3; //a white padlock keeps at least WCAG's 3:1 contrast for graphics on a player color up to this relative luminance; lighter colors get a black one
DiceHandler.LOCK_CLOSE_DURATION_POWER2 = 180; //ms of the padlock closing, once a pending reservation's roll has landed
DiceHandler.COMBO_HIGHLIGHT_CLASS = 'die-highlight-combo'; //PlayCard: the dice that make the selected hand card playable
DiceHandler.DIE_FACES = 6;
//roll-in (diceRolled): every die of the new roll comes in from the top right at 45 degrees (the same path for every die,
//shifted to its own slot), spinning down to upright, while the previous roll's dice fade out in place, all at once
DiceHandler.ROLL_DURATION = 500; //ms of a die's travel on average. With ROLL_DURATION_VARIATION and ROLL_MAX_DELAY, the last die of a roll lands about 625ms in
DiceHandler.ROLL_DURATION_VARIATION = 0.15; //each die's travel is ROLL_DURATION up to this share longer or shorter, at random, so no two rolls look alike
DiceHandler.ROLL_MAX_DELAY = 120; //ms, each die starts after a random delay up to this, so the dice don't move as one block
DiceHandler.ROLL_SOUND_DELAY = 100; //ms after the roll starts at which its sound plays
DiceHandler.ROLL_EASING_POINTS = [0.25, 0.8, 0.35, 1]; //x1, y1, x2, y2 of the roll's cubic-bezier: ease-out with no overshoot, the dice decelerate into place
DiceHandler.ROLL_EASING = `cubic-bezier(${DiceHandler.ROLL_EASING_POINTS.join(', ')})`; //the faces follow the rotation through this same curve (getRollProgress)
DiceHandler.ROLL_DISTANCE = 3; //die sizes (on screen) the die starts right of its slot, and as many above: D in translate(+D, -D). The dice container is about 1.6 die sizes tall, so every die starts above it
DiceHandler.ROLL_MIN_SPIN = 150; //deg from upright at the start, in a random direction
DiceHandler.ROLL_MAX_SPIN = 420; //deg
DiceHandler.FACE_TURN = 90; //deg: the face changes each time the rotation passes a multiple of this, as if a new side rolled up
DiceHandler.FACE_LOCK_FRACTION = 0.6; //share of the travel time from which the face is the real value: no change while the die slows down
DiceHandler.MAX_SPIN_AFTER_LOCK = 90; //deg the die may still turn after FACE_LOCK_FRACTION; a bigger start spin is reduced to keep to it
DiceHandler.FADE_OUT_DURATION = 240; //ms of the previous roll's dice fading out
DiceHandler.FADE_OUT_SCALE = 0.85; //their size at the end of the fade
DiceHandler.FINISH_SAFETY_MARGIN = 300; //ms after an animation's duration at which it counts as done anyway, should it never report finished

/**
 * Card 9, after the roll: the active owner turns one die that hasn't been changed this roll by 1 (6 wraps to 1,
 * 1 wraps to 6), or skips. Clicking a die's up (+1) or down (-1) arrow, or the top or bottom half of the die, selects
 * that choice; "Confirm" sends it ([BGA] like card play, the "One-click card play" preference sends it at once).
 * Everyone else only sees the status text.
 */
class ModifyDie {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.modifiableDice = [];
        this.selectedChoice = null;
        this.powerCard = null;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.modifiableDice = args?.modifiableDice ?? [];
        this.powerCard = args?.powerCard ?? null;
        this.selectedChoice = null;
        if (!isCurrentPlayerActive) {
            this.game.setPowerPromptTitle(this.powerCard, false);
            return;
        }
        this.game.diceHandler.showModifyArrowsPOWER9(this.modifiableDice);
        this.updateStatusBar();
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
        this.selectedChoice = null;
        this.game.diceHandler.hideModifyArrowsPOWER9();
    }
    //called by DiceHandler: another choice switches the selection, the selected one clears it
    choiceClicked(dieColor, delta) {
        if (this.game.prefHandler?.isOneClickPlay()) {
            this.modifyDie(dieColor, delta);
            return;
        }
        const isSelectedChoice = this.selectedChoice?.color === dieColor && this.selectedChoice?.delta === delta;
        this.selectedChoice = isSelectedChoice ? null : { color: dieColor, delta: delta };
        this.game.diceHandler.setSelectedChoicePOWER9(this.selectedChoice);
        this.updateStatusBar();
    }
    updateStatusBar() {
        this.bga.statusBar.removeActionButtons();
        const selectedChoice = this.selectedChoice;
        const selectedDie = selectedChoice ? this.modifiableDice.find(die => die.color === selectedChoice.color) : null;
        if (selectedChoice && selectedDie) {
            const newValue = DiceHandler.turnDieValue(selectedDie.value, selectedChoice.delta);
            this.bga.statusBar.setTitle(_('Turn ${die} ${oldValue} → ${newValue}?')
                .replace('${die}', this.getDieIconHTML(selectedDie.color))
                .replace('${oldValue}', selectedDie.value.toString())
                .replace('${newValue}', newValue.toString()));
            this.bga.statusBar.addActionButton(_('Confirm'), () => this.modifyDie(selectedChoice.color, selectedChoice.delta), { id: 'confirm-die-button' });
        }
        else {
            this.game.setPowerPromptTitle(this.powerCard, true);
        }
        this.bga.statusBar.addActionButton(_('Skip'), () => this.skipClicked(), { id: 'skip-power-button', color: 'secondary' });
    }
    //"Skip" puts a previewed die back at once
    skipClicked() {
        this.cancelSelection();
        this.bga.actions.performAction('actSkip_POWER9');
    }
    //clears the choice and its die preview; DiceHandler calls it when the server sends real dice values
    cancelSelection() {
        if (!this.selectedChoice)
            return;
        this.selectedChoice = null;
        this.game.diceHandler.setSelectedChoicePOWER9(null);
        if (this.game.getGameStateName() === 'ModifyDie' && this.bga.players.isCurrentPlayerActive())
            this.updateStatusBar();
    }
    //a mini copy of the die with its real value (never the preview), for the status bar
    getDieIconHTML(dieColor) {
        const dieData = this.game.diceHandler.getDiceData().find(die => die.color === dieColor);
        if (!dieData)
            return '';
        const dieIcon = this.game.diceHandler.createDieDiv(dieData);
        dieIcon.classList.add('status-die-icon');
        return dieIcon.outerHTML;
    }
    modifyDie(dieColor, delta) {
        this.bga.actions.performAction('actModifyDie_POWER9', { dieColor: dieColor, delta: delta });
    }
}

/**
 * Card 11, after Stop or More (the owner chose More), before the next roll: the active owner may add the golden die
 * to the next roll, or skip. (Card 2 needs no choice and card 10 has its own SwapCards state, before Stop or More.)
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
        this.game.setPowerPromptTitle(args?.powerCard ?? null, isCurrentPlayerActive);
        if (!isCurrentPlayerActive)
            return;
        this.bga.statusBar.addActionButton(_('Add golden die'), () => this.bga.actions.performAction('actAddGoldenDie_POWER11'), { id: 'add-golden-die-button' });
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER11'), { id: 'skip-power-button', color: 'secondary' });
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
    }
}

/**
 * Card 10, after the reveal and before Stop or More (the owner is still in the round): the active owner selects 2 cards
 * from their hand, then the opponent to swap them with (the opponent's cards are random). Only opponents still in the
 * round with at least 2 cards can be chosen.
 * With none, the owner discards and draws instead; when only 1 card can be drawn, a confirmation explains it first.
 * Everyone else sees the power prompt ("<name> may use [10]") throughout.
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
            this.game.setPowerPromptTitle(args?.powerCard ?? null, false);
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
    //step 1, fewer cards selected than the power takes: "You may choose 2 cards to swap [10]" (or to discard) with Skip alone.
    //Step 2, all selected: the selected cards' circular icons in the title, then one button per opponent (swap) or Confirm
    //(discard and draw), plus Skip. Rebuilt from the selection on every change, so unselecting a card goes back to step 1
    updateStatusBar() {
        if (!this.args)
            return;
        this.bga.statusBar.removeActionButtons();
        const selectedCardIDs = this.game.handHandler.getSelectedCardIDs();
        const isSwap = this.args.mode === 'swap';
        if (selectedCardIDs.length < this.args.maxCards) {
            let title = _('${you} may choose 2 cards to swap ${card}');
            if (!isSwap)
                title = (this.args.maxCards === 1) ? _('${you} may choose 1 card to discard ${card}') : _('${you} may choose 2 cards to discard ${card}');
            this.bga.statusBar.setTitle(title, { card: this.game.getStatusCardWithPowerHTML(this.args.powerCard) });
        }
        else {
            //each selected card with its power badge, like the other status bar titles
            const cardsIcons = selectedCardIDs.map(cardID => this.game.getStatusCardWithPowerHTML(this.game.handHandler.getCardData(cardID))).join('');
            if (isSwap) {
                this.bga.statusBar.setTitle(_('Choose an opponent to swap ${cards}'), { cards: cardsIcons });
                for (let target of this.args.targets) {
                    const label = _('Swap with ${player_name}').replace('${player_name}', '<b>' + this.game.getPlayerName(target.player_id) + '</b>');
                    this.game.addPlayerChoiceButton(target.player_id, label, () => this.swapClicked(target, selectedCardIDs), { id: 'swap-with-' + target.player_id + '-button' });
                }
            }
            else {
                this.bga.statusBar.setTitle((this.args.maxCards === 1) ? _('Discard ${cards} and draw 1?') : _('Discard ${cards} and draw 2?'), { cards: cardsIcons });
                this.bga.statusBar.addActionButton(_('Confirm'), () => this.redrawClicked(selectedCardIDs), { id: 'redraw-button' });
            }
        }
        this.game.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER10'), { id: 'skip-power-button', color: 'secondary' });
    }
    swapClicked(target, cardIDs) {
        this.bga.actions.performAction('actSwapCards_POWER10', { cardIDs: this.game.getCardIDsParam(cardIDs), targetPlayerId: target.player_id });
    }
    async redrawClicked(cardIDs) {
        if (cardIDs.length < 2) {
            if (!(await this.bga.dialogs.confirmation(_('Only 1 card is left to draw, so only 1 card will be discarded and replaced. Continue?'))))
                return;
        }
        this.bga.actions.performAction('actRedrawCards_POWER10', { cardIDs: this.game.getCardIDsParam(cardIDs) });
    }
}

/**
 * BGA's final state: the game is over, so the 40+ scores lose their end-game highlight (intro, loop, red, bold) and an
 * empty hand is hidden.
 */
class GameEnd {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.game.updateEndGameScoreHighlights();
        this.game.handHandler?.updateGameOverVisibility();
    }
    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
    }
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
 * PlayedColumnHandler.ts
 */
class PlayedColumnHandler {
    constructor(game, owner, playedCardsData) {
        this.game = game;
        this.owner = owner;
        this.playedCardsData = playedCardsData;
        this.roundStatus = 'in';
        const parent = document.querySelector('#played-columns-container');
        if (parent) {
            this.columnContainer = document.createElement('div');
            this.columnContainer.className = 'a-played-column';
            this.columnContainer.setAttribute('data-owner-id', `${this.owner.getPlayerID()}`);
            this.columnContainer.setAttribute('data-is-myself', 'false');
            this.columnContainer.style.setProperty('--column-owner-color', '#' + this.owner.getPlayerColor());
            this.columnContainer.setAttribute('data-light-owner-color', PlayedColumnHandler.isLightColor(this.owner.getPlayerColor()) ? 'true' : 'false');
            //the avatar or the name, whichever the "Show players as" preference picks (PrefHandler, an attribute on
            //#played-columns-container), is one button: a click switches every column's header
            this.columnContainer.innerHTML = `
                <div class="played-column-title">
                    <span class="played-column-player" id="column-player-${this.owner.getPlayerID()}" role="button" tabindex="0">
                        <span class="played-column-avatar"></span>
                        <span class="played-column-name"></span>
                    </span>
                    <span class="played-column-stars"></span>
                </div>
                <div class="cards-column"></div>
            `;
            this.columnContainer.querySelector('.played-column-name').textContent = this.owner.getPlayerName(); //full name in the tooltip (TooltipHandler)
            this.fillAvatar(this.columnContainer.querySelector('.played-column-avatar'));
            const playerButton = this.columnContainer.querySelector('.played-column-player');
            playerButton.addEventListener('click', () => this.game.prefHandler?.togglePlayersDisplay());
            playerButton.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ')
                    return;
                event.preventDefault(); //no page scroll on Space
                this.game.prefHandler?.togglePlayersDisplay();
            });
            parent.appendChild(this.columnContainer);
        }
        this.cardsColumn = this.columnContainer.querySelector('.cards-column');
        this.starsText = this.columnContainer.querySelector('.played-column-stars');
        this.starsText.id = 'column-stars-' + this.owner.getPlayerID(); //for TooltipHandler
        this.displayColumn();
    }
    //the owner's BGA avatar (Game.fillPlayerAvatar), or the name's initial on the owner's color, so every header can show a circle
    fillAvatar(avatarContainer) {
        this.game.fillPlayerAvatar(avatarContainer, this.owner.getPlayerID(), 'played-column-avatar-image', 'played-column-avatar-initial');
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
    //a revealed card slides in from fromElement: my hand card, at its full size the whole way, or (fromBoard) another player's
    //hand count on their board, starting at Game.BOARD_CARD_SCALE centered on its top mini card back and growing to full size.
    //The sliding copy is placed on fromElement before the first await, so the caller can remove fromElement right after calling this
    async animateCardIn(cardData, fromElement, fromBoard = false) {
        this.playedCardsData.push(cardData);
        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());
        await this.game.animateSlide(aCard, fromElement, this.cardsColumn, Game.CARD_SLIDE_DURATION, fromBoard ? { boardEnd: true } : { keepSize: true });
        this.updateStarsTotal();
    }
    //a new round empties the column: its cards sweep off-screen up-left, the bottom (fully shown) card first, like
    //peeling the stack, staggerMs apart. The column keeps its height until the sweep has ended, so nothing below it moves meanwhile
    async clear(durationMs = Game.CARD_SWEEP_DURATION, staggerMs = Game.CARD_SWEEP_STAGGER) {
        const cards = Array.from(this.cardsColumn.querySelectorAll('.a-card'));
        if (cards.length > 0)
            this.cardsColumn.style.minHeight = getComputedStyle(this.cardsColumn).height; //CSS px, unrounded
        const sweep = this.game.sweepCardsOffScreen(cards.reverse(), durationMs, staggerMs);
        this.removeAllCards();
        await sweep;
        this.cardsColumn.style.minHeight = '';
    }
    //every card leaves the column at once, with no animation (a crash's cards have already tumbled out, Game.notif_crashAnimation)
    removeAllCards() {
        this.playedCardsData = [];
        this.cardsColumn.innerHTML = '';
        this.updateStarsTotal();
    }
    getCardElements() { return Array.from(this.cardsColumn.querySelectorAll('.a-card')); } //top to bottom, in play order
    getStarsTotal() {
        return this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
    }
    //a stopped column's stars are already in the score (banked at the Stop reveal) and can't change: the badge shows the
    //bank icon with no number, so it doesn't read as stars still to come. Its tooltip gives the amount. A crashed column's
    //badge shows a bomb (the crash log row's icon), also with no number
    updateStarsTotal() {
        if (this.isBanked())
            this.starsText.innerHTML = this.game.getBankIconHtml('played-column-bank-icon');
        else if (this.isCrashed())
            this.starsText.innerHTML = '<i class="fa6 fa-bomb played-column-bomb" aria-hidden="true"></i>';
        else
            this.starsText.innerHTML = `<span class="played-column-star">★</span>${this.getStarsTotal()}`;
    }
    isBanked() { return this.roundStatus === 'stopped'; }
    isCrashed() { return this.roundStatus === 'crashed'; }
    //hexColor without the #, as BGA gives player colors
    static isLightColor(hexColor) {
        const channels = [0, 2, 4].map(offset => parseInt(hexColor.substring(offset, offset + 2), 16) / 255);
        const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue > PlayedColumnHandler.LIGHT_COLOR_LUMINANCE;
    }
    setMyColumn(isMyColumn) {
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if (isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }
    //also on setup (before the TooltipHandler exists: its constructor adds the badge tooltip itself) and on the new round's 'in'
    setRoundStatus(roundStatus) {
        this.roundStatus = roundStatus;
        this.columnContainer.setAttribute('data-round-status', roundStatus);
        this.updateStarsTotal();
        this.game.tooltipHandler?.updateColumnStarsTooltip(this.owner.getPlayerID());
    }
    getColumnContainer() { return this.columnContainer; }
}
PlayedColumnHandler.LIGHT_COLOR_LUMINANCE = 0.3; //relative luminance above which white text on the color falls under a 3:1 contrast: the score badge gets dark text instead

class PlayerHandler {
    constructor(game, playerID, playerName, playerColor, playerNo, handCount, roundStatus, lastChanceUsed, playedCardsData, score) {
        this.game = game;
        this.playerID = playerID;
        this.playerName = playerName;
        this.playerColor = playerColor;
        this.playerNo = playerNo;
        this.handCount = handCount;
        this.roundStatus = roundStatus;
        this.lastChanceUsed = lastChanceUsed;
        this.playedCardsData = playedCardsData;
        this.score = score;
        this.scoreElement = null; //BGA's score counter span, through getScoreElement()
        this.clippedScoreAncestors = []; //overflow made visible while the score scales
        this.createPlayerBoardContainer();
        this.setHandCount(this.handCount);
        this.setLastChanceUsed(this.lastChanceUsed);
        this.updateScoreTarget();
        this.updateEndGameScoreHighlight(); //on load: no intro, straight to the loop (nothing once the game is over)
        this.playedColumn = new PlayedColumnHandler(this.game, this, this.playedCardsData);
        this.setRoundStatus(this.roundStatus);
    }
    //every player board, spectators included, shows the hand count, Last Chance and, out of the round, a STOPPED or CRASHED
    //stamp (shown by data-round-status, see setRoundStatus). The Start token is not in this content: it is a badge on BGA's
    //avatar (startTokenAnchor) and takes no layout space
    createPlayerBoardContainer() {
        this.playerBoardContainer = document.createElement('div');
        this.playerBoardContainer.classList.add('riviera-player-board');
        this.playerBoardContainer.innerHTML = `
            <div class="player-board-cards-row">
                <div class="hand-count-backs"></div>
                <div class="last-chance-indicator"></div>
                <div class="round-status-stamp stopped-stamp">${_('Stopped')}</div>
                <div class="round-status-stamp crashed-stamp"><i class="fa6 fa-bomb"></i>${_('Crashed')}</div>
            </div>
        `;
        const playerPanel = this.game.bga.playerPanels.getElement(this.playerID);
        playerPanel.appendChild(this.playerBoardContainer);
        this.cardsRow = this.playerBoardContainer.querySelector('.player-board-cards-row');
        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.boardElement = playerPanel.closest('.player-board') ?? playerPanel; //BGA's whole board around our panel
        this.boardElement.classList.add('positioned-player-board');
        this.boardElement.addEventListener('animationend', (event) => {
            if (event.target === this.boardElement && event.animationName === PlayerHandler.BOUNCE_CLASS)
                this.boardElement.classList.remove(PlayerHandler.BOUNCE_CLASS);
        });
        this.startTokenAnchor = this.createStartTokenAnchor();
        this.updateStartTokenPlace();
        this.scoreTargetElement = document.createElement('span');
        this.scoreTargetElement.classList.add('score-target');
        this.scoreTargetElement.textContent = '/' + this.game.getWinningScore();
        //ids for TooltipHandler
        this.handCountBacks.id = 'hand-count-backs-' + this.playerID;
        this.scoreTargetElement.id = 'score-target-' + this.playerID;
        const lastChanceCard = this.game.createLastChanceDiv();
        lastChanceCard.classList.add('mini-card');
        this.lastChanceIndicator.prepend(lastChanceCard);
    }
    //the Start token is a badge on the bottom-right corner of BGA's avatar. Its anchor is BGA's .player_board_inner (positioned
    //here if BGA leaves it static), never the avatar's wrapper: BGA hides #avatarwrap_<id> while the player is active and shows
    //#avatar_active_wrap_<id> (the hourglass) in the same spot. With no .player_board_inner, the whole board
    createStartTokenAnchor() {
        const anchor = this.boardElement.querySelector('.player_board_inner') ?? this.boardElement;
        if (getComputedStyle(anchor).position === 'static')
            anchor.style.position = 'relative';
        anchor.classList.add('start-token-anchor');
        return anchor;
    }
    //where the avatar's bottom-right corner is in the anchor (--start-token-avatar-right / -bottom, in the anchor's px from its
    //padding box), measured on whichever avatar wrapper is showing, the avatar or the hourglass. Game.scss places the token
    //over that corner and clamps it inside the anchor. Both hidden (or not found): the last measurement stays, else the
    //CSS fallback (the anchor's top-left inside corner)
    updateStartTokenPlace() {
        const avatarWrapper = ['avatarwrap_', 'avatar_active_wrap_']
            .map(prefix => document.getElementById(prefix + this.playerID))
            .find(element => element && this.startTokenAnchor.contains(element) && element.getBoundingClientRect().width > 0);
        if (!avatarWrapper)
            return;
        const anchorRect = this.startTokenAnchor.getBoundingClientRect();
        const cssWidth = parseFloat(getComputedStyle(this.startTokenAnchor).width); //unrounded, unlike offsetWidth
        if (!(cssWidth > 0) || anchorRect.width <= 0)
            return;
        const zoom = anchorRect.width / cssWidth; //BGA scales the page on mobile
        const avatarRect = avatarWrapper.getBoundingClientRect();
        const right = (avatarRect.right - anchorRect.left) / zoom - this.startTokenAnchor.clientLeft;
        const bottom = (avatarRect.bottom - anchorRect.top) / zoom - this.startTokenAnchor.clientTop;
        this.startTokenAnchor.style.setProperty('--start-token-avatar-right', `${right}px`);
        this.startTokenAnchor.style.setProperty('--start-token-avatar-bottom', `${bottom}px`);
    }
    //the Last Chance card keeps the same gap to the board's right edge as the card backs have to its left edge, which comes
    //from BGA's own padding. Measured on screen, then turned into this board's px (BGA scales the page on mobile)
    updateLastChanceInset() {
        const boardRect = this.boardElement.getBoundingClientRect();
        const rowRect = this.cardsRow.getBoundingClientRect();
        const cssWidth = parseFloat(getComputedStyle(this.cardsRow).width); //unrounded, unlike offsetWidth
        if (!(cssWidth > 0) || rowRect.width <= 0)
            return;
        const zoom = rowRect.width / cssWidth;
        const currentMargin = parseFloat(getComputedStyle(this.lastChanceIndicator).marginRight) || 0; //inside the row, so it doesn't move rowRect
        const leftInset = rowRect.left - boardRect.left;
        const rightInset = boardRect.right - rowRect.right;
        const margin = Math.max(0, (leftInset - rightInset) / zoom);
        if (Math.abs(margin - currentMargin) > 0.5)
            this.playerBoardContainer.style.setProperty('--last-chance-margin-right', `${margin}px`);
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
    //a used Last Chance card disappears from the board. Live, Game.notif_lastChanceAnimation shows it first (PlayerSpotlightOverlay)
    setLastChanceUsed(lastChanceUsed) {
        this.lastChanceUsed = lastChanceUsed;
        this.lastChanceIndicator.setAttribute('data-used', lastChanceUsed ? 'true' : 'false');
    }
    //card 10: the whole BGA player board (boardElement) bounces once a swap or redraw has landed. Nothing waits for it:
    //the class comes off by itself on animationend. No bounce in fast replay or a hidden tab
    bounceBoard() {
        if (!this.game.bga.gameui.bgaAnimationsActive())
            return;
        this.boardElement.classList.remove(PlayerHandler.BOUNCE_CLASS);
        void this.boardElement.offsetWidth; //restarts a bounce still playing
        this.boardElement.classList.add(PlayerHandler.BOUNCE_CLASS);
    }
    //px the board is lifted by its bounce right now (0 at rest), so a measurement can be brought back to the resting place
    getBounceOffset() {
        if (!this.boardElement.classList.contains(PlayerHandler.BOUNCE_CLASS))
            return 0;
        return parseFloat(getComputedStyle(this.boardElement).top) || 0;
    }
    //every live score change goes through here: BGA's score counter, then the end-game highlight. Crossing WINNING_SCORE
    //during play plays the intro (two big beats) before the loop; in fast replay or a hidden tab, straight to the loop.
    //Once the game is over (the final scores, a Grand Slam's score), no intro: updateEndGameScoreHighlight clears everything
    setScore(score) {
        const previousScore = this.score;
        this.score = score;
        this.game.bga.playerPanels.getScoreCounter(this.playerID)?.toValue(score);
        this.updateScoreTarget();
        const winningScore = this.game.getWinningScore();
        const crossed = previousScore < winningScore && score >= winningScore;
        if (crossed && this.getEndGameScoreHighlight() === 'loop' && this.game.bga.gameui.bgaAnimationsActive())
            this.applyScoreHighlight('intro');
        else
            this.updateEndGameScoreHighlight();
    }
    //the "/40" after the score: kept right after BGA's score counter (put back if BGA has replaced the counter) and hidden once
    //the score is past WINNING_SCORE. Setup and setScore (every score notification, replays, the end-game table) call it
    updateScoreTarget() {
        const scoreElement = this.getScoreElement();
        if (!scoreElement)
            return;
        if (scoreElement.nextElementSibling !== this.scoreTargetElement)
            scoreElement.after(this.scoreTargetElement);
        this.scoreTargetElement.hidden = this.score > this.game.getWinningScore();
    }
    //the one place that decides the score's end-game look, from the score and the game's progress. Safe to call any time
    //(setup, score changes, BGA's layout hooks, the game end): a running intro or loop is never restarted, and an intro
    //still playing during the game is left to finish (its animationend brings the loop)
    updateEndGameScoreHighlight() {
        const highlight = this.getEndGameScoreHighlight();
        if (highlight === 'loop' && this.getScoreElement()?.classList.contains(PlayerHandler.END_GAME_SCORE_INTRO_CLASS))
            return;
        this.applyScoreHighlight(highlight);
    }
    //game over: BGA's default look, whatever the score. Below WINNING_SCORE: nothing. At it or more: the gentle loop, or
    //just red and bold with reduced motion
    getEndGameScoreHighlight() {
        if (this.game.isGameOver() || this.score < this.game.getWinningScore())
            return 'none';
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'static' : 'loop';
    }
    //one state at a time, so the intro and the loop never run together. 'static' is red and bold (the board's
    //END_GAME_SCORE_CLASS); the loop adds the gentle pulse to it; the intro turns the score red itself and the board class
    //only comes with the loop. The board burns (BURNING_CLASS) while the score animates, intro or loop, never on its own.
    //Ancestors that clip stay unclipped while the score scales
    applyScoreHighlight(highlight) {
        this.boardElement.classList.toggle(PlayerHandler.END_GAME_SCORE_CLASS, highlight === 'static' || highlight === 'loop');
        const scoreElement = this.getScoreElement();
        this.boardElement.classList.toggle(PlayerHandler.BURNING_CLASS, !!scoreElement && (highlight === 'intro' || highlight === 'loop'));
        if (!scoreElement)
            return;
        const animationClass = (highlight === 'intro') ? PlayerHandler.END_GAME_SCORE_INTRO_CLASS : (highlight === 'loop') ? PlayerHandler.END_GAME_SCORE_LOOP_CLASS : null;
        if (animationClass && scoreElement.classList.contains(animationClass))
            return; //already running: never restarted
        scoreElement.classList.remove(PlayerHandler.END_GAME_SCORE_INTRO_CLASS, PlayerHandler.END_GAME_SCORE_LOOP_CLASS);
        if (animationClass) {
            void scoreElement.offsetWidth; //a fresh start for the new animation
            scoreElement.classList.add(animationClass);
            this.unclipScoreAncestors(scoreElement);
        }
        else
            this.restoreScoreAncestorsOverflow();
    }
    //BGA's score counter span, marked .player-score-counter for Game.scss. Looked up again whenever the one we hold has
    //left the page, so the highlight always lands on the span BGA shows
    getScoreElement() {
        if (this.scoreElement?.isConnected)
            return this.scoreElement;
        this.scoreElement = document.getElementById('player_score_' + this.playerID);
        this.scoreElement?.classList.add('player-score-counter');
        this.scoreElement?.addEventListener('animationend', (event) => {
            if (event.target !== event.currentTarget || event.animationName !== 'end-game-score-beats')
                return;
            event.currentTarget.classList.remove(PlayerHandler.END_GAME_SCORE_INTRO_CLASS); //the intro held its red last frame until here
            this.updateEndGameScoreHighlight();
        });
        return this.scoreElement;
    }
    //the score grows to 1.8x in the intro and the loop alike: any ancestor up to the board that clips its overflow lets it show meanwhile
    unclipScoreAncestors(scoreElement) {
        this.restoreScoreAncestorsOverflow();
        if (!this.boardElement.contains(scoreElement)) //never walk past the board
            return;
        for (let element = scoreElement.parentElement; element; element = element.parentElement) {
            if (getComputedStyle(element).overflow !== 'visible') {
                this.clippedScoreAncestors.push({ element, overflow: element.style.overflow });
                element.style.overflow = 'visible';
            }
            if (element === this.boardElement)
                break;
        }
    }
    restoreScoreAncestorsOverflow() {
        this.clippedScoreAncestors.forEach(({ element, overflow }) => element.style.overflow = overflow);
        this.clippedScoreAncestors = [];
    }
    setGrandSlam() {
        this.playerBoardContainer.classList.add('grand-slam-player-board');
        this.playedColumn.getColumnContainer().classList.add('grand-slam-column');
    }
    //data-round-status shows one stamp at most. In: nothing. Stopped: the hand area greys out under the STOPPED stamp.
    //Crashed: the CRASHED stamp (the hand count is already 0). The next round's 'in' clears both
    setRoundStatus(roundStatus) {
        this.roundStatus = roundStatus;
        this.playerBoardContainer.setAttribute('data-round-status', roundStatus);
        this.boardElement.classList.toggle(PlayerHandler.STOPPED_CLASS, roundStatus === 'stopped');
        this.playedColumn.setRoundStatus(roundStatus);
    }
    getPlayerID() { return this.playerID; }
    getPlayerName() { return this.playerName; }
    getPlayerColor() { return this.playerColor; }
    getHandCount() { return this.handCount; }
    getScore() { return this.score; } //as tracked by setScore()
    getRoundStatus() { return this.roundStatus; } //as tracked by setRoundStatus()
    getPlayedColumn() { return this.playedColumn; }
    getStartTokenAnchor() { return this.startTokenAnchor; }
    getHandCountElement() { return this.handCountBacks; }
    getLastChanceCardElement() { return this.lastChanceIndicator.querySelector('.last-chance-card'); }
    //where card 10's swapped cards fly to and from in my hand: BGA's avatar on this player's board, or the top mini card
    //back of the hand count when the avatar isn't shown
    getAvatarRect() {
        const avatarRect = document.getElementById('avatar_' + this.playerID)?.getBoundingClientRect();
        if (avatarRect && avatarRect.width > 0 && avatarRect.height > 0)
            return avatarRect;
        const cardBacks = this.handCountBacks.querySelectorAll('.a-card');
        return (cardBacks.length > 0) ? cardBacks[cardBacks.length - 1].getBoundingClientRect() : this.handCountBacks.getBoundingClientRect();
    }
}
PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS = 7; //above this, the hand count shows a single card back followed by "x N"
PlayerHandler.BOUNCE_CLASS = 'bouncing-player-board'; //the one shared bounce class, its timing lives in Game.scss
PlayerHandler.STOPPED_CLASS = 'stopped-player-board'; //greys out the hand area under the STOPPED stamp
PlayerHandler.END_GAME_SCORE_CLASS = 'end-game-score-player-board'; //the score stays red and bold at WINNING_SCORE or more
PlayerHandler.END_GAME_SCORE_INTRO_CLASS = 'end-game-score-intro'; //on the score counter: the two big beats when the score crosses WINNING_SCORE, once (Game.scss)
PlayerHandler.END_GAME_SCORE_LOOP_CLASS = 'end-game-score-loop'; //on the score counter: the gentle pulse after the intro, until the game ends
PlayerHandler.BURNING_CLASS = 'burning-player-board'; //on the board: the flamy background, exactly while the score's intro or loop runs

//every card value with a power; Game.createCardDiv gives those cards the power-card-POWER<n> class (used by the log row tooltips)
const POWER_CARD_VALUES = [1, 2, 9, 10, 11];
class TooltipHandler {
    constructor(game) {
        this.game = game;
        this.powerReferenceHTMLByValue = {}; //0: the whole reference, no power on top
        this.cardPowersInDialog = this.game.isTouchOrMobile();
        this.addTooltipsToCards();
        this.addCardLongPress();
        this.addTooltipsToBoards();
        //log rows written before this handler existed; later rows come through LogMutationObserver
        const logs = document.getElementById('logs');
        if (logs)
            this.addTooltipsToCardsIn(logs);
        for (let dieData of this.game.diceHandler.getDiceData())
            this.updateDieTooltip(dieData);
    }
    //every card in the game area (my hand, every played column) shows the power reference, with the hovered card's power
    //on top. Tooltips only reach the cards already on the page, so this runs again whenever cards are created
    addTooltipsToCards() {
        if (this.isSafariMobile()) {
            this.addTooltipToBottomForSafari();
            return;
        }
        //touch and mobile: the reference is too long for a tooltip, a long press opens it in a dialog instead (addCardLongPress)
        if (!this.cardPowersInDialog) {
            document.querySelectorAll(TooltipHandler.GAME_AREA_CARDS_SELECTOR).forEach((card) => {
                this.game.bga.gameui.addTooltipHtml(card.id, this.getCardPowerReferenceHTML(card), TooltipHandler.TOOLTIP_DELAY);
            });
        }
        this.game.bga.gameui.addTooltipToClass('last-chance-card', this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
    }
    //BGA's resize hook: a window can cross BGA's mobile width, so the cards already on the page swap between the tooltip and the dialog
    syncCardPowersDisplay() {
        const cardPowersInDialog = this.game.isTouchOrMobile();
        if (cardPowersInDialog === this.cardPowersInDialog || this.isSafariMobile())
            return;
        this.cardPowersInDialog = cardPowersInDialog;
        if (cardPowersInDialog)
            document.querySelectorAll(TooltipHandler.GAME_AREA_CARDS_SELECTOR).forEach((card) => this.game.bga.gameui.removeTooltip(card.id));
        else
            this.addTooltipsToCards();
    }
    //a set-aside card that can still be taken back (PlayCard, waiting for the others) gets the undo hint on top of the reference,
    //as the wrapper's first child (after the first '>', the end of the wrapper's opening tag)
    getCardPowerReferenceHTML(card) {
        const value = parseInt(card.getAttribute('data-value'));
        const referenceHTML = this.getPowerReferenceHTML(POWER_CARD_VALUES.includes(value) ? value : 0);
        if (!this.game.handHandler?.isUndoableChosenCard(card))
            return referenceHTML;
        return referenceHTML.replace('>', `><div class="power-reference-hint">${_('Click to undo your choice')}</div>`);
    }
    //one game-area card's tooltip again (HandHandler: a set-aside card became undoable or stopped being so)
    updateCardTooltip(card) {
        if (this.cardPowersInDialog || this.isSafariMobile() || !card.id)
            return;
        this.game.bga.gameui.addTooltipHtml(card.id, this.getCardPowerReferenceHTML(card), TooltipHandler.TOOLTIP_DELAY);
    }
    //a tap stays the card's selection, so only a long press on a game-area card opens the dialog. On the document, since cards come and go.
    //Any pointer type: a narrow desktop window has BGA's mobile layout and a mouse
    addCardLongPress() {
        let pressTimeout = null;
        let pressX = 0;
        let pressY = 0;
        const cancelPress = () => {
            clearTimeout(pressTimeout);
            pressTimeout = null;
        };
        document.addEventListener('pointerdown', (event) => {
            cancelPress();
            const card = event.target.closest?.(TooltipHandler.GAME_AREA_CARDS_SELECTOR);
            if (!card || !event.isPrimary || event.button !== 0 || !this.game.isTouchOrMobile())
                return;
            pressX = event.clientX;
            pressY = event.clientY;
            pressTimeout = setTimeout(() => {
                pressTimeout = null;
                this.swallowClickAfterLongPress();
                this.showPowerReferenceDialog(card);
            }, TooltipHandler.LONG_PRESS_DURATION);
        });
        document.addEventListener('pointermove', (event) => {
            if (pressTimeout !== null && Math.hypot(event.clientX - pressX, event.clientY - pressY) > TooltipHandler.LONG_PRESS_MOVE_TOLERANCE)
                cancelPress();
        });
        document.addEventListener('pointerup', cancelPress);
        document.addEventListener('pointercancel', cancelPress); //the browser took the touch over to scroll
        //Android's own long press menu
        document.addEventListener('contextmenu', (event) => {
            if (this.game.isTouchOrMobile() && event.target.closest?.(TooltipHandler.GAME_AREA_CARDS_SELECTOR))
                event.preventDefault();
        });
    }
    //releasing a long press can still click: that must neither select the card nor reach the dialog's underlay, which would close it at once.
    //Some browsers send no click, so the next press ends the wait and keeps its own click
    swallowClickAfterLongPress() {
        const swallowClick = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('click', swallowClick, { capture: true, once: true });
        document.addEventListener('pointerdown', () => document.removeEventListener('click', swallowClick, { capture: true }), { capture: true, once: true });
    }
    showPowerReferenceDialog(card) {
        const dialog = new ebg.popindialog();
        dialog.create(TooltipHandler.POWER_REFERENCE_DIALOG_ID);
        dialog.setTitle(_('Card powers'));
        dialog.setContent(`<div class="power-reference-dialog-content">${this.getCardPowerReferenceHTML(card)}</div>`);
        dialog.show();
        document.getElementById(`popin_${TooltipHandler.POWER_REFERENCE_DIALOG_ID}_underlay`)?.addEventListener('click', () => dialog.destroy());
    }
    //a log row (its mini cards) or the status bar title (its circular card icons and power icons): single-power tooltips. Only that container
    //is queried, so loading a long log stays cheap
    addTooltipsToCardsIn(container) {
        if (this.isSafariMobile() || !container)
            return;
        //.card-power-badge[id]: the power badge on a circular card icon (Game.getStatusCardWithPowerHTML). Both also appear in log
        //rows, where they keep the log mini cards' tooltip look
        container.querySelectorAll('.a-card[id], .status-card-icon[id], .card-power-badge[id]').forEach((card) => {
            const value = parseInt(card.getAttribute('data-value') ?? card.getAttribute('data-power-value'));
            if (card.classList.contains(TooltipHandler.getPowerCardClass(value)))
                this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerTooltipHTML(value, card.closest('#pagemaintitletext') ? 'status-bar-power-tooltip' : ''), TooltipHandler.TOOLTIP_DELAY);
            else if (card.classList.contains('last-chance-card'))
                this.game.bga.gameui.addTooltip(card.id, this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
        });
    }
    //the card's number badge on the Keep Going button: the status bar's single-power tooltip, plus one line
    addPowerNeedingMoreTooltip(icon) {
        if (this.isSafariMobile())
            return;
        const noteHTML = `<div class="power-needing-more-note">${_('This power resolves only if you keep going')}</div>`;
        this.game.bga.gameui.addTooltipHtml(icon.id, this.getPowerTooltipHTML(parseInt(icon.getAttribute('data-value')), 'status-bar-power-tooltip', noteHTML), TooltipHandler.TOOLTIP_DELAY);
    }
    //player boards and played columns: the parts that aren't self-explanatory
    addTooltipsToBoards() {
        this.game.bga.gameui.addTooltipHtml('start-token', this.getStartTokenTooltipHTML(), TooltipHandler.TOOLTIP_DELAY);
        for (let player_id in this.game.players) {
            this.game.bga.gameui.addTooltip('hand-count-backs-' + player_id, _('Cards in hand'), '', TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltip('score-target-' + player_id, _('First to ${points} ★ wins').replace('${points}', `${this.game.getWinningScore()}`), '', TooltipHandler.TOOLTIP_DELAY);
            this.updateColumnStarsTooltip(parseInt(player_id));
            //the column header's avatar or name: the full name (the avatar has none, and a long name is cut)
            this.game.bga.gameui.addTooltip('column-player-' + player_id, this.game.players[player_id].getPlayerName(), '', TooltipHandler.TOOLTIP_DELAY);
        }
    }
    //the column badge: the stars at stake while in, the banked amount once stopped, nothing to bank once crashed
    //(PlayedColumnHandler.setRoundStatus)
    updateColumnStarsTooltip(player_id) {
        const playedColumn = this.game.players[player_id]?.getPlayedColumn();
        if (!playedColumn)
            return;
        let tooltipText = _('Stars of the cards played this round. A player who stops banks them; a crash loses them.');
        if (playedColumn.isBanked())
            tooltipText = _('Banked ${points} ★').replace('${points}', `${playedColumn.getStarsTotal()}`);
        else if (playedColumn.isCrashed())
            tooltipText = _('Crashed: no stars this round');
        this.game.bga.gameui.addTooltip('column-stars-' + player_id, tooltipText, '', TooltipHandler.TOOLTIP_DELAY);
    }
    //a die's tooltip follows its card 2 reservation, card 9 change and, for gold, card 11, on the card tooltips' background
    //(the power reference's single-entry look, like the Start token's). withRing false: the die is rolling in with no card 2
    //ring yet (DiceHandler.rollDice), so its tooltip leaves the reservation out until it lands
    updateDieTooltip(dieData, withRing = true) {
        const dieID = 'die-' + dieData.color;
        if (!document.getElementById(dieID))
            return;
        //card 2: the same pending (dashed) / reserved (solid) split as the die's ring (DiceHandler.applyReservationRingPOWER2).
        //A die with a ring gets this one line instead of its default text, kept on one line
        const pendingReserverID = withRing ? (dieData.pending_reserved_by_POWER2 ?? null) : null;
        const reserverID = withRing ? dieData.reserved_by_POWER2 : null;
        if (pendingReserverID !== null || reserverID !== null) {
            const reservationText = (pendingReserverID !== null) ? _('${player_name} may reserve ${die_color} die with ${card_icon}') : _('${player_name} reserved ${die_color} die with ${card_icon}');
            const reservationHTML = reservationText
                .replace('${player_name}', this.game.divColoredPlayer(pendingReserverID ?? reserverID, { class: 'playername tooltip-playername' }))
                .replace('${die_color}', this.getDieColorName(dieData.color))
                .replace('${card_icon}', this.game.getInlineCardIconHTML(dieData.color, 2));
            this.game.bga.gameui.addTooltipHtml(dieID, this.getDieTooltipHTML(reservationHTML, 'die-reservation-tooltip-power2'), TooltipHandler.TOOLTIP_DELAY);
            return;
        }
        const lines = [dieData.color === 'gold'
                ? _('Golden die (card 11): it only counts in a sum with a colored die and never gives its color')
                : _('${die_color} die').replace('${die_color}', this.getDieColorName(dieData.color))];
        if (dieData.modified_by_POWER9)
            lines.push(_('Turned by a card 9 this roll: it cannot be turned again'));
        this.game.bga.gameui.addTooltipHtml(dieID, this.getDieTooltipHTML(lines.join('<br>')), TooltipHandler.TOOLTIP_DELAY);
    }
    //the colored dice's names in their tooltips (the golden die has its own text)
    getDieColorName(color) {
        const dieColorNames = { red: _('Red'), green: _('Green'), purple: _('Purple'), blue: _('Blue'), orange: _('Orange') };
        return dieColorNames[color] ?? '';
    }
    getDieTooltipHTML(contentHTML, modifierClass = '') {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference die-tooltip ${modifierClass}">
                <div>${contentHTML}</div>
            </div>
        `;
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
     * (img/power_icons_sprite.webp) floated left. Two columns on desktop, one on narrow screens.
     * focusedValue 0 (a card with no power): the whole reference, split in two (left: card 1, then card 10;
     * right: cards 2 and 11, then card 9). A power card: its own entry on top under its timing heading, as wide as the tooltip, then the other powers under
     * their timing headings (a group left empty loses its heading) in two columns the browser balances (CSS columns).
     * The text follows our BGA rules (SPEC.md), not the rulebook's wording.
     */
    getPowerReferenceHTML(focusedValue) {
        if (this.powerReferenceHTMLByValue[focusedValue])
            return this.powerReferenceHTMLByValue[focusedValue];
        const headingHTML = (heading) => `<div class="power-reference-heading">${heading}</div>`;
        const timingGroups = this.getPowerTimingGroups();
        const [immediateGroup, beforeStopOrMoreGroup, beforeRollGroup, afterRollGroup] = timingGroups;
        let referenceHTML;
        if (focusedValue === 0) {
            referenceHTML = `
                <div class="tooltip-wrapper power-reference">
                    <div class="power-reference-column">
                        ${headingHTML(immediateGroup.heading)}
                        ${this.getPowerEntryHTML(1)}
                        ${headingHTML(beforeStopOrMoreGroup.heading)}
                        ${this.getPowerEntryHTML(10)}
                    </div>
                    <div class="power-reference-column">
                        ${headingHTML(beforeRollGroup.heading)}
                        ${this.getPowerEntryHTML(2)}
                        ${this.getPowerEntryHTML(11)}
                        ${headingHTML(afterRollGroup.heading)}
                        ${this.getPowerEntryHTML(9)}
                    </div>
                </div>
            `;
        }
        else {
            //each heading is kept with its group's first entry, so a column never ends on a heading
            const otherPowersHTML = timingGroups.map(({ heading, values }) => {
                const otherValues = values.filter((value) => value !== focusedValue);
                if (otherValues.length === 0)
                    return '';
                const [firstValue, ...nextValues] = otherValues;
                return `<div class="power-reference-heading-group">${headingHTML(heading)}${this.getPowerEntryHTML(firstValue)}</div>` + nextValues.map((value) => this.getPowerEntryHTML(value)).join('');
            }).join('');
            //the hovered power keeps its timing heading on top too (repeated below when its group has other powers)
            const focusedGroup = timingGroups.find(({ values }) => values.includes(focusedValue));
            referenceHTML = `
                <div class="tooltip-wrapper power-reference focused-power-reference">
                    ${headingHTML(focusedGroup.heading)}
                    ${this.getPowerEntryHTML(focusedValue, 'focused-power-entry')}
                    <div class="power-reference-balanced-columns">${otherPowersHTML}</div>
                </div>
            `;
        }
        this.powerReferenceHTMLByValue[focusedValue] = referenceHTML;
        return referenceHTML;
    }
    //the powers by timing, in turn order: the only source of the reference's headings
    getPowerTimingGroups() {
        return [
            { heading: _('Power activated immediately after playing the card:'), values: [1] },
            { heading: _('Power activated before Stop or More:'), values: [10] },
            { heading: _('Powers activated before the next dice roll:'), values: [2, 11] },
            { heading: _('Power activated after the next dice roll and before playing a card:'), values: [9] },
        ];
    }
    //a single power: the power reference's entry for it, on the same background. For the mini cards in log rows and the
    //status bar's circular card icons and power icons. modifierClass: status-bar-power-tooltip for the status bar's icons.
    //noteHTML: goes under the entry
    getPowerTooltipHTML(value, modifierClass = '', noteHTML = '') {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference ${modifierClass}">
                ${this.getPowerEntryHTML(value)}${noteHTML}
            </div>
        `;
    }
    //one power's entry: its icon floated left, "Card N:" in bold, then its text. Shared by the power reference and the
    //single-power tooltip, so both look the same. extraClass: focused-power-entry for the hovered card's power on top of the reference
    getPowerEntryHTML(value, extraClass = '') {
        return `
            <div class="power-reference-entry highlighted-power-entry ${extraClass}">
                <span class="power-icon" data-power-value="${value}"></span><b>${_('Card ${value}:').replace('${value}', value.toString())}</b> ${this.getPowerText(value)}
            </div>`;
    }
    //the only source of the power texts. They follow our BGA rules (SPEC.md), not the rulebook's wording
    getPowerText(value) {
        const powerTexts = {
            1: _('You may play another card from your hand on the same roll. It must match dice as usual and can trigger its own power.'),
            2: _('Automatic: on the next roll, the die of this card\'s color is reserved only for you. Opponents can\'t use it, either alone or in a sum. Usable only if you stay in the round.'),
            9: _('Turn any die 1 up or down (a 1 can become a 6, and a 6 a 1). This applies to everyone. You can\'t change a die that was already changed this turn. Usable only if you are still in the round.'),
            10: _('Swap 2 cards of your choice with 2 random cards from an opponent\'s hand. If no other player still in the round has at least 2 cards, discard 2 cards and draw 2 instead.'),
            11: _('Add the golden die to the next roll, for everyone. It has no color and only counts when added to another die. Stays for 1 turn only. Usable only if you stay in the round.'),
        };
        return powerTexts[value];
    }
    //on the card tooltips' background: the single-power tooltip's wrapper, with the text in place of a power entry
    getStartTokenTooltipHTML() {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference">
                <div>${_('<b>Start token:</b> Powers resolve clockwise from this player. Every turn it passes to the next player who is still in the round.')}</div>
            </div>
        `;
    }
    getLastChanceTooltipText() {
        return _('Last Chance: once per game, when you can\'t play any card, play nothing this turn and stay in the round.');
    }
    isSafariMobile() { return document.body.classList.contains('safari-browser') && this.game.isMobile(); }
    static getPowerCardClass(value) { return 'power-card-POWER' + value; }
}
TooltipHandler.TOOLTIP_DELAY = 1000;
TooltipHandler.GAME_AREA_CARDS_SELECTOR = '#my-hand-container .a-card[id], #played-columns-container .a-card[id]';
TooltipHandler.POWER_REFERENCE_DIALOG_ID = 'power_reference_dialog'; //its popin's id is popin_<this>, styled in Game.scss
TooltipHandler.LONG_PRESS_DURATION = 450;
TooltipHandler.LONG_PRESS_MOVE_TOLERANCE = 10; //px: a finger moving further is scrolling

/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * HandHandler.ts
 */
class HandHandler {
    constructor(game, handData) {
        this.game = game;
        this.handData = handData;
        this.maxSelectedCards = 1;
        this.selectionCounter = 0; //stamps data-selection-order on each selected card, so selections read back in the order they were made
        this.resizeDebounceTimeout = null;
        this.rejectedCardPopupTimeout = null;
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
        this.cardsContainer.addEventListener('animationstart', (event) => { this.syncCardGlow(event); });
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
        if (this.game.isInterfaceLocked())
            return;
        //a set-aside card while its choice can still be undone (the player is inactive by then): the same as the Undo button
        const clickedCard = event.target.closest('.a-card');
        if (clickedCard?.classList.contains(HandHandler.UNDOABLE_CHOSEN_CARD_CLASS)) {
            this.game.undoableChosenCardClicked();
            return;
        }
        if (!this.game.bga.players.isCurrentPlayerActive())
            return;
        if (!HandHandler.SELECTION_STATES.includes(this.game.getGameStateName()))
            return;
        if (!event.target.classList.contains(HandHandler.SELECTABLE_CARD_CLASS))
            return;
        this.handCardClicked(event.target);
    }
    //selecting a card only raises it; the status-bar confirmation sends it. With one card at most (card play),
    //a click moves the selection; with more (card 10), clicks add cards, and once the limit is reached a new card
    //replaces the oldest selected one (first in, first out). Clicking a selected card unselects it
    handCardClicked(cardDiv) {
        const cardWasAlreadySelected = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);
        //Expert mode: an unplayable card is rejected before anything is selected (or played, with "One-click card play")
        if (!cardWasAlreadySelected && !this.game.canSelectHandCard(parseInt(cardDiv.getAttribute('data-card-id')))) {
            this.rejectCard(cardDiv);
            return;
        }
        if (cardWasAlreadySelected) {
            cardDiv.classList.remove(HandHandler.SELECTED_CARD_CLASS);
        }
        else if (this.maxSelectedCards === 1) {
            this.clearSelection();
            this.selectCard(cardDiv);
        }
        else {
            const selectedCards = this.getSelectedCardDivs();
            if (selectedCards.length >= this.maxSelectedCards)
                selectedCards[0].classList.remove(HandHandler.SELECTED_CARD_CLASS);
            this.selectCard(cardDiv);
        }
        this.game.handSelectionChanged();
    }
    selectCard(cardDiv) {
        this.selectionCounter++;
        cardDiv.setAttribute('data-selection-order', this.selectionCounter.toString());
        cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
    }
    //selected cards, oldest selection first
    getSelectedCardDivs() {
        const selectedCards = Array.from(this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS));
        return selectedCards.sort((a, b) => parseInt(a.getAttribute('data-selection-order') ?? '0') - parseInt(b.getAttribute('data-selection-order') ?? '0'));
    }
    clearSelection() {
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }
    getSelectedCardID() {
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }
    //in selection order, oldest first
    getSelectedCardIDs() {
        return this.getSelectedCardDivs().map(card => parseInt(card.getAttribute('data-card-id')));
    }
    getSelectedCardData() {
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.getCardData(selectedCardID);
    }
    getCardData(cardID) {
        return this.handData.find(card => card.card_id === cardID) ?? null;
    }
    //selectable cards glow, the others keep their normal look. isPlay: the cards are playable cards, so power cards get their own glow.
    //withGlow false (Expert mode's PlayCard): the cards get the selectable cursor but no glow, so every card looks the same
    setSelectableCards(selectableCardIDs, maxSelectedCards = 1, isPlay = false, withGlow = true) {
        this.clearSelection();
        this.maxSelectedCards = maxSelectedCards;
        this.cardsContainer.classList.toggle(HandHandler.SELECTABLE_WITHOUT_GLOW_CLASS, !withGlow);
        for (let card of this.getCardDivs()) {
            const isSelectable = selectableCardIDs.includes(parseInt(card.getAttribute('data-card-id')));
            card.classList.toggle(HandHandler.SELECTABLE_CARD_CLASS, isSelectable);
            card.classList.toggle(HandHandler.PLAYABLE_POWER_CARD_CLASS, isSelectable && isPlay && POWER_CARD_VALUES.includes(parseInt(card.getAttribute('data-value'))));
        }
    }
    //cards that start glowing together are already in phase; a card that starts while others already pulse (a later
    //setSelectableCards that keeps some cards playable) joins their phase, so gold and power cards always peak together
    syncCardGlow(event) {
        if (!HandHandler.CARD_GLOW_ANIMATIONS.includes(event.animationName))
            return;
        const isCardGlow = (animation) => animation instanceof CSSAnimation && HandHandler.CARD_GLOW_ANIMATIONS.includes(animation.animationName);
        const runningGlow = this.cardsContainer.getAnimations({ subtree: true })
            .find(animation => isCardGlow(animation) && animation.effect?.target !== event.target && animation.startTime !== null);
        if (!runningGlow)
            return;
        for (let animation of event.target.getAnimations())
            if (isCardGlow(animation))
                animation.startTime = runningGlow.startTime;
    }
    clearSelectableCards() {
        this.clearSelection();
        this.cardsContainer.classList.remove(HandHandler.SELECTABLE_WITHOUT_GLOW_CLASS);
        for (let card of this.getCardDivs())
            card.classList.remove(HandHandler.SELECTABLE_CARD_CLASS, HandHandler.PLAYABLE_POWER_CARD_CLASS);
    }
    //the cards chosen this turn (a first card, then any card-1 chain) stay set aside in the hand until the reveal, or until "Undo"
    setChosenCards(cardIDs) {
        for (let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }
    //PlayCard, waiting for the others: every set-aside card (a first card and its card-1 chain, one choice) undoes the
    //choice when clicked. Only the cards whose state changes get their tooltip again, with or without the undo hint
    setChosenCardsUndoable(isUndoable) {
        for (let card of this.getCardDivs()) {
            const wasUndoable = card.classList.contains(HandHandler.UNDOABLE_CHOSEN_CARD_CLASS);
            const undoable = isUndoable && card.classList.contains(HandHandler.CHOSEN_CARD_CLASS);
            if (undoable === wasUndoable)
                continue;
            card.classList.toggle(HandHandler.UNDOABLE_CHOSEN_CARD_CLASS, undoable);
            this.game.tooltipHandler?.updateCardTooltip(card);
        }
    }
    isUndoableChosenCard(card) { return card.classList.contains(HandHandler.UNDOABLE_CHOSEN_CARD_CLASS); }
    //Expert mode: an unplayable card was clicked. It shakes sideways (not with reduced motion) and "Can't play [card]" pops up on it
    rejectCard(cardDiv) {
        const cardData = this.getCardData(parseInt(cardDiv.getAttribute('data-card-id')));
        if (!cardData)
            return;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            //restarted on a second click mid-shake. One-shot: removed once played, or once the rule stops applying (the interface locks)
            cardDiv.classList.remove(HandHandler.REJECTED_CARD_CLASS);
            void cardDiv.offsetWidth;
            cardDiv.style.setProperty('--card-reject-shake-duration', Game.CARD_REJECT_SHAKE_DURATION + 'ms');
            cardDiv.classList.add(HandHandler.REJECTED_CARD_CLASS);
            //a timeout too, in case the shake never starts (then neither event comes)
            const removeShake = () => {
                cardDiv.classList.remove(HandHandler.REJECTED_CARD_CLASS);
                cardDiv.removeEventListener('animationend', onShakeEvent);
                cardDiv.removeEventListener('animationcancel', onShakeEvent);
                clearTimeout(shakeTimeout);
            };
            const onShakeEvent = (event) => {
                if (event.target === cardDiv && event.animationName === 'rejected-hand-card-shake')
                    removeShake();
            };
            const shakeTimeout = setTimeout(removeShake, Game.CARD_REJECT_SHAKE_DURATION + 100);
            cardDiv.addEventListener('animationend', onShakeEvent);
            cardDiv.addEventListener('animationcancel', onShakeEvent);
        }
        this.showRejectedCardPopup(cardDiv, cardData);
    }
    //one popup at a time (a new rejection replaces it), fixed in <body> above the card (below it when there is no room above),
    //kept inside the window. It ignores the pointer, fades out in Game.REJECTED_CARD_POPUP_DURATION and is removed
    showRejectedCardPopup(cardDiv, cardData) {
        this.removeRejectedCardPopup();
        const popup = document.createElement('div');
        popup.id = HandHandler.REJECTED_CARD_POPUP_ID;
        popup.className = 'rejected-card-popup';
        popup.style.setProperty('--rejected-card-popup-duration', Game.REJECTED_CARD_POPUP_DURATION + 'ms');
        popup.innerHTML = _("Can't play ${card}").replace('${card}', this.game.getStatusCardIconHTML(cardData));
        document.body.appendChild(popup);
        const gap = HandHandler.REJECTED_CARD_POPUP_GAP;
        const cardRect = cardDiv.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        let left = cardRect.left + (cardRect.width - popupRect.width) / 2;
        left = Math.max(gap, Math.min(left, viewportWidth - popupRect.width - gap));
        let top = cardRect.top - popupRect.height - gap;
        if (top < gap)
            top = cardRect.bottom + gap;
        top = Math.max(gap, Math.min(top, viewportHeight - popupRect.height - gap));
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        this.rejectedCardPopupTimeout = setTimeout(() => this.removeRejectedCardPopup(), Game.REJECTED_CARD_POPUP_DURATION);
    }
    removeRejectedCardPopup() {
        if (this.rejectedCardPopupTimeout !== null)
            clearTimeout(this.rejectedCardPopupTimeout);
        this.rejectedCardPopupTimeout = null;
        document.getElementById(HandHandler.REJECTED_CARD_POPUP_ID)?.remove();
    }
    //card 10 redraw: the discarded cards sweep off-screen up-left, then the drawn cards come in from off-screen up-left into
    //their sorted slots, dealt like a new hand. The hand is laid out once, in its final order, as the sweep starts, with the
    //drawn cards hidden in their slots. Resolves when the last drawn card has landed
    async redrawCards(discardedCardIDs, drawnCardsData) {
        const discardedCards = discardedCardIDs.map(cardID => this.getCardDiv(cardID)).filter(card => card);
        const sweep = this.game.sweepCardsOffScreen(discardedCards, Game.REDRAW_SWEEP_DURATION, Game.REDRAW_SWEEP_STAGGER); //lifts the copies out, so the cards can go right away
        discardedCards.forEach(card => card.remove());
        this.handData = [...this.handData.filter(handCard => !discardedCardIDs.includes(handCard.card_id)), ...drawnCardsData];
        this.displayHand();
        const drawnCardIDs = drawnCardsData.map(cardData => cardData.card_id);
        const drawnCards = this.getCardDivs().filter(card => drawnCardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
        drawnCards.forEach(card => card.style.visibility = 'hidden');
        await sweep;
        await this.dealIn(drawnCards, Game.REDRAW_DEAL_DURATION, Game.REDRAW_DEAL_STAGGER);
    }
    //card 10 swap: the cards I give fly from their slots onto the other player's board (boardRect, on screen) and fade out
    //there, the cards I get fly from it into their sorted slots, and the cards I keep slide from their old places to their
    //new ones. A card is Game.BOARD_CARD_SCALE of its full size on the board and full size in my hand. Every card is measured
    //before the hand changes, the hand is laid out once in its final order, then every move starts at the same time. Resolves
    //when the last one has landed
    async swapCards(leavingCardIDs, arrivingCardsData, boardRect) {
        const animate = this.game.bga.gameui.bgaAnimationsActive();
        const oldRects = new Map();
        for (let card of this.getCardDivs())
            oldRects.set(parseInt(card.getAttribute('data-card-id')), card.getBoundingClientRect());
        const moves = [];
        let landedCount = 0; //the cards I give land as a stack on the other player's avatar, each in front of the one before
        for (let cardID of leavingCardIDs) {
            const card = this.getCardDiv(cardID);
            if (!card)
                continue;
            if (animate)
                moves.push(this.game.animateSlideAway(card, boardRect, Game.CARD_SLIDE_DURATION, { boardEnd: true, stackIndex: landedCount++, holdMs: Game.BOARD_ARRIVAL_HOLD, fadeOutMs: Game.SWAP_FADE_OUT_DURATION })); //places the copy on card before its first await,
            card.remove(); //so the card can go right away
        }
        this.handData = [...this.handData.filter(handCard => !leavingCardIDs.includes(handCard.card_id)), ...arrivingCardsData];
        for (let cardData of arrivingCardsData)
            this.insertCardToHand(cardData);
        for (let cardData of this.getSortedHandData()) //moves the cards I keep instead of recreating them, so they keep their tooltips
            this.cardsContainer.appendChild(this.getCardDiv(cardData.card_id));
        this.recomputeCardSpacing();
        if (animate) {
            for (let card of this.getCardDivs()) {
                const oldRect = oldRects.get(parseInt(card.getAttribute('data-card-id')));
                if (!oldRect)
                    moves.push(this.game.animateSlide(card, boardRect, null, Game.CARD_SLIDE_DURATION, { boardEnd: true }));
                else if (HandHandler.hasMoved(oldRect, card.getBoundingClientRect()))
                    moves.push(this.game.animateSlide(card, oldRect, null, Game.CARD_SLIDE_DURATION));
            }
        }
        await Promise.all(moves);
    }
    static hasMoved(oldRect, newRect) {
        return Math.abs(oldRect.left - newRect.left) > 0.5 || Math.abs(oldRect.top - newRect.top) > 0.5;
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
    //a crash or a new round (with every column, in newRound) discards the whole hand: it sweeps off-screen up-left
    async discardAll(durationMs = Game.CARD_SWEEP_DURATION, staggerMs = Game.CARD_SWEEP_STAGGER) {
        await this.sweepOutCards(durationMs, staggerMs);
    }
    //a new round's hand, dealt card by card (dealIn) once the previous round's cards have swept out (newRound). Any card
    //still in the hand sweeps out alongside the deal. Resolves when the last card has landed
    async setHand(handData) {
        const sweep = this.sweepOutCards(); //nothing left to sweep after newRound
        this.handData = handData;
        this.displayHand();
        await Promise.all([sweep, this.dealIn(this.getCardDivs())]);
    }
    //cards already laid out in their final slots are hidden, then a copy of each flies in, rightmost first,
    //staggerMs apart, and the real card shows when its copy lands, so no card moves during or after the deal.
    //Every card starts DEAL_X_OFFSET window widths to the left of its slot (more if that isn't off-screen) and up along
    //Game.CARD_SWEEP_ANGLE, read per card in case of a scroll. Resolves when the last one has landed
    async dealIn(cards, durationMs = Game.CARD_DEAL_DURATION, staggerMs = Game.CARD_DEAL_STAGGER) {
        cards.forEach(card => card.style.visibility = 'hidden');
        const deals = [];
        for (let i = cards.length - 1; i >= 0; i--) {
            if (i < cards.length - 1)
                await this.game.bga.gameui.wait(staggerMs);
            const startRect = Game.getOffScreenUpLeftRect(cards[i].getBoundingClientRect(), window.innerWidth * HandHandler.DEAL_X_OFFSET);
            deals.push(this.game.animateSlide(cards[i], startRect, null, durationMs, { easing: Game.CARD_DEAL_EASING }));
        }
        await Promise.all(deals);
    }
    //every card in my hand sweeps off-screen up-left (Game.sweepCardsOffScreen) and the hand is emptied at once
    async sweepOutCards(durationMs = Game.CARD_SWEEP_DURATION, staggerMs = Game.CARD_SWEEP_STAGGER) {
        const sweep = this.game.sweepCardsOffScreen(this.getCardDivs(), durationMs, staggerMs);
        this.removeAllCards();
        await sweep;
    }
    //every card leaves the hand at once, with no animation (a crash's cards have already tumbled out, Game.notif_crashAnimation)
    removeAllCards() {
        this.handData = [];
        this.cardsContainer.innerHTML = '';
    }
    getCardDivs() { return Array.from(this.cardsContainer.querySelectorAll('.a-card')); }
    getCardDiv(cardID) { return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }
    getCardCount() { return this.cardsContainer.querySelectorAll('.a-card').length; }
    //the hand keeps its height when it is empty (Game.scss), so emptying it never moves the layout; only once the game is
    //over with no card left for good is it hidden. Called on entering gameEnd (page load included) and with the end-game table
    updateGameOverVisibility() {
        this.handContainer.classList.toggle(HandHandler.GAME_OVER_EMPTY_HAND_CLASS, this.game.isGameOver() && this.getCardCount() === 0);
    }
    getHandContainer() { return this.handContainer; }
}
HandHandler.SELECTED_CARD_CLASS = 'selected-hand-card';
HandHandler.CHOSEN_CARD_CLASS = 'chosen-card';
HandHandler.UNDOABLE_CHOSEN_CARD_CLASS = 'undoable-chosen-card'; //a set-aside card whose choice Undo can still take back: clicking it is the Undo button
HandHandler.SELECTABLE_CARD_CLASS = 'selectable-card';
HandHandler.PLAYABLE_POWER_CARD_CLASS = 'playable-power-card'; //a playable power card glows cream instead of gold
HandHandler.CARD_GLOW_ANIMATIONS = ['selectable-card-glow-pulse', 'mobile-selectable-card-glow-pulse']; //Game.scss keyframes
HandHandler.SELECTABLE_WITHOUT_GLOW_CLASS = 'selectable-without-glow'; //on the cards container: Expert mode's PlayCard, every card selectable and none glowing
HandHandler.REJECTED_CARD_CLASS = 'rejected-hand-card'; //Expert mode: the one-shot shake of an unplayable card that was clicked
HandHandler.REJECTED_CARD_POPUP_ID = 'rejected-card-popup';
HandHandler.REJECTED_CARD_POPUP_GAP = 8; //px between the popup and the card, and the least between the popup and the window's edges
//new hand (setHand): the previous round's leftover cards sweep out up-left (Game.sweepCardsOffScreen) while the new hand
//is dealt right to left, every new card travelling the same path, shifted to its own slot, in from the top-left along
//Game.CARD_SWEEP_ANGLE. A card 10 redraw deals its drawn cards the same way. Durations, staggers, easings and the
//angle: Game.CARD_DEAL_* / CARD_SWEEP_* (the redraw's own durations and staggers: Game.REDRAW_*)
HandHandler.DEAL_X_OFFSET = 1.2; //a card starts at least this share of the window width to the left of its slot (and up along the angle)
HandHandler.GAME_OVER_EMPTY_HAND_CLASS = 'game-over-empty-hand'; //hides the hand once the game is over with no card left
HandHandler.SELECTION_STATES = ['PlayCard', 'SwapCards'];
HandHandler.DEFAULT_CARD_OVERLAP = 0.1; //share of a card width each card covers of the one before
HandHandler.MAX_CARD_OVERLAP = 0.7;
HandHandler.MOBILE_HAND_SPAN_PERCENT = 99; //like Fugu: on mobile the hand spans 99% of its container's width
HandHandler.MOBILE_MAX_CARD_OVERLAP = 0.85; //on mobile a card may cover this share of the one before
HandHandler.RESIZE_DEBOUNCE_TIME = 100;

class StartTokenHandler {
    constructor(game, startPlayerID) {
        this.game = game;
        this.startPlayerID = startPlayerID;
        this.startToken = document.createElement('div');
        this.startToken.id = 'start-token';
        this.startToken.className = 'start-token';
        this.startToken.style.rotate = this.getTilt(); //never `transform` on the token or its copy: see moveTo
        this.startToken.innerHTML = StartTokenHandler.LAYERS_HTML;
        StartTokenHandler.setOutlineColor(this.startToken, this.getPlayerColorCSS(this.startPlayerID));
        const startTokenAnchor = this.game.players[this.startPlayerID]?.getStartTokenAnchor();
        if (startTokenAnchor)
            startTokenAnchor.appendChild(this.startToken);
    }
    //the token flies from its current player board's avatar corner to playerID's on a position:fixed copy, so it shows wherever
    //the page is scrolled: one Web Animations API animation over the whole curved path, the lift and the landing each eased
    //in and out, with a hold at the peak between them. Resolves when the copy has landed and the real token shows on the new board.
    //Movement, rotation and size each have their own CSS property (translate, rotate, scale), on the token and on its copy
    //alike, and `transform` is never used for either: when the board tilt lived in `transform`, the copy inherited it and
    //every on-screen measurement of the copy came out rotated, so the whole flight was off
    async moveTo(playerID) {
        const targetAnchor = this.game.players[playerID]?.getStartTokenAnchor();
        if (!targetAnchor)
            return;
        const fromColor = this.getPlayerColorCSS(this.startPlayerID);
        const toColor = this.getPlayerColorCSS(playerID);
        this.startPlayerID = playerID;
        const sourceAnchor = this.startToken.parentElement;
        if (sourceAnchor === targetAnchor)
            return;
        if (!sourceAnchor || !this.game.bga.gameui.bgaAnimationsActive()) { //nothing to fly from, or no animations (fast replay, hidden tab)
            targetAnchor.appendChild(this.startToken);
            StartTokenHandler.setOutlineColor(this.startToken, toColor);
            return;
        }
        const fromRect = this.getUntiltedRect(); //real on-screen places, even off-screen
        const flyingCopy = this.createFlyingCopy();
        const placeOnScreen = this.getFlyingCopyPlacement(flyingCopy);
        this.startToken.style.visibility = 'hidden';
        targetAnchor.appendChild(this.startToken);
        StartTokenHandler.setOutlineColor(this.startToken, toColor); //hidden until the copy lands
        const landingRect = this.getUntiltedRect();
        const targetBounce = this.game.players[playerID].getBounceOffset(); //a card 10 bounce may still be playing: land on the resting board
        const toRect = new DOMRect(landingRect.x, landingRect.y - targetBounce, landingRect.width, landingRect.height);
        const from = this.getCenter(fromRect);
        const to = this.getCenter(toRect);
        const liftHeight = fromRect.height * StartTokenHandler.LIFT_SCALE;
        const sideways = this.areBoardsBesideGameArea(sourceAnchor);
        const lift = this.getLiftPoint(sourceAnchor, targetAnchor, from, to, liftHeight);
        //two quadratic curves meeting at the lift point in the same direction, so the path has no corner there. Boards beside
        //the game area: the token passes the lift point moving up or down (a C, out sideways and back); boards above it: moving
        //sideways (a U, down and back up). Each curve's control point sits on that line through the lift point, at a distance
        //proportional to its phase's duration
        const liftShare = StartTokenHandler.LIFT_DURATION / (StartTokenHandler.LIFT_DURATION + StartTokenHandler.LAND_DURATION);
        const direction = sideways
            ? { x: 0, y: Math.sign(to.y - from.y) || 1 }
            : { x: Math.sign(to.x - from.x) || Math.sign(window.innerWidth / 2 - from.x) || 1, y: 0 };
        const span = Math.max(sideways ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x), StartTokenHandler.MIN_CURVE_SPAN);
        const liftControl = { x: lift.x - direction.x * span * liftShare, y: lift.y - direction.y * span * liftShare };
        const landControl = { x: lift.x + direction.x * span * (1 - liftShare), y: lift.y + direction.y * span * (1 - liftShare) };
        //where the copy is at a point of a phase (phaseProgress 0 to 1, already eased). At the start of the lift and the end of
        //the landing it sits exactly on the real token: same center, same untilted height, same TILT
        const placementAt = (isLifting, phaseProgress) => {
            const point = isLifting ? this.getCurvePoint(from, liftControl, lift, phaseProgress) : this.getCurvePoint(lift, landControl, to, phaseProgress);
            const height = isLifting
                ? fromRect.height + (liftHeight - fromRect.height) * phaseProgress
                : liftHeight + (toRect.height - liftHeight) * phaseProgress;
            const tiltBackStart = 1 - StartTokenHandler.TILT_BACK_FRACTION;
            const tilt = isLifting
                ? StartTokenHandler.TILT * (1 - Math.min(1, phaseProgress / StartTokenHandler.STRAIGHTEN_FRACTION))
                : StartTokenHandler.TILT * Math.max(0, (phaseProgress - tiltBackStart) / StartTokenHandler.TILT_BACK_FRACTION);
            return placeOnScreen(point, height, tilt);
        };
        //keyframes evenly spread in time, linear between them, eased here per phase: the lift eases in leaving the board and
        //the landing eases out arriving, while around the peak they ease into and out of the hold only as much as PEAK_PAUSE
        //calls for (peakEasing 0: through the peak at full speed; 1: to rest and from rest). The hold itself is two equal
        //keyframes at the peak, exactly PEAK_PAUSE ms apart
        const peakEasing = Math.min(1, StartTokenHandler.PEAK_PAUSE / StartTokenHandler.PEAK_EASE_FULL_PAUSE);
        const durationMs = StartTokenHandler.LIFT_DURATION + StartTokenHandler.PEAK_PAUSE + StartTokenHandler.LAND_DURATION;
        const landStart = (StartTokenHandler.LIFT_DURATION + StartTokenHandler.PEAK_PAUSE) / durationMs; //offset where the landing starts
        const keyframes = [];
        for (let i = 0; i <= StartTokenHandler.KEYFRAMES_PER_PHASE; i++) {
            const t = i / StartTokenHandler.KEYFRAMES_PER_PHASE;
            keyframes.push({ offset: t * StartTokenHandler.LIFT_DURATION / durationMs, ...placementAt(true, this.easeLift(t, peakEasing)) });
        }
        for (let i = 0; i <= StartTokenHandler.KEYFRAMES_PER_PHASE; i++) { //its first keyframe ends the hold at the lift point
            const t = i / StartTokenHandler.KEYFRAMES_PER_PHASE;
            keyframes.push({ offset: landStart + t * (1 - landStart), ...placementAt(false, this.easeLand(t, peakEasing)) });
        }
        keyframes[keyframes.length - 1].offset = 1; //exactly, whatever the rounding
        Object.assign(flyingCopy.style, placementAt(true, 0)); //in place before the animation's first frame
        const flightTiming = { duration: durationMs, easing: 'linear', fill: 'forwards' };
        const flight = flyingCopy.animate(keyframes, flightTiming);
        //the stroke keeps the old owner's color through the lift and the hold, and blends into the new owner's through the
        //landing, done as it lands. Only that layer's background-color animates
        flyingCopy.querySelector('.start-token-outline')?.animate([
            { offset: 0, backgroundColor: fromColor },
            { offset: landStart, backgroundColor: fromColor },
            { offset: 1, backgroundColor: toColor },
        ], flightTiming);
        await Promise.race([
            flight.finished.catch(() => undefined),
            this.game.bga.gameui.wait(durationMs + StartTokenHandler.FINISH_SAFETY_MARGIN),
        ]);
        this.startToken.style.visibility = null;
        flyingCopy.remove();
    }
    //the copy for the flight: in <body>, pinned to the viewport's top-left corner (.flying-start-token), with none of the
    //token's own translate, rotate or scale, so its first measurement is its untransformed box
    createFlyingCopy() {
        const flyingCopy = this.startToken.cloneNode(true);
        flyingCopy.removeAttribute('id');
        flyingCopy.style.removeProperty('visibility');
        flyingCopy.style.removeProperty('rotate');
        flyingCopy.classList.add('flying-start-token');
        document.body.appendChild(flyingCopy);
        return flyingCopy;
    }
    //returns the translate, scale and rotate that put the copy's center on an on-screen point, at an on-screen height and
    //tilt. The copy rotates and scales around its center, so the three never depend on each other. Its measured zoom
    //converts screen px into its own px (it lives outside BGA's mobile scaling of the page)
    getFlyingCopyPlacement(flyingCopy) {
        const baseRect = flyingCopy.getBoundingClientRect(); //untransformed, at the viewport's top-left corner
        const baseCenter = this.getCenter(baseRect);
        const cssWidth = parseFloat(getComputedStyle(flyingCopy).width); //unrounded, unlike offsetWidth
        const zoom = (cssWidth > 0) ? baseRect.width / cssWidth : 1;
        return (center, height, tilt) => ({
            translate: `${(center.x - baseCenter.x) / zoom}px ${(center.y - baseCenter.y) / zoom}px`,
            scale: `${(baseRect.height > 0) ? height / baseRect.height : 1}`,
            rotate: `${tilt}deg`,
        });
    }
    //where the token lifts to, in viewport coordinates, so the lift shows even when the boards are scrolled out of view
    getLiftPoint(sourceAnchor, targetAnchor, from, to, liftHeight) {
        const margin = liftHeight / 2 + StartTokenHandler.VIEWPORT_MARGIN;
        const clamp = (value, max) => Math.min(Math.max(value, margin), Math.max(margin, max - margin));
        if (this.areBoardsBesideGameArea(sourceAnchor)) { //out of the boards column, toward the game area
            const sourceRect = this.getBoard(sourceAnchor).getBoundingClientRect();
            const targetRect = this.getBoard(targetAnchor).getBoundingClientRect();
            const gameAreaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
            const x = (sourceRect.left >= gameAreaRect.left)
                ? Math.min(sourceRect.left, targetRect.left) - StartTokenHandler.DESKTOP_LIFT_DISTANCE
                : Math.max(sourceRect.right, targetRect.right) + StartTokenHandler.DESKTOP_LIFT_DISTANCE;
            return { x: clamp(x, window.innerWidth), y: clamp((from.y + to.y) / 2, window.innerHeight) };
        }
        return { x: clamp((from.x + to.x) / 2, window.innerWidth), y: window.innerHeight * StartTokenHandler.MOBILE_LIFT_Y };
    }
    //decided by where the boards are, not by the screen width: beside the game area (desktop) when they don't share any
    //horizontal range with it, above it (mobile) otherwise
    areBoardsBesideGameArea(anchor) {
        const boardRect = this.getBoard(anchor).getBoundingClientRect();
        const gameAreaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
        return boardRect.left >= gameAreaRect.right - 1 || boardRect.right <= gameAreaRect.left + 1;
    }
    //the whole BGA player board around a token anchor (the avatar's wrapper, or the board itself)
    getBoard(anchor) { return anchor.closest('.player-board') ?? anchor; }
    //the token's on-screen box without its tilt (a rotated box measures bigger); its center is the same either way
    getUntiltedRect() {
        this.startToken.style.rotate = 'none';
        const rect = this.startToken.getBoundingClientRect();
        this.startToken.style.rotate = this.getTilt();
        return rect;
    }
    getCurvePoint(from, control, to, t) {
        return {
            x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
            y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
        };
    }
    //the stroke's color: the token's --start-token-color, read by .start-token-outline
    static setOutlineColor(token, color) { token.style.setProperty('--start-token-color', color); }
    getPlayerColorCSS(playerID) { return '#' + (this.game.getPlayerColor(playerID) ?? '000000'); }
    getTilt() { return `${StartTokenHandler.TILT}deg`; }
    //quadratic easings for the two phases, blended by peakEasing (0 to 1) between ease-in (lift) or ease-out (landing) and
    //ease-in-out. At peakEasing 0 the lift ends at speed 2 and the landing starts at speed 2 (per unit of its own time); the
    //path's control points scale with each phase's duration, so the token crosses the peak at one steady speed, no jerk
    easeLift(t, peakEasing) { return (1 - peakEasing) * t * t + peakEasing * this.easeInOutQuad(t); }
    easeLand(t, peakEasing) { return (1 - peakEasing) * (1 - (1 - t) * (1 - t)) + peakEasing * this.easeInOutQuad(t); }
    easeInOutQuad(t) { return (t < 0.5) ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); }
    getCenter(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }
    getStartPlayerID() { return this.startPlayerID; }
}
StartTokenHandler.TILT = -7; //deg, the token's rotation on a board (tilted left); upright (0) in flight
//the pass: a flight on a copy of the token, out of the player boards area (growing), a hold at the peak, then into the new board (shrinking back)
StartTokenHandler.LIFT_DURATION = 520; //ms of phase 1, from the old board to the lift point: eases in leaving the board
StartTokenHandler.PEAK_PAUSE = 20; //ms of real stillness at the lift point, at full size, between the two phases (0: no hold, no slowdown)
StartTokenHandler.PEAK_EASE_FULL_PAUSE = 300; //PEAK_PAUSE (ms) from which the lift fully eases into the hold and the landing out of it; shorter pauses ease proportionally less
StartTokenHandler.LAND_DURATION = 520; //ms of phase 2, from the lift point to the new board: eases out arriving on it
StartTokenHandler.STRAIGHTEN_FRACTION = 0.22; //share of phase 1, from its start, in which the token rotates from TILT to upright
StartTokenHandler.TILT_BACK_FRACTION = 0.22; //share of phase 2, up to its end, in which it rotates back to TILT, done as it lands
StartTokenHandler.LIFT_SCALE = 2; //size of the token at the lift point, relative to its size on a board
StartTokenHandler.DESKTOP_LIFT_DISTANCE = 140; //px from the boards column's inner edge to the token's center at the lift point (boards beside the game area)
StartTokenHandler.MOBILE_LIFT_Y = 0.4; //share of the viewport height of the lift point (boards above the game area)
StartTokenHandler.VIEWPORT_MARGIN = 10; //px the lifted token keeps from the viewport's edges
StartTokenHandler.MIN_CURVE_SPAN = 120; //px, the least the path swings through the lift point, so boards right next to each other still get a curve
StartTokenHandler.KEYFRAMES_PER_PHASE = 24; //points sampled along each phase for the animation's keyframes (a fixed count, computed once per pass)
StartTokenHandler.FINISH_SAFETY_MARGIN = 300; //ms after the flight's duration at which the pass ends anyway, should the animation never report finished
//the token's layers, bottom to top: its drop shadow, the stroke in its owner's color, the pawn (see .start-token in
//Game.scss). Shared with the mini token in log rows, which hides the shadow
StartTokenHandler.LAYERS_HTML = '<div class="start-token-shadow"></div><div class="start-token-outline"></div><div class="start-token-pawn"></div>';

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
        if (this.game.isReplay()) { //to observe replayLogs that appears at the bottom of the page on replays
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
    //gapBefore: the row starts a new group in the log (log-gap-before, a gap on the side of the previous row). Decided from the
    //notification's args, never from the rows around it, so live rows, F5 and replays all get the same gaps
    addLogClassTag(logHTML, logClass, gapBefore = false) {
        const gapTagHTML = gapBefore ? '<div log-class-tag="log-gap-before"></div>' : '';
        return { log_html: logHTML + `<div log-class-tag="${logClass}"></div>` + gapTagHTML, log_class: logClass };
    }
    //create specific log types
    createLogNewRound(roundNumber) {
        let logHTML = `
            <div class="new-round-row">
                ${_('Round ${roundNumber}').replace('${roundNumber}', roundNumber.toString())}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'new-round-log', roundNumber > 1); //Round 1 is the game's first row
    }
    createLogDiceRolled(dice, firstRollOfRound) {
        const diceHTML = dice.filter(dieData => dieData.value !== null).map(dieData => this.game.diceHandler.createDieDiv(dieData).outerHTML).join('');
        let logHTML = `
            <div class="dice-rolled-row">
                ${diceHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'dice-rolled-log', !firstRollOfRound); //a round's first roll stays with its "Round N" row
    }
    createLogCardsRevealed(reveals) {
        const revealsHTML = reveals.map(reveal => {
            //a card as the status bar's circular card icon with its power icon, a card-1 chain's cards right after it in the same
            //icons container; Last Chance has no icon, so it stays a mini card
            const choiceHTML = (reveal.choice === 'card' && reveal.card) ? this.getCardIconsHTML([reveal.card, ...(reveal.extra_cards_POWER1 ?? [])], true) : `<div class="minimised-card-icon">${this.game.createLastChanceDiv().outerHTML}</div>`;
            //one table row: name, arrow, cards (the row's grid lays the entries out as columns)
            return `
                <div class="reveal-entry">
                    ${this.getCutPlayerNameHTML(reveal.player_id)}
                    <i class="log-arrow place-under-icon fa6 fa-share" aria-hidden="true"></i>
                    <span class="reveal-cards">${choiceHTML}</span>
                </div>`;
        }).join('');
        let logHTML = `
            <div class="cards-revealed-row">
                ${revealsHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'cards-revealed-log');
    }
    //icons only: "name → [Last Chance]", the reveal row's arrow and mini card (the server's LAST_CHANCE_LOG_STR is the
    //plain-text fallback)
    createLogLastChanceUsed(player_id) {
        let logHTML = `
            <div class="last-chance-row">
                ${this.getCutPlayerNameHTML(player_id)}
                <i class="fa6 fa-arrow-right last-chance-arrow" aria-hidden="true"></i>
                <div class="minimised-card-icon">${this.game.createLastChanceDiv().outerHTML}</div>
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'last-chance-log');
    }
    createLogPlayerCrashed(player_id) {
        //icons only: "[bomb] name [bomb]" (the server's CRASH_LOG_STR is the plain-text fallback)
        let logHTML = `
            <div class="player-crashed-row">
                <i class="fa6 fa-bomb" aria-hidden="true"></i>
                ${this.getCutPlayerNameHTML(player_id)}
                <i class="fa6 fa-bomb" aria-hidden="true"></i>
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'crash-log');
    }
    createLogGrandSlam(player_id) {
        const playerNameHTML = this.game.divColoredPlayer(player_id, { class: 'playername' });
        const grandSlamText = player_id === this.game.getMyPlayerID()
            ? _('${you} do a Grand Slam!').replace('${you}', playerNameHTML)
            : _('${player_name} does a Grand Slam!').replace('${player_name}', playerNameHTML);
        let logHTML = `
            <div class="grand-slam-row">
                ${grandSlamText}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'grand-slam-log');
    }
    createLogStartTokenPassed(player_id) {
        //icons only: "name ⇐ [Start token]" (the server's START_TOKEN_LOG_STR is the plain-text fallback)
        let logHTML = `
            <div class="start-token-row">
                ${this.getCutPlayerNameHTML(player_id)}
                ${LogMutationObserver.getDoubleArrowLeftHTML('start-token-arrow')}
                <div class="start-token mini-start-token" style="--start-token-color: #${this.game.getPlayerColor(player_id) ?? '000000'}">${StartTokenHandler.LAYERS_HTML}</div>
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'start-token-log');
    }
    //one line per player, stoppers, then More, then players who crashed this round, each group clockwise from the Start token
    //holder (the rows' order): "name [bank icon] N ★" with the stars banked, "name [forward]", "name [bomb]" (the crash row's
    //icon). Each icon sits in a fixed-width slot, so they all share one vertical axis; the play and bomb icons' titles name them
    createLogStopOrMoreRevealed(rows) {
        const iconsHTML = {
            stop: this.game.getBankIconHtml('log-bank-icon'),
            more: `<i class="fa6 fa-forward stop-or-more-icon" title="${_('Continues').replace(/"/g, '&quot;')}"></i>`,
            crash: `<i class="fa6 fa-bomb stop-or-more-icon" title="${_('Crashed').replace(/"/g, '&quot;')}"></i>`,
        };
        const linesByChoice = { stop: [], more: [], crash: [] };
        for (const row of rows) {
            //a stopper's stars (rows logged before they were sent have none)
            const starsHTML = (row.choice === 'stop' && row.stars !== undefined && row.stars !== null) ? `<span class="stop-or-more-stars"><b class="stop-or-more-amount">${row.stars}</b>&nbsp;<span class="stop-or-more-star">★</span></span>` : '';
            linesByChoice[row.choice].push(`
                <div class="stop-or-more-line">
                    ${this.game.divColoredPlayer(row.player_id, { class: 'playername' })}
                    <span class="stop-or-more-choice"><span class="stop-or-more-icon-slot">${iconsHTML[row.choice]}</span>${starsHTML}</span>
                </div>`);
        }
        const choiceLinesHTML = linesByChoice.stop.join('') + linesByChoice.more.join('') + linesByChoice.crash.join('');
        let logHTML = `
            <div class="stop-or-more-row">
                ${choiceLinesHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'stop-or-more-log');
    }
    //icons only: "name [die]", the reserved die blank (it is rolled again, so no value) with a lock on it, in its color with the
    //solid card 2 ring in the owner's color, as in the dice area (the server's DIE_RESERVED_POWER2_LOG_STR is the plain-text
    //fallback)
    createLogDieReservedPOWER2(player_id, die) {
        let logHTML = `
            <div class="die-reserved-row">
                ${this.game.divColoredPlayer(player_id, { class: 'playername' })}
                ${this.getBlankMiniDieHTML({ ...die, pending_reserved_by_POWER2: null }, 'fa-lock')}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'die-reserved-power2-log');
    }
    //icons only: "name [plus] [die]", the golden die blank (it has no value until the next roll), as big as the card 2 row's
    //die but with no ring and a flat gold face (the server's GOLDEN_DIE_POWER11_LOG_STR is the plain-text fallback)
    createLogGoldenDiePOWER11(player_id) {
        const goldenDie = { color: 'gold', value: null, reserved_by_POWER2: null, pending_reserved_by_POWER2: null, modified_by_POWER9: false, in_use_by_POWER11: true };
        let logHTML = `
            <div class="golden-die-row">
                ${this.game.divColoredPlayer(player_id, { class: 'playername' })}
                <i class="fa6 fa-solid fa-plus golden-die-plus" aria-hidden="true"></i>
                ${this.getBlankMiniDieHTML(goldenDie)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'golden-die-power11-log');
    }
    //icons only: "name [9]: [old die] → [new die]", the 9 that gave the power as the circular card icon (the server's
    //DIE_MODIFIED_POWER9_LOG_STR is the plain-text fallback). moveID tags the row, so a card 9 undo can remove it
    //(removeDieModifiedLogPOWER9)
    createLogDieModifiedPOWER9(player_id, card, dieColor, oldValue, newValue, moveID) {
        const oldDie = { color: dieColor, value: oldValue, reserved_by_POWER2: null, pending_reserved_by_POWER2: null, modified_by_POWER9: false, in_use_by_POWER11: true };
        const newDie = { ...oldDie, value: newValue };
        //rows logged before the card was sent have no card: the colon goes with it
        const cardHTML = card ? `<span class="die-modified-card">${this.getCardIconsHTML([card])}<span class="die-modified-colon">:</span></span>` : '';
        let logHTML = `
            <div class="die-modified-row" data-move-id="${moveID}">
                ${this.game.divColoredPlayer(player_id, { class: 'playername' })}
                ${cardHTML}
                ${this.getMiniDieHTML(oldDie)}
                <i class="fa6 fa-arrow-right die-modified-arrow" aria-hidden="true"></i>
                ${this.getMiniDieHTML(newDie)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'die-modified-power9-log');
    }
    //the server removes the row from the stored logs (F5, replay); this removes it from the logs already on the page (desktop and mobile)
    removeDieModifiedLogPOWER9(moveID) {
        document.querySelectorAll(`.die-modified-row[data-move-id="${moveID}"]`).forEach(row => {
            (row.closest('.log, .gamelogreview') ?? row).remove();
        });
    }
    //card 10: one row for everyone. The owner and the victim got the cards (ownerGives / targetGives set, from the
    //notification's _private); everyone else sees card backs
    createLogCardsSwappedPOWER10(owner_id, target_id, ownerGives, targetGives, count) {
        //the backs go in the icons' container too, so both views space their cards the same way
        const ownerCardsHTML = ownerGives ? this.getCardIconsHTML(ownerGives) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;
        const targetCardsHTML = targetGives ? this.getCardIconsHTML(targetGives) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;
        //"owner [cards] ⇄ [cards] target", on one line: each side's cards next to its player
        let logHTML = `
            <div class="cards-swapped-row">
                ${this.getCutPlayerNameHTML(owner_id)}${ownerCardsHTML}
                <span class="log-arrow">⇄</span>
                ${targetCardsHTML}${this.getCutPlayerNameHTML(target_id)}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'cards-swapped-power10-log');
    }
    //card 10 with no opponent left: one row for everyone, icons only like the swap row's: "name [discarded] ⇄ [drawn]" (the
    //server's CARDS_REDRAWN_POWER10_LOG_STR is the plain-text fallback). The owner sees the cards (from _private), everyone
    //else card backs, in the icons' container like the swap row's
    createLogCardsRedrawnPOWER10(player_id, discarded, drawn, count) {
        const discardedHTML = discarded ? this.getCardIconsHTML(discarded) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;
        const drawnHTML = drawn ? this.getCardIconsHTML(drawn) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;
        let logHTML = `
            <div class="cards-redrawn-row">
                ${this.getCutPlayerNameHTML(player_id)}${discardedHTML}
                <span class="log-arrow">⇄</span>
                ${drawnHTML}
            </div>` + ' &nbsp;';
        return this.addLogClassTag(logHTML, 'cards-redrawn-power10-log');
    }
    //icons only: "name [ban] [card]", the card as the circular card icon (the server's POWER_SKIPPED_LOG_STR is the plain-text
    //fallback). A card 10 skipped on its own keeps its reason after it
    createLogPowerSkipped(player_id, value, card, reason) {
        const cardHTML = card ? this.getCardIconsHTML([card]) : `<b>${value}</b>`;
        let reasonHTML = '';
        if (reason === 'nothing_to_draw')
            reasonHTML = _('(no card left to draw)');
        else if (reason === 'not_enough_cards')
            reasonHTML = _('(fewer than 2 cards in hand)');
        let logHTML = `
            <div class="power-skipped-row">
                ${this.game.divColoredPlayer(player_id, { class: 'playername' })}
                <i class="fa6 fa-ban power-skipped-ban" aria-hidden="true"></i>
                ${cardHTML}
                ${reasonHTML}
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
    //the status bar's circular card icons (Game.getStatusCardIconHTML), sized for the log by .log-card-icons. withPowerIcons:
    //each power card with its power badge, as in the status bar (Game.getStatusCardWithPowerHTML)
    getCardIconsHTML(cards, withPowerIcons = false) {
        const iconsHTML = cards.map(card => withPowerIcons ? this.game.getStatusCardWithPowerHTML(card) : this.game.getStatusCardIconHTML(card)).join('');
        return `<span class="log-card-icons">${iconsHTML}</span>`;
    }
    getMiniCardBacksHTML(count) {
        let backsHTML = '';
        for (let i = 0; i < count; i++)
            backsHTML += `<div class="minimised-card-icon">${this.game.createCardBackDiv().outerHTML}</div>`;
        return backsHTML;
    }
    //a player name the row's CSS cuts with an ellipsis (max-width), so its title shows it whole
    getCutPlayerNameHTML(player_id) {
        const nameText = (player_id === this.game.getMyPlayerID()) ? _('You') : this.game.getPlayerName(player_id);
        return this.game.divColoredPlayer(player_id, { class: 'playername', title: nameText.replace(/"/g, '&quot;') });
    }
    //"⇐" in the fa6 arrows' style: Font Awesome 6 Free's solid arrow-left (same viewBox, same arrowhead, same length), its
    //single 64-unit shaft replaced by two bars, centered on the arrow's middle line. Each bar's outer edge meets the inside of
    //an arm and the gap ends in the head's inner corner, so the bars join the head at any gap. Filled in the text color, 1em
    //tall like the fa6 glyphs
    static getDoubleArrowLeftHTML(className) {
        const barThickness = 40; //viewBox units (the fa6 shaft is 64). Thinner bars blur into one shaft at the logs' 15px
        const gap = 64; //viewBox units between the two bars; at most 194, where the bars reach the ends of the arms
        //the head's inner edges: the upper arm runs along x = 333.3 - y, the lower one along x = y - 178.8, meeting at (77.3, 256)
        const gapTop = 256 - gap / 2, gapBottom = 256 + gap / 2;
        const barsTop = gapTop - barThickness, barsBottom = gapBottom + barThickness;
        const barEndX = 448 - barThickness / 2; //where each bar's rounded end starts, so it ends at the shaft's x = 448
        const roundEnd = `a${barThickness / 2} ${barThickness / 2} 0 0 0 0-${barThickness}`;
        const path = 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3'
            + `L${barsBottom - 178.8} ${barsBottom}H${barEndX}${roundEnd}H${gapBottom - 178.8}L77.3 256L${333.3 - gapTop} ${gapTop}H${barEndX}${roundEnd}H${333.3 - barsTop}`
            + 'L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z';
        return `<svg class="${className}" width="0.875em" height="1em" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
                    <path d="${path}"/>
                </svg>`;
    }
    getMiniDieHTML(die) {
        return this.game.diceHandler.createDieDiv(die).outerHTML;
    }
    //a die with no face, with a Font Awesome icon centred on it when iconClass is given (fa-lock for card 2): data-value
    //"blank" matches no pip rule, so no pips show, and unlike "" (no value) it is not hidden
    getBlankMiniDieHTML(die, iconClass = null) {
        const aDie = this.game.diceHandler.createDieDiv(die);
        aDie.setAttribute('data-value', 'blank');
        if (iconClass)
            aDie.insertAdjacentHTML('beforeend', `<i class="fa6 ${iconClass} log-die-icon" aria-hidden="true"></i>`);
        return aDie.outerHTML;
    }
}

//"Undo", shared by every multiactive state where a choice stays pending until the last player has chosen.
//The player is inactive by then, so the action skips the active-player check (checkAction: false) and the
//server checks the state itself (#[CheckAction(false)] + checkPossibleAction).
//[BGA] Card 9's undo (actUndoDieChange_POWER9) uses the same button; its player is still active, so the server's own check applies
class UndoHandler {
    constructor(game) {
        this.game = game;
    }
    addUndoButton(actionName) {
        return this.game.bga.statusBar.addActionButton(_('Undo'), () => this.undo(actionName), {
            id: 'undo-button',
            color: 'alert',
        });
    }
    //the Undo button, and anything that does the same (PlayCard: clicking a set-aside card)
    undo(actionName) {
        if (!this.game.bga.actions.checkPossibleActions(actionName))
            return;
        this.game.bga.actions.performAction(actionName, {}, { checkAction: false });
    }
}

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
        this.game.updateEndGameScoreHighlights(); //the game is over (isDisplayed): every score back to BGA's default look
        this.game.handHandler?.updateGameOverVisibility(); //and an empty hand is hidden for good
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
            cellContent = `${roundScore.stars}`;
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
            this.game.players[player_id]?.setScore(score);
        }
    }
    isInstantFadeIn() { return this.game.getGameStateName() === 'gameEnd'; }
    isDisplayed() { return !!this.scoreContainer; }
}

class PrefHandler {
    constructor(game, prefNameToIndex) {
        this.game = game;
        this.prefNameToIndex = prefNameToIndex;
        this.oneClickPlay = false;
        this.playersDisplay = PrefHandler.PLAYERS_DISPLAY_AVATAR;
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
            case this.prefNameToIndex.background_trees:
                this.game.backgroundHandler.applyTreePreference(prefValue);
                break;
            case this.prefNameToIndex.background_drift:
                this.game.backgroundHandler.applyDriftPreference(prefValue);
                break;
            case this.prefNameToIndex.players_display:
                this.applyPlayersDisplay(prefValue);
                break;
        }
    }
    //game specific functions
    //clicking a playable card plays it at once, with no Confirm step
    isOneClickPlay() { return this.oneClickPlay; }
    //every column header follows one attribute on #played-columns-container, so all of them switch together. Any value other
    //than Player name is Profile picture (the default; also a missing value, as for a spectator with no saved preference)
    applyPlayersDisplay(prefValue) {
        this.playersDisplay = prefValue == PrefHandler.PLAYERS_DISPLAY_NAME ? PrefHandler.PLAYERS_DISPLAY_NAME : PrefHandler.PLAYERS_DISPLAY_AVATAR;
        document.getElementById('played-columns-container')?.setAttribute('data-players-display', this.playersDisplay == PrefHandler.PLAYERS_DISPLAY_NAME ? 'name' : 'avatar');
    }
    //a click on any column header's avatar or name: switches every header at once and saves the choice as the preference, so
    //BGA's preferences menu shows it too. Applied here first, since saving may not be possible (a spectator who isn't logged
    //in); the onChange that follows a successful save applies the same value again, which changes nothing
    togglePlayersDisplay() {
        const newValue = this.playersDisplay == PrefHandler.PLAYERS_DISPLAY_NAME ? PrefHandler.PLAYERS_DISPLAY_AVATAR : PrefHandler.PLAYERS_DISPLAY_NAME;
        this.applyPlayersDisplay(newValue);
        try {
            this.game.bga.userPreferences.set(this.prefNameToIndex.players_display, newValue);
        }
        catch (e) {
            console.error('Could not save the "Show players as" preference', e);
        }
    }
}
//"Show players as" (gamepreferences.jsonc, pref 103): the played columns' headers show each player's avatar or name
PrefHandler.PLAYERS_DISPLAY_AVATAR = 1;
PrefHandler.PLAYERS_DISPLAY_NAME = 2;

class BackgroundHandler {
    static getInstance(game) {
        return BackgroundHandler.instance ?? (BackgroundHandler.instance = new BackgroundHandler(game));
    }
    constructor(game) {
        this.swayVariants = BackgroundHandler.SWAY_SHAPES.slice(0, BackgroundHandler.numOfSwayAnimations).map((_, variant) => `background-tree-sway-${variant}`); //the @keyframes names
        this.treeAspect = null; //width / height of one sprite cell, read from the image once it has loaded
        this.builtWidth = 0;
        this.builtAsNarrow = false;
        this.narrowTrees = []; //under narrowBreakpoint: each tree with its unscaled layout, for applyNarrowScale()
        this.narrowFirstTreeShare = 0; //the first tree's height as a share of the container's width, picked in buildTrees(), so a rescale keeps it
        this.treesEnabled = true;
        this.resizeDebounceTimeout = null;
        this.onResize = () => this.scheduleRebuild();
        this.onSwayCycleEnd = (event) => this.reshuffleTree(event.target);
        this.container = document.createElement('div');
        this.container.classList.add('background-trees-container');
        this.container.style.zIndex = `${BackgroundHandler.treeContainerZIndex}`;
        this.container.addEventListener('animationiteration', this.onSwayCycleEnd);
        document.body.insertAdjacentElement('afterbegin', this.container);
        this.keyframesStyle = document.createElement('style');
        this.keyframesStyle.textContent = this.getSwayKeyframesCSS();
        document.head.appendChild(this.keyframesStyle);
        //never drawn: only here to read the cell's aspect ratio. The trees themselves use the same file as a CSS background
        this.spriteImage = new Image();
        this.spriteImage.onload = () => {
            this.treeAspect = (this.spriteImage.naturalWidth / BackgroundHandler.SPRITE_COLUMNS) / (this.spriteImage.naturalHeight / BackgroundHandler.SPRITE_ROWS);
            this.buildTrees();
        };
        this.spriteImage.src = game.bga.images.getImgUrl(BackgroundHandler.SPRITE_FILE);
        window.addEventListener('resize', this.onResize);
        this.randomizeDrift();
    }
    //once per page load, so the background doesn't always start the same way: a random point in the drift's there-and-back cycle
    //(a negative delay of up to two legs, so it may start on either leg) and a random pattern offset of up to a tile each way.
    //Set whatever the preference says, so a still pattern is offset too; replays get their own random start like any page load
    randomizeDrift() {
        const root = document.documentElement;
        const legDurationMs = BackgroundHandler.parseCSSTime(getComputedStyle(root).getPropertyValue(BackgroundHandler.DRIFT_LEG_DURATION_PROPERTY));
        if (legDurationMs !== null)
            root.style.setProperty(BackgroundHandler.DRIFT_DELAY_PROPERTY, `${-Math.round(Math.random() * 2 * legDurationMs)}ms`);
        root.style.setProperty(BackgroundHandler.DRIFT_OFFSET_X_PROPERTY, Math.random().toFixed(4));
        root.style.setProperty(BackgroundHandler.DRIFT_OFFSET_Y_PROPERTY, Math.random().toFixed(4));
    }
    //a CSS <time> ("20s", "500ms") in ms; null if it can't be read (the stylesheet not loaded), and the drift then starts at 0s
    static parseCSSTime(value) {
        const match = value.trim().match(/^(-?[\d.]+)(m?s)$/);
        if (!match)
            return null;
        const amount = parseFloat(match[1]);
        return isNaN(amount) ? null : (match[2] == 's' ? amount * 1000 : amount);
    }
    //from PrefHandler, on setup and whenever the player changes it. No wind is a class in Game.scss, the same rule as prefers-reduced-motion, which applies whatever this says
    applyTreePreference(value) {
        this.treesEnabled = value != BackgroundHandler.TREES_PREF_NO_TREES;
        this.container.classList.toggle('no-wind', value == BackgroundHandler.TREES_PREF_NO_WIND);
        this.container.style.display = this.treesEnabled ? '' : 'none';
        if (!this.treesEnabled)
            this.container.replaceChildren();
        else if (this.treeAspect !== null && !this.container.hasChildNodes()) //not loaded yet: the sprite's onload builds them
            this.buildTrees();
    }
    //from PrefHandler, on setup and whenever the player changes it. Off is a class on <html> in Game.scss, the same rule as
    //prefers-reduced-motion, which stops the drift whatever this says
    applyDriftPreference(value) {
        document.documentElement.classList.toggle('no-background-drift', value == BackgroundHandler.DRIFT_PREF_OFF);
    }
    destroy() {
        this.spriteImage.onload = null; //the image may still be loading
        window.removeEventListener('resize', this.onResize);
        if (this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);
        this.container.removeEventListener('animationiteration', this.onSwayCycleEnd);
        this.container.remove();
        this.keyframesStyle.remove();
        BackgroundHandler.instance = null;
    }
    getSwayKeyframesCSS() {
        return this.swayVariants.map((variantName, variant) => {
            const keyframes = BackgroundHandler.SWAY_SHAPES[variant].map(([percent, lean]) => `${percent}% { transform: rotate(calc(var(--sway) * ${lean})) skewX(calc(var(--sway) * ${lean * BackgroundHandler.swaySkew})); }`);
            return `@keyframes ${variantName} { ${keyframes.join(' ')} }`;
        }).join('\n');
    }
    isNarrowWidth() { return window.innerWidth < BackgroundHandler.narrowBreakpoint; }
    scheduleRebuild() {
        if (this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => {
            this.resizeDebounceTimeout = null;
            if (this.treeAspect === null) //not loaded yet: the first build will read the new size
                return;
            const crossedBreakpoint = this.isNarrowWidth() !== this.builtAsNarrow;
            const widthChange = Math.abs(window.innerWidth - this.builtWidth) / this.builtWidth;
            if (crossedBreakpoint)
                this.buildTrees();
            else if (this.builtAsNarrow) //the same forest, rescaled to the new width: never a new random one
                this.applyNarrowScale();
            else if (widthChange >= BackgroundHandler.rebuildWidthChange)
                this.buildTrees();
        }, BackgroundHandler.resizeDebounceTime);
    }
    buildTrees() {
        if (!this.treesEnabled)
            return;
        this.builtWidth = window.innerWidth;
        this.builtAsNarrow = this.isNarrowWidth();
        let previousColor = null;
        const trees = this.getTreePlacements().map(placement => {
            previousColor = BackgroundHandler.randomItemExcept(BackgroundHandler.pickableTreeColors, previousColor);
            return { element: this.createTree(placement, previousColor), placement };
        });
        this.container.replaceChildren(...trees.map(tree => tree.element));
        this.narrowTrees = this.builtAsNarrow ? trees : [];
        if (this.builtAsNarrow) {
            this.narrowFirstTreeShare = BackgroundHandler.narrowFirstTreeMaxHeightShare * BackgroundHandler.randomBetween(BackgroundHandler.narrowFirstTreeMinRatio, 1);
            this.applyNarrowScale();
        }
    }
    //under narrowBreakpoint: the desktop forest, starting at the left edge, its span (the right edge of its rightmost-reaching tree) at
    //narrowForestWidthShare of the container's width. The first (tallest) tree is narrowFirstTreeShare of that width tall, the others
    //keep their proportions to it (never wider than the span itself), and the steps shrink or grow by one factor, the largest that
    //keeps every tree's right edge within the span. Whole px from the container's own width (what clips the trees, never a
    //scrollbar), measured on every call, so nothing depends on when the sprite loaded: every tree stays whole, the first at left 0
    applyNarrowScale() {
        const containerWidth = this.container.clientWidth;
        if (!this.treesEnabled || containerWidth <= 0 || this.narrowTrees.length == 0)
            return;
        const span = containerWidth * BackgroundHandler.narrowForestWidthShare;
        const widestTree = Math.max(...this.narrowTrees.map(({ placement }) => placement.width));
        const sizeScale = Math.min(containerWidth * this.narrowFirstTreeShare / this.narrowTrees[0].placement.height, span / widestTree);
        const stepScale = Math.min(...this.narrowTrees.filter(({ placement }) => placement.left > 0).map(({ placement }) => (span - placement.width * sizeScale) / placement.left));
        this.narrowTrees.forEach(({ element, placement }) => {
            const height = Math.round(placement.height * sizeScale);
            element.style.left = `${Math.round(placement.left * stepScale)}px`;
            element.style.width = `${Math.round(height * this.treeAspect)}px`;
            element.style.height = `${height}px`;
            element.style.bottom = `${-Math.round(height * BackgroundHandler.treeSinkRatio)}px`;
        });
    }
    //sizes and places a new forest in the bottom left corner, left to right, heights descending
    getTreePlacements() {
        const { minHeight, maxHeight } = this.getHeightRange();
        const maxNumOfTrees = this.builtAsNarrow ? BackgroundHandler.maxNumOfTreesNarrow : BackgroundHandler.maxNumOfTrees;
        const treeCount = BackgroundHandler.minNumOfTrees + Math.floor(Math.random() * (maxNumOfTrees - BackgroundHandler.minNumOfTrees + 1));
        const rawHeights = Array.from({ length: treeCount }, () => BackgroundHandler.randomBetween(minHeight, maxHeight)).sort((a, b) => b - a);
        //whole px, so the sprite's percentages land on whole pixels too and no neighbouring cell's edge shows through
        const sizes = rawHeights.map(rawHeight => ({ height: Math.round(rawHeight), width: Math.round(rawHeight * this.treeAspect) }));
        const steps = sizes.slice(0, -1).map(size => size.width * (BackgroundHandler.treeSpacing + BackgroundHandler.randomBetween(-BackgroundHandler.spacingJitter, BackgroundHandler.spacingJitter)));
        //squeezed so the last tree's right edge stays within maxSpanOfWidth. Under narrowBreakpoint: no squeeze and no edgeBleed,
        //the first tree at 0; applyNarrowScale() then scales the whole forest down
        const firstLeft = this.builtAsNarrow ? 0 : -sizes[0].width * BackgroundHandler.edgeBleed;
        const room = this.builtWidth * BackgroundHandler.maxSpanOfWidth - sizes[sizes.length - 1].width - firstLeft;
        const totalSteps = steps.reduce((total, step) => total + step, 0);
        const stepScale = !this.builtAsNarrow && totalSteps > room ? Math.max(room, 0) / totalSteps : 1;
        let left = firstLeft;
        return sizes.map((size, index) => {
            if (index > 0)
                left += steps[index - 1] * stepScale;
            return { left, ...size };
        });
    }
    getHeightRange() {
        const maxHeight = Math.min(BackgroundHandler.maxTreeHeight, window.innerHeight * BackgroundHandler.maxTreeHeightOfViewport);
        const minHeight = Math.min(BackgroundHandler.minTreeHeight, maxHeight);
        return { minHeight: Math.max(minHeight, maxHeight / BackgroundHandler.maxHeightRatio), maxHeight };
    }
    //under narrowBreakpoint, applyNarrowScale() replaces the place and size set here
    createTree(placement, color) {
        const tree = document.createElement('div');
        tree.classList.add('background-tree');
        tree.dataset.treeColor = color;
        tree.style.left = `${placement.left / this.builtWidth * 100}%`;
        tree.style.width = `${placement.width}px`;
        tree.style.height = `${placement.height}px`;
        tree.style.zIndex = `${Math.round(BackgroundHandler.maxTreeHeight - placement.height)}`; //taller trees further back
        tree.style.bottom = `${-Math.round(placement.height * BackgroundHandler.treeSinkRatio)}px`; //the rotation's pivot (transform-origin: bottom center) sinks with it, so the trunk's bottom stays below the screen
        const duration = this.applyRandomSway(tree);
        tree.style.animationDelay = `${-Math.random() * duration}s`; //negative: starts mid-cycle, so the trees aren't in sync
        return tree;
    }
    //gives the tree a new variant, strength, duration and easing; returns the duration
    applyRandomSway(tree) {
        const duration = BackgroundHandler.randomBetween(BackgroundHandler.minSwayDuration, BackgroundHandler.maxSwayDuration);
        const strength = BackgroundHandler.randomBetween(BackgroundHandler.minWindStrength, BackgroundHandler.maxWindStrength);
        const direction = Math.random() < 0.5 ? -1 : 1;
        tree.style.setProperty('--sway', `${(strength * direction).toFixed(2)}deg`);
        tree.style.animationName = BackgroundHandler.randomItemExcept(this.swayVariants, tree.style.animationName);
        tree.style.animationDuration = `${duration.toFixed(2)}s`;
        tree.style.animationTimingFunction = BackgroundHandler.randomItemExcept(BackgroundHandler.swayEasings, null);
        return duration;
    }
    //runs as a cycle ends, when the tree is upright and at rest, so nothing jumps. The new variant name starts a fresh animation
    //from its beginning: the delay has to go, or the tree would jump into the middle of its new cycle
    reshuffleTree(tree) {
        if (Math.random() >= BackgroundHandler.animationReshuffleChance)
            return;
        this.applyRandomSway(tree);
        tree.style.animationDelay = '0s';
    }
    static randomBetween(min, max) { return min + Math.random() * (max - min); }
    static randomItemExcept(items, excluded) {
        const candidates = items.filter(item => item !== excluded);
        const pickFrom = candidates.length > 0 ? candidates : items; //a single item left to pick (one tree color not excluded) repeats rather than giving nothing
        return pickFrom[Math.floor(Math.random() * pickFrom.length)];
    }
}
//tree count, picked at random on every build
BackgroundHandler.minNumOfTrees = 4;
BackgroundHandler.maxNumOfTrees = 7;
BackgroundHandler.maxNumOfTreesNarrow = 5; //under narrowBreakpoint: more trees would crowd into the span
//tree height in px, picked per tree; the width follows from the sprite's cell
BackgroundHandler.minTreeHeight = 50;
BackgroundHandler.maxTreeHeight = 156;
BackgroundHandler.maxHeightRatio = 1.95; //the tallest tree is at most this many times the shortest: getHeightRange() raises the min to enforce it
BackgroundHandler.treeSinkRatio = 0.06; //share of a tree's height below the screen's bottom edge, so no gap shows under the trunk as it rotates
BackgroundHandler.narrowBreakpoint = 600; //px of window width, under it the whole forest is scaled down to narrowForestWidthShare (applyNarrowScale())
BackgroundHandler.maxTreeHeightOfViewport = 0.85; //no tree is taller than this share of the window, so a landscape phone doesn't cut the canopies off
//horizontal spacing: the trees stand in the bottom left corner, tallest on the left, each step measured in the width of the tree just placed
BackgroundHandler.maxSpanOfWidth = 0.2; //the trees never reach past this share of the screen's width: the steps are squeezed to fit
BackgroundHandler.narrowForestWidthShare = 0.25; //under narrowBreakpoint: the forest's span, from the left edge to this share of the container's width
BackgroundHandler.narrowFirstTreeMaxHeightShare = 0.184; //under narrowBreakpoint: the first (tallest) tree's height is at most this share of the container's width (69px at 375px); the others keep their proportions to it
BackgroundHandler.narrowFirstTreeMinRatio = 0.8; //and at least this share of that maximum (55px at 375px), picked at random once per build
BackgroundHandler.treeSpacing = 0.9; //step to the next tree when there is room; under 1 neighbours overlap, over 1 there is a gap between them
BackgroundHandler.spacingJitter = 0.15; //random change to each step, added to or taken from treeSpacing
BackgroundHandler.edgeBleed = 0.3; //share of the first tree's width off the left edge of the screen (not under narrowBreakpoint, where every tree is whole)
//wind
BackgroundHandler.minWindStrength = 0.75; //degrees of rotation at peak sway
BackgroundHandler.maxWindStrength = 2.5;
BackgroundHandler.minSwayDuration = 7.5; //seconds per cycle
BackgroundHandler.maxSwayDuration = 11;
BackgroundHandler.numOfSwayAnimations = 8; //baked keyframe variants, at most SWAY_SHAPES.length
BackgroundHandler.animationReshuffleChance = 0.35; //probability a tree switches to a different variant each time its cycle ends
BackgroundHandler.swaySkew = -0.3; //skewX per degree of rotation, the canopy trailing behind the lean (negative skews the same way as the rotation). Follows the wind strength: a weaker wind skews less on its own
//every one eases to a stop on each keyframe, so a tree switching variant at the end of its cycle (at rest, upright) never jerks: no plain 'ease' or 'linear' here
BackgroundHandler.swayEasings = ['ease-in-out', 'cubic-bezier(0.37, 0, 0.63, 1)', 'cubic-bezier(0.45, 0, 0.55, 1)', 'cubic-bezier(0.65, 0, 0.35, 1)'];
//every variant starts and ends upright (lean 0): reshuffleTree() relies on it. A tree's --sway can be negative, which mirrors the shape
BackgroundHandler.SWAY_SHAPES = [
    [[0, 0], [25, 1], [75, -1], [100, 0]], //gentle and symmetric
    [[0, 0], [17, 0.6], [50, -0.6], [83, 0.6], [100, 0]], //gentle and symmetric, smaller and busier
    [[0, 0], [50, 0.8], [100, 0]], //a slow lean and back
    [[0, 0], [25, 1], [100, 0]], //a strong push, a slow return
    [[0, 0], [25, 1], [60, -0.25], [100, 0]], //a strong push, overshooting on the way back
    [[0, 0], [30, 0.3], [50, 1], [80, -0.2], [100, 0]], //a gust building up
    [[0, 0], [25, 1], [40, 0.7], [55, 0.85], [100, 0]], //a strong push, held with a flutter
    [[0, 0], [20, 0.8], [32, 0.45], [44, 0.9], [58, 0.5], [100, 0]], //double flutter
];
//sprite: img/bg_trees.webp, one tree per cell, left to right, top to bottom. These are the data-tree-color values Game.scss places
BackgroundHandler.SPRITE_FILE = 'bg_trees.webp';
BackgroundHandler.SPRITE_COLUMNS = 3;
BackgroundHandler.SPRITE_ROWS = 2;
BackgroundHandler.TREE_COLORS = ['teal', 'yellow', 'green', 'orange', 'pink', 'purple'];
BackgroundHandler.excludedTreeColors = ['yellow']; //sprite cells no tree uses; empty this to bring them back
BackgroundHandler.pickableTreeColors = BackgroundHandler.TREE_COLORS.filter(color => !BackgroundHandler.excludedTreeColors.includes(color));
//stacking and rebuilding
BackgroundHandler.treeContainerZIndex = 0; //like Fugu's background: first in <body>, so all of BGA's positioned content paints over it. Its own stacking context, so a tree's z-index stays inside it
BackgroundHandler.resizeDebounceTime = 250; //ms
BackgroundHandler.rebuildWidthChange = 0.15; //share of the width a resize must change it by to rebuild, so a phone's address bar showing or hiding (height only) or a small drag does nothing. Trees are placed in %, so they follow until then
//the "Background trees" preference (gamepreferences.jsonc): any other value is On
BackgroundHandler.TREES_PREF_NO_WIND = 2;
BackgroundHandler.TREES_PREF_NO_TREES = 3;
//the "Background animation" preference: the pattern on body::before drifts (Game.scss) unless this is set; any other value is On
BackgroundHandler.DRIFT_PREF_OFF = 2;
//custom properties on <html> that Game.scss reads for the drifting pattern: the leg's duration (set there) and the random start (set here)
BackgroundHandler.DRIFT_LEG_DURATION_PROPERTY = '--bg-drift-leg-duration';
BackgroundHandler.DRIFT_DELAY_PROPERTY = '--bg-drift-delay';
BackgroundHandler.DRIFT_OFFSET_X_PROPERTY = '--bg-drift-offset-x';
BackgroundHandler.DRIFT_OFFSET_Y_PROPERTY = '--bg-drift-offset-y';
BackgroundHandler.instance = null; //guards against a second background if the game sets its UI up again

//the shared part of the announcement overlays: a fixed overlay over the whole page (a light dim and an art deco banner at the
//top), centred on the play area, not the whole screen (setPlayAreaBounds). Each subclass plays its own timeline (start()) with
//the helpers here: the player tag (avatar and name), slots laid out in rows like the Last Chance cards, the overlay's fade.
//The theme class (on the overlay) styles the banner and the dim in Game.scss (.last-chance-spotlight, .crash-spotlight). Sizes
//and gaps live in Game.scss; each timeline lives at the top of its subclass.
//play() resolves once everything is gone; the caller then applies the end state. A click or tap on the overlay skips to that
//end at once. Nothing plays in a replay or with animations off (fast replay, instantaneous mode, hidden tab)
class PlayerSpotlightOverlay {
    constructor(game, entries, bannerText, themeClass) {
        this.game = game;
        this.entries = entries;
        this.bannerText = bannerText;
        this.themeClass = themeClass;
        this.animations = [];
        this.finished = false;
        this.resolveSkip = () => { };
    }
    async play() {
        if (this.entries.length === 0 || this.game.isReplay() || !this.game.bga.gameui.bgaAnimationsActive())
            return;
        this.createOverlay();
        const skipped = new Promise(resolve => this.resolveSkip = resolve);
        this.overlay.addEventListener('click', () => this.resolveSkip());
        const timeline = this.start();
        const timeout = new Promise(resolve => setTimeout(resolve, timeline.duration + PlayerSpotlightOverlay.FINISH_SAFETY_MARGIN));
        await Promise.race([timeline.done, skipped, timeout]);
        this.finish();
    }
    //after a skip or at the end, once every animation has stopped and the overlay is gone: the subclass removes its own
    //temporary elements and shows again what it hid
    cleanUp() { }
    //the overlay with its banner and an empty stage for slots, in <body>
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'player-spotlight-overlay ' + this.themeClass;
        this.overlay.innerHTML = `
            <div class="player-spotlight-banner" role="status">
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
                <span class="player-spotlight-banner-text">${this.bannerText}</span>
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
            </div>
            <div class="player-spotlight-stage"></div>
        `;
        this.setPlayAreaBounds();
        this.banner = this.overlay.querySelector('.player-spotlight-banner');
        this.stage = this.overlay.querySelector('.player-spotlight-stage');
        document.body.appendChild(this.overlay);
        this.fitBannerText(); //first: the banner's height, which placeBanner centres, depends on its font size
        this.placeBanner();
    }
    //the banner sits on BGA's status bar, vertically centred on it, when the bar shows in the viewport (in place at the top of the
    //page, or fixed at the top once the page is scrolled). Never under BGA's top bar: pushed down just enough to clear it. With
    //no status bar in sight, just below the top bar (BANNER_TOP_GAP); with neither, Game.scss's default top. The overlay is fixed
    //at the viewport's top-left corner, so these on-screen px are its own
    placeBanner() {
        const topBarRect = PlayerSpotlightOverlay.getShownRect(PlayerSpotlightOverlay.TOP_BAR_SELECTOR);
        const topBarBottom = topBarRect ? Math.max(0, topBarRect.bottom) : 0;
        const statusBarRect = PlayerSpotlightOverlay.getShownRect(PlayerSpotlightOverlay.STATUS_BAR_SELECTOR);
        let top = null;
        if (statusBarRect && statusBarRect.bottom > topBarBottom) { //some of it is in sight, not wholly under the top bar
            top = Math.max(topBarBottom, statusBarRect.top + (statusBarRect.height - this.banner.offsetHeight) / 2);
            this.raiseOverStatusBar(PlayerSpotlightOverlay.STATUS_BAR_SELECTOR);
        }
        else if (topBarRect)
            top = topBarBottom + PlayerSpotlightOverlay.BANNER_TOP_GAP;
        if (top !== null)
            this.banner.style.top = `${top}px`;
    }
    //the element's rect on screen, if it shows and reaches into the viewport
    static getShownRect(selector) {
        const element = document.querySelector(selector);
        if (!element)
            return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const shown = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        return (shown && rect.bottom > 0 && rect.top < window.innerHeight) ? rect : null;
    }
    //the overlay (948 in Game.scss, later in <body>) already paints over BGA's status bar; should BGA ever give the bar a higher
    //z-index, the overlay takes it, and still comes later
    raiseOverStatusBar(selector) {
        const statusBarZIndex = parseInt(getComputedStyle(document.querySelector(selector)).zIndex);
        if (!isNaN(statusBarZIndex) && statusBarZIndex > PlayerSpotlightOverlay.OVERLAY_Z_INDEX)
            this.overlay.style.zIndex = statusBarZIndex.toString();
    }
    //the banner's text never wraps (Game.scss): its side lines shrink first, down to their minimum, and only then, if it still
    //overflows the banner's maximum width (a long translation on a narrow screen), the whole banner's font size comes down to fit
    fitBannerText() {
        for (let pass = 0; pass < PlayerSpotlightOverlay.FIT_PASSES && this.banner.clientWidth > 0; pass++) { //the side lines' minimum doesn't scale, so one pass may fall short
            const overflow = this.banner.scrollWidth / this.banner.clientWidth;
            if (overflow <= 1.01)
                return;
            this.banner.style.fontSize = `${parseFloat(getComputedStyle(this.banner).fontSize) / overflow}px`;
        }
    }
    //the layout's bottom of the banner in viewport px: offsetTop and offsetHeight ignore the banner's own scale and shake
    getBannerBottom() { return this.banner.offsetTop + this.banner.offsetHeight; }
    //the slots and the banner centre on the game's play area (bga.gameArea, beside the player boards and the log on desktop, the
    //whole width on mobile), the part of it inside the viewport, and the slots fit its width (--spotlight-area-width, in
    //Game.scss's card width). Vertically they centre on the viewport. Measured once, as the animation starts
    setPlayAreaBounds() {
        const viewportWidth = document.documentElement.clientWidth; //without a vertical scrollbar
        const areaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
        let left = Math.max(0, areaRect.left);
        let right = Math.min(viewportWidth, areaRect.right);
        if (right - left <= 0) { //off-screen or not laid out: the whole viewport
            left = 0;
            right = viewportWidth;
        }
        this.overlay.style.setProperty('--spotlight-center-x', `${(left + right) / 2}px`);
        this.overlay.style.setProperty('--spotlight-area-width', `${right - left}px`);
    }
    //the slots (already in the page or not) on the stage: 1 to 3 large, 4 to 6 smaller, in one row, or two when one row would
    //make them narrower than --spotlight-min-card-width (4 to 6 on a narrow screen). Each slot is --spotlight-card-width wide
    layOutSlots(slots) {
        const count = slots.length;
        this.overlay.setAttribute('data-size', count <= 3 ? 'large' : 'small');
        this.fillRows(slots, count);
        const minCardWidth = parseFloat(getComputedStyle(this.overlay).getPropertyValue('--spotlight-min-card-width')) || 0;
        const slotWidth = slots[0].getBoundingClientRect().width;
        if (count > 3 && slotWidth < minCardWidth)
            this.fillRows(slots, Math.ceil(count / 2));
        this.fitStageBelowBanner();
    }
    //the slots start below the banner and end above the screen's bottom (STAGE_GAP each side): centred on the viewport when that
    //fits, pushed down when the banner reaches into them, and scaled down (--spotlight-fit-scale on the slots' width) when the
    //space between the banner and the bottom is shorter than they are. Done before anything measures the slots
    fitStageBelowBanner() {
        const viewportHeight = window.innerHeight;
        const top = this.getBannerBottom() + PlayerSpotlightOverlay.STAGE_GAP;
        const bottom = viewportHeight - PlayerSpotlightOverlay.STAGE_GAP;
        const available = bottom - top;
        if (available <= 0)
            return;
        let scale = 1;
        for (let pass = 0; pass < PlayerSpotlightOverlay.FIT_PASSES && this.stage.offsetHeight > available && scale > PlayerSpotlightOverlay.MIN_FIT_SCALE; pass++) {
            scale = Math.max(PlayerSpotlightOverlay.MIN_FIT_SCALE, scale * available / this.stage.offsetHeight);
            this.overlay.style.setProperty('--spotlight-fit-scale', scale.toString());
        }
        const height = this.stage.offsetHeight;
        const center = Math.max(top + height / 2, Math.min(viewportHeight / 2, bottom - height / 2));
        this.stage.style.top = `${center}px`;
    }
    //the slots in rows of perRow; Game.scss sizes them from --spotlight-per-row and data-rows
    fillRows(slots, perRow) {
        this.stage.innerHTML = '';
        const rowCount = Math.ceil(slots.length / perRow);
        this.overlay.style.setProperty('--spotlight-per-row', perRow.toString());
        this.overlay.setAttribute('data-rows', rowCount.toString());
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const row = document.createElement('div');
            row.className = 'player-spotlight-row';
            slots.slice(rowIndex * perRow, (rowIndex + 1) * perRow).forEach(slot => row.appendChild(slot));
            this.stage.appendChild(row);
        }
    }
    //an empty slot in the player's color (--player-color), for the subclass to fill
    createSlot(playerID) {
        const slot = document.createElement('div');
        slot.className = 'player-spotlight-slot';
        slot.style.setProperty('--player-color', this.getPlayerColor(playerID));
        return slot;
    }
    //the player tag: their BGA avatar and their name in their color, on a light pill
    createPlayerTag(playerID) {
        const tag = document.createElement('div');
        tag.className = 'player-spotlight-player';
        tag.style.setProperty('--player-color', this.getPlayerColor(playerID));
        tag.innerHTML = `
            <span class="player-spotlight-avatar"></span>
            ${this.game.divColoredPlayer(playerID, { class: 'playername player-spotlight-name' }, false)}
        `;
        this.game.fillPlayerAvatar(tag.querySelector('.player-spotlight-avatar'), playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return tag;
    }
    getPlayerColor(playerID) { return '#' + (this.game.getPlayerColor(playerID) ?? '000000'); }
    //the dim and the banner fade in (fadeInMs), stay, and fade out from fadeOutStart (fadeOutMs); then the overlay goes, so it no
    //longer catches clicks. Resolves when it has faded out (or at once, after a skip)
    animateOverlay(fadeInMs, fadeOutStart, fadeOutMs) {
        const duration = fadeOutStart + fadeOutMs;
        const overlayAnimation = this.overlay.animate([
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: fadeInMs / duration },
            { opacity: 1, offset: fadeOutStart / duration },
            { opacity: 0, offset: 1 },
        ], { duration: duration, fill: 'forwards' });
        this.animations.push(overlayAnimation);
        return overlayAnimation.finished.then(() => this.overlay.remove()).catch(() => { }); //cancelled by a skip, which removes it itself
    }
    //an animation stopped by a skip (cancelled) resolves too, instead of rejecting
    static whenFinished(animation) {
        return animation.finished.then(() => { }).catch(() => { });
    }
    //the end, reached or skipped: every animation stops, the overlay goes, then the subclass's own clean-up (the caller applies the
    //end state right after, in the same task, so nothing paints in between)
    finish() {
        if (this.finished)
            return;
        this.finished = true;
        this.animations.forEach(animation => animation.cancel());
        this.overlay.remove();
        this.cleanUp();
    }
}
PlayerSpotlightOverlay.FINISH_SAFETY_MARGIN = 1000; //ms past the timeline's end after which play() resolves anyway (a hidden tab's throttled animations)
PlayerSpotlightOverlay.TOP_BAR_SELECTOR = '#topbar'; //BGA's top bar: the banner never goes under it (on mobile it paints over everything)
PlayerSpotlightOverlay.STATUS_BAR_SELECTOR = '#page-title'; //BGA's status bar, the same element when BGA fixes it at the top once the page is scrolled: the banner sits on it
PlayerSpotlightOverlay.OVERLAY_Z_INDEX = 948; //Game.scss's, BGA's status bar's: the overlay comes later in <body>, so it paints over the bar
PlayerSpotlightOverlay.BANNER_TOP_GAP = 10; //px between BGA's top bar and the banner, when there is no status bar in sight to sit on
PlayerSpotlightOverlay.STAGE_GAP = 12; //px kept between the banner and the slots, and between the slots and the screen's bottom
PlayerSpotlightOverlay.MIN_FIT_SCALE = 0.35; //the slots never shrink below this share of their size to fit between the banner and the bottom
PlayerSpotlightOverlay.FIT_PASSES = 4; //measure and shrink passes, for the slots and the banner's text (parts of each don't shrink, so one pass falls short)

//[BGA] every Last Chance of a reveal (Game.notif_lastChanceAnimation): each entry's element is the player's Last Chance card on
//their board. A copy of it flies to the middle of the play area, grows, holds under the player's avatar and name, flies back
//and fades out there; the board card waits hidden meanwhile. Shown in one row of slots (two for 4 to 6 on a narrow screen)
class LastChanceSpotlight extends PlayerSpotlightOverlay {
    constructor(game, entries) {
        super(game, entries, _('Last Chance!'), 'last-chance-spotlight');
        this.clones = [];
    }
    start() {
        const slots = this.entries.map(entry => this.createCardSlot(entry.playerID));
        this.layOutSlots(slots);
        const slotPlaces = slots.map(slot => slot.querySelector('.player-spotlight-card-place'));
        const count = this.entries.length;
        const holdDuration = LastChanceSpotlight.HOLD_DURATION + (count - 1) * LastChanceSpotlight.CARD_STAGGER; //every copy holds as long, so they come back in the order they came
        const cardDuration = LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION + LastChanceSpotlight.BOARD_HOLD_DURATION + LastChanceSpotlight.BOARD_FADE_DURATION;
        //the overlay fades out while the cards fly back, so it no longer catches clicks while the copies fade out on the boards
        this.animateOverlay(LastChanceSpotlight.OVERLAY_FADE_IN_DURATION, LastChanceSpotlight.CARD_IN_DURATION + holdDuration, LastChanceSpotlight.CARD_OUT_DURATION);
        const cardFlights = this.entries.map((entry, index) => this.animateCard(entry.element, slotPlaces[index], index, holdDuration, cardDuration));
        this.animatePlayers();
        return { done: Promise.all(cardFlights).then(() => { }), duration: (count - 1) * LastChanceSpotlight.CARD_STAGGER + cardDuration };
    }
    //the player's tag above an empty place the card's size
    createCardSlot(playerID) {
        const slot = this.createSlot(playerID);
        slot.appendChild(this.createPlayerTag(playerID));
        slot.insertAdjacentHTML('beforeend', '<div class="player-spotlight-card-place"></div>');
        return slot;
    }
    //each player's avatar and name come in as their card arrives
    animatePlayers() {
        this.overlay.querySelectorAll('.player-spotlight-player').forEach((player, index) => {
            this.animations.push(player.animate([
                { opacity: 0, translate: '0px 6px' },
                { opacity: 1, translate: '0px 0px' },
            ], { duration: LastChanceSpotlight.PLAYER_FADE_IN_DURATION, delay: index * LastChanceSpotlight.CARD_STAGGER + LastChanceSpotlight.CARD_IN_DURATION / 2, easing: 'ease-out', fill: 'backwards' }));
        });
    }
    //one copy's whole trip in one animation: board → place (CARD_IN), hold, place → board (CARD_OUT), stay, fade out. The copy is
    //made at the place's size, so it is crisp while it holds, and the transform scales it down to the board card at both ends.
    //Its start is measured now, before the board card is hidden (it doesn't move meanwhile)
    animateCard(element, place, index, holdDuration, duration) {
        const boardRect = element.getBoundingClientRect();
        const placeRect = place.getBoundingClientRect();
        const startRect = (boardRect.width > 0 && boardRect.height > 0) ? boardRect : new DOMRect(placeRect.left + placeRect.width / 2, placeRect.top + placeRect.height / 2, 0, 0); //no board card on screen (display: none): it grows from the place's middle
        const clone = this.game.createSlidingClone(element);
        clone.classList.add('player-spotlight-card');
        clone.style.setProperty('--my-card-width', `${placeRect.width / LastChanceSpotlight.getZoom(clone)}px`);
        this.clones.push(clone);
        element.style.visibility = 'hidden';
        const transformOnto = this.game.getSlidingCloneTransform(clone);
        const arrived = LastChanceSpotlight.CARD_IN_DURATION / duration;
        const leaving = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration) / duration;
        const back = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION) / duration;
        const fading = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION + LastChanceSpotlight.BOARD_HOLD_DURATION) / duration;
        const flight = clone.animate([
            { transform: transformOnto(startRect), opacity: 1, offset: 0, easing: LastChanceSpotlight.CARD_IN_EASING },
            { transform: transformOnto(placeRect), opacity: 1, offset: arrived, easing: 'linear' },
            { transform: transformOnto(placeRect), opacity: 1, offset: leaving, easing: LastChanceSpotlight.CARD_OUT_EASING },
            { transform: transformOnto(startRect), opacity: 1, offset: back, easing: 'linear' },
            { transform: transformOnto(startRect), opacity: 1, offset: fading, easing: 'ease' },
            { transform: transformOnto(startRect), opacity: 0, offset: 1 },
        ], { duration: duration, delay: index * LastChanceSpotlight.CARD_STAGGER, fill: 'both' });
        this.animations.push(flight);
        return PlayerSpotlightOverlay.whenFinished(flight);
    }
    //the copy's measured zoom (it lives in <body>, outside BGA's mobile scaling), to turn on-screen px into its own px
    static getZoom(element) {
        const cssWidth = parseFloat(getComputedStyle(element).width);
        return (cssWidth > 0) ? element.getBoundingClientRect().width / cssWidth : 1;
    }
    //the copies go and the board cards show again
    cleanUp() {
        this.clones.forEach(clone => clone.remove());
        this.entries.forEach(entry => entry.element.style.removeProperty('visibility'));
    }
}
LastChanceSpotlight.OVERLAY_FADE_IN_DURATION = 250; //ms the dim and the banner take to appear
LastChanceSpotlight.CARD_IN_DURATION = 550; //ms each copy takes from its player board to the middle of the screen
LastChanceSpotlight.CARD_IN_EASING = 'ease-out';
LastChanceSpotlight.CARD_STAGGER = 120; //ms between two copies leaving their boards (and again between two coming back)
LastChanceSpotlight.HOLD_DURATION = 1300; //ms every copy stays still in the middle, counted from the last one's arrival
LastChanceSpotlight.CARD_OUT_DURATION = 550; //ms each copy takes back to its player board, shrinking to the board card's size
LastChanceSpotlight.CARD_OUT_EASING = 'ease-in-out';
LastChanceSpotlight.BOARD_HOLD_DURATION = 100; //ms a copy stays fully shown on the board before it fades (like Game.BOARD_ARRIVAL_HOLD)
LastChanceSpotlight.BOARD_FADE_DURATION = 400; //ms it then fades out there
LastChanceSpotlight.PLAYER_FADE_IN_DURATION = 250; //ms a player's avatar and name take to appear, as their card arrives

//[BGA] every crash of a reveal (Game.notif_crashAnimation), under a "Crashed!" banner (.crash-spotlight). Each crashed player's
//column animates where it is, nothing scrolls: a red glow on its border and one short shake, their avatar and name just
//above it, then its cards tumble (a random turn, a small drop, a fade), last card first. A column that isn't on screen also
//gets a large tile with the avatar and name in the middle of the play area, laid out like the Last Chance cards. Players
//start PLAYER_STAGGER apart. The caller discards the cards at the end (the tumbled cards stay hidden until then)
class CrashSpotlight extends PlayerSpotlightOverlay {
    constructor(game, entries) {
        super(game, entries, _('Crashed!'), 'crash-spotlight');
    }
    start() {
        //measured before anything moves: which columns are on screen, and where to put their tags
        const areaRects = this.entries.map(entry => entry.element.getBoundingClientRect());
        const onScreen = areaRects.map(rect => CrashSpotlight.isOnScreen(rect));
        const offScreenTiles = [];
        const offScreenIndexes = [];
        this.entries.forEach((entry, index) => {
            if (onScreen[index])
                this.addAreaTag(entry.playerID, areaRects[index], index);
            else {
                offScreenTiles.push(this.createTileSlot(entry.playerID));
                offScreenIndexes.push(index);
            }
        });
        if (offScreenTiles.length > 0) {
            this.layOutSlots(offScreenTiles);
            offScreenTiles.forEach((slot, tileIndex) => this.fadeIn(slot.querySelector('.player-spotlight-tile'), offScreenIndexes[tileIndex]));
        }
        let lastCardGone = 0;
        this.entries.forEach((entry, index) => {
            const delay = index * CrashSpotlight.PLAYER_STAGGER;
            this.animateArea(entry.element, delay);
            lastCardGone = Math.max(lastCardGone, delay + CrashSpotlight.AREA_FLASH_DURATION);
            for (let cards of entry.cardGroups) {
                cards.forEach((card, cardIndex) => this.tumbleCard(card, delay + CrashSpotlight.TUMBLE_START + cardIndex * CrashSpotlight.CARD_TUMBLE_STAGGER));
                if (cards.length > 0)
                    lastCardGone = Math.max(lastCardGone, delay + CrashSpotlight.TUMBLE_START + (cards.length - 1) * CrashSpotlight.CARD_TUMBLE_STAGGER + CrashSpotlight.CARD_TUMBLE_DURATION);
            }
        });
        const fadeOutStart = lastCardGone + CrashSpotlight.HOLD_DURATION;
        const done = this.animateOverlay(CrashSpotlight.OVERLAY_FADE_IN_DURATION, fadeOutStart, CrashSpotlight.OVERLAY_FADE_OUT_DURATION);
        return { done: done, duration: fadeOutStart + CrashSpotlight.OVERLAY_FADE_OUT_DURATION };
    }
    //enough of the column inside the viewport, on both axes, to see it animate
    static isOnScreen(rect) {
        if (rect.width <= 0 || rect.height <= 0)
            return false;
        const visibleWidth = Math.min(rect.right, document.documentElement.clientWidth) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        return visibleWidth > 0 && visibleHeight >= rect.height * CrashSpotlight.MIN_VISIBLE_SHARE;
    }
    //the player's tag just above their column, centred on it and kept inside the viewport (the overlay is fixed over the whole
    //viewport, so its children are placed in viewport px). Below the banner when the column starts higher than that
    addAreaTag(playerID, areaRect, index) {
        const tag = this.createPlayerTag(playerID);
        tag.classList.add('player-spotlight-area-tag');
        this.overlay.appendChild(tag);
        const tagRect = tag.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const centeredLeft = areaRect.left + (areaRect.width - tagRect.width) / 2;
        tag.style.left = `${Math.max(4, Math.min(centeredLeft, viewportWidth - tagRect.width - 4))}px`;
        tag.style.top = `${Math.max(this.getBannerBottom() + CrashSpotlight.TAG_GAP, areaRect.top - CrashSpotlight.TAG_GAP - tagRect.height)}px`; //never over the banner
        this.fadeIn(tag, index);
    }
    //a column off screen: a large tile with the avatar and the name, in the middle of the play area
    createTileSlot(playerID) {
        const slot = this.createSlot(playerID);
        slot.innerHTML = `
            <div class="player-spotlight-tile">
                <span class="player-spotlight-avatar"></span>
                ${this.game.divColoredPlayer(playerID, { class: 'playername player-spotlight-name' }, false)}
            </div>
        `;
        this.game.fillPlayerAvatar(slot.querySelector('.player-spotlight-avatar'), playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return slot;
    }
    //a tag or a tile comes in with its player's turn
    fadeIn(element, index) {
        this.animations.push(element.animate([
            { opacity: 0, translate: '0px 6px' },
            { opacity: 1, translate: '0px 0px' },
        ], { duration: CrashSpotlight.TAG_FADE_IN_DURATION, delay: index * CrashSpotlight.PLAYER_STAGGER, easing: 'ease-out', fill: 'backwards' }));
    }
    //the column, where it is: a red glow on its border (box-shadow, up and down) and one short shake (translate), together
    animateArea(area, delay) {
        const noGlow = `0 0 0 0px rgba(217, 72, 59, 0), 0 0 0px 0px rgba(217, 72, 59, 0)`;
        const glow = `0 0 0 3px ${CrashSpotlight.GLOW_COLOR}, 0 0 22px 6px ${CrashSpotlight.GLOW_HALO_COLOR}`;
        this.animations.push(area.animate([
            { boxShadow: noGlow, offset: 0 },
            { boxShadow: glow, offset: 0.2 },
            { boxShadow: glow, offset: 0.45 },
            { boxShadow: noGlow, offset: 1 },
        ], { duration: CrashSpotlight.AREA_FLASH_DURATION, delay: delay, easing: 'ease-out' }));
        const distance = CrashSpotlight.AREA_SHAKE_DISTANCE;
        this.animations.push(area.animate([
            { translate: '0px 0px' },
            { translate: `${-distance}px 0px` },
            { translate: `${distance}px 0px` },
            { translate: `${-distance * 0.6}px 0px` },
            { translate: `${distance * 0.6}px 0px` },
            { translate: `${-distance * 0.25}px 0px` },
            { translate: '0px 0px' },
        ], { duration: CrashSpotlight.AREA_SHAKE_DURATION, delay: delay, easing: 'ease-in-out' }));
    }
    //a card turns a random amount either way, drops a little and fades out, then stays hidden (fill forwards) until the caller
    //discards it. rotate and translate are their own properties, so a hand card's transform (its lift) is untouched
    tumbleCard(card, delay) {
        const rotation = (Math.random() * 2 - 1) * CrashSpotlight.CARD_TUMBLE_MAX_ROTATION;
        this.animations.push(card.animate([
            { rotate: '0deg', translate: '0px 0px', opacity: 1 },
            { rotate: `${rotation}deg`, translate: `0px ${CrashSpotlight.CARD_TUMBLE_DROP}px`, opacity: 0 },
        ], { duration: CrashSpotlight.CARD_TUMBLE_DURATION, delay: delay, easing: CrashSpotlight.CARD_TUMBLE_EASING, fill: 'forwards' }));
    }
}
CrashSpotlight.OVERLAY_FADE_IN_DURATION = 150; //ms the dim and the banner take to appear (the banner's slam and shake are in Game.scss)
CrashSpotlight.PLAYER_STAGGER = 100; //ms between two crashed players' animations
CrashSpotlight.AREA_FLASH_DURATION = 750; //ms of the red glow on the column's border, up and down
CrashSpotlight.AREA_SHAKE_DURATION = 400; //ms of the column's one short shake, with the glow
CrashSpotlight.AREA_SHAKE_DISTANCE = 6; //px of the shake's widest swing (in the column's own px)
CrashSpotlight.TAG_FADE_IN_DURATION = 250; //ms the avatar and name above the column (or the off-screen tile) take to appear
CrashSpotlight.TAG_GAP = 6; //px between the tag and the top of the column
CrashSpotlight.TUMBLE_START = 400; //ms after a player's start their cards begin to tumble (once the shake is over)
CrashSpotlight.CARD_TUMBLE_DURATION = 520; //ms each card takes to turn, drop and fade out
CrashSpotlight.CARD_TUMBLE_STAGGER = 50; //ms between two cards of a group starting to tumble
CrashSpotlight.CARD_TUMBLE_EASING = 'ease-in';
CrashSpotlight.CARD_TUMBLE_MAX_ROTATION = 15; //degrees, either way, at random per card
CrashSpotlight.CARD_TUMBLE_DROP = 28; //px each card drops (in its own px)
CrashSpotlight.HOLD_DURATION = 500; //ms everything stays once the last card is gone, before the overlay fades out
CrashSpotlight.OVERLAY_FADE_OUT_DURATION = 300; //ms the dim, the banner, the tags and the tiles take to fade out
CrashSpotlight.MIN_VISIBLE_SHARE = 0.4; //a column with less than this share of its height in the viewport counts as off screen (it gets a tile)
CrashSpotlight.GLOW_COLOR = 'rgba(217, 72, 59, 0.9)'; //the banner's red (#d9483b)
CrashSpotlight.GLOW_HALO_COLOR = 'rgba(217, 72, 59, 0.6)';

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
        this.startTokenFlight = Promise.resolve(); //the Start token's pass, flying alongside the notifications after it
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
        this.bga.states.register('gameEnd', new GameEnd(this, bga));
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
        this.backgroundHandler = BackgroundHandler.getInstance(this);
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
            const { name, color, player_no, hand_count, round_status, last_chance_used, score } = this.gamedatas.players[player_id];
            const playedCardsData = gamedatas.cardsPlayed[parseInt(player_id)] || [];
            this.players[player_id] = new PlayerHandler(this, parseInt(player_id), name, color, player_no, hand_count, round_status, last_chance_used, playedCardsData, Number(score));
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
        this.undoHandler = new UndoHandler(this);
        this.tooltipHandler = new TooltipHandler(this);
        this.prefHandler = new PrefHandler(this, gamedatas.pref_names);
        this.addExpertModeIndicator();
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
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'LAST_CHANCE_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR',
                    'DIE_RESERVED_POWER2_LOG_STR', 'GOLDEN_DIE_POWER11_LOG_STR', 'DIE_MODIFIED_POWER9_LOG_STR', 'CARDS_SWAPPED_POWER10_LOG_STR', 'CARDS_REDRAWN_POWER10_LOG_STR', 'POWER_SKIPPED_LOG_STR', 'GAME_END_LOG_STR'];
                for (let key of keys) {
                    if (key in args) {
                        if (key == 'NEW_ROUND_LOG_STR')
                            log = this.logMutationObserver.createLogNewRound(args['round_number']).log_html;
                        else if (key == 'DICE_ROLLED_LOG_STR')
                            log = this.logMutationObserver.createLogDiceRolled(args['dice'], args['first_roll_of_round'] ?? false).log_html;
                        else if (key == 'REVEAL_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRevealed(args['reveals']).log_html;
                        else if (key == 'LAST_CHANCE_LOG_STR')
                            log = this.logMutationObserver.createLogLastChanceUsed(args['player_id']).log_html;
                        else if (key == 'CRASH_LOG_STR')
                            log = this.logMutationObserver.createLogPlayerCrashed(args['player_id']).log_html;
                        else if (key == 'GRAND_SLAM_LOG_STR')
                            log = this.logMutationObserver.createLogGrandSlam(args['player_id']).log_html;
                        else if (key == 'START_TOKEN_LOG_STR')
                            log = this.logMutationObserver.createLogStartTokenPassed(args['player_id']).log_html;
                        else if (key == 'STOP_OR_MORE_LOG_STR') {
                            console.log('[TEMP stopOrMore] log args', JSON.parse(JSON.stringify(args))); //TEMP: remove once the banked stars show
                            //rows logged before rows existed carry choices (and banked, for a while) instead
                            const rows = args['rows'] ?? Object.keys(args['choices'] ?? {}).map(player_id => ({ player_id: Number(player_id), choice: args['choices'][player_id], stars: args['banked']?.[player_id]?.stars }));
                            log = this.logMutationObserver.createLogStopOrMoreRevealed(rows).log_html;
                        }
                        else if (key == 'DIE_RESERVED_POWER2_LOG_STR')
                            log = this.logMutationObserver.createLogDieReservedPOWER2(args['player_id'], args['die']).log_html;
                        else if (key == 'GOLDEN_DIE_POWER11_LOG_STR')
                            log = this.logMutationObserver.createLogGoldenDiePOWER11(args['player_id']).log_html;
                        else if (key == 'DIE_MODIFIED_POWER9_LOG_STR')
                            log = this.logMutationObserver.createLogDieModifiedPOWER9(args['player_id'], args['card'] ?? null, args['die_color'], args['old_value'], args['new_value'], args['move_id']).log_html;
                        else if (key == 'CARDS_SWAPPED_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsSwappedPOWER10(args['owner_id'], args['target_id'], args['_private']?.['owner_gives'] ?? null, args['_private']?.['target_gives'] ?? null, args['count']).log_html;
                        else if (key == 'CARDS_REDRAWN_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRedrawnPOWER10(args['player_id'], args['_private']?.['discarded'] ?? null, args['_private']?.['drawn'] ?? null, args['count']).log_html;
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
    //`from` can also be a DOMRect on screen, for a start point with no element (the new hand's deal starts off the page).
    //With options.keepSize, the copy keeps element's size the whole way and starts centered on `from`.
    //With options.boardEnd, `from` is on a player board (a mini card back or an avatar): the copy starts there at
    //BOARD_CARD_SCALE of element's size and grows to full size on the way.
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    async animateSlide(element, from, to, durationMs, options = {}) {
        const fromRect = this.getSlideSourceRect(from); //before element moves: from may be element itself
        const slidingClone = this.createSlidingClone(element);
        element.style.visibility = 'hidden';
        if (to)
            to.appendChild(element);
        const toRect = element.getBoundingClientRect();
        let startRect = fromRect;
        if (options.boardEnd)
            startRect = Game.getBoardCardRect(fromRect, toRect);
        else if (options.keepSize)
            startRect = Game.getCenteredRect(fromRect, toRect.width, toRect.height);
        await this.moveSlidingClone(slidingClone, startRect, toRect, durationMs, options);
        element.style.visibility = null;
    }
    //the other way round: a copy of element flies from where element is now to toRect on screen, then disappears.
    //Element itself is left alone and can be removed as soon as this is called (the old hand's sweep at a new round).
    //With options.keepSize, the copy keeps element's size and lands centered on toRect; with options.boardEnd, toRect is on
    //a player board and the copy shrinks to BOARD_CARD_SCALE on the way; with options.fadeOutMs, it fades out once there.
    //The copy shows at the opacity element shows at (a stopped column's dimmed cards), which it doesn't inherit in <body>
    async animateSlideAway(element, toRect, durationMs, options = {}) {
        const fromRect = element.getBoundingClientRect();
        const shownOpacity = Game.getShownOpacity(element);
        const slidingClone = this.createSlidingClone(element);
        if (shownOpacity < 1)
            slidingClone.style.opacity = shownOpacity.toString();
        let endRect = toRect;
        if (options.boardEnd)
            endRect = Game.getBoardCardRect(toRect, fromRect, options.stackIndex);
        else if (options.keepSize)
            endRect = Game.getCenteredRect(toRect, fromRect.width, fromRect.height);
        await this.moveSlidingClone(slidingClone, fromRect, endRect, durationMs, options);
    }
    //cards leaving the game (a new round, a crash, a card 10 redraw): each card is lifted out as a copy at its place on
    //screen, and the copies slide up-left along CARD_SWEEP_ANGLE, at their size, until they are off the screen's left
    //side, then go. They leave in
    //the order given, staggerMs apart; every copy is placed at once, so the cards can be removed as soon as this
    //is called. No copies with animations off (fast replay, hidden tab)
    async sweepCardsOffScreen(cards, durationMs = Game.CARD_SWEEP_DURATION, staggerMs = Game.CARD_SWEEP_STAGGER) {
        if (!this.bga.gameui.bgaAnimationsActive())
            return;
        await Promise.all(cards.map((card, index) => {
            const offScreenRect = Game.getOffScreenUpLeftRect(card.getBoundingClientRect());
            return this.animateSlideAway(card, offScreenRect, durationMs, { easing: Game.CARD_SWEEP_EASING, delayMs: index * staggerMs });
        }));
    }
    //where a card on screen (cardRect) leaves for in a sweep, or comes from in a deal: up-left along CARD_SWEEP_ANGLE, so for
    //dx px left it also goes dx * tan(angle) px up. dx is at least minDistance and always takes the card wholly past the
    //screen's left edge, so it is out of view at that end whatever its height (a card near the top goes above the screen
    //too, which changes nothing: past the left edge is enough)
    static getOffScreenUpLeftRect(cardRect, minDistance = 0) {
        const dx = Math.max(minDistance, cardRect.right + Game.OFF_SCREEN_MARGIN);
        const dy = dx * Math.tan(Game.CARD_SWEEP_ANGLE * Math.PI / 180);
        return new DOMRect(cardRect.left - dx, cardRect.top - dy, cardRect.width, cardRect.height);
    }
    //a width x height rect on screen, centered on rect
    static getCenteredRect(rect, width, height) {
        return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
    }
    //a card's rect at the player board end of a slide: BOARD_CARD_SCALE of its full size (cardRect), centered on boardRect,
    //wholly inside the viewport. The base is clamped before the stack offset, so a stack against the top or left edge still
    //fans out; clamping again keeps its last cards in view against the bottom or right edge
    static getBoardCardRect(boardRect, cardRect, stackIndex = 0) {
        const centeredRect = Game.getCenteredRect(boardRect, cardRect.width * Game.BOARD_CARD_SCALE, cardRect.height * Game.BOARD_CARD_SCALE);
        return Game.clampToViewport(Game.getStackedRect(Game.clampToViewport(centeredRect), stackIndex));
    }
    //rect moved, not resized, to be wholly on screen. clientWidth leaves out a vertical scrollbar, which innerWidth counts
    static clampToViewport(rect) {
        const left = Math.max(0, Math.min(rect.left, document.documentElement.clientWidth - rect.width));
        const top = Math.max(0, Math.min(rect.top, window.innerHeight - rect.height));
        return new DOMRect(left, top, rect.width, rect.height);
    }
    //element's own opacity times its ancestors'
    static getShownOpacity(element) {
        let opacity = 1;
        for (let node = element; node && node !== document.body; node = node.parentElement)
            opacity *= parseFloat(getComputedStyle(node).opacity);
        return opacity;
    }
    createSlidingClone(element) {
        const slidingClone = element.cloneNode(true);
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        slidingClone.style.removeProperty('visibility'); //element may already wait hidden in its slot (the new hand's deal)
        document.body.appendChild(slidingClone);
        return slidingClone;
    }
    //moves the copy from fromRect to toRect (both on screen), after options.delayMs at its start, fades it out there if
    //options.fadeOutMs (after options.holdMs of stillness), then removes it
    async moveSlidingClone(slidingClone, fromRect, toRect, durationMs, options) {
        const { easing = Game.CARD_SLIDE_EASING, delayMs = 0, holdMs = 0, fadeOutMs = 0 } = options;
        const transformOnto = this.getSlidingCloneTransform(slidingClone);
        slidingClone.style.transform = transformOnto(fromRect);
        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in
        slidingClone.style.transition = `transform ${durationMs}ms ${easing} ${delayMs}ms`;
        slidingClone.style.transform = transformOnto(toRect);
        await this.bga.gameui.wait(delayMs + durationMs);
        if (holdMs > 0)
            await this.bga.gameui.wait(holdMs);
        if (fadeOutMs > 0) {
            slidingClone.style.transition = `opacity ${fadeOutMs}ms ease`;
            slidingClone.style.opacity = '0';
            await this.bga.gameui.wait(fadeOutMs);
        }
        slidingClone.remove();
    }
    //returns the transform that puts the copy (a fresh createSlidingClone, untransformed) onto an on-screen rect: scaled to
    //rect's height (cards and the token keep their aspect) and centered on rect, so a source wider than the copy, like a row
    //of mini card backs, still sends it off from its middle. The copy converts screen px with its own measured zoom
    getSlidingCloneTransform(slidingClone) {
        const baseRect = slidingClone.getBoundingClientRect(); //on screen, untransformed at the viewport's top-left corner
        const cssWidth = parseFloat(getComputedStyle(slidingClone).width); //unrounded, unlike offsetWidth
        const zoom = (cssWidth > 0) ? baseRect.width / cssWidth : 1;
        return (rect) => {
            const scale = (baseRect.height > 0) ? rect.height / baseRect.height : 1;
            const left = rect.left + (rect.width - baseRect.width * scale) / 2;
            return `translate(${(left - baseRect.left) / zoom}px, ${(rect.top - baseRect.top) / zoom}px) scale(${scale})`;
        };
    }
    //a player board's hand count is a row of mini card backs: a card leaving it starts from the top one
    getSlideSourceRect(from) {
        if (from instanceof DOMRect)
            return from;
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
        this.tooltipHandler?.syncCardPowersDisplay();
        for (let player_id in this.players) {
            this.players[player_id].updateLastChanceInset();
            this.players[player_id].updateStartTokenPlace();
            this.players[player_id].updateEndGameScoreHighlight(); //after BGA has finished laying out the player panels
        }
    }
    isDesktop() { return document.body.classList.contains('desktop_version'); }
    isMobile() { return document.body.classList.contains('mobile_version'); }
    isTouchOrMobile() { return this.isMobile() || window.matchMedia('(hover: none)').matches; } //BGA's mobile layout, or a device that can't hover (a tablet in the desktop layout). Not BGA's touch-device class, which a touch laptop with a mouse has too
    isReplay() { return typeof g_replayFrom != 'undefined' || g_archive_mode; } //"replay from this move" in an ongoing game, or an archived game
    isInterfaceLocked() { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    updateStatusText(statusText) { $('gameaction_status').innerHTML = statusText; $('pagemaintitletext').innerHTML = statusText; }
    //power prompts (cards 1, 9, 10, 11): "may use" + the circular card icon of the card that gave the power, followed by
    //its power icon (like "Play [card]?"). setTitle substitutes its args as raw HTML (Fugu's pass button slot uses the
    //same), so the translatable string only holds the ${card} placeholder. The details live in the icons' power tooltip
    setPowerPromptTitle(powerCard, isCurrentPlayerActive) {
        this.bga.statusBar.setTitle(isCurrentPlayerActive ? _('${you} may use ${card}') : _('${actplayer} may use ${card}'), { card: this.getStatusCardWithPowerHTML(powerCard) });
        this.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
    }
    //the circular card icon of status bar titles: a ring in the card's color around its number. The number is drawn from
    //img/card_icon_numbers.webp, so screen readers (and copy-paste) get the visually hidden text instead. The id and the
    //power-card-POWER<n> class let TooltipHandler.addTooltipsToCardsIn give it the same power tooltip as the log mini cards
    getStatusCardIconHTML(card) {
        if (!card)
            return '';
        const cardText = _('${value} ${color}').replace('${value}', card.value.toString()).replace('${color}', this.getColorName(card.color));
        const powerClass = POWER_CARD_VALUES.includes(card.value) ? ' ' + TooltipHandler.getPowerCardClass(card.value) : '';
        const iconID = 'an-id-required-for-tooltips-' + this.localCardIDCounter;
        this.localCardIDCounter++;
        return `<span id="${iconID}" class="status-card-icon${powerClass}" data-color="${card.color}" data-value="${card.value}"><span class="status-card-icon-number" aria-hidden="true"></span><span class="status-card-icon-text">${cardText}</span></span>`;
    }
    //the bank icon (Font Awesome 6's coins, BGA's fa6 fa6-<name>) of the "Stop and bank" button, the Stop/More log row and the
    //banked column badge, the one source for all three. className is the place's class (button-bank-icon, log-bank-icon,
    //played-column-bank-icon), which Game.scss sizes and colors
    getBankIconHtml(className) {
        return `<i class="fa6 fa6-coins ${className}" aria-hidden="true"></i>`;
    }
    //the circular card icon (getStatusCardIconHTML) at text size, to sit inline in a sentence (tooltips), sized by .inline-card-icon
    getInlineCardIconHTML(color, value) {
        return `<span class="inline-card-icon">${this.getStatusCardIconHTML({ card_id: null, color: color, value: value })}</span>`;
    }
    //the circular card icon with, for a card with a power (1, 2, 9, 10, 11), that power's badge attached to its right edge
    //(getPowerBadgeHTML), so the two read as one icon. Both sit in one .status-card-with-power, which keeps them on the same
    //line; Game.scss sizes the badge from the card icon wherever the pair sits (card-power-badge mixin). Cards without a power
    //get the card icon alone
    getStatusCardWithPowerHTML(card) {
        if (!card || !POWER_CARD_VALUES.includes(card.value))
            return this.getStatusCardIconHTML(card);
        return `<span class="status-card-with-power">${this.getStatusCardIconHTML(card)}${this.getPowerBadgeHTML(card.value)}</span>`;
    }
    //a power's icon (the power reference's .power-icon) in a small square cream badge. The badge gets its own id and the
    //power-card-POWER<n> class, so addTooltipsToCardsIn gives the whole badge that power's tooltip
    getPowerBadgeHTML(value) {
        const badgeID = 'an-id-required-for-tooltips-' + this.localCardIDCounter;
        this.localCardIDCounter++;
        return `<span id="${badgeID}" class="card-power-badge ${TooltipHandler.getPowerCardClass(value)}" data-power-value="${value}" aria-hidden="true"><span class="power-icon" data-power-value="${value}"></span></span>`;
    }
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
    getWinningScore() { return this.gamedatas.winningScore; }
    isExpertMode() { return !!this.gamedatas.expertMode; } //[BGA] "Highlight playable cards" Off: no playable glow, unplayable clicks rejected (PlayCard)
    //[BGA] Expert mode only, players, spectators and replays alike: a pill in the game area's top-left corner, beside the dice
    //row's empty left side (the dice are centred, so even 6 dice at their largest leave that corner free, see Game.scss)
    addExpertModeIndicator() {
        if (!this.isExpertMode())
            return;
        document.documentElement.classList.add('riviera-expert-mode');
        const gameArea = this.bga.gameArea.getElement();
        if (getComputedStyle(gameArea).position === 'static')
            gameArea.classList.add('expert-mode-indicator-anchor');
        gameArea.insertAdjacentHTML('afterbegin', `<div id="expert-mode-indicator" class="expert-mode-indicator">${_('Expert mode')}</div>`);
        this.bga.gameui.addTooltip('expert-mode-indicator', _('Playable cards are not highlighted at this table.'), '');
    }
    //BGA's final state, or the end-game table already shown (it arrives in EndScore, just before gameEnd)
    isGameOver() { return this.getGameStateName() === 'gameEnd' || !!this.endGameScoringHandler?.isDisplayed(); }
    updateEndGameScoreHighlights() {
        for (let player_id in this.players)
            this.players[player_id].updateEndGameScoreHighlight();
    }
    getPlayerName(playerID) { return this.gamedatas.players[playerID]?.name ?? ''; }
    //fills container with the player's avatar from their BGA player board (#avatar_<id>, there on setup for players, spectators
    //and replays alike), at a bigger size so it stays sharp (an <img> with imageClass). If the bigger one fails, the board's own;
    //with no avatar at all, the name's initial, with initialClass on container (a played column's header, the spotlight overlay)
    fillPlayerAvatar(container, playerID, imageClass, initialClass) {
        const showInitial = () => {
            container.classList.add(initialClass);
            container.textContent = Array.from(this.getPlayerName(playerID))[0]?.toUpperCase() ?? '';
        };
        const boardAvatar = document.getElementById('avatar_' + playerID);
        const boardSource = boardAvatar instanceof HTMLImageElement ? boardAvatar.getAttribute('src') : null;
        if (!boardSource) {
            showInitial();
            return;
        }
        const image = document.createElement('img');
        image.className = imageClass;
        image.alt = this.getPlayerName(playerID);
        image.draggable = false;
        image.addEventListener('error', () => {
            if (image.getAttribute('src') !== boardSource)
                image.setAttribute('src', boardSource);
            else {
                image.remove();
                showInitial();
            }
        });
        image.setAttribute('src', boardSource.replace(/_(32|50|92)(\.\w+)(?=$|\?)/, Game.AVATAR_SIZE_SUFFIX + '$2'));
        container.appendChild(image);
    }
    //card ids for an action's comma-separated cardIDs param, sorted numerically so the request is the same whatever order
    //they were clicked in (BGA tutorials compare the request's params)
    getCardIDsParam(cardIDs) { return [...cardIDs].sort((a, b) => a - b).join(','); }
    //a status bar button that picks a player: BGA's secondary button with the .player-choice-button look, ringed in that
    //player's color through --player-color. label is HTML (setTitle-style), e.g. the player's name in bold
    addPlayerChoiceButton(playerID, label, callback, params = {}) {
        const button = this.bga.statusBar.addActionButton(label, callback, { ...params, color: 'secondary', classes: 'player-choice-button' });
        button.style.setProperty('--player-color', '#' + (this.getPlayerColor(playerID) ?? '000000'));
        return button;
    }
    //a hand card was clicked: the current state handles the selection
    handSelectionChanged() {
        const stateName = this.getGameStateName();
        if (stateName === 'PlayCard')
            this.playCard.selectionChanged();
        else if (stateName === 'SwapCards')
            this.swapCards.selectionChanged();
    }
    //a hand card that isn't selected yet was clicked: whether it may be selected (PlayCard in Expert mode rejects unplayable cards)
    canSelectHandCard(cardID) {
        if (this.getGameStateName() === 'PlayCard')
            return this.playCard.canSelectCard(cardID);
        return true;
    }
    //a set-aside card that can still be taken back was clicked (HandHandler only marks them in PlayCard)
    undoableChosenCardClicked() {
        if (this.getGameStateName() === 'PlayCard')
            this.playCard.chosenCardClicked();
    }
    //card 10, seen by everyone but the two players involved: N card backs fly each way between their boards, all at once.
    //Both start points are measured before any back is added to a board, so one direction never starts from the other's back
    async animateCardBacksSwap(firstPlayerID, secondPlayerID, count) {
        const firstPlayer = this.players[firstPlayerID];
        const secondPlayer = this.players[secondPlayerID];
        if (!firstPlayer || !secondPlayer)
            return;
        if (this.bga.gameui.bgaAnimationsActive()) {
            const firstRect = this.getSlideSourceRect(firstPlayer.getHandCountElement());
            const secondRect = this.getSlideSourceRect(secondPlayer.getHandCountElement());
            const slides = [];
            for (let i = 0; i < count; i++) {
                slides.push(this.animateCardBackSlide(firstRect, Game.getStackedRect(secondRect, i)));
                slides.push(this.animateCardBackSlide(secondRect, Game.getStackedRect(firstRect, i)));
            }
            await Promise.all(slides);
        }
        //a swap keeps hand sizes, this only redraws the backs
        firstPlayer.setHandCount(firstPlayer.getHandCount());
        secondPlayer.setHandCount(secondPlayer.getHandCount());
    }
    //a mini card back flies from fromRect onto toRect (on the other board's hand count, stacked), stays there a moment
    //(BOARD_ARRIVAL_HOLD), then goes; the hand count itself is redrawn after
    async animateCardBackSlide(fromRect, toRect) {
        const cardBack = this.createCardBackDiv();
        cardBack.classList.add('mini-card-back');
        await this.moveSlidingClone(this.createSlidingClone(cardBack), fromRect, toRect, Game.CARD_SLIDE_DURATION, { holdMs: Game.BOARD_ARRIVAL_HOLD });
    }
    //cards flying onto the same spot of a player board land as a visible stack: the index-th one (0 = the first, at the
    //back) lands BOARD_STACK_OFFSET * BOARD_CARD_SCALE px further right and down per index, and later ones come later in
    //<body>, so on top
    static getStackedRect(rect, index) {
        const offset = index * Game.BOARD_STACK_OFFSET * Game.BOARD_CARD_SCALE;
        return new DOMRect(rect.left + offset, rect.top + offset, rect.width, rect.height);
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
        //minDuration: BGA holds every notification with log text for 500ms by default, even when nothing animates (the
        //Stop/More reveal, each "banks N ★" row). A notification now lasts as long as its handler awaits a real animation
        this.bga.notifications.setupPromiseNotifications({
            minDuration: 1,
            // logger: console.log
        });
    }
    // Add the notification handlers
    async notif_newRound(args) {
        await this.startTokenFlight; //the end-of-round pass (EndRound) lands before the columns clear
        //every column and the cards left in my hand sweep out together, each with its own stagger; newHand deals once all have left
        const sweeps = [];
        for (let player_id in this.players) {
            const player = this.players[player_id];
            sweeps.push(player.getPlayedColumn().clear());
            player.setRoundStatus('in');
            player.setHandCount(args.hand_counts[player_id] ?? 0);
        }
        if (this.handHandler)
            sweeps.push(this.handHandler.discardAll());
        //args.dice (blank, not rolled yet) is not shown: last round's dice stay up through the deal, until diceRolled
        await Promise.all(sweeps);
    }
    async notif_newHand(args) {
        await this.handHandler?.setHand(args.cards); //the old cards have already swept out (newRound): the new ones are dealt
        this.tooltipHandler.addTooltipsToCards();
    }
    //the roll starts at once, alongside a Start token pass still flying, and the notification waits for both
    async notif_diceRolled(args) {
        await Promise.all([this.diceHandler.rollDice(args.dice), this.startTokenFlight]);
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
        if (reveal.choice === 'last_chance') //the card stays on the board until lastChanceAnimation, after the Last Chance log rows
            return;
        //a card-1 chain follows its first card into the column, slightly behind it
        const revealedCards = [reveal.card, ...(reveal.extra_cards_POWER1 ?? [])];
        const slides = [];
        for (let i = 0; i < revealedCards.length; i++) {
            if (i > 0)
                await this.bga.gameui.wait(Game.CHAIN_CARD_STAGGER);
            if (reveal.player_id === this.myPlayerID && this.handHandler)
                slides.push(this.handHandler.animateCardToColumn(revealedCards[i], player.getPlayedColumn()));
            else
                slides.push(player.getPlayedColumn().animateCardIn(revealedCards[i], player.getHandCountElement(), true));
        }
        await Promise.all(slides);
    }
    //the log row only, at once: lastChanceAnimation, after every Last Chance row of the reveal, takes the cards off the boards
    async notif_lastChanceUsed(args) {
    }
    //[BGA] every Last Chance of the reveal at once: the cards fly from their boards to the middle of the screen under a "Last
    //Chance!" banner, each with its player's avatar and name, then back to their boards, where they fade out. The queue waits
    //for the whole animation (or a click on the overlay that skips it). No animation in a replay or with animations off
    async notif_lastChanceAnimation(args) {
        const players = args.player_ids.map(playerID => this.players[playerID]).filter(player => !!player);
        const entries = players.map(player => ({ playerID: player.getPlayerID(), element: player.getLastChanceCardElement() }));
        await new LastChanceSpotlight(this, entries).play();
        players.forEach(player => player.setLastChanceUsed(true));
    }
    //[BGA] the last player in had only Crash, so the server chose it. The reveal comes after this, so after the roll has landed too
    async notif_autoCrashAnnounced(args) {
        await this.announceAutoChoice(args.player_id, _('${you} crash'), _('${player_name} crashes'));
    }
    //[BGA] the player's last card was playable, so the server played it. While others choose, only that player gets this (the
    //others still see them choosing), and their status bar goes back to the waiting title after the hold
    async notif_autoGrandSlamAnnounced(args) {
        if (args.player_id === this.myPlayerID)
            this.playCard.onAutoGrandSlam();
        await this.announceAutoChoice(args.player_id, _('${you} go for a Grand Slam'), _('${player_name} goes for a Grand Slam'));
        if (args.others_choosing)
            this.playCard.refresh();
    }
    //a choice the server made for a player: no buttons or selectable cards, the status bar says it with looping dots, then the
    //queue holds (not in a replay or with no animations)
    async announceAutoChoice(playerID, myTitle, othersTitle) {
        this.bga.statusBar.removeActionButtons();
        this.handHandler?.clearSelectableCards();
        //the dots stay out of the translated text. All of them are there from the start, hidden, so the text never moves
        const dotsHTML = '<span class="auto-choice-dots">' + '<span>.</span>'.repeat(Game.AUTO_CHOICE_DOT_COUNT) + '</span>';
        if (playerID === this.myPlayerID)
            this.bga.statusBar.setTitle(myTitle + dotsHTML);
        else
            this.bga.statusBar.setTitle(othersTitle + dotsHTML, { player_name: this.bga.players.getFormattedPlayerName(playerID) });
        const dots = Array.from(document.querySelectorAll('#pagemaintitletext .auto-choice-dots > span'));
        //no hold in a replay, or with no animations (fast forward, instantaneous mode, hidden tab): the whole "..." at once
        if (this.isReplay() || !this.bga.gameui.bgaAnimationsActive()) {
            dots.forEach(dot => dot.classList.add('shown-dot'));
            return;
        }
        //"." at once, then a step every AUTO_CHOICE_DOT_STEP_TIME, back to "." after "...", for the whole hold
        let shownDotCount = 0;
        const showNextDots = () => {
            shownDotCount = shownDotCount % dots.length + 1;
            dots.forEach((dot, index) => dot.classList.toggle('shown-dot', index < shownDotCount));
        };
        showNextDots();
        const dotsTimer = setInterval(showNextDots, Game.AUTO_CHOICE_DOT_STEP_TIME);
        try {
            await this.bga.gameui.wait(Game.AUTO_CHOICE_HOLD_TIME);
        }
        finally {
            clearInterval(dotsTimer);
        }
    }
    //the log row only, at once: crashAnimation, after every crash row of the reveal, discards the cards
    async notif_playerCrashed(args) {
    }
    //[BGA] every crash of the reveal at once: a "Crashed!" banner, each crashed column glows red and shakes where it is, under its
    //player's avatar and name (a large tile in the middle of the play area too, for a column off screen), then its cards tumble
    //out, my hand's too if I crashed. The queue waits for the whole animation (or a click on the overlay that skips it). No
    //animation in a replay or with animations off. Then the end state: column and hand emptied, hand count 0, round status crashed
    async notif_crashAnimation(args) {
        const players = args.player_ids.map(playerID => this.players[playerID]).filter(player => !!player);
        const entries = players.map(player => {
            const cardGroups = [player.getPlayedColumn().getCardElements().reverse()]; //last card first
            if (player.getPlayerID() === this.myPlayerID && this.handHandler)
                cardGroups.push(this.handHandler.getCardDivs().reverse());
            return { playerID: player.getPlayerID(), element: player.getPlayedColumn().getColumnContainer(), cardGroups: cardGroups };
        });
        await new CrashSpotlight(this, entries).play();
        for (let player of players) {
            player.getPlayedColumn().removeAllCards();
            if (player.getPlayerID() === this.myPlayerID)
                this.handHandler?.removeAllCards();
            player.setHandCount(0);
            player.setRoundStatus('crashed');
        }
    }
    async notif_grandSlam(args) {
        this.players[args.player_id]?.setScore(args.score);
        this.players[args.player_id]?.setGrandSlam();
    }
    //the flight doesn't block: the card 2 and 11 notifications (no animation) and the roll play while it flies, and
    //diceRolled (or newRound, when the round ends) waits for it
    async notif_startTokenPassed(args) {
        await this.startTokenFlight; //a previous pass still flying (debug passes back to back)
        this.startTokenFlight = this.startTokenHandler.moveTo(args.player_id);
    }
    async notif_stopOrMoreChoiceConfirmed(args) {
        this.stopOrMore.setPendingChoice(args.choice);
    }
    async notif_stopOrMoreChoiceReverted(args) {
        this.stopOrMore.setPendingChoice(null);
    }
    //each stopper is out, and the stars they banked are already in their score (banked)
    async notif_stopOrMoreRevealed(args) {
        console.log('[TEMP stopOrMore] notif args', JSON.parse(JSON.stringify(args))); //TEMP: remove once the banked stars show
        for (const row of args.rows) {
            if (row.choice !== 'stop')
                continue;
            this.players[row.player_id]?.setRoundStatus('stopped');
            this.players[row.player_id]?.setScore(row.score);
        }
    }
    //last turn's card-2 reservation and golden die expire after the reveal
    async notif_diceUpdated(args) {
        this.diceHandler.updateDice(args.dice);
    }
    async notif_dieReserved_POWER2(args) {
        this.diceHandler.updateDice(args.dice);
    }
    //the log row only: the golden die appears with the next roll (diceRolled), once it has a value
    async notif_goldenDieAdded_POWER11(args) {
    }
    async notif_dieModified_POWER9(args) {
        this.diceHandler.updateDice(args.dice);
    }
    //[BGA] the only player still in took their card 9 change back: the die goes back and its log row goes away
    async notif_dieChangeUndone_POWER9(args) {
        this.diceHandler.updateDice(args.dice);
        this.logMutationObserver.removeDieModifiedLogPOWER9(args.move_id);
    }
    //the owner and the victim get the cards (_private): my side of the swap. The cards I give fly to the other player's
    //avatar while the cards I get fly from it into my hand and my other cards slide to their new places, all at once.
    //Everyone else gets no cards: card backs slide each way between the two boards
    async notif_cardsSwapped_POWER10(args) {
        if (!args._private || !this.handHandler) {
            await this.animateCardBacksSwap(args.owner_id, args.target_id, args.count);
            this.bouncePlayerBoards([args.owner_id, args.target_id]);
            return;
        }
        const iAmOwner = args.owner_id === this.myPlayerID;
        const cardsILose = iAmOwner ? args._private.owner_gives : args._private.target_gives;
        const cardsIGet = iAmOwner ? args._private.target_gives : args._private.owner_gives;
        const otherPlayer = this.players[iAmOwner ? args.target_id : args.owner_id];
        const boardRect = otherPlayer?.getAvatarRect() ?? this.handHandler.getHandContainer().getBoundingClientRect();
        //the owner is still active in SwapCards until the state changes: once BGA unlocks the interface at the end of the
        //animation, cards left selectable would glow until onLeavingState clears them
        this.handHandler.clearSelectableCards();
        await this.handHandler.swapCards(cardsILose.map(card => card.card_id), cardsIGet, boardRect);
        this.tooltipHandler.addTooltipsToCards();
        this.bouncePlayerBoards([args.owner_id, args.target_id]);
    }
    //the owner gets the cards (_private) and redraws in their hand. Hand sizes don't change, so everyone else only sees the
    //owner's board bounce
    async notif_cardsRedrawn_POWER10(args) {
        if (!args._private || !this.handHandler) {
            this.bouncePlayerBoards([args.player_id]);
            return;
        }
        await this.handHandler.redrawCards(args._private.discarded.map(card => card.card_id), args._private.drawn);
        this.tooltipHandler.addTooltipsToCards();
    }
    //card 10: the boards of the players involved bounce once the cards have landed, except my own (a swapper or victim
    //sees only the other player's board bounce); nothing waits for it
    bouncePlayerBoards(playerIDs) {
        for (let playerID of playerIDs) {
            if (playerID !== this.myPlayerID)
                this.players[playerID]?.bounceBoard();
        }
    }
    async notif_powerSkipped(args) {
    }
    async notif_displayEndGameScoring(args) {
        this.updateStatusText(_('Final scores'));
        await this.endGameScoringHandler.displayEndGameScore(args.endGameScoring);
    }
}
//every card animation's timing, in one place to tune them together (HandHandler and PlayedColumnHandler read them too)
Game.CARD_SLIDE_DURATION = 600; //ms of a card moving between two places in sight: the reveal into a column, a card 10 swap (and its card backs between two boards)
Game.CARD_SLIDE_EASING = 'ease-in-out';
Game.CHAIN_CARD_STAGGER = 150; //ms between two cards of a card-1 chain leaving for the column
Game.SWAP_FADE_OUT_DURATION = 300; //ms a card I give in a card 10 swap takes to fade out on the other player's avatar
Game.BOARD_CARD_SCALE = 0.75; //share of its full size a card has at the player board end of a slide (the boards sit at the top of the screen on mobile, where a full card went off-screen)
Game.BOARD_STACK_OFFSET = 10; //px right and down, before BOARD_CARD_SCALE, each card lands from the one before when several fly onto the same board spot at once (a card 10 swap)
Game.BOARD_ARRIVAL_HOLD = 100; //ms a card that has flown onto a player board (avatar or hand count) stays fully shown before it fades or goes
Game.CARD_SWEEP_DURATION = 293; //ms each card leaving at a new round (hand and columns) takes to slide off-screen, quicker than the deal so the two read apart
Game.CARD_SWEEP_STAGGER = 32; //ms between two cards starting their sweep at a new round
Game.CARD_SWEEP_EASING = 'ease-in-out';
Game.CARD_DEAL_DURATION = 440; //ms each card of a new hand slides in for
Game.CARD_DEAL_STAGGER = 48; //ms between the starts of two dealt cards (well under CARD_DEAL_DURATION: a few cards move at once)
Game.CARD_DEAL_EASING = 'ease-out';
Game.REDRAW_SWEEP_DURATION = 550; //card 10 redraw: the discarded cards' sweep, a little slower than a new round's (same easing)
Game.REDRAW_SWEEP_STAGGER = 60;
Game.REDRAW_DEAL_DURATION = 550; //card 10 redraw: the drawn cards' deal (same easing as a new hand's)
Game.REDRAW_DEAL_STAGGER = 100;
Game.CARD_REJECT_SHAKE_DURATION = 400; //ms of the short horizontal shake of an unplayable card clicked in Expert mode (none with reduced motion)
Game.REJECTED_CARD_POPUP_DURATION = 2000; //ms the "Can't play [card]" popup stays before it has faded out
Game.CARD_SWEEP_ANGLE = 10; //degrees above horizontal of the sweeps' and deals' straight path: cards leave towards, and come in from, the top-left
Game.OFF_SCREEN_MARGIN = 20; //px past the screen's left edge a card goes to (or comes from), for its drop shadow
Game.AUTO_CHOICE_HOLD_TIME = 1500; //the status bar announces an automatic crash or Grand Slam this long
Game.AUTO_CHOICE_DOT_STEP_TIME = 250; //its dots loop "." → ".." → "..." → ".", one step this often
Game.AUTO_CHOICE_DOT_COUNT = 3;
Game.AVATAR_SIZE_SUFFIX = '_184'; //BGA serves avatars at _32, _50, _92 and _184 px: the board's _32 would blur in a bigger circle

export { Game };
