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

/**
 * Card 9, after the roll: the active owner picks a die that hasn't been changed this roll, then turns it by 1
 * (6 wraps to 1, 1 wraps to 6), or skips.
 */
export class ModifyDie {
    private modifiableDice: { color: DieColor; value: number; }[] = [];

    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: ModifyDieArgs, isCurrentPlayerActive: boolean) {
        this.modifiableDice = args?.modifiableDice ?? [];

        if(!isCurrentPlayerActive){
            this.bga.statusBar.setTitle(_('${actplayer} may change a die (card 9)'));
            return;
        }

        this.game.diceHandler.setSelectableDice(this.modifiableDice.map(die => die.color));
        this.updateStatusBar();
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: ModifyDieArgs, isCurrentPlayerActive: boolean) {
        this.game.diceHandler.clearSelectableDice();
    }

    //called by DiceHandler when a die is selected or unselected
    public dieSelectionChanged(): void {
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        this.bga.statusBar.removeActionButtons();

        const selectedColor = this.game.diceHandler.getSelectedDieColor();
        const selectedDie = this.modifiableDice.find(die => die.color === selectedColor);

        if(selectedDie){
            this.bga.statusBar.setTitle(_('${you} may turn this die by 1'));

            const lowerValue = (selectedDie.value === 1) ? 6 : selectedDie.value - 1;
            const higherValue = (selectedDie.value === 6) ? 1 : selectedDie.value + 1;
            this.bga.statusBar.addActionButton(_('Turn to ${value}').replace('${value}', lowerValue.toString()), () => this.modifyDie(selectedDie.color, -1), {id: 'die-minus-button'});
            this.bga.statusBar.addActionButton(_('Turn to ${value}').replace('${value}', higherValue.toString()), () => this.modifyDie(selectedDie.color, 1), {id: 'die-plus-button'});
        } else {
            this.bga.statusBar.setTitle(_('${you} may choose a die to turn by 1 (card 9)'));
        }

        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER9'), {id: 'skip-power-button', color: 'secondary'});
    }

    private modifyDie(dieColor: DieColor, delta: number): void {
        this.bga.actions.performAction('actModifyDie_POWER9', { dieColor: dieColor, delta: delta });
    }
}
