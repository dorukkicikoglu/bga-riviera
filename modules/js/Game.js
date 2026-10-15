/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 *
 * Everyone still in the round secretly chooses a card (select, then confirm), or, only when no card is
 * playable, their Last Chance or a crash. The choice stays pending until the last player has chosen, and
 * "Undo" takes it back.
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
        const handHandler = this.game.handHandler;
        this.bga.statusBar.removeActionButtons();
        handHandler?.clearSelectableCards();
        this.confirmButton = null;
        //spectator, or a player who isn't choosing and has nothing pending
        if (!handHandler || (!isCurrentPlayerActive && !this.pendingChoice)) {
            this.bga.statusBar.setTitle(_('Others must choose a card'));
            return;
        }
        //in the two choosing branches, selectionChanged() sets the title (no card is selected yet)
        if (isCurrentPlayerActive && this.pendingChoice && this.chainOpen) {
            handHandler.setSelectableCards(this.playableCardIDs, 1, true);
            //hidden until a card is selected, like Fugu's swap button
            this.confirmActionName = 'actAddChainCard_POWER1';
            this.confirmButton = this.bga.statusBar.addActionButton(_('Add card'), () => this.confirmClicked(this.confirmActionName), { id: 'add-chain-card-button' });
            this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actFinishChain_POWER1'), { id: 'finish-chain-button', color: 'secondary' });
            this.game.undoHandler.addUndoButton('actUndoPlayCard');
            this.selectionChanged();
        }
        else if (isCurrentPlayerActive && !this.pendingChoice) {
            if (this.playableCardIDs.length > 0) {
                handHandler.setSelectableCards(this.playableCardIDs, 1, true);
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
        }
        else {
            if (this.pendingChoice.choice === 'card') {
                const cardsIcons = this.getChosenCardIDs().map(cardID => this.game.getStatusCardIconHTML(handHandler.getCardData(cardID))).join('');
                this.bga.statusBar.setTitle(_('${you} chose ${card}. Waiting for other players').replace('${card}', cardsIcons || _('a card')));
            }
            else {
                const pendingChoiceTitles = {
                    last_chance: _('${you} chose your Last Chance. Waiting for other players'),
                    crash: _('${you} chose to crash. Waiting for other players'),
                };
                this.bga.statusBar.setTitle(pendingChoiceTitles[this.pendingChoice.choice]);
            }
            this.game.undoHandler.addUndoButton('actUndoPlayCard');
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
            this.bga.statusBar.setTitle((isAddingToChain ? _('Add ${card}?') : _('Play ${card}?')).replace('${card}', this.game.getStatusCardIconHTML(selectedCard)));
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
            this.bga.statusBar.setTitle(_('${you} must choose an action'));
            const starsTotal = this.game.myself.getPlayedColumn().getStarsTotal();
            //the ★ gets its own span so its fallback font can't make this button taller than the others (see #stop-button in Game.scss)
            const stopLabel = _('Stop and bank ${stars} ★').replace('${stars}', starsTotal.toString()).replace('★', '<span class="button-star">★</span>');
            this.bga.statusBar.addActionButton(stopLabel, () => this.bga.actions.performAction('actStop'), { id: 'stop-button' });
            this.bga.statusBar.addActionButton(_('Stay for More'), () => this.bga.actions.performAction('actMore'), { id: 'more-button' });
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
    applyDieData(aDie, dieData, isRoll = false) {
        if (dieData.value !== null)
            aDie.setAttribute('data-value', dieData.value.toString());
        else if (isRoll || !aDie.getAttribute('data-value'))
            aDie.setAttribute('data-value', '');
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
            this.game.tooltipHandler?.updateDieTooltip(dieData);
            aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
            this.applyDieData(aDie, dieData, true);
            if (dieData.value !== null)
                rolledDice.push({ aDie: aDie, dieData: dieData });
        }
        if (animate)
            await Promise.all(rolledDice.map(rolledDie => this.rollIn(rolledDie.aDie, rolledDie.dieData)));
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
    //one die of the new roll, already at its final face and place: it starts off the container's right edge, a little
    //above its row, turned ROLL_MIN_SPIN to ROLL_MAX_SPIN either way, and slides and spins into its slot. Only translate and
    //rotate animate (never transform). fill 'backwards' keeps it off-screen during its delay. Random faces show on the way,
    //the real one from ROLL_FACE_SETTLE_FRACTION of the travel
    async rollIn(aDie, dieData) {
        const containerRect = this.diceContainer.getBoundingClientRect();
        const dieRect = aDie.getBoundingClientRect();
        const zoom = this.getZoom(aDie); //screen px to the game area's px (BGA scales the game area down on mobile)
        const dieSize = dieRect.width / zoom;
        const startX = (containerRect.right - dieRect.left) / zoom + dieSize * DiceHandler.ROLL_START_GAP;
        const startY = -dieSize * DiceHandler.ROLL_START_LIFT;
        const spinDirection = Math.random() < 0.5 ? -1 : 1;
        const spin = spinDirection * (DiceHandler.ROLL_MIN_SPIN + Math.random() * (DiceHandler.ROLL_MAX_SPIN - DiceHandler.ROLL_MIN_SPIN));
        const delay = Math.random() * DiceHandler.ROLL_MAX_DELAY;
        const roll = aDie.animate([
            { translate: `${startX}px ${startY}px`, rotate: `${spin}deg` },
            { translate: '0px 0px', rotate: '0deg' },
        ], { duration: DiceHandler.ROLL_DURATION, delay: delay, easing: DiceHandler.ROLL_EASING, fill: 'backwards' });
        let face = this.getRandomFace(null);
        aDie.setAttribute('data-value', face.toString());
        const faceInterval = DiceHandler.ROLL_DURATION * DiceHandler.ROLL_FACE_SETTLE_FRACTION / DiceHandler.ROLL_FACE_CHANGES;
        const faceTimers = [];
        for (let faceIndex = 1; faceIndex < DiceHandler.ROLL_FACE_CHANGES; faceIndex++) {
            faceTimers.push(window.setTimeout(() => {
                face = this.getRandomFace(face);
                aDie.setAttribute('data-value', face.toString());
            }, delay + faceIndex * faceInterval));
        }
        faceTimers.push(window.setTimeout(() => this.applyDieData(aDie, dieData, true), delay + DiceHandler.ROLL_FACE_CHANGES * faceInterval));
        await Promise.race([
            roll.finished.catch(() => undefined),
            this.game.bga.gameui.wait(delay + DiceHandler.ROLL_DURATION + DiceHandler.FINISH_SAFETY_MARGIN),
        ]);
        faceTimers.forEach(faceTimer => window.clearTimeout(faceTimer));
        this.applyDieData(aDie, dieData, true);
    }
    getRandomFace(previousFace) {
        let face;
        do {
            face = Math.floor(Math.random() * DiceHandler.DIE_FACES) + 1;
        } while (face === previousFace);
        return face;
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
DiceHandler.DIE_FACES = 6;
//roll-in (diceRolled): every die of the new roll slides in from past the dice container's right edge (the game area's;
//Game.scss clips it there), spinning down to upright, while the previous roll's dice fade out in place, all at once
DiceHandler.ROLL_DURATION = 450; //ms of each die's travel
DiceHandler.ROLL_MAX_DELAY = 80; //ms, each die starts after a random delay up to this, so the dice don't move as one block
DiceHandler.ROLL_EASING = 'cubic-bezier(0.25, 0.8, 0.35, 1)'; //ease-out with no overshoot: the dice decelerate into place
DiceHandler.ROLL_START_GAP = 0.5; //die sizes between the container's right edge and the die's left edge at the start, so its rotated corners are hidden too
DiceHandler.ROLL_START_LIFT = 0.4; //die sizes above its slot at the start
DiceHandler.ROLL_MIN_SPIN = 180; //deg from upright at the start, in a random direction
DiceHandler.ROLL_MAX_SPIN = 360; //deg
DiceHandler.ROLL_FACE_CHANGES = 4; //random faces shown on the way, evenly spaced, before the real one
DiceHandler.ROLL_FACE_SETTLE_FRACTION = 0.7; //share of the travel after which the die shows its real value, so it is right when it stops
DiceHandler.FADE_OUT_DURATION = 300; //ms of the previous roll's dice fading out
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
    updateStatusBar() {
        if (!this.args)
            return;
        this.bga.statusBar.removeActionButtons();
        const selectedCardIDs = this.game.handHandler.getSelectedCardIDs();
        //the buttons show from the start, disabled until enough cards are selected, so the swap or redraw mode is visible at once
        const allCardsSelected = selectedCardIDs.length === this.args.maxCards;
        if (this.args.mode === 'swap') {
            if (selectedCardIDs.length === 0)
                this.game.setPowerPromptTitle(this.args.powerCard, true);
            else
                this.bga.statusBar.setTitle(allCardsSelected ? _('Choose an opponent to swap with') : _('Choose 2 cards to swap'));
            for (let target of this.args.targets) {
                const label = _('Swap with ${player_name}').replace('${player_name}', this.game.getPlayerName(target.player_id));
                this.bga.statusBar.addActionButton(label, () => this.swapClicked(target, selectedCardIDs), { id: 'swap-with-' + target.player_id + '-button', disabled: !allCardsSelected });
            }
        }
        else {
            if (selectedCardIDs.length === 0)
                this.game.setPowerPromptTitle(this.args.powerCard, true);
            else if (allCardsSelected)
                this.bga.statusBar.setTitle(this.args.maxCards === 1 ? _('Discard this card and draw 1?') : _('Discard these cards and draw 2?'));
            else
                this.bga.statusBar.setTitle(_('Choose 2 cards to discard'));
            this.bga.statusBar.addActionButton(_('Discard and draw'), () => this.redrawClicked(selectedCardIDs), { id: 'redraw-button', disabled: !allCardsSelected });
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
    //every player board, spectators included, shows the hand count, Last Chance and round status. The Start token is not in
    //this content: it sits on the top-left corner of the whole BGA player board (startTokenAnchor) and takes no layout space
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
            </div>
        `;
        const playerPanel = this.game.bga.playerPanels.getElement(this.playerID);
        playerPanel.appendChild(this.playerBoardContainer);
        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.roundStatusIndicator = this.playerBoardContainer.querySelector('.round-status-indicator');
        this.startTokenAnchor = playerPanel.closest('.player-board') ?? playerPanel; //BGA's whole board around our panel
        this.startTokenAnchor.classList.add('start-token-anchor');
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
    getStartTokenAnchor() { return this.startTokenAnchor; }
    getHandCountElement() { return this.handCountBacks; }
}
PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS = 6; //above this, the hand count shows a single card back followed by "x N"
PlayerHandler.LAST_CHANCE_FADE_ANIM_TIME = 400;

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
    //a log row (its mini cards) or the status bar title (its circular card icons): single-power tooltips. Only that container
    //is queried, so loading a long log stays cheap
    addTooltipsToCardsIn(container) {
        if (this.isSafariMobile() || !container)
            return;
        container.querySelectorAll('.a-card[id], .status-card-icon[id]').forEach((card) => {
            const value = parseInt(card.getAttribute('data-value'));
            if (card.classList.contains(TooltipHandler.getPowerCardClass(value)))
                this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerTooltipHTML(value), TooltipHandler.TOOLTIP_DELAY);
            else if (card.classList.contains('last-chance-card'))
                this.game.bga.gameui.addTooltip(card.id, this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
        });
    }
    //player boards and played columns: the parts that aren't self-explanatory
    addTooltipsToBoards() {
        this.game.bga.gameui.addTooltip('start-token', _('Start token: powers resolve clockwise from this player. Every turn it passes to the next player still in the round.'), '', TooltipHandler.TOOLTIP_DELAY);
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

class HandHandler {
    constructor(game, handData) {
        this.game = game;
        this.handData = handData;
        this.maxSelectedCards = 1;
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
    //selectable cards glow, the others keep their normal look. isPlay: the cards are playable cards, so power cards get their own glow
    setSelectableCards(selectableCardIDs, maxSelectedCards = 1, isPlay = false) {
        this.clearSelection();
        this.maxSelectedCards = maxSelectedCards;
        for (let card of this.getCardDivs()) {
            const isSelectable = selectableCardIDs.includes(parseInt(card.getAttribute('data-card-id')));
            card.classList.toggle(HandHandler.SELECTABLE_CARD_CLASS, isSelectable);
            card.classList.toggle(HandHandler.PLAYABLE_POWER_CARD_CLASS, isSelectable && isPlay && POWER_CARD_VALUES.includes(parseInt(card.getAttribute('data-value'))));
        }
    }
    clearSelectableCards() {
        this.clearSelection();
        for (let card of this.getCardDivs())
            card.classList.remove(HandHandler.SELECTABLE_CARD_CLASS, HandHandler.PLAYABLE_POWER_CARD_CLASS);
    }
    //the cards chosen this turn (a first card, then any card-1 chain) stay set aside in the hand until the reveal, or until "Undo"
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
    //a new round's hand: the cards left from the previous round sweep out left as copies while the new hand is dealt card
    //by card. The final hand is laid out first (sorted and spaced) with every card hidden in its slot, then a copy of each card flies
    //in, rightmost first, and the real card shows when its copy lands, so no card moves during or after the deal. Every card
    //starts DEAL_X_OFFSET to the left of its slot, at the same page y DEAL_START_Y (the document's, not the viewport's:
    //scrolled down, the start is off-screen). Resolves when the last card has landed
    async setHand(handData) {
        const sweep = this.sweepOutCards(); //empties the hand at once, the deal doesn't wait for the copies
        this.handData = handData;
        this.displayHand();
        const cards = this.getCardDivs();
        cards.forEach(card => card.style.visibility = 'hidden');
        const deals = [];
        for (let i = cards.length - 1; i >= 0; i--) {
            if (i < cards.length - 1)
                await this.game.bga.gameui.wait(HandHandler.DEAL_STAGGER);
            const pageTop = document.documentElement.getBoundingClientRect().top; //the page's top on screen, read per card in case of a scroll
            const cardRect = cards[i].getBoundingClientRect();
            const startLeft = cardRect.left - window.innerWidth * HandHandler.DEAL_X_OFFSET;
            const startTop = pageTop + HandHandler.DEAL_START_Y - cardRect.height;
            const startRect = new DOMRect(startLeft, startTop, cardRect.width, cardRect.height);
            deals.push(this.game.animateSlide(cards[i], startRect, null, HandHandler.DEAL_DURATION, HandHandler.DEAL_EASING));
        }
        await Promise.all([sweep, ...deals]);
    }
    //every card in my hand is lifted out as a copy at its place on screen and the hand is emptied at once; the copies
    //slide left together until they are off the screen's left side
    async sweepOutCards() {
        const sweeps = this.getCardDivs().map(card => {
            const cardRect = card.getBoundingClientRect();
            const offScreenRect = new DOMRect(-cardRect.width - 20, cardRect.top, cardRect.width, cardRect.height); //20px more for the drop shadow
            return this.game.animateSlideAway(card, offScreenRect, HandHandler.OLD_HAND_SWEEP_DURATION, HandHandler.OLD_HAND_SWEEP_EASING);
        });
        this.cardsContainer.innerHTML = '';
        await Promise.all(sweeps);
    }
    getCardDivs() { return Array.from(this.cardsContainer.querySelectorAll('.a-card')); }
    getCardDiv(cardID) { return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }
    getCardCount() { return this.cardsContainer.querySelectorAll('.a-card').length; }
    getHandContainer() { return this.handContainer; }
}
HandHandler.SELECTED_CARD_CLASS = 'selected-hand-card';
HandHandler.CHOSEN_CARD_CLASS = 'chosen-card';
HandHandler.SELECTABLE_CARD_CLASS = 'selectable-card';
HandHandler.PLAYABLE_POWER_CARD_CLASS = 'playable-power-card'; //a playable power card glows cream instead of gold
HandHandler.FADE_ANIM_TIME = 400;
//new hand (setHand): the previous round's leftover cards sweep out left while the new hand is dealt right to left,
//every new card travelling the same path, shifted to its own slot
HandHandler.OLD_HAND_SWEEP_DURATION = 200; //ms the leftover cards take to slide left off-screen, all together, as the deal starts
HandHandler.OLD_HAND_SWEEP_EASING = 'ease-in'; //CSS timing function of the sweep
HandHandler.DEAL_X_OFFSET = 1.2; //a card starts this share of the window width to the left of its slot
HandHandler.DEAL_START_Y = 0; //page (document) y, in px, of every card's bottom edge at the start: 0 = just above the top of the page
HandHandler.DEAL_DURATION = 400; //ms each card slides for
HandHandler.DEAL_STAGGER = 100; //ms between the starts of two cards (a bit less than DEAL_DURATION: 1 or 2 cards move at once)
HandHandler.DEAL_EASING = 'ease-out'; //CSS timing function of each card's slide
HandHandler.SLIDE_ANIM_TIME = 600;
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
    //the token flies from its current player board's corner to playerID's on a position:fixed copy, so it shows wherever
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
        const toRect = this.getUntiltedRect();
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
            const sourceRect = sourceAnchor.getBoundingClientRect();
            const targetRect = targetAnchor.getBoundingClientRect();
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
        const boardRect = anchor.getBoundingClientRect();
        const gameAreaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
        return boardRect.left >= gameAreaRect.right - 1 || boardRect.right <= gameAreaRect.left + 1;
    }
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
//the token's layers, bottom to top: the stroke in its owner's color, the pawn (see .start-token in Game.scss).
//Shared with the mini token in log rows
StartTokenHandler.LAYERS_HTML = '<div class="start-token-outline"></div><div class="start-token-pawn"></div>';

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
                <div class="start-token mini-start-token" style="--start-token-color: #${this.game.getPlayerColor(player_id) ?? '000000'}">${StartTokenHandler.LAYERS_HTML}</div>&nbsp;${startTokenText}
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
        //no die drawn: the golden die has no value until the next roll, and a die never shows without one
        const goldenDieText = player_id === this.game.getMyPlayerID()
            ? _('${you} add the golden die to the next roll').replace('${you}', playerNameHTML)
            : _('${playerName} adds the golden die to the next roll').replace('${playerName}', playerNameHTML);
        let logHTML = `
            <div class="golden-die-row">
                ${goldenDieText}
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

//"Undo", shared by every multiactive state where a choice stays pending until the last player has chosen.
//The player is inactive by then, so the action skips the active-player check (checkAction: false) and the
//server checks the state itself (#[CheckAction(false)] + checkPossibleAction)
class UndoHandler {
    constructor(game) {
        this.game = game;
    }
    addUndoButton(actionName) {
        return this.game.bga.statusBar.addActionButton(_('Undo'), () => this.undoClicked(actionName), {
            id: 'undo-button',
            color: 'alert',
        });
    }
    undoClicked(actionName) {
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
        this.undoHandler = new UndoHandler(this);
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
    //`from` can also be a DOMRect on screen, for a start point with no element (the new hand's deal starts off the page).
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    async animateSlide(element, from, to, durationMs, easing = 'ease-in-out') {
        const fromRect = this.getSlideSourceRect(from); //before element moves: from may be element itself
        const slidingClone = this.createSlidingClone(element);
        element.style.visibility = 'hidden';
        if (to)
            to.appendChild(element);
        const toRect = element.getBoundingClientRect();
        await this.moveSlidingClone(slidingClone, fromRect, toRect, durationMs, easing);
        element.style.visibility = null;
    }
    //the other way round: a copy of element flies from where element is now to toRect on screen, then disappears.
    //Element itself is left alone and can be removed as soon as this is called (the old hand's sweep at a new round)
    async animateSlideAway(element, toRect, durationMs, easing = 'ease-in-out') {
        const fromRect = element.getBoundingClientRect();
        const slidingClone = this.createSlidingClone(element);
        await this.moveSlidingClone(slidingClone, fromRect, toRect, durationMs, easing);
    }
    createSlidingClone(element) {
        const slidingClone = element.cloneNode(true);
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        slidingClone.style.removeProperty('visibility'); //element may already wait hidden in its slot (the new hand's deal)
        document.body.appendChild(slidingClone);
        return slidingClone;
    }
    //moves the copy from fromRect to toRect (both on screen), then removes it
    async moveSlidingClone(slidingClone, fromRect, toRect, durationMs, easing) {
        const transformOnto = this.getSlidingCloneTransform(slidingClone);
        slidingClone.style.transform = transformOnto(fromRect);
        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in
        slidingClone.style.transition = `transform ${durationMs}ms ${easing}`;
        slidingClone.style.transform = transformOnto(toRect);
        await this.bga.gameui.wait(durationMs);
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
    }
    isDesktop() { return document.body.classList.contains('desktop_version'); }
    isMobile() { return document.body.classList.contains('mobile_version'); }
    isInterfaceLocked() { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    updateStatusText(statusText) { $('gameaction_status').innerHTML = statusText; $('pagemaintitletext').innerHTML = statusText; }
    //power prompts (cards 1, 9, 10, 11): "may use" + the circular card icon of the card that gave the power. setTitle
    //substitutes its args as raw HTML (Fugu's pass button slot uses the same), so the translatable string only holds the
    //${card} placeholder. The details live in the icon's power tooltip
    setPowerPromptTitle(powerCard, isCurrentPlayerActive) {
        this.bga.statusBar.setTitle(isCurrentPlayerActive ? _('${you} may use ${card}') : _('${actplayer} may use ${card}'), { card: this.getStatusCardIconHTML(powerCard) });
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
        //args.dice (blank, not rolled yet) is not shown: last round's dice stay up through the deal, until diceRolled
        await Promise.all(columnsCleared);
    }
    async notif_newHand(args) {
        await this.handHandler?.setHand(args.cards); //old cards sweep out, then the new ones are dealt
        this.tooltipHandler.addTooltipsToCards();
    }
    async notif_diceRolled(args) {
        await this.diceHandler.rollDice(args.dice);
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
    //the log row only: the golden die appears with the next roll (diceRolled), once it has a value
    async notif_goldenDieAdded_POWER11(args) {
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
