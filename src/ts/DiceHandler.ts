/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * DiceHandler.ts
 */
import { Game } from "./Game";

export class DiceHandler{
    private static readonly PIPS_PER_DIE = 9; //3x3 layout, Game.scss shows the right pips for each data-value
    private static readonly CHANGE_ANIM_CLASS = 'die-changed';
    private static readonly MODIFIABLE_CLASS_POWER9 = 'modifiable-die-power9'; //the die shows its card-9 arrows
    private static readonly SELECTED_ARROW_CLASS_POWER9 = 'selected-die-arrow-power9';
    private static readonly PREVIEWED_CLASS_POWER9 = 'previewed-die-power9'; //the die shows the value it would become
    private static readonly RESERVATION_PENDING_CLASS_POWER2 = 'die-reservation-pending-power2'; //a revealed card 2 will reserve this die: its ring, dashed
    private static readonly DIE_FACES = 6;

    //roll-in (diceRolled): every die of the new roll comes in from the top right at 45 degrees (the same path for every die,
    //shifted to its own slot), spinning down to upright, while the previous roll's dice fade out in place, all at once
    private static readonly ROLL_DURATION = 500; //ms of a die's travel on average. With ROLL_DURATION_VARIATION and ROLL_MAX_DELAY, the last die of a roll lands about 625ms in
    private static readonly ROLL_DURATION_VARIATION = 0.15; //each die's travel is ROLL_DURATION up to this share longer or shorter, at random, so no two rolls look alike
    private static readonly ROLL_MAX_DELAY = 120; //ms, each die starts after a random delay up to this, so the dice don't move as one block
    private static readonly ROLL_EASING_POINTS = [0.25, 0.8, 0.35, 1]; //x1, y1, x2, y2 of the roll's cubic-bezier: ease-out with no overshoot, the dice decelerate into place
    private static readonly ROLL_EASING = `cubic-bezier(${DiceHandler.ROLL_EASING_POINTS.join(', ')})`; //the faces follow the rotation through this same curve (getRollProgress)
    private static readonly ROLL_DISTANCE = 3; //die sizes (on screen) the die starts right of its slot, and as many above: D in translate(+D, -D). The dice container is about 1.6 die sizes tall, so every die starts above it
    private static readonly ROLL_MIN_SPIN = 150; //deg from upright at the start, in a random direction
    private static readonly ROLL_MAX_SPIN = 420; //deg
    private static readonly FACE_TURN = 90; //deg: the face changes each time the rotation passes a multiple of this, as if a new side rolled up
    private static readonly FACE_LOCK_FRACTION = 0.6; //share of the travel time from which the face is the real value: no change while the die slows down
    private static readonly MAX_SPIN_AFTER_LOCK = 90; //deg the die may still turn after FACE_LOCK_FRACTION; a bigger start spin is reduced to keep to it
    private static readonly FADE_OUT_DURATION = 240; //ms of the previous roll's dice fading out
    private static readonly FADE_OUT_SCALE = 0.85; //their size at the end of the fade
    private static readonly FINISH_SAFETY_MARGIN = 300; //ms after an animation's duration at which it counts as done anyway, should it never report finished

    private diceContainer: HTMLDivElement;
    private previewedColorPOWER9: DieColor | null = null;

    constructor(private game: Game, private diceData: RivieraDie[]) {
        this.diceContainer = document.querySelector('#dice-container');

        //each die sits in a slot; during card 9 the slot also gets the die's arrow hit containers (showModifyArrowsPOWER9),
        //absolutely placed over it and in the space #dice-container always reserves, so the dice never move. Only the dice
        //in the game area get an id (for their tooltip), never the copies in log rows
        for(let dieData of this.diceData){
            const aDie = this.createDieDiv(dieData);
            aDie.id = 'die-' + dieData.color;

            const dieSlot = document.createElement('div');
            dieSlot.className = 'die-slot';
            dieSlot.setAttribute('data-color', dieData.color);
            dieSlot.appendChild(aDie);
            this.diceContainer.appendChild(dieSlot);
        }

        this.diceContainer.addEventListener('click', (event: Event) => { this.diceContainerClicked(event); });
    }

