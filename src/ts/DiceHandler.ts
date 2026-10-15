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
    private static readonly DIE_FACES = 6;

    //roll-in (diceRolled): every die of the new roll slides in from past the dice container's right edge (the game area's;
    //Game.scss clips it there), spinning down to upright, while the previous roll's dice fade out in place, all at once
    private static readonly ROLL_DURATION = 450; //ms of each die's travel
    private static readonly ROLL_MAX_DELAY = 80; //ms, each die starts after a random delay up to this, so the dice don't move as one block
    private static readonly ROLL_EASING = 'cubic-bezier(0.25, 0.8, 0.35, 1)'; //ease-out with no overshoot: the dice decelerate into place
    private static readonly ROLL_START_GAP = 0.5; //die sizes between the container's right edge and the die's left edge at the start, so its rotated corners are hidden too
    private static readonly ROLL_START_LIFT = 0.4; //die sizes above its slot at the start
    private static readonly ROLL_MIN_SPIN = 180; //deg from upright at the start, in a random direction
    private static readonly ROLL_MAX_SPIN = 360; //deg
    private static readonly ROLL_FACE_CHANGES = 4; //random faces shown on the way, evenly spaced, before the real one
    private static readonly ROLL_FACE_SETTLE_FRACTION = 0.7; //share of the travel after which the die shows its real value, so it is right when it stops
    private static readonly FADE_OUT_DURATION = 300; //ms of the previous roll's dice fading out
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
    private applyDieData(aDie: HTMLDivElement, dieData: RivieraDie, isRoll: boolean = false): void {
        if(dieData.value !== null)
            aDie.setAttribute('data-value', dieData.value.toString());
        else if(isRoll || !aDie.getAttribute('data-value'))
            aDie.setAttribute('data-value', '');
        aDie.setAttribute('data-modified-by-power9', dieData.modified_by_POWER9 ? 'true' : 'false');
        aDie.setAttribute('data-in-use-by-power11', dieData.in_use_by_POWER11 ? 'true' : 'false');

        const reserverID = dieData.reserved_by_POWER2;
        aDie.setAttribute('data-reserved-by-power2', reserverID === null ? '' : reserverID.toString());
        if(reserverID !== null)
            aDie.style.setProperty('--reserver-color', '#' + this.game.getPlayerColor(reserverID));
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
            this.game.tooltipHandler?.updateDieTooltip(dieData);
            aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
            this.applyDieData(aDie, dieData, true);

            if(dieData.value !== null)
                rolledDice.push({ aDie: aDie, dieData: dieData });
        }

        if(animate)
            await Promise.all(rolledDice.map(rolledDie => this.rollIn(rolledDie.aDie, rolledDie.dieData)));
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

    //one die of the new roll, already at its final face and place: it starts off the container's right edge, a little
    //above its row, turned ROLL_MIN_SPIN to ROLL_MAX_SPIN either way, and slides and spins into its slot. Only translate and
    //rotate animate (never transform). fill 'backwards' keeps it off-screen during its delay. Random faces show on the way,
    //the real one from ROLL_FACE_SETTLE_FRACTION of the travel
    private async rollIn(aDie: HTMLDivElement, dieData: RivieraDie): Promise<void> {
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
        const faceTimers: number[] = [];
        for(let faceIndex = 1; faceIndex < DiceHandler.ROLL_FACE_CHANGES; faceIndex++){
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

    private getRandomFace(previousFace: number | null): number {
        let face: number;
        do {
            face = Math.floor(Math.random() * DiceHandler.DIE_FACES) + 1;
        } while(face === previousFace);
        return face;
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
