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

    //slides the token from its current player board to playerID's, the same way Fugu moves cards between containers:
    //a clone flies over the page while the real token waits hidden in its new slot
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

        const tokenClone = this.startToken.cloneNode(true) as HTMLDivElement;
        tokenClone.removeAttribute('id');
        tokenClone.classList.add('cloned-start-token');
        document.body.appendChild(tokenClone);
        this.game.placeOnObject(tokenClone, this.startToken, true);

        this.startToken.style.visibility = 'hidden';
        targetSlot.appendChild(this.startToken);

        const tokenRect = this.startToken.getBoundingClientRect();
        const cloneRect = tokenClone.getBoundingClientRect();
        const targetLeft = parseFloat(tokenClone.style.left || '0') + (tokenRect.left - cloneRect.left);
        const targetTop = parseFloat(tokenClone.style.top || '0') + (tokenRect.top - cloneRect.top);

        await this.game.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in

        tokenClone.style.transition = `left ${StartTokenHandler.SLIDE_ANIM_TIME}ms ease-in-out, top ${StartTokenHandler.SLIDE_ANIM_TIME}ms ease-in-out`;
        tokenClone.style.left = targetLeft + 'px';
        tokenClone.style.top = targetTop + 'px';

        await this.game.bga.gameui.wait(StartTokenHandler.SLIDE_ANIM_TIME);

        this.startToken.style.visibility = null;
        tokenClone.remove();
    }

    public getStartPlayerID(): number { return this.startPlayerID; }
}
