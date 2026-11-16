/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * PlayedColumnHandler.ts
 */
import { Game } from "./Game";
import { PlayerHandler } from "./PlayerHandler";

export class PlayedColumnHandler{
    private static readonly LIGHT_COLOR_LUMINANCE = 0.3; //relative luminance above which white text on the color falls under a 3:1 contrast: the score badge gets dark text instead
    private static readonly SWAP_TARGET_CLASS_POWER10 = 'swap-target-column-power10'; //card 10: a column that can be clicked to swap with its owner (Game.scss)

    private columnContainer: HTMLDivElement;
    private cardsColumn: HTMLDivElement;
    private starsText: HTMLSpanElement;
    private roundStatus: RoundStatus = 'in';
    private swapTargetClickedPOWER10: (() => void) | null = null; //card 10: set while this column is a swap target (setSwapTargetPOWER10)

    constructor(private game: Game, private owner: PlayerHandler, private playedCardsData: PlayedCard[]) {
        const parent = document.querySelector('#played-columns-container');
        if (parent) {
            this.columnContainer = document.createElement('div');
            this.columnContainer.className = 'a-played-column';
            this.columnContainer.setAttribute('data-owner-id', `${this.owner.getPlayerID()}`);
            this.columnContainer.setAttribute('data-is-myself', 'false');
            this.columnContainer.style.setProperty('--column-owner-color', '#' + this.owner.getPlayerColor());
            this.columnContainer.setAttribute('data-light-owner-color', PlayedColumnHandler.isLightColor(this.owner.getPlayerColor()) ? 'true' : 'false');

            //the avatar or the name, whichever the "Show players as" preference picks (PrefHandler, an attribute on
            //#played-columns-container), is one button: a click switches every column's header
            this.columnContainer.innerHTML = `
                <div class="played-column-title">
                    <span class="played-column-player" id="column-player-${this.owner.getPlayerID()}" role="button" tabindex="0">
                        <span class="played-column-avatar"></span>
                        <span class="played-column-name"></span>
                    </span>
                    <span class="played-column-stars"></span>
                </div>
                <div class="cards-column"></div>
            `;
            this.columnContainer.querySelector('.played-column-name').textContent = this.owner.getPlayerName(); //full name in the tooltip (TooltipHandler)
            this.fillAvatar(this.columnContainer.querySelector('.played-column-avatar') as HTMLSpanElement);

            //while the column is a card 10 swap target, a click or key on the header goes to the column (the swap) instead
            const playerButton = this.columnContainer.querySelector('.played-column-player') as HTMLSpanElement;
            playerButton.addEventListener('click', () => {
                if(!this.swapTargetClickedPOWER10)
                    this.game.prefHandler?.togglePlayersDisplay();
            });
            playerButton.addEventListener('keydown', (event: KeyboardEvent) => {
                if((event.key !== 'Enter' && event.key !== ' ') || this.swapTargetClickedPOWER10)
                    return;
                event.preventDefault(); //no page scroll on Space
                this.game.prefHandler?.togglePlayersDisplay();
            });

            this.columnContainer.addEventListener('click', () => this.swapTargetClickedPOWER10?.());
            this.columnContainer.addEventListener('keydown', (event: KeyboardEvent) => {
                if((event.key !== 'Enter' && event.key !== ' ') || !this.swapTargetClickedPOWER10)
                    return;
                event.preventDefault(); //no page scroll on Space
                this.swapTargetClickedPOWER10();
            });
            this.columnContainer.addEventListener('mouseenter', () => {
                if(this.swapTargetClickedPOWER10)
                    this.owner.setSwapTargetHighlightPOWER10(true);
            });
            this.columnContainer.addEventListener('mouseleave', () => this.owner.setSwapTargetHighlightPOWER10(false));

            parent.appendChild(this.columnContainer);
        }

        this.cardsColumn = this.columnContainer.querySelector('.cards-column') as HTMLDivElement;
        this.starsText = this.columnContainer.querySelector('.played-column-stars') as HTMLSpanElement;
        this.starsText.id = 'column-stars-' + this.owner.getPlayerID(); //for TooltipHandler

        this.displayColumn();
    }

    //the owner's BGA avatar (Game.fillPlayerAvatar), or the name's initial on the owner's color, so every header can show a circle
    private fillAvatar(avatarContainer: HTMLSpanElement): void{
        this.game.fillPlayerAvatar(avatarContainer, this.owner.getPlayerID(), 'played-column-avatar-image', 'played-column-avatar-initial');
    }

    private displayColumn(): void{
        this.cardsColumn.innerHTML = ''; // Clear existing cards

        const sortedCards = [...this.playedCardsData].sort((a, b) => a.location_in_column - b.location_in_column);
        for(let cardData of sortedCards)
            this.insertCardToColumn(cardData);

        this.owner.updateScoreDisplays();
    }

