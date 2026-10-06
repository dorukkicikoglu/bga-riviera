import { Game } from "./Game";
import { PlayedColumnHandler } from "./PlayedColumnHandler";

export class PlayerHandler{
    private static readonly MAX_INDIVIDUAL_CARD_BACKS = 6; //above this, the hand count shows a single card back followed by "x N"
    private static readonly LAST_CHANCE_FADE_ANIM_TIME = 400;

    private playerBoardContainer: HTMLDivElement;
    private handCountBacks: HTMLDivElement;
    private lastChanceIndicator: HTMLDivElement;
    private roundStatusIndicator: HTMLDivElement;
    private startTokenSlot: HTMLDivElement;
    private playedColumn: PlayedColumnHandler;

	constructor(private game: Game, private playerID: number, private playerName: string, private playerColor: string, private playerNo: number, private handCount: number, private roundStatus: RoundStatus, private lastChanceUsed: boolean, private playedCardsData: PlayedCard[]) {
        this.createPlayerBoardContainer();

        this.setHandCount(this.handCount);
        this.setLastChanceUsed(this.lastChanceUsed);

        this.playedColumn = new PlayedColumnHandler(this.game, this, this.playedCardsData);
        this.setRoundStatus(this.roundStatus);
	}

    //every player board, spectators included, shows the hand count, Last Chance, round status and a slot for the Start token
    private createPlayerBoardContainer(){
        this.playerBoardContainer = document.createElement('div');
        this.playerBoardContainer.classList.add('riviera-player-board');
        this.playerBoardContainer.innerHTML = `
            <div class="player-board-cards-row">
                <div class="hand-count-backs"></div>
                <div class="last-chance-indicator"></div>
            </div>
            <div class="player-board-status-row">
                <div class="round-status-indicator"></div>
                <div class="start-token-slot"></div>
            </div>
        `;

        this.game.bga.playerPanels.getElement(this.playerID).appendChild(this.playerBoardContainer);

        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.roundStatusIndicator = this.playerBoardContainer.querySelector('.round-status-indicator');
        this.startTokenSlot = this.playerBoardContainer.querySelector('.start-token-slot');

        const lastChanceCard = this.game.createLastChanceDiv();
        lastChanceCard.classList.add('mini-card');
        this.lastChanceIndicator.prepend(lastChanceCard);
    }

    public setHandCount(handCount: number): void {
        this.handCount = handCount;
        this.handCountBacks.setAttribute('data-count', handCount.toString());
        this.handCountBacks.innerHTML = '';

        const individualBackCount = (handCount > PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS) ? 1 : handCount;
        for(let i = 0; i < individualBackCount; i++){
            const cardBack = this.game.createCardBackDiv();
            cardBack.classList.add('mini-card-back');
            this.handCountBacks.appendChild(cardBack);
        }

        if(handCount > PlayerHandler.MAX_INDIVIDUAL_CARD_BACKS)
            this.handCountBacks.insertAdjacentHTML('beforeend', `<span class="hand-count-text">x ${handCount}</span>`);
    }

    //a used Last Chance card disappears from the board; live, it shrinks and fades out first
    public async setLastChanceUsed(lastChanceUsed: boolean, animate: boolean = false): Promise<void> {
        this.lastChanceUsed = lastChanceUsed;

        if(lastChanceUsed && animate){
            this.lastChanceIndicator.classList.add('last-chance-fading');
            await this.game.bga.gameui.wait(PlayerHandler.LAST_CHANCE_FADE_ANIM_TIME);
            this.lastChanceIndicator.classList.remove('last-chance-fading');
        }

        this.lastChanceIndicator.setAttribute('data-used', lastChanceUsed ? 'true' : 'false');
    }

    public setGrandSlam(): void {
        this.playerBoardContainer.classList.add('grand-slam-player-board');
        this.playedColumn.getColumnContainer().classList.add('grand-slam-column');
    }

    public setRoundStatus(roundStatus: RoundStatus): void {
        this.roundStatus = roundStatus;

        const roundStatusTexts: Record<RoundStatus, {icon: string, text: string}> = {
            in: {icon: 'fa-play', text: _('In')},
            stopped: {icon: 'fa-flag-checkered', text: _('Stopped')},
            crashed: {icon: 'fa-bomb', text: _('Crashed')},
        };
        const {icon, text} = roundStatusTexts[roundStatus];

        this.roundStatusIndicator.setAttribute('data-round-status', roundStatus);
        this.roundStatusIndicator.innerHTML = `<i class="fa6 ${icon}"></i>&nbsp;${text}`;
        this.playedColumn.setRoundStatus(roundStatus);
    }

    public getPlayerID(): number { return this.playerID; }
    public getPlayerName(): string { return this.playerName; }
    public getPlayerColor(): string { return this.playerColor; }
    public getHandCount(): number { return this.handCount; }
    public getPlayedColumn(): PlayedColumnHandler { return this.playedColumn; }
    public getStartTokenSlot(): HTMLDivElement { return this.startTokenSlot; }
    public getHandCountElement(): HTMLDivElement { return this.handCountBacks; }
}
