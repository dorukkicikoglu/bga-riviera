/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * ModifyDie.ts
 */
import { Game } from "../Game";
import { DiceHandler } from "../DiceHandler";

/**
 * Card 9, after the roll: the active owner turns one die that hasn't been changed this roll by 1 (6 wraps to 1,
 * 1 wraps to 6), or skips. Clicking a die's up (+1) or down (-1) arrow, or the top or bottom half of the die, selects
 * that choice; "Confirm" sends it ([BGA] like card play, the "One-click card play" preference sends it at once).
 * Everyone else only sees the status text.
 */
export class ModifyDie {
    private modifiableDice: { color: DieColor; value: number; }[] = [];
    private selectedChoice: { color: DieColor; delta: number; } | null = null;

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: ModifyDieArgs, isCurrentPlayerActive: boolean) {
        this.modifiableDice = args?.modifiableDice ?? [];
        this.selectedChoice = null;

        if(!isCurrentPlayerActive){
            this.bga.statusBar.setTitle(_('${actplayer} may change a die (card 9)'));
            return;
        }

        this.game.diceHandler.showModifyArrowsPOWER9(this.modifiableDice);
        this.updateStatusBar();
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: ModifyDieArgs, isCurrentPlayerActive: boolean) {
        this.selectedChoice = null;
        this.game.diceHandler.hideModifyArrowsPOWER9();
    }

    //called by DiceHandler: another choice switches the selection, the selected one clears it
    public choiceClicked(dieColor: DieColor, delta: number): void {
        if(this.game.prefHandler?.isOneClickPlay()){
            this.modifyDie(dieColor, delta);
            return;
        }

        const isSelectedChoice = this.selectedChoice?.color === dieColor && this.selectedChoice?.delta === delta;
        this.selectedChoice = isSelectedChoice ? null : { color: dieColor, delta: delta };
        this.game.diceHandler.setSelectedChoicePOWER9(this.selectedChoice);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        this.bga.statusBar.removeActionButtons();

        const selectedChoice = this.selectedChoice;
        const selectedDie = selectedChoice ? this.modifiableDice.find(die => die.color === selectedChoice.color) : null;

        if(selectedChoice && selectedDie){
            const newValue = DiceHandler.turnDieValue(selectedDie.value, selectedChoice.delta);
            this.bga.statusBar.setTitle(_('Turn ${die} ${oldValue} → ${newValue}?')
                .replace('${die}', this.getDieIconHTML(selectedDie.color))
                .replace('${oldValue}', selectedDie.value.toString())
                .replace('${newValue}', newValue.toString()));
            this.bga.statusBar.addActionButton(_('Confirm'), () => this.modifyDie(selectedChoice.color, selectedChoice.delta), {id: 'confirm-die-button'});
        } else {
            this.bga.statusBar.setTitle(_('${you} may turn a die up or down by 1 (card 9)'));
        }

        this.bga.statusBar.addActionButton(_('Skip'), () => this.skipClicked(), {id: 'skip-power-button', color: 'secondary'});
    }

    //"Skip" puts a previewed die back at once
    private skipClicked(): void {
        this.cancelSelection();
        this.bga.actions.performAction('actSkip_POWER9');
    }

    //clears the choice and its die preview; DiceHandler calls it when the server sends real dice values
    public cancelSelection(): void {
        if(!this.selectedChoice)
            return;

        this.selectedChoice = null;
        this.game.diceHandler.setSelectedChoicePOWER9(null);
        if(this.game.getGameStateName() === 'ModifyDie' && this.bga.players.isCurrentPlayerActive())
            this.updateStatusBar();
    }

    //a mini copy of the die with its real value (never the preview), for the status bar
    private getDieIconHTML(dieColor: DieColor): string {
        const dieData = this.game.diceHandler.getDiceData().find(die => die.color === dieColor);
        if(!dieData)
            return '';

        const dieIcon = this.game.diceHandler.createDieDiv(dieData);
        dieIcon.classList.add('status-die-icon');
        return dieIcon.outerHTML;
    }

    private modifyDie(dieColor: DieColor, delta: number): void {
        this.bga.actions.performAction('actModifyDie_POWER9', { dieColor: dieColor, delta: delta });
    }
}
