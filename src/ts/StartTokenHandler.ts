/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * StartTokenHandler.ts
 */
import { Game } from "./Game";

export class StartTokenHandler{
    private static readonly SLIDE_ANIM_TIME = 600;

    private startToken: HTMLDivElement;

    constructor(private game: Game, private startPlayerID: number) {
        this.startToken = document.createElement('div');
        this.startToken.id = 'start-token';
        this.startToken.className = 'start-token';

        const startTokenSlot = this.game.players[this.startPlayerID]?.getStartTokenSlot();
        if(startTokenSlot)
            startTokenSlot.appendChild(this.startToken);
	}

    //slides the token from its current player board to playerID's, the same way cards move between containers
    public async moveTo(playerID: number){
        const targetSlot = this.game.players[playerID]?.getStartTokenSlot();
        if(!targetSlot)
            return;

        this.startPlayerID = playerID;

        if(this.startToken.parentElement === targetSlot)
            return;

        if(!this.startToken.parentElement){ //nothing to slide from
            targetSlot.appendChild(this.startToken);
            return;
        }

        await this.game.animateSlide(this.startToken, this.startToken, targetSlot, StartTokenHandler.SLIDE_ANIM_TIME);
    }

    public getStartPlayerID(): number { return this.startPlayerID; }
}
