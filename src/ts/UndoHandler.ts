/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * UndoHandler.ts
 */
import { Game } from "./Game";

//"Undo", shared by every multiactive state where a choice stays pending until the last player has chosen.
//The player is inactive by then, so the action skips the active-player check (checkAction: false) and the
//server checks the state itself (#[CheckAction(false)] + checkPossibleAction)
export class UndoHandler{
    constructor(private game: Game) {
    }

    public addUndoButton(actionName: string): HTMLButtonElement {
        return this.game.bga.statusBar.addActionButton(_('Undo'), () => this.undoClicked(actionName), {
            id: 'undo-button',
            color: 'alert',
        });
    }

    private undoClicked(actionName: string): void {
        if(!this.game.bga.actions.checkPossibleActions(actionName))
            return;

        this.game.bga.actions.performAction(actionName, {}, { checkAction: false });
    }
}
