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

    //a die that has not been rolled yet (value null) shows a blank face
    private applyDieData(aDie: HTMLDivElement, dieData: RivieraDie): void {
        aDie.setAttribute('data-value', dieData.value === null ? '' : dieData.value.toString());
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

            if(previousValue !== aDie.getAttribute('data-value'))
                this.playChangeAnimation(aDie);
        }
    }

    private playChangeAnimation(aDie: HTMLDivElement): void {
        aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS);
        void aDie.offsetWidth; // restart the animation if it's already running
        aDie.classList.add(DiceHandler.CHANGE_ANIM_CLASS);
        aDie.addEventListener('animationend', () => aDie.classList.remove(DiceHandler.CHANGE_ANIM_CLASS), { once: true });
    }

    public getDieDiv(color: DieColor): HTMLDivElement { return this.diceContainer.querySelector(`.a-die[data-color="${color}"]`); }
    private getDieSlot(color: DieColor): HTMLDivElement { return this.diceContainer.querySelector(`.die-slot[data-color="${color}"]`); }
    public getDiceContainer(): HTMLDivElement{ return this.diceContainer; }
    public getDiceData(): RivieraDie[]{ return this.diceData; }
}