    //cards are stacked top to bottom in play order, each later card covering all but the star strip of the one before
    private insertCardToColumn(cardData: PlayedCard){
        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());
        this.cardsColumn.appendChild(aCard);
    }

    public addCard(cardData: PlayedCard): void{
        this.playedCardsData.push(cardData);
        this.insertCardToColumn(cardData);
        this.owner.updateScoreDisplays();
    }

    //a revealed card slides in from fromElement: my hand card, at its full size the whole way, or (fromBoard) another player's
    //hand count on their board, starting at Game.BOARD_CARD_SCALE centered on its top mini card back and growing to full size.
    //The sliding copy is placed on fromElement before the first await, so the caller can remove fromElement right after calling this
    public async animateCardIn(cardData: PlayedCard, fromElement: HTMLDivElement, fromBoard: boolean = false): Promise<void>{
        this.playedCardsData.push(cardData);

        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());

        await this.game.animateSlide(aCard, fromElement, this.cardsColumn, Game.CARD_SLIDE_DURATION, fromBoard ? { boardEnd: true } : { keepSize: true });
        this.owner.updateScoreDisplays();
    }

    //a new round empties the column: its cards sweep off-screen up-left, the bottom (fully shown) card first, like
    //peeling the stack, staggerMs apart. The column keeps its height until the sweep has ended, so nothing below it moves meanwhile
    public async clear(durationMs: number = Game.CARD_SWEEP_DURATION, staggerMs: number = Game.CARD_SWEEP_STAGGER): Promise<void>{
        const cards = Array.from(this.cardsColumn.querySelectorAll('.a-card')) as HTMLDivElement[];
        if(cards.length > 0)
            this.cardsColumn.style.minHeight = getComputedStyle(this.cardsColumn).height; //CSS px, unrounded
        const sweep = this.game.sweepCardsOffScreen(cards.reverse(), durationMs, staggerMs);
        this.removeAllCards();

        await sweep;
        this.cardsColumn.style.minHeight = '';
    }

    //every card leaves the column at once, with no animation (a crash's cards have already tumbled out, Game.notif_crashAnimation)
    public removeAllCards(): void{
        this.playedCardsData = [];
        this.cardsColumn.innerHTML = '';
        this.owner.updateScoreDisplays();
    }

    public getCardElements(): HTMLDivElement[]{ return Array.from(this.cardsColumn.querySelectorAll('.a-card')) as HTMLDivElement[]; } //top to bottom, in play order

    public getStarsTotal(): number{
        return this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
    }

    //[BGA] the header's badge, only from PlayerHandler.updateScoreDisplays (which also fills the board's "+N" chip): the column
    //stars not banked yet ("★7"). A stopped column's stars are already in the score (banked at the Stop reveal) and can't
    //change: the badge shows the bank icon with no number, so it doesn't read as stars still to come. Its tooltip gives the
    //amount. A crashed column's badge shows a bomb (the crash log row's icon), also with no number
    public updateStarsBadge(unbankedStars: number): void{
        if(this.isBanked())
            this.starsText.innerHTML = this.game.getBankIconHtml('played-column-bank-icon');
        else if(this.isCrashed())
            this.starsText.innerHTML = '<i class="fa6 fa-bomb played-column-bomb" aria-hidden="true"></i>';
        else this.starsText.innerHTML = `<span class="played-column-star">★</span>${unbankedStars}`;
    }

    public isBanked(): boolean{ return this.roundStatus === 'stopped'; }
    public isCrashed(): boolean{ return this.roundStatus === 'crashed'; }

    //hexColor without the #, as BGA gives player colors
    public static isLightColor(hexColor: string): boolean{
        const channels = [0, 2, 4].map(offset => parseInt(hexColor.substring(offset, offset + 2), 16) / 255);
        const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue > PlayedColumnHandler.LIGHT_COLOR_LUMINANCE;
    }

    public setMyColumn(isMyColumn: boolean): void{
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if(isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }

    //also on setup (before the TooltipHandler exists: its constructor adds the badge tooltip itself) and on the new round's 'in'
    public setRoundStatus(roundStatus: RoundStatus): void{
        this.roundStatus = roundStatus;
        this.columnContainer.setAttribute('data-round-status', roundStatus);
        this.owner.updateScoreDisplays();
        this.game.tooltipHandler?.updateColumnStarsTooltip(this.owner.getPlayerID());
    }
    public getColumnContainer(): HTMLDivElement{ return this.columnContainer; }

    //card 10, while the active owner chooses whom to swap with (SwapCards): onClick makes the whole column a button doing the
    //same as its "Swap with <name>" button, with a selectable look (Game.scss) and the owner's board lit up on hover. null
    //takes all of it away
    public setSwapTargetPOWER10(onClick: (() => void) | null): void{
        this.swapTargetClickedPOWER10 = onClick;
        this.columnContainer.classList.toggle(PlayedColumnHandler.SWAP_TARGET_CLASS_POWER10, !!onClick);
        if(onClick){
            this.columnContainer.setAttribute('role', 'button');
            this.columnContainer.setAttribute('tabindex', '0');
        }
        else{
            this.columnContainer.removeAttribute('role');
            this.columnContainer.removeAttribute('tabindex');
            this.owner.setSwapTargetHighlightPOWER10(false); //no mouseleave comes if the pointer is still on it
        }
    }
}
