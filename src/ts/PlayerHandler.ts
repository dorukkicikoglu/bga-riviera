/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * PlayerHandler.ts
 */
import { Game } from "./Game";
import { PlayedColumnHandler } from "./PlayedColumnHandler";

export class PlayerHandler{
    private static readonly MAX_INDIVIDUAL_CARD_BACKS = 7; //above this, the hand count shows a single card back followed by "x N"
    private static readonly LAST_CHANCE_FADE_ANIM_TIME = 400;
    private static readonly BOUNCE_CLASS = 'bouncing-player-board'; //the one shared bounce class, its timing lives in Game.scss
    private static readonly STOPPED_CLASS = 'stopped-player-board'; //greys out the hand area under the STOPPED stamp
    private static readonly END_GAME_SCORE_CLASS = 'end-game-score-player-board'; //the score stays red and bold at WINNING_SCORE or more
    private static readonly END_GAME_SCORE_ANIM_CLASS = 'end-game-score-reached'; //on the score counter, the one-shot two beats (Game.scss)

    private playerBoardContainer: HTMLDivElement;
    private cardsRow: HTMLDivElement;
    private handCountBacks: HTMLDivElement;
    private lastChanceIndicator: HTMLDivElement;
    private roundStatusIndicator: HTMLDivElement;
    private boardElement: HTMLDivElement;
    private startTokenAnchor: HTMLElement;
    private scoreElement: HTMLElement | null;
    private clippedScoreAncestors: { element: HTMLElement; overflow: string; }[] = []; //overflow made visible while the score beats
    private playedColumn: PlayedColumnHandler;

	constructor(private game: Game, private playerID: number, private playerName: string, private playerColor: string, private playerNo: number, private handCount: number, private roundStatus: RoundStatus, private lastChanceUsed: boolean, private playedCardsData: PlayedCard[], score: number) {
        this.createPlayerBoardContainer();

        this.setHandCount(this.handCount);
        this.setLastChanceUsed(this.lastChanceUsed);
        this.boardElement.classList.toggle(PlayerHandler.END_GAME_SCORE_CLASS, score >= this.game.getWinningScore()); //no animation on load

        this.playedColumn = new PlayedColumnHandler(this.game, this, this.playedCardsData);
        this.setRoundStatus(this.roundStatus);
	}

    //every player board, spectators included, shows the hand count, Last Chance and a crash. The Start token is not in this
    //content: it is a badge on BGA's avatar (startTokenAnchor) and takes no layout space
    private createPlayerBoardContainer(){
        this.playerBoardContainer = document.createElement('div');
        this.playerBoardContainer.classList.add('riviera-player-board');
        this.playerBoardContainer.innerHTML = `
            <div class="player-board-cards-row">
                <div class="hand-count-backs"></div>
                <div class="last-chance-indicator"></div>
                <div class="stopped-stamp">${_('Stopped')}</div>
            </div>
            <div class="player-board-status-row">
                <div class="round-status-indicator"></div>
            </div>
        `;

        const playerPanel = this.game.bga.playerPanels.getElement(this.playerID);
        playerPanel.appendChild(this.playerBoardContainer);

        this.cardsRow = this.playerBoardContainer.querySelector('.player-board-cards-row');
        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.roundStatusIndicator = this.playerBoardContainer.querySelector('.round-status-indicator');
        this.boardElement = (playerPanel.closest('.player-board') as HTMLDivElement) ?? playerPanel; //BGA's whole board around our panel
        this.boardElement.classList.add('positioned-player-board');
        this.boardElement.addEventListener('animationend', (event: AnimationEvent) => { //the board's own bounce, not a child's animation
            if(event.target === this.boardElement && event.animationName === PlayerHandler.BOUNCE_CLASS)
                this.boardElement.classList.remove(PlayerHandler.BOUNCE_CLASS);
        });
        this.startTokenAnchor = this.createStartTokenAnchor();
        this.updateStartTokenPlace();

        this.scoreElement = document.getElementById('player_score_' + this.playerID); //BGA's score counter
        this.scoreElement?.classList.add('player-score-counter');
        this.scoreElement?.addEventListener('animationend', (event: AnimationEvent) => {
            if(event.target === this.scoreElement && event.animationName === 'end-game-score-beats')
                this.endEndGameScoreAnimation();
        });

        //ids for TooltipHandler
        this.handCountBacks.id = 'hand-count-backs-' + this.playerID;
        this.roundStatusIndicator.id = 'round-status-' + this.playerID;

        const lastChanceCard = this.game.createLastChanceDiv();
        lastChanceCard.classList.add('mini-card');
        this.lastChanceIndicator.prepend(lastChanceCard);
    }

