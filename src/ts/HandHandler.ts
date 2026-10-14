/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * HandHandler.ts
 */
import { Game } from "./Game";
import { PlayedColumnHandler } from "./PlayedColumnHandler";

export class HandHandler{
    private static readonly SELECTED_CARD_CLASS = 'selected-hand-card';
    private static readonly CHOSEN_CARD_CLASS = 'chosen-card';
    private static readonly SELECTABLE_CARD_CLASS = 'selectable-card';
    private static readonly FADE_ANIM_TIME = 400;
    private static readonly HAND_FADE_IN_CLASS = 'cards-fading-in';
    private static readonly HAND_FADE_IN_ANIM_TIME = 500; //card-fade-in on .cards-fading-in in Game.scss
    private static readonly SLIDE_ANIM_TIME = 600;
    private static readonly SELECTION_STATES = ['PlayCard', 'SwapCards'];
    private static readonly DEFAULT_CARD_OVERLAP = 0.1; //share of a card width each card covers of the one before
    private static readonly MAX_CARD_OVERLAP = 0.7;
    private static readonly MOBILE_HAND_SPAN_PERCENT = 99; //like Fugu: on mobile the hand spans 99% of its container's width
    private static readonly MOBILE_MAX_CARD_OVERLAP = 0.85; //on mobile a card may cover this share of the one before
    private static readonly RESIZE_DEBOUNCE_TIME = 100;

    private handContainer: HTMLDivElement;
    private cardsContainer: HTMLDivElement;
    private maxSelectedCards: number = 1;
    private handFadeInCount: number = 0;
    private resizeDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

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

