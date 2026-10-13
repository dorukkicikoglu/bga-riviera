import { Game } from "./Game";

export class DiceHandler{
    private static readonly PIPS_PER_DIE = 9; //3x3 layout, Game.scss shows the right pips for each data-value
    private static readonly CHANGE_ANIM_CLASS = 'die-changed';
    private static readonly SELECTABLE_DIE_CLASS = 'selectable-die';
    private static readonly SELECTED_DIE_CLASS = 'selected-die';

    private diceContainer: HTMLDivElement;

    constructor(private game: Game, private diceData: RivieraDie[]) {
        this.diceContainer = document.querySelector('#dice-container');

        for(let dieData of this.diceData)
            this.diceContainer.appendChild(this.createDieDiv(dieData));

        this.diceContainer.addEventListener('click', (event: Event) => { this.diceContainerClicked(event); });
    }

    //card 9: the active owner picks one die, then turns it with the status bar buttons
    private diceContainerClicked(event: Event){
        if(!this.game.bga.players.isCurrentPlayerActive())
            return;

        if(this.game.getGameStateName() !== 'ModifyDie')
            return;

        if(this.game.isInterfaceLocked())
            return;

        const aDie = (event.target as HTMLElement).closest('.a-die') as HTMLDivElement;
        if(!aDie || !aDie.classList.contains(DiceHandler.SELECTABLE_DIE_CLASS))
            return;

        const dieWasAlreadySelected = aDie.classList.contains(DiceHandler.SELECTED_DIE_CLASS);
        this.clearDieSelection();
        if(!dieWasAlreadySelected)
            aDie.classList.add(DiceHandler.SELECTED_DIE_CLASS);

        this.game.modifyDie.dieSelectionChanged();
    }

    public setSelectableDice(colors: DieColor[]): void {
        this.clearSelectableDice();
        for(let color of colors)
            this.getDieDiv(color)?.classList.add(DiceHandler.SELECTABLE_DIE_CLASS);
    }

    public clearSelectableDice(): void {
        this.clearDieSelection();
        this.diceContainer.querySelectorAll('.a-die.' + DiceHandler.SELECTABLE_DIE_CLASS).forEach(aDie => aDie.classList.remove(DiceHandler.SELECTABLE_DIE_CLASS));
    }

    private clearDieSelection(): void {
        this.diceContainer.querySelectorAll('.a-die.' + DiceHandler.SELECTED_DIE_CLASS).forEach(aDie => aDie.classList.remove(DiceHandler.SELECTED_DIE_CLASS));
    }

    public getSelectedDieColor(): DieColor | null {
        const selectedDie = this.diceContainer.querySelector('.a-die.' + DiceHandler.SELECTED_DIE_CLASS);
        return selectedDie ? selectedDie.getAttribute('data-color') as DieColor : null;
    }

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
        for(let dieData of diceData){
            const aDie = this.getDieDiv(dieData.color);
            if(!aDie)
                continue;

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
    public getDiceContainer(): HTMLDivElement{ return this.diceContainer; }
}