    //the Start token is a badge on the bottom-right corner of BGA's avatar. Its anchor is BGA's .player_board_inner (positioned
    //here if BGA leaves it static), never the avatar's wrapper: BGA hides #avatarwrap_<id> while the player is active and shows
    //#avatar_active_wrap_<id> (the hourglass) in the same spot. With no .player_board_inner, the whole board
    private createStartTokenAnchor(): HTMLElement {
        const anchor = (this.boardElement.querySelector('.player_board_inner') as HTMLElement) ?? this.boardElement;
        if(getComputedStyle(anchor).position === 'static')
            anchor.style.position = 'relative';
        anchor.classList.add('start-token-anchor');
        return anchor;
    }

    //where the avatar's bottom-right corner is in the anchor (--start-token-avatar-right / -bottom, in the anchor's px from its
    //padding box), measured on whichever avatar wrapper is showing, the avatar or the hourglass. Game.scss places the token
    //over that corner and clamps it inside the anchor. Both hidden (or not found): the last measurement stays, else the
    //CSS fallback (the anchor's top-left inside corner)
    public updateStartTokenPlace(): void {
        const avatarWrapper = ['avatarwrap_', 'avatar_active_wrap_']
            .map(prefix => document.getElementById(prefix + this.playerID))
            .find(element => element && this.startTokenAnchor.contains(element) && element.getBoundingClientRect().width > 0);
        if(!avatarWrapper)
            return;

        const anchorRect = this.startTokenAnchor.getBoundingClientRect();
        const cssWidth = parseFloat(getComputedStyle(this.startTokenAnchor).width); //unrounded, unlike offsetWidth
        if(!(cssWidth > 0) || anchorRect.width <= 0)
            return;

        const zoom = anchorRect.width / cssWidth; //BGA scales the page on mobile
        const avatarRect = avatarWrapper.getBoundingClientRect();
        const right = (avatarRect.right - anchorRect.left) / zoom - this.startTokenAnchor.clientLeft;
        const bottom = (avatarRect.bottom - anchorRect.top) / zoom - this.startTokenAnchor.clientTop;
        this.startTokenAnchor.style.setProperty('--start-token-avatar-right', `${right}px`);
        this.startTokenAnchor.style.setProperty('--start-token-avatar-bottom', `${bottom}px`);
    }

