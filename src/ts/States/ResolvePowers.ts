/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * ResolvePowers.ts
 */
import { Game } from "../Game";

/**
 * Card 11, before the next roll: the active owner may add the golden die to the next roll, or skip.
 * (Card 2 needs no choice and card 10 has its own SwapCards state.)
 * When another 11 already added it, adding it too keeps it in the next roll if that player stops.
 */
export class ResolvePowers {
    constructor(private game: Game, private bga: Bga<RivieraPlayer, RivieraGamedatas>) {
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args: ResolvePowersArgs, isCurrentPlayerActive: boolean) {
        if(!isCurrentPlayerActive){
            this.bga.statusBar.setTitle(_('${actplayer} may add the golden die to the next roll (card 11)'));
            return;
        }

        if(args?.goldenDieAlreadyAdded){
            this.bga.statusBar.setTitle(_('The golden die is already added: ${you} may add it too (card 11), so it stays even if the other player stops'));
            this.bga.statusBar.addActionButton(_('Add it too'), () => this.bga.actions.performAction('actAddGoldenDie_POWER11'), {id: 'add-golden-die-button'});
        } else {
            this.bga.statusBar.setTitle(_('${you} may add the golden die to the next roll (card 11)'));
            this.bga.statusBar.addActionButton(_('Add the golden die'), () => this.bga.actions.performAction('actAddGoldenDie_POWER11'), {id: 'add-golden-die-button'});
        }
        this.bga.statusBar.addActionButton(_('Skip'), () => this.bga.actions.performAction('actSkip_POWER11'), {id: 'skip-power-button', color: 'secondary'});
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args: ResolvePowersArgs, isCurrentPlayerActive: boolean) {
    }
}