    //card 9: an arrow's hit container (the triangle, the gap and that half of the die) picks that choice
    private diceContainerClicked(event: Event){
        if(!this.game.bga.players.isCurrentPlayerActive())
            return;

        if(this.game.getGameStateName() !== 'ModifyDie')
            return;

        if(this.game.isInterfaceLocked())
            return;

        const dieArrow = (event.target as HTMLElement).closest('.die-arrow') as HTMLElement;
        const dieSlot = dieArrow?.closest('.die-slot') as HTMLDivElement;
        if(!dieArrow || !dieSlot || !dieSlot.classList.contains(DiceHandler.MODIFIABLE_CLASS_POWER9))
            return;

        this.game.modifyDie.choiceClicked(dieSlot.getAttribute('data-color') as DieColor, parseInt(dieArrow.getAttribute('data-delta')));
    }

    //card 9, active owner only: each die that can still be turned this roll gets two transparent hit containers on top of
    //it, the up one from its triangle's tip down to the die's middle line, the down one from that line to its triangle's tip,
    //each holding its visible triangle. They only exist during this, so the dice and their tooltips are untouched otherwise.
    //The title shows the result, wrap-around included
    public showModifyArrowsPOWER9(modifiableDice: { color: DieColor; value: number; }[]): void {
        this.hideModifyArrowsPOWER9();

        for(let die of modifiableDice){
            const dieSlot = this.getDieSlot(die.color);
            if(!dieSlot)
                continue;

            for(let delta of [1, -1]){
                const resultText = `${die.value} → ${DiceHandler.turnDieValue(die.value, delta)}`;
                dieSlot.insertAdjacentHTML('beforeend', `<div class="die-arrow" data-delta="${delta}" role="button" title="${resultText}" aria-label="${resultText}"><span class="die-arrow-triangle"></span></div>`);
            }
            dieSlot.classList.add(DiceHandler.MODIFIABLE_CLASS_POWER9);
        }
    }

    public hideModifyArrowsPOWER9(): void {
        this.setSelectedChoicePOWER9(null);
        this.diceContainer.querySelectorAll('.die-arrow').forEach(dieArrow => dieArrow.remove());
        this.diceContainer.querySelectorAll('.die-slot').forEach(dieSlot => dieSlot.classList.remove(DiceHandler.MODIFIABLE_CLASS_POWER9));
    }

    //the chosen arrow stays highlighted until it is confirmed, switched or clicked again, and its die previews the result
    public setSelectedChoicePOWER9(choice: { color: DieColor; delta: number; } | null): void {
        this.diceContainer.querySelectorAll('.die-arrow.' + DiceHandler.SELECTED_ARROW_CLASS_POWER9).forEach(dieArrow => dieArrow.classList.remove(DiceHandler.SELECTED_ARROW_CLASS_POWER9));
        if(choice)
            this.getDieSlot(choice.color)?.querySelector(`.die-arrow[data-delta="${choice.delta}"]`)?.classList.add(DiceHandler.SELECTED_ARROW_CLASS_POWER9);

        this.previewChoicePOWER9(choice);
    }

    //local only: one die at a time shows the value it would become. Its real value stays in diceData (status bar icon,
    //tooltip), so restoring it is just applying the real data again. Previewing and restoring change the face instantly:
    //the die-changed animation is only for real changes from the server (updateDice)
    private previewChoicePOWER9(choice: { color: DieColor; delta: number; } | null): void {
        if(this.previewedColorPOWER9){
            const previewedDie = this.getDieDiv(this.previewedColorPOWER9);
            const realDieData = this.diceData.find(dieData => dieData.color === this.previewedColorPOWER9);
            this.previewedColorPOWER9 = null;

            if(previewedDie && realDieData){
                previewedDie.classList.remove(DiceHandler.PREVIEWED_CLASS_POWER9);
                this.applyDieData(previewedDie, realDieData);
            }
        }

        const realDieData = choice ? this.diceData.find(dieData => dieData.color === choice.color) : null;
        const aDie = choice ? this.getDieDiv(choice.color) : null;
        if(!choice || !aDie || !realDieData || realDieData.value === null)
            return;

        aDie.setAttribute('data-value', DiceHandler.turnDieValue(realDieData.value, choice.delta).toString());
        aDie.classList.add(DiceHandler.PREVIEWED_CLASS_POWER9);
        this.previewedColorPOWER9 = choice.color;
    }

