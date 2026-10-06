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
