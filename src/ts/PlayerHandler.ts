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
    private static readonly END_GAME_SCORE_INTRO_CLASS = 'end-game-score-intro'; //on the score counter: the two big beats when the score crosses WINNING_SCORE, once (Game.scss)
    private static readonly END_GAME_SCORE_LOOP_CLASS = 'end-game-score-loop'; //on the score counter: the gentle pulse after the intro, until the game ends
    private static readonly BURNING_CLASS = 'burning-player-board'; //on the board: the flamy background, exactly while the score's intro or loop runs

    private playerBoardContainer: HTMLDivElement;
    private cardsRow: HTMLDivElement;
    private handCountBacks: HTMLDivElement;
    private lastChanceIndicator: HTMLDivElement;
    private boardElement: HTMLDivElement;
    private startTokenAnchor: HTMLElement;
    private scoreElement: HTMLElement | null = null; //BGA's score counter span, through getScoreElement()
    private scoreTargetElement: HTMLSpanElement; //"/40" right after BGA's score counter, never inside it (updateScoreTarget)
    private clippedScoreAncestors: { element: HTMLElement; overflow: string; }[] = []; //overflow made visible while the score scales
    private playedColumn: PlayedColumnHandler;

	constructor(private game: Game, private playerID: number, private playerName: string, private playerColor: string, private playerNo: number, private handCount: number, private roundStatus: RoundStatus, private lastChanceUsed: boolean, private playedCardsData: PlayedCard[], private score: number) {
        this.createPlayerBoardContainer();

        this.setHandCount(this.handCount);
        this.setLastChanceUsed(this.lastChanceUsed);
        this.updateScoreTarget();
        this.updateEndGameScoreHighlight(); //on load: no intro, straight to the loop (nothing once the game is over)

        this.playedColumn = new PlayedColumnHandler(this.game, this, this.playedCardsData);
        this.setRoundStatus(this.roundStatus);
	}

    //every player board, spectators included, shows the hand count, Last Chance and, out of the round, a STOPPED or CRASHED
    //stamp (shown by data-round-status, see setRoundStatus). The Start token is not in this content: it is a badge on BGA's
    //avatar (startTokenAnchor) and takes no layout space
    private createPlayerBoardContainer(){
        this.playerBoardContainer = document.createElement('div');
        this.playerBoardContainer.classList.add('riviera-player-board');
        this.playerBoardContainer.innerHTML = `
            <div class="player-board-cards-row">
                <div class="hand-count-backs"></div>
                <div class="last-chance-indicator"></div>
                <div class="round-status-stamp stopped-stamp">${_('Stopped')}</div>
                <div class="round-status-stamp crashed-stamp"><i class="fa6 fa-bomb"></i>${_('Crashed')}</div>
            </div>
        `;

        const playerPanel = this.game.bga.playerPanels.getElement(this.playerID);
        playerPanel.appendChild(this.playerBoardContainer);

        this.cardsRow = this.playerBoardContainer.querySelector('.player-board-cards-row');
        this.handCountBacks = this.playerBoardContainer.querySelector('.hand-count-backs');
        this.lastChanceIndicator = this.playerBoardContainer.querySelector('.last-chance-indicator');
        this.boardElement = (playerPanel.closest('.player-board') as HTMLDivElement) ?? playerPanel; //BGA's whole board around our panel
        this.boardElement.classList.add('positioned-player-board');
        this.boardElement.addEventListener('animationend', (event: AnimationEvent) => { //the board's own bounce, not a child's animation
            if(event.target === this.boardElement && event.animationName === PlayerHandler.BOUNCE_CLASS)
                this.boardElement.classList.remove(PlayerHandler.BOUNCE_CLASS);
        });
        this.startTokenAnchor = this.createStartTokenAnchor();
        this.updateStartTokenPlace();

        this.scoreTargetElement = document.createElement('span');
        this.scoreTargetElement.classList.add('score-target');
        this.scoreTargetElement.textContent = '/' + this.game.getWinningScore();

        //ids for TooltipHandler
        this.handCountBacks.id = 'hand-count-backs-' + this.playerID;
        this.scoreTargetElement.id = 'score-target-' + this.playerID;

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
    //during play plays the intro (two big beats) before the loop; in fast replay or a hidden tab, straight to the loop.
    //Once the game is over (the final scores, a Grand Slam's score), no intro: updateEndGameScoreHighlight clears everything
    public setScore(score: number): void {
        const previousScore = this.score;
        this.score = score;
        this.game.bga.playerPanels.getScoreCounter(this.playerID)?.toValue(score);
        this.updateScoreTarget();

        const winningScore = this.game.getWinningScore();
        const crossed = previousScore < winningScore && score >= winningScore;
        if(crossed && this.getEndGameScoreHighlight() === 'loop' && this.game.bga.gameui.bgaAnimationsActive())
            this.applyScoreHighlight('intro');
        else this.updateEndGameScoreHighlight();
    }

    //the "/40" after the score: kept right after BGA's score counter (put back if BGA has replaced the counter) and hidden once
    //the score is past WINNING_SCORE. Setup and setScore (every score notification, replays, the end-game table) call it
    private updateScoreTarget(): void {
        const scoreElement = this.getScoreElement();
        if(!scoreElement)
            return;

        if(scoreElement.nextElementSibling !== this.scoreTargetElement)
            scoreElement.after(this.scoreTargetElement);
        this.scoreTargetElement.hidden = this.score > this.game.getWinningScore();
    }

    //the one place that decides the score's end-game look, from the score and the game's progress. Safe to call any time
    //(setup, score changes, BGA's layout hooks, the game end): a running intro or loop is never restarted, and an intro
    //still playing during the game is left to finish (its animationend brings the loop)
    public updateEndGameScoreHighlight(): void {
        const highlight = this.getEndGameScoreHighlight();
        if(highlight === 'loop' && this.getScoreElement()?.classList.contains(PlayerHandler.END_GAME_SCORE_INTRO_CLASS))
            return;
        this.applyScoreHighlight(highlight);
    }

    //game over: BGA's default look, whatever the score. Below WINNING_SCORE: nothing. At it or more: the gentle loop, or
    //just red and bold with reduced motion
    private getEndGameScoreHighlight(): 'none' | 'static' | 'loop' {
        if(this.game.isGameOver() || this.score < this.game.getWinningScore())
            return 'none';
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'static' : 'loop';
    }

    //one state at a time, so the intro and the loop never run together. 'static' is red and bold (the board's
    //END_GAME_SCORE_CLASS); the loop adds the gentle pulse to it; the intro turns the score red itself and the board class
    //only comes with the loop. The board burns (BURNING_CLASS) while the score animates, intro or loop, never on its own.
    //Ancestors that clip stay unclipped while the score scales
    private applyScoreHighlight(highlight: 'none' | 'static' | 'intro' | 'loop'): void {
        this.boardElement.classList.toggle(PlayerHandler.END_GAME_SCORE_CLASS, highlight === 'static' || highlight === 'loop');
        const scoreElement = this.getScoreElement();
        this.boardElement.classList.toggle(PlayerHandler.BURNING_CLASS, !!scoreElement && (highlight === 'intro' || highlight === 'loop'));
        if(!scoreElement)
            return;

        const animationClass = (highlight === 'intro') ? PlayerHandler.END_GAME_SCORE_INTRO_CLASS : (highlight === 'loop') ? PlayerHandler.END_GAME_SCORE_LOOP_CLASS : null;
        if(animationClass && scoreElement.classList.contains(animationClass))
            return; //already running: never restarted

        scoreElement.classList.remove(PlayerHandler.END_GAME_SCORE_INTRO_CLASS, PlayerHandler.END_GAME_SCORE_LOOP_CLASS);
        if(animationClass){
            void scoreElement.offsetWidth; //a fresh start for the new animation
            scoreElement.classList.add(animationClass);
            this.unclipScoreAncestors(scoreElement);
        }
        else this.restoreScoreAncestorsOverflow();
    }

    //BGA's score counter span, marked .player-score-counter for Game.scss. Looked up again whenever the one we hold has
    //left the page, so the highlight always lands on the span BGA shows
    private getScoreElement(): HTMLElement | null {
        if(this.scoreElement?.isConnected)
            return this.scoreElement;

        this.scoreElement = document.getElementById('player_score_' + this.playerID);
        this.scoreElement?.classList.add('player-score-counter');
        this.scoreElement?.addEventListener('animationend', (event: AnimationEvent) => {
            if(event.target !== event.currentTarget || event.animationName !== 'end-game-score-beats')
                return;
            (event.currentTarget as HTMLElement).classList.remove(PlayerHandler.END_GAME_SCORE_INTRO_CLASS); //the intro held its red last frame until here
            this.updateEndGameScoreHighlight();
        });
        return this.scoreElement;
    }

    //the score grows to 1.8x in the intro and the loop alike: any ancestor up to the board that clips its overflow lets it show meanwhile
    private unclipScoreAncestors(scoreElement: HTMLElement): void {
        this.restoreScoreAncestorsOverflow();
        if(!this.boardElement.contains(scoreElement)) //never walk past the board
            return;

        for(let element = scoreElement.parentElement; element; element = element.parentElement){
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

    //data-round-status shows one stamp at most. In: nothing. Stopped: the hand area greys out under the STOPPED stamp.
    //Crashed: the CRASHED stamp (the hand count is already 0). The next round's 'in' clears both
    public setRoundStatus(roundStatus: RoundStatus): void {
        this.roundStatus = roundStatus;

        this.playerBoardContainer.setAttribute('data-round-status', roundStatus);
        this.boardElement.classList.toggle(PlayerHandler.STOPPED_CLASS, roundStatus === 'stopped');
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