    //the Last Chance card keeps the same gap to the board's right edge as the card backs have to its left edge, which comes
    //from BGA's own padding. Measured on screen, then turned into this board's px (BGA scales the page on mobile)
    public updateLastChanceInset(): void {
        const boardRect = this.boardElement.getBoundingClientRect();
        const rowRect = this.cardsRow.getBoundingClientRect();
        const cssWidth = parseFloat(getComputedStyle(this.cardsRow).width); //unrounded, unlike offsetWidth
        if(!(cssWidth > 0) || rowRect.width <= 0)
            return;

        const zoom = rowRect.width / cssWidth;
        const currentMargin = parseFloat(getComputedStyle(this.lastChanceIndicator).marginRight) || 0; //inside the row, so it doesn't move rowRect
        const leftInset = rowRect.left - boardRect.left;
        const rightInset = boardRect.right - rowRect.right;
        const margin = Math.max(0, (leftInset - rightInset) / zoom);
        if(Math.abs(margin - currentMargin) > 0.5)
            this.playerBoardContainer.style.setProperty('--last-chance-margin-right', `${margin}px`);
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

    //card 10: the whole BGA player board (boardElement) bounces once a swap or redraw has landed. Nothing waits for it:
    //the class comes off by itself on animationend. No bounce in fast replay or a hidden tab
    public bounceBoard(): void {
        if(!this.game.bga.gameui.bgaAnimationsActive())
            return;

        this.boardElement.classList.remove(PlayerHandler.BOUNCE_CLASS);
        void this.boardElement.offsetWidth; //restarts a bounce still playing
        this.boardElement.classList.add(PlayerHandler.BOUNCE_CLASS);
    }

    //px the board is lifted by its bounce right now (0 at rest), so a measurement can be brought back to the resting place
    public getBounceOffset(): number {
        if(!this.boardElement.classList.contains(PlayerHandler.BOUNCE_CLASS))
            return 0;
        return parseFloat(getComputedStyle(this.boardElement).top) || 0;
    }

    //every live score change goes through here: BGA's score counter, then the end-game highlight. Crossing WINNING_SCORE
    //plays the two beats once (not in fast replay, a hidden tab or with reduced motion: then the red state alone)
    public setScore(score: number): void {
        const scoreCounter = this.game.bga.playerPanels.getScoreCounter(this.playerID);
        const previousScore = scoreCounter?.getValue() ?? 0;
        scoreCounter?.toValue(score);

        const winningScore = this.game.getWinningScore();
        const crossed = previousScore < winningScore && score >= winningScore;
        const animate = crossed && this.scoreElement && this.game.bga.gameui.bgaAnimationsActive() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if(!animate){
            this.boardElement.classList.toggle(PlayerHandler.END_GAME_SCORE_CLASS, score >= winningScore);
            return;
        }

        this.unclipScoreAncestors();
        this.scoreElement.classList.remove(PlayerHandler.END_GAME_SCORE_ANIM_CLASS);
        void this.scoreElement.offsetWidth;
        this.scoreElement.classList.add(PlayerHandler.END_GAME_SCORE_ANIM_CLASS);
    }

    //the animation holds its last (red) frame until here, so the persistent class takes over in the same frame
    private endEndGameScoreAnimation(): void {
        this.boardElement.classList.add(PlayerHandler.END_GAME_SCORE_CLASS);
        this.scoreElement.classList.remove(PlayerHandler.END_GAME_SCORE_ANIM_CLASS);
        this.restoreScoreAncestorsOverflow();
    }

    //the score grows to 1.8x for a moment: any ancestor up to the board that clips its overflow lets it show meanwhile
    private unclipScoreAncestors(): void {
        this.restoreScoreAncestorsOverflow();
        for(let element = this.scoreElement.parentElement; element; element = element.parentElement){
            if(getComputedStyle(element).overflow !== 'visible'){
                this.clippedScoreAncestors.push({ element, overflow: element.style.overflow });
                element.style.overflow = 'visible';
            }
            if(element === this.boardElement)
                break;
        }
    }
    private restoreScoreAncestorsOverflow(): void {
        this.clippedScoreAncestors.forEach(({ element, overflow }) => element.style.overflow = overflow);
        this.clippedScoreAncestors = [];
    }

    public setGrandSlam(): void {
        this.playerBoardContainer.classList.add('grand-slam-player-board');
        this.playedColumn.getColumnContainer().classList.add('grand-slam-column');
    }

    //in: nothing shown. Stopped: the hand area greys out under the STOPPED stamp (cleared by the next round's 'in').
    //Crashed: the "Crashed" line
    public setRoundStatus(roundStatus: RoundStatus): void {
        this.roundStatus = roundStatus;

        this.playerBoardContainer.setAttribute('data-round-status', roundStatus);
        this.boardElement.classList.toggle(PlayerHandler.STOPPED_CLASS, roundStatus === 'stopped');
        this.roundStatusIndicator.innerHTML = (roundStatus === 'crashed') ? `<i class="fa6 fa-bomb"></i>&nbsp;${_('Crashed')}` : '';
        this.playedColumn.setRoundStatus(roundStatus);
    }

    public getPlayerID(): number { return this.playerID; }
    public getPlayerName(): string { return this.playerName; }
    public getPlayerColor(): string { return this.playerColor; }
    public getHandCount(): number { return this.handCount; }
    public getPlayedColumn(): PlayedColumnHandler { return this.playedColumn; }
    public getStartTokenAnchor(): HTMLElement { return this.startTokenAnchor; }
    public getHandCountElement(): HTMLDivElement { return this.handCountBacks; }

    //where card 10's swapped cards fly to and from in my hand: BGA's avatar on this player's board, or the top mini card
    //back of the hand count when the avatar isn't shown
    public getAvatarRect(): DOMRect {
        const avatarRect = document.getElementById('avatar_' + this.playerID)?.getBoundingClientRect();
        if(avatarRect && avatarRect.width > 0 && avatarRect.height > 0)
            return avatarRect;

        const cardBacks = this.handCountBacks.querySelectorAll('.a-card');
        return (cardBacks.length > 0) ? cardBacks[cardBacks.length - 1].getBoundingClientRect() : this.handCountBacks.getBoundingClientRect();
    }
}
