import { Game } from "./Game";
import { PlayerHandler } from "./PlayerHandler";

export class PlayedColumnHandler{
    private static readonly SLIDE_ANIM_TIME = 600;
    private static readonly CLEAR_ANIM_TIME = 400;

    private columnContainer: HTMLDivElement;
    private cardsColumn: HTMLDivElement;
    private starsText: HTMLSpanElement;

    constructor(private game: Game, private owner: PlayerHandler, private playedCardsData: PlayedCard[]) {
        const parent = document.querySelector('#played-columns-container');
        if (parent) {
            this.columnContainer = document.createElement('div');
            this.columnContainer.className = 'a-played-column';
            this.columnContainer.setAttribute('data-owner-id', `${this.owner.getPlayerID()}`);
            this.columnContainer.setAttribute('data-is-myself', 'false');
            this.columnContainer.style.setProperty('--column-owner-color', '#' + this.owner.getPlayerColor());

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

    private updateStarsTotal(): void{
        this.starsText.textContent = `★ ${this.getStarsTotal()}`;
    }

    public setMyColumn(isMyColumn: boolean): void{
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if(isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }

    public setRoundStatus(roundStatus: RoundStatus): void{ this.columnContainer.setAttribute('data-round-status', roundStatus); }
    public getColumnContainer(): HTMLDivElement{ return this.columnContainer; }
}