    //6 + 1 wraps to 1, 1 - 1 wraps to 6, like the server
    public static turnDieValue(value: number, delta: number): number { return ((value - 1 + delta + DiceHandler.DIE_FACES) % DiceHandler.DIE_FACES) + 1; }

    //also used for the mini dice in logs
    public createDieDiv(dieData: RivieraDie): HTMLDivElement {
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
    private applyDieData(aDie: HTMLDivElement, dieData: RivieraDie, isRoll: boolean = false, withRing: boolean = true): void {
        if(dieData.value !== null)
            aDie.setAttribute('data-value', dieData.value.toString());
        else if(isRoll || !aDie.getAttribute('data-value'))
            aDie.setAttribute('data-value', '');
        aDie.setAttribute('data-modified-by-power9', dieData.modified_by_POWER9 ? 'true' : 'false');
        aDie.setAttribute('data-in-use-by-power11', dieData.in_use_by_POWER11 ? 'true' : 'false');

        this.applyReservationRingPOWER2(aDie, withRing ? dieData : null);
    }

    //card 2: pending (dashed ring) from the reveal until the roll it is for, reserved (solid ring) from then. null: no ring
    //(a die rolling in gets its ring once it has landed)
    private applyReservationRingPOWER2(aDie: HTMLDivElement, dieData: RivieraDie | null): void {
        const reserverID = dieData?.reserved_by_POWER2 ?? null;
        const pendingReserverID = dieData?.pending_reserved_by_POWER2 ?? null;
        aDie.setAttribute('data-reserved-by-power2', reserverID === null ? '' : reserverID.toString());
        aDie.classList.toggle(DiceHandler.RESERVATION_PENDING_CLASS_POWER2, pendingReserverID !== null);
        const ringOwnerID = pendingReserverID ?? reserverID;
        if(ringOwnerID !== null)
            aDie.style.setProperty('--reserver-color', '#' + this.game.getPlayerColor(ringOwnerID));
        else
            aDie.style.removeProperty('--reserver-color');
    }

    public updateDice(diceData: RivieraDie[]): void {
        if(this.previewedColorPOWER9) //real values from the server end any card-9 preview (and its selection)
            this.game.modifyDie.cancelSelection();

        for(let dieData of diceData){
            const aDie = this.getDieDiv(dieData.color);
            if(!aDie)
                continue;

            this.diceData = this.diceData.map(knownDie => (knownDie.color === dieData.color) ? dieData : knownDie);
            this.game.tooltipHandler?.updateDieTooltip(dieData);

            const previousValue = aDie.getAttribute('data-value');
            this.applyDieData(aDie, dieData);

            //a die losing its value is hidden at once: an animation on a hidden die never ends, and its leftover class would replay
            const newValue = aDie.getAttribute('data-value');
            if(previousValue !== newValue && newValue !== '')
                this.playChangeAnimation(aDie);
        }
    }

    /**
     * diceRolled: the previous roll's dice fade out in place while every die of the new roll rolls in, all at once (a
     * golden die left out of this roll only fades out). Resolves once the last die has stopped, so the notification waits
     * for it. With BGA's animations off (fast replay, hidden tab) the dice just change. A card 9 change is not a roll: it
     * goes through updateDice.
     * The fading copies keep the rings they had (a pending reservation stays dashed); the dice rolling in have none, and
     * get their card 2 rings once the last die has landed (each die's travel and delay are random, so no fixed time).
     */
    public async rollDice(diceData: RivieraDie[]): Promise<void> {
        if(this.previewedColorPOWER9)
            this.game.modifyDie.cancelSelection();

        const animate = this.game.bga.gameui.bgaAnimationsActive();
        if(animate)
            this.fadeOutShownDice();

        //every die gets its final face first, so the layout (a golden die joining or leaving) is final before measuring
        const rolledDice: { aDie: HTMLDivElement; dieData: RivieraDie; }[] = [];
        for(let dieData of diceData){
            const aDie = this.getDieDiv(dieData.color);
            if(!aDie)
                continue;

            this.diceData = this.diceData.map(knownDie => (knownDie.color === dieData.color) ? dieData : knownDie);
            aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
            const rollsIn = animate && dieData.value !== null;
            this.applyDieData(aDie, dieData, true, !rollsIn);
            this.game.tooltipHandler?.updateDieTooltip(dieData, !rollsIn);

            if(rollsIn)
                rolledDice.push({ aDie: aDie, dieData: dieData });
        }

        await Promise.all(rolledDice.map(rolledDie => this.rollIn(rolledDie.aDie, rolledDie.dieData)));

        //every die has landed: the card 2 rings show together
        for(let rolledDie of rolledDice){
            this.applyReservationRingPOWER2(rolledDie.aDie, rolledDie.dieData);
            this.game.tooltipHandler?.updateDieTooltip(rolledDie.dieData);
        }
    }

    //each shown die leaves a copy at its place, under the dice rolling in (prepended), that fades out and is removed
    private fadeOutShownDice(): void {
        const containerRect = this.diceContainer.getBoundingClientRect();

        this.diceContainer.querySelectorAll('.die-slot > .a-die').forEach((aDie: HTMLDivElement) => {
            if(!aDie.getAttribute('data-value'))
                return;

            const dieRect = aDie.getBoundingClientRect();
            const zoom = this.getZoom(aDie);
            const fadingDie = aDie.cloneNode(true) as HTMLDivElement;
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

    //one die of the new roll, already at its final face and place, hidden there while a copy flies in: the copy starts
    //ROLL_DISTANCE die sizes right of the slot and as many above it, turned ROLL_MIN_SPIN to ROLL_MAX_SPIN either way, and
    //slides and spins into the slot, where the real die shows again. The copy is position: fixed in <body> (.rolling-die),
    //so no ancestor's overflow clips its entry and it adds no scrollable overflow, under the Start token (see Game.scss). It lives outside BGA's mobile
    //scaling of the game area, so it is scaled (scale property, set once) to the die's on-screen size; only translate and
    //rotate animate, never transform. fill 'backwards' keeps it at its start during its delay. Its travel time is
    //ROLL_DURATION give or take ROLL_DURATION_VARIATION. The face changes each time the rotation passes a multiple of
    //FACE_TURN, and is the real value from FACE_LOCK_FRACTION of the travel. Its card 2 ring waits for rollDice
    private async rollIn(aDie: HTMLDivElement, dieData: RivieraDie): Promise<void> {
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

        const rollingDie = aDie.cloneNode(true) as HTMLDivElement;
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
        const faceTimers: number[] = [];
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
    private getRandomSpin(): number {
        const spinLeftShareAtLock = 1 - DiceHandler.getRollProgress(DiceHandler.FACE_LOCK_FRACTION);
        const maxSpin = Math.min(DiceHandler.ROLL_MAX_SPIN, DiceHandler.MAX_SPIN_AFTER_LOCK / Math.max(spinLeftShareAtLock, 0.0001));
        const minSpin = Math.min(DiceHandler.ROLL_MIN_SPIN, maxSpin);
        const spinDirection = Math.random() < 0.5 ? -1 : 1;
        return spinDirection * (minSpin + Math.random() * (maxSpin - minSpin));
    }

    //ms into a travel of duration ms at which the rotation, spin * (1 - eased progress), passes each multiple of FACE_TURN
    //before FACE_LOCK_FRACTION, in order. The start angle itself is not a change
    private getFaceChangeTimes(spin: number, duration: number): number[] {
        const absSpin = Math.abs(spin);
        const spinLeftAtLock = absSpin * (1 - DiceHandler.getRollProgress(DiceHandler.FACE_LOCK_FRACTION));

        const faceChangeTimes: number[] = [];
        for(let turn = Math.ceil(absSpin / DiceHandler.FACE_TURN - 1) * DiceHandler.FACE_TURN; turn >= spinLeftAtLock && turn > 0; turn -= DiceHandler.FACE_TURN){
            if(turn >= absSpin)
                continue;
            faceChangeTimes.push(DiceHandler.getRollTimeFraction(1 - turn / absSpin) * duration);
        }
        return faceChangeTimes;
    }

    //the faces shown during a tumble with faceChangeCount changes: random, never the same twice in a row, ending on the real
    //value (shown from the start when there is no change)
    private getTumbleFaces(faceChangeCount: number, realValue: number): number[] {
        const faces: number[] = [];
        for(let faceIndex = 0; faceIndex < faceChangeCount; faceIndex++){
            const excludedFaces = [faces[faceIndex - 1], ...(faceIndex === faceChangeCount - 1 ? [realValue] : [])];
            let face: number;
            do {
                face = Math.floor(Math.random() * DiceHandler.DIE_FACES) + 1;
            } while(excludedFaces.includes(face));
            faces.push(face);
        }
        faces.push(realValue);
        return faces;
    }

    //the roll's cubic-bezier (ROLL_EASING_POINTS): eased progress at a time fraction, and the time fraction of an eased
    //progress. Both axes are monotone (control points within 0..1), so bisection on the curve's parameter solves either
    private static getRollProgress(timeFraction: number): number {
        const [x1, y1, x2, y2] = DiceHandler.ROLL_EASING_POINTS;
        return DiceHandler.bezierAxis(y1, y2, DiceHandler.solveBezierParameter(x1, x2, timeFraction));
    }

    private static getRollTimeFraction(progress: number): number {
        const [x1, y1, x2, y2] = DiceHandler.ROLL_EASING_POINTS;
        return DiceHandler.bezierAxis(x1, x2, DiceHandler.solveBezierParameter(y1, y2, progress));
    }

    private static bezierAxis(p1: number, p2: number, t: number): number { return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t; }

    private static solveBezierParameter(p1: number, p2: number, value: number): number {
        let low = 0, high = 1;
        for(let iteration = 0; iteration < 30; iteration++){
            const middle = (low + high) / 2;
            if(DiceHandler.bezierAxis(p1, p2, middle) < value)
                low = middle;
            else high = middle;
        }
        return (low + high) / 2;
    }

    //on-screen px per px of the game area (below 1 when BGA scales it down on mobile). The unrounded computed width, not
    //offsetWidth, which rounds and drifts by a pixel
    private getZoom(aDie: HTMLDivElement): number {
        const cssWidth = parseFloat(window.getComputedStyle(aDie).width);
        return cssWidth > 0 ? aDie.getBoundingClientRect().width / cssWidth : 1;
    }

    private playChangeAnimation(aDie: HTMLDivElement): void {
        aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
        void aDie.offsetWidth; // restart the animation if it's already running
        aDie.classList.add(DiceHandler.CHANGE_ANIM_CLASS);
        aDie.addEventListener('animationend', () => aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS), { once: true });
    }

    public getDieDiv(color: DieColor): HTMLDivElement { return this.diceContainer.querySelector(`.die-slot > .a-die[data-color="${color}"]`); } //never a fading copy
    private getDieSlot(color: DieColor): HTMLDivElement { return this.diceContainer.querySelector(`.die-slot[data-color="${color}"]`); }
    public getDiceContainer(): HTMLDivElement{ return this.diceContainer; }
    public getDiceData(): RivieraDie[]{ return this.diceData; }
}
