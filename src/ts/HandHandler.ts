import { Game } from "./Game";
import { PlayedColumnHandler } from "./PlayedColumnHandler";

export class HandHandler{
    private static readonly SELECTED_CARD_CLASS = 'selected-hand-card';
    private static readonly CHOSEN_CARD_CLASS = 'chosen-card';
    private static readonly PLAYABLE_CARD_CLASS = 'playable-card';
    private static readonly FADE_ANIM_TIME = 400;

    private handContainer: HTMLDivElement;
    private cardsContainer: HTMLDivElement;

    constructor(private game: Game, private handData: RivieraCard[]) {
        // my hand only: spectators never get one, other players' hands are only counts on their player boards
        this.handContainer = document.querySelector('#my-hand-container');
        this.handContainer.classList.add('a-hand-container');
        this.handContainer.setAttribute('data-owner-id', `${this.game.getMyPlayerID()}`);
        this.handContainer.style.setProperty('--hand-owner-color', '#' + this.game.getPlayerColor(this.game.getMyPlayerID()));

        this.handContainer.innerHTML = `
            <div class="my-hand-title">
                <div class="my-hand-title-text">${_('Your hand')}</div>
            </div>
            <div class="cards-container"></div>
        `;

        this.cardsContainer = this.handContainer.querySelector('.cards-container') as HTMLDivElement;
        this.cardsContainer.addEventListener('click', (event: Event) => { this.cardsContainerClicked(event); });

        this.displayHand();
    }

    private displayHand(): void{
        this.cardsContainer.innerHTML = ''; // Clear existing cards

        for(let cardData of this.getSortedHandData())
            this.insertCardToHand(cardData);
    }

    //sorted like the sprite: by color index, then value
    private getSortedHandData(): RivieraCard[]{
        return [...this.handData].sort((a, b) => (this.game.getColorIndex(a.color) - this.game.getColorIndex(b.color)) || (a.value - b.value));
    }

    private insertCardToHand(cardData: RivieraCard){
        let aCard = this.game.createCardDiv(cardData);
        this.cardsContainer.appendChild(aCard);
    }

    private cardsContainerClicked(event: Event){
        if(!this.game.bga.players.isCurrentPlayerActive())
            return;

        if(!['PlayCard'].includes(this.game.getGameStateName()))
            return;

        if(this.game.isInterfaceLocked())
            return;

        if(!(event.target as HTMLElement).classList.contains(HandHandler.PLAYABLE_CARD_CLASS))
            return;

        this.handCardClicked(event.target as HTMLDivElement);
    }

    //selecting a playable card only raises it; the status-bar confirmation sends it
    private handCardClicked(cardDiv: HTMLDivElement){
        const cardWasAlreadySelected: boolean = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);
        this.clearSelection();

        if(!cardWasAlreadySelected)
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);

        this.game.playCard.selectionChanged();
    }

    private clearSelection(): void{
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }

    public getSelectedCardID(): number | null{
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }

    public getSelectedCardData(): RivieraCard | null{
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.handData.find(card => card.card_id === selectedCardID) ?? null;
    }

    //playable cards glow, the others keep their normal look
    public setPlayableCards(playableCardIDs: number[]): void{
        for(let card of this.getCardDivs())
            card.classList.toggle(HandHandler.PLAYABLE_CARD_CLASS, playableCardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }

    public clearPlayableCards(): void{
        this.clearSelection();
        for(let card of this.getCardDivs())
            card.classList.remove(HandHandler.PLAYABLE_CARD_CLASS);
    }

    //the card chosen this turn stays set aside in the hand until the reveal, or until "Change my mind"
    public setChosenCard(cardID: number | null): void{
        for(let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardID !== null && parseInt(card.getAttribute('data-card-id')) === cardID);
    }

    //the card leaves the hand at once while a copy of it slides into the played column
    public async animateCardToColumn(cardData: PlayedCard, column: PlayedColumnHandler): Promise<void>{
        this.handData = this.handData.filter(handCard => handCard.card_id !== cardData.card_id);

        const handCard = this.getCardDiv(cardData.card_id);
        if(!handCard){
            column.addCard(cardData);
            return;
        }

        const slidePromise = column.animateCardIn(cardData, handCard); //places the sliding copy on handCard before its first await,
        handCard.remove();                                              //so the hand card can go right away
        await slidePromise;
    }

    //a crash discards the whole hand
    public async discardAll(): Promise<void>{
        this.handData = [];
        this.cardsContainer.classList.add('cards-fading-out');
        await this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME);

        this.cardsContainer.innerHTML = '';
        this.cardsContainer.classList.remove('cards-fading-out');
    }

    //a new round's hand
    public setHand(handData: RivieraCard[]): void{
        this.handData = handData;
        this.displayHand();

        this.cardsContainer.classList.remove('cards-fading-in');
        void this.cardsContainer.offsetWidth; //restart the animation if it's already running
        this.cardsContainer.classList.add('cards-fading-in');
    }

    private getCardDivs(): HTMLDivElement[]{ return Array.from(this.cardsContainer.querySelectorAll('.a-card')) as HTMLDivElement[]; }
    private getCardDiv(cardID: number): HTMLDivElement{ return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }

    public getCardCount(): number{ return this.cardsContainer.querySelectorAll('.a-card').length; }
    public getHandContainer(): HTMLDivElement{ return this.handContainer; }
}
