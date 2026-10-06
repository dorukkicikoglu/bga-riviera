import { Game } from "./Game";

//"Change my mind", shared by every multiactive state where a choice stays pending until the last player has chosen.
//The player is inactive by then, so the action skips the active-player check (checkAction: false) and the
//server checks the state itself (#[CheckAction(false)] + checkPossibleAction)
export class ChangeMindHandler{
    constructor(private game: Game) {
    }

    public addChangeMindButton(actionName: string): HTMLButtonElement {
        return this.game.bga.statusBar.addActionButton(_('Change my mind'), () => this.changeMindClicked(actionName), {
            id: 'change-mind-button',
            color: 'secondary',
        });
    }

    private changeMindClicked(actionName: string): void {
        if(!this.game.bga.actions.checkPossibleActions(actionName))
            return;

        this.game.bga.actions.performAction(actionName, {}, { checkAction: false });
    }
}
