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
    private static readonly SLIDE_ANIM_TIME = 600;
    private static readonly CLEAR_ANIM_TIME = 400;
    private static readonly LIGHT_COLOR_LUMINANCE = 0.3; //relative luminance above which white text on the color falls under a 3:1 contrast: the score badge gets dark text instead
    //the banked badge's icon, inline (BGA's Font Awesome has no piggy bank). Body, coin slot and eye are one evenodd path, so
    //the slot and the eye are holes showing the pill behind them
    private static readonly PIGGY_BANK_SVG = `<svg class="played-column-piggy-bank" viewBox="0 0 23 20" aria-hidden="true" focusable="false">
            <path fill-rule="evenodd" d="M2.5 10.5a8.5 6.5 0 1 0 17 0a8.5 6.5 0 1 0 -17 0Z M10.2 5.1h4.4v1.2h-4.4Z M14.6 8.3a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0Z"/>
            <path d="M5.5 6L6.8 1.8L9.8 4.4Z"/>
            <rect x="18.5" y="8.2" width="3.5" height="4.6" rx="1.2"/>
            <rect x="5.5" y="14.5" width="3" height="4.5" rx="1"/>
            <rect x="12.5" y="14.5" width="3" height="4.5" rx="1"/>
            <path d="M2.8 9C1 9 0.8 7 2.2 6.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>`;

    private columnContainer: HTMLDivElement;
    private cardsColumn: HTMLDivElement;
    private starsText: HTMLSpanElement;
    private roundStatus: RoundStatus = 'in';

    constructor(private game: Game, private owner: PlayerHandler, private playedCardsData: PlayedCard[]) {
        const parent = document.querySelector('#played-columns-container');
        if (parent) {
            this.columnContainer = document.createElement('div');
            this.columnContainer.className = 'a-played-column';
            this.columnContainer.setAttribute('data-owner-id', `${this.owner.getPlayerID()}`);
            this.columnContainer.setAttribute('data-is-myself', 'false');
            this.columnContainer.style.setProperty('--column-owner-color', '#' + this.owner.getPlayerColor());
            this.columnContainer.setAttribute('data-light-owner-color', PlayedColumnHandler.isLightColor(this.owner.getPlayerColor()) ? 'true' : 'false');

            this.columnContainer.innerHTML = `
                <div class="played-column-title">
                    <span class="played-column-name"></span>
                    <span class="played-column-stars"></span>
                </div>
                <div class="cards-column"></div>
            `;
            this.columnContainer.querySelector('.played-column-name').textContent = this.owner.getPlayerName();
            this.columnContainer.querySelector('.played-column-name').setAttribute('title', this.owner.getPlayerName()); //full name on hover when it's cut

            parent.appendChild(this.columnContainer);
        }

        this.cardsColumn = this.columnContainer.querySelector('.cards-column') as HTMLDivElement;
        this.starsText = this.columnContainer.querySelector('.played-column-stars') as HTMLSpanElement;
        this.starsText.id = 'column-stars-' + this.owner.getPlayerID(); //for TooltipHandler

        this.displayColumn();
    }

    private displayColumn(): void{
        this.cardsColumn.innerHTML = ''; // Clear existing cards

        const sortedCards = [...this.playedCardsData].sort((a, b) => a.location_in_column - b.location_in_column);
        for(let cardData of sortedCards)
            this.insertCardToColumn(cardData);

        this.updateStarsTotal();
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
        this.updateStarsTotal();
    }

    //a revealed card slides in from fromElement (my hand card, or another player's hand count on their board).
    //The sliding copy is placed on fromElement before the first await, so the caller can remove fromElement right after calling this
    public async animateCardIn(cardData: PlayedCard, fromElement: HTMLDivElement): Promise<void>{
        this.playedCardsData.push(cardData);

        let aCard = this.game.createCardDiv(cardData);
        aCard.setAttribute('data-location-in-column', cardData.location_in_column.toString());

        await this.game.animateSlide(aCard, fromElement, this.cardsColumn, PlayedColumnHandler.SLIDE_ANIM_TIME);
        this.updateStarsTotal();
    }

    //a crash or a new round empties the column
    public async clear(): Promise<void>{
        this.playedCardsData = [];

        if(this.cardsColumn.children.length > 0){
            this.cardsColumn.classList.add('cards-fading-out');
            await this.game.bga.gameui.wait(PlayedColumnHandler.CLEAR_ANIM_TIME);
            this.cardsColumn.classList.remove('cards-fading-out');
        }

        this.cardsColumn.innerHTML = '';
        this.updateStarsTotal();
    }

    public getStarsTotal(): number{
        return this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
    }

    //a stopped column's stars are already in the score (banked at the Stop reveal) and can't change: the badge shows the
    //piggy bank with no number, so it doesn't read as stars still to come. Its tooltip gives the amount
    private updateStarsTotal(): void{
        this.starsText.innerHTML = this.isBanked() ? PlayedColumnHandler.PIGGY_BANK_SVG : `<span class="played-column-star">★</span>${this.getStarsTotal()}`;
    }

    public isBanked(): boolean{ return this.roundStatus === 'stopped'; }

    //hexColor without the #, as BGA gives player colors
    private static isLightColor(hexColor: string): boolean{
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
        this.updateStarsTotal();
        this.game.tooltipHandler?.updateColumnStarsTooltip(this.owner.getPlayerID());
    }
    public getColumnContainer(): HTMLDivElement{ return this.columnContainer; }
}
