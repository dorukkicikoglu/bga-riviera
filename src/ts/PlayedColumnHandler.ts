import { Game } from "./Game";
import { PlayerHandler } from "./PlayerHandler";

export class PlayedColumnHandler{
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

    private updateStarsTotal(): void{
        const starsTotal = this.playedCardsData.reduce((total, cardData) => total + this.game.getStarsForValue(cardData.value), 0);
        this.starsText.textContent = `★ ${starsTotal}`;
    }

    public setMyColumn(isMyColumn: boolean): void{
        this.columnContainer.setAttribute('data-is-myself', isMyColumn ? 'true' : 'false');
        if(isMyColumn)
            this.columnContainer.querySelector('.played-column-name').textContent = _('You');
    }

    public setRoundStatus(roundStatus: RoundStatus): void{ this.columnContainer.setAttribute('data-round-status', roundStatus); }
    public getColumnContainer(): HTMLDivElement{ return this.columnContainer; }
}
