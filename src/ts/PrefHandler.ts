/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * PrefHandler.ts
 */
import { Game } from "./Game";

export class PrefHandler{
    private oneClickPlay: boolean = false;

    constructor(private game: Game, private prefNameToIndex: GamePrefs) {
        this.game.bga.userPreferences.onChange = (prefIndex, prefValue) => this.onGameUserPreferenceChanged(prefIndex, prefValue);

        for(const prefName in this.prefNameToIndex){
            const prefIndex = this.prefNameToIndex[prefName];
            this.onGameUserPreferenceChanged(prefIndex, this.game.bga.userPreferences.get(prefIndex), true);
        }
    }

    //on page load (isInitialLoad) the state classes haven't received their args yet, so nothing is redrawn
    private onGameUserPreferenceChanged(prefIndex: number, prefValue: number, isInitialLoad: boolean = false): void{
        switch (prefIndex) {
            case this.prefNameToIndex.one_click_play:
                this.oneClickPlay = prefValue == 1;
                if(!isInitialLoad)
                    this.game.playCard.preferenceChanged();
            break;
        }
    }

    //game specific functions

    //clicking a playable card plays it at once, with no Confirm step
    public isOneClickPlay(): boolean { return this.oneClickPlay; }

    //end game specific functions
}
