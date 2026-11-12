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
    //"Show players as" (gamepreferences.jsonc, pref 103): the played columns' headers show each player's avatar or name
    private static readonly PLAYERS_DISPLAY_AVATAR = 1;
    private static readonly PLAYERS_DISPLAY_NAME = 2;

    private oneClickPlay: boolean = false;
    private playersDisplay: number = PrefHandler.PLAYERS_DISPLAY_AVATAR;

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
            case this.prefNameToIndex.background_trees:
                this.game.backgroundHandler.applyTreePreference(prefValue);
            break;
            case this.prefNameToIndex.background_drift:
                this.game.backgroundHandler.applyDriftPreference(prefValue);
            break;
            case this.prefNameToIndex.players_display:
                this.applyPlayersDisplay(prefValue);
            break;
        }
    }

    //game specific functions

    //clicking a playable card plays it at once, with no Confirm step
    public isOneClickPlay(): boolean { return this.oneClickPlay; }

    //every column header follows one attribute on #played-columns-container, so all of them switch together. Any value other
    //than Player name is Profile picture (the default; also a missing value, as for a spectator with no saved preference)
    private applyPlayersDisplay(prefValue: number): void{
        this.playersDisplay = prefValue == PrefHandler.PLAYERS_DISPLAY_NAME ? PrefHandler.PLAYERS_DISPLAY_NAME : PrefHandler.PLAYERS_DISPLAY_AVATAR;
        document.getElementById('played-columns-container')?.setAttribute('data-players-display', this.playersDisplay == PrefHandler.PLAYERS_DISPLAY_NAME ? 'name' : 'avatar');
    }

    //a click on any column header's avatar or name: switches every header at once and saves the choice as the preference, so
    //BGA's preferences menu shows it too. Applied here first, since saving may not be possible (a spectator who isn't logged
    //in); the onChange that follows a successful save applies the same value again, which changes nothing
    public togglePlayersDisplay(): void{
        const newValue = this.playersDisplay == PrefHandler.PLAYERS_DISPLAY_NAME ? PrefHandler.PLAYERS_DISPLAY_AVATAR : PrefHandler.PLAYERS_DISPLAY_NAME;
        this.applyPlayersDisplay(newValue);
        try {
            this.game.bga.userPreferences.set(this.prefNameToIndex.players_display, newValue);
        } catch (e) {
            console.error('Could not save the "Show players as" preference', e);
        }
    }

    //end game specific functions
}