        this.recomputeCardSpacing();
    }

    //called by Game.onScreenWidthChange (BGA's resize hook, covers orientation changes too): the screen can change without
    //the hand changing, so the spacing is recomputed on its own trigger too, debounced like Fugu's recomputeMobileCardSpacing
    public recomputeCardSpacingAfterResize(): void{
        if(this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);

        this.resizeDebounceTimeout = setTimeout(() => this.recomputeCardSpacing(), HandHandler.RESIZE_DEBOUNCE_TIME);
    }

    //the hand always fits on one row. Desktop: cards overlap more only when they wouldn't fit. Mobile: Fugu's spacing
    public recomputeCardSpacing(): void{
        if(this.game.isMobile())
            this.applyMobileCardSpacing();
        else this.applyDesktopCardSpacing();
    }

    private applyDesktopCardSpacing(): void{
        const cards = this.getCardDivs();
        cards.forEach(card => { card.style.marginLeft = null; card.style.marginRight = null; }); //left over from the mobile layout

        if(cards.length < 2 || this.cardsContainer.clientWidth === 0){
            this.cardsContainer.style.removeProperty('--hand-card-overlap');
            return;
        }

        const cardWidth = cards[0].offsetWidth;
        const neededOverlap = (cardWidth * cards.length - this.cardsContainer.clientWidth) / (cards.length - 1);
        const overlap = Math.min(cardWidth * HandHandler.MAX_CARD_OVERLAP, Math.max(cardWidth * HandHandler.DEFAULT_CARD_OVERLAP, neededOverlap));
        this.cardsContainer.style.setProperty('--hand-card-overlap', `${-overlap}px`);
    }

    //Fugu's applyMobileCardSpacing: every card but the last gets the same negative margin-right, in % of the container,
    //so the row (one line, every card at the same height) spans MOBILE_HAND_SPAN_PERCENT of it and stays centered. A short hand keeps the default overlap instead of
    //spreading out. Widths come from offsetWidth / clientWidth, so transforms and BGA's mobile scaling don't affect them
    private applyMobileCardSpacing(): void{
        this.cardsContainer.style.removeProperty('--hand-card-overlap');

        const cards = this.getCardDivs();
        if(cards.length === 0 || this.cardsContainer.clientWidth === 0)
            return;

        const cardWidthPercent = cards[0].offsetWidth / this.cardsContainer.clientWidth * 100;
        let marginPercent = (cards.length > 1) ? (HandHandler.MOBILE_HAND_SPAN_PERCENT - cards.length * cardWidthPercent) / (cards.length - 1) : 0;
        marginPercent = Math.min(marginPercent, -cardWidthPercent * HandHandler.DEFAULT_CARD_OVERLAP);
        marginPercent = Math.max(marginPercent, -cardWidthPercent * HandHandler.MOBILE_MAX_CARD_OVERLAP);

        cards.forEach((card, i) => {
            card.style.marginLeft = '0%';
            card.style.marginRight = (i === cards.length - 1) ? '0%' : `${marginPercent.toFixed(3)}%`;
        });
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

        if(!HandHandler.SELECTION_STATES.includes(this.game.getGameStateName()))
            return;

        if(this.game.isInterfaceLocked())
            return;

        if(!(event.target as HTMLElement).classList.contains(HandHandler.SELECTABLE_CARD_CLASS))
            return;

        this.handCardClicked(event.target as HTMLDivElement);
    }

    //selecting a card only raises it; the status-bar confirmation sends it. With one card at most (card play),
    //a click moves the selection; with more (card 10), clicks add cards until the limit
    private handCardClicked(cardDiv: HTMLDivElement){
        const cardWasAlreadySelected: boolean = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);

        if(cardWasAlreadySelected){
            cardDiv.classList.remove(HandHandler.SELECTED_CARD_CLASS);
        } else if(this.maxSelectedCards === 1){
            this.clearSelection();
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
        } else if(this.getSelectedCardIDs().length < this.maxSelectedCards){
            cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
        }

        this.game.handSelectionChanged();
    }

    private clearSelection(): void{
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }

    public getSelectedCardID(): number | null{
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }

    public getSelectedCardIDs(): number[]{
        return Array.from(this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS)).map(card => parseInt(card.getAttribute('data-card-id')));
    }

    public getSelectedCardData(): RivieraCard | null{
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.getCardData(selectedCardID);
    }

    public getCardData(cardID: number): RivieraCard | null{
        return this.handData.find(card => card.card_id === cardID) ?? null;
    }

    //selectable cards glow, the others keep their normal look
    public setSelectableCards(selectableCardIDs: number[], maxSelectedCards: number = 1): void{
        this.clearSelection();
        this.maxSelectedCards = maxSelectedCards;

        for(let card of this.getCardDivs())
            card.classList.toggle(HandHandler.SELECTABLE_CARD_CLASS, selectableCardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }

    public clearSelectableCards(): void{
        this.clearSelection();
        for(let card of this.getCardDivs())
            card.classList.remove(HandHandler.SELECTABLE_CARD_CLASS);
    }

    //the cards chosen this turn (a first card, then any card-1 chain) stay set aside in the hand until the reveal, or until "Change my mind"
    public setChosenCards(cardIDs: number[]): void{
        for(let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }

    //card 10: cards leaving my hand fade out
    public async removeCards(cardIDs: number[]): Promise<void>{
        this.handData = this.handData.filter(handCard => !cardIDs.includes(handCard.card_id));

        const leavingCards = cardIDs.map(cardID => this.getCardDiv(cardID)).filter(card => card);
        leavingCards.forEach(card => card.classList.add('card-fading-out'));
        await this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME);
        leavingCards.forEach(card => card.remove());
        this.recomputeCardSpacing();
    }

    //card 10: cards joining my hand take their sorted place and slide in from fromElement (the other player's board), or fade in
    public async addCards(cardsData: RivieraCard[], fromElement: HTMLDivElement | null): Promise<void>{
        this.handData = [...this.handData, ...cardsData];
        this.displayHand();

        const arrivals = cardsData.map(cardData => {
            const card = this.getCardDiv(cardData.card_id);
            if(!card)
                return Promise.resolve();

            if(fromElement)
                return this.game.animateSlide(card, fromElement, null, HandHandler.SLIDE_ANIM_TIME);

            card.classList.add('card-fading-in');
            return this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME).then(() => card.classList.remove('card-fading-in'));
        });

        await Promise.all(arrivals);
    }

    public getHandCardIDs(): number[]{ return this.handData.map(cardData => cardData.card_id); }

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
        this.recomputeCardSpacing();
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
    //the fade-in class must come off once it has played: left on, card-fade-in stays every card's fallback animation
    //and replays whenever another animation stops applying (the playable glow when I confirm a card, for example)
    public setHand(handData: RivieraCard[]): void{
        this.cardsContainer.classList.remove(HandHandler.HAND_FADE_IN_CLASS);
        this.handData = handData;
        this.displayHand();

        void this.cardsContainer.offsetWidth; //restart the animation if it's already running
        this.cardsContainer.classList.add(HandHandler.HAND_FADE_IN_CLASS);

        const handFadeInID = ++this.handFadeInCount; //a newer hand restarts the fade-in: only its own timer may end it
        this.game.bga.gameui.wait(HandHandler.HAND_FADE_IN_ANIM_TIME).then(() => {
            if(handFadeInID === this.handFadeInCount)
                this.cardsContainer.classList.remove(HandHandler.HAND_FADE_IN_CLASS);
        });
    }

    private getCardDivs(): HTMLDivElement[]{ return Array.from(this.cardsContainer.querySelectorAll('.a-card')) as HTMLDivElement[]; }
    private getCardDiv(cardID: number): HTMLDivElement{ return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }

    public getCardCount(): number{ return this.cardsContainer.querySelectorAll('.a-card').length; }
    public getHandContainer(): HTMLDivElement{ return this.handContainer; }
}
