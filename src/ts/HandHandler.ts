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
import { POWER_CARD_VALUES } from "./TooltipHandler";

export class HandHandler{
    private static readonly SELECTED_CARD_CLASS = 'selected-hand-card';
    private static readonly CHOSEN_CARD_CLASS = 'chosen-card';
    private static readonly SELECTABLE_CARD_CLASS = 'selectable-card';
    private static readonly PLAYABLE_POWER_CARD_CLASS = 'playable-power-card'; //a playable power card glows cream instead of gold
    private static readonly CARD_GLOW_ANIMATIONS = ['selectable-card-glow-pulse', 'mobile-selectable-card-glow-pulse']; //Game.scss keyframes
    private static readonly FADE_ANIM_TIME = 400;
    //new hand (setHand): the previous round's leftover cards sweep out left while the new hand is dealt right to left,
    //every new card travelling the same path, shifted to its own slot
    private static readonly OLD_HAND_SWEEP_DURATION = 200; //ms the leftover cards take to slide left off-screen, all together, as the deal starts
    private static readonly OLD_HAND_SWEEP_EASING = 'ease-in'; //CSS timing function of the sweep
    private static readonly DEAL_X_OFFSET = 1.2; //a card starts this share of the window width to the left of its slot
    private static readonly DEAL_START_Y = 0; //page (document) y, in px, of every card's bottom edge at the start: 0 = just above the top of the page
    private static readonly DEAL_DURATION = 400; //ms each card slides for
    private static readonly DEAL_STAGGER = 100; //ms between the starts of two cards (a bit less than DEAL_DURATION: 1 or 2 cards move at once)
    private static readonly DEAL_EASING = 'ease-out'; //CSS timing function of each card's slide
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
    private selectionCounter: number = 0; //stamps data-selection-order on each selected card, so selections read back in the order they were made
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
        this.cardsContainer.addEventListener('animationstart', (event: AnimationEvent) => { this.syncCardGlow(event); });

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
    //a click moves the selection; with more (card 10), clicks add cards, and once the limit is reached a new card
    //replaces the oldest selected one (first in, first out). Clicking a selected card unselects it
    private handCardClicked(cardDiv: HTMLDivElement){
        const cardWasAlreadySelected: boolean = cardDiv.classList.contains(HandHandler.SELECTED_CARD_CLASS);

        if(cardWasAlreadySelected){
            cardDiv.classList.remove(HandHandler.SELECTED_CARD_CLASS);
        } else if(this.maxSelectedCards === 1){
            this.clearSelection();
            this.selectCard(cardDiv);
        } else {
            const selectedCards = this.getSelectedCardDivs();
            if(selectedCards.length >= this.maxSelectedCards)
                selectedCards[0].classList.remove(HandHandler.SELECTED_CARD_CLASS);
            this.selectCard(cardDiv);
        }

        this.game.handSelectionChanged();
    }

    private selectCard(cardDiv: HTMLDivElement): void{
        this.selectionCounter++;
        cardDiv.setAttribute('data-selection-order', this.selectionCounter.toString());
        cardDiv.classList.add(HandHandler.SELECTED_CARD_CLASS);
    }

    //selected cards, oldest selection first
    private getSelectedCardDivs(): HTMLDivElement[]{
        const selectedCards = Array.from(this.cardsContainer.querySelectorAll<HTMLDivElement>('.a-card.' + HandHandler.SELECTED_CARD_CLASS));
        return selectedCards.sort((a, b) => parseInt(a.getAttribute('data-selection-order') ?? '0') - parseInt(b.getAttribute('data-selection-order') ?? '0'));
    }

    private clearSelection(): void{
        this.cardsContainer.querySelectorAll('.a-card.' + HandHandler.SELECTED_CARD_CLASS).forEach(card => card.classList.remove(HandHandler.SELECTED_CARD_CLASS));
    }

    public getSelectedCardID(): number | null{
        const selectedCard = this.cardsContainer.querySelector('.a-card.' + HandHandler.SELECTED_CARD_CLASS);
        return selectedCard ? parseInt(selectedCard.getAttribute('data-card-id')) : null;
    }

    //in selection order, oldest first
    public getSelectedCardIDs(): number[]{
        return this.getSelectedCardDivs().map(card => parseInt(card.getAttribute('data-card-id')));
    }

    public getSelectedCardData(): RivieraCard | null{
        const selectedCardID = this.getSelectedCardID();
        return selectedCardID === null ? null : this.getCardData(selectedCardID);
    }

    public getCardData(cardID: number): RivieraCard | null{
        return this.handData.find(card => card.card_id === cardID) ?? null;
    }

    //selectable cards glow, the others keep their normal look. isPlay: the cards are playable cards, so power cards get their own glow
    public setSelectableCards(selectableCardIDs: number[], maxSelectedCards: number = 1, isPlay: boolean = false): void{
        this.clearSelection();
        this.maxSelectedCards = maxSelectedCards;

        for(let card of this.getCardDivs()){
            const isSelectable = selectableCardIDs.includes(parseInt(card.getAttribute('data-card-id')));
            card.classList.toggle(HandHandler.SELECTABLE_CARD_CLASS, isSelectable);
            card.classList.toggle(HandHandler.PLAYABLE_POWER_CARD_CLASS, isSelectable && isPlay && POWER_CARD_VALUES.includes(parseInt(card.getAttribute('data-value'))));
        }
    }

    //cards that start glowing together are already in phase; a card that starts while others already pulse (a later
    //setSelectableCards that keeps some cards playable) joins their phase, so gold and power cards always peak together
    private syncCardGlow(event: AnimationEvent): void{
        if(!HandHandler.CARD_GLOW_ANIMATIONS.includes(event.animationName))
            return;

        const isCardGlow = (animation: Animation) => animation instanceof CSSAnimation && HandHandler.CARD_GLOW_ANIMATIONS.includes(animation.animationName);
        const runningGlow = this.cardsContainer.getAnimations({ subtree: true })
            .find(animation => isCardGlow(animation) && (animation.effect as KeyframeEffect)?.target !== event.target && animation.startTime !== null);
        if(!runningGlow)
            return;

        for(let animation of (event.target as HTMLElement).getAnimations())
            if(isCardGlow(animation))
                animation.startTime = runningGlow.startTime;
    }

    public clearSelectableCards(): void{
        this.clearSelection();
        for(let card of this.getCardDivs())
            card.classList.remove(HandHandler.SELECTABLE_CARD_CLASS, HandHandler.PLAYABLE_POWER_CARD_CLASS);
    }

    //the cards chosen this turn (a first card, then any card-1 chain) stay set aside in the hand until the reveal, or until "Undo"
    public setChosenCards(cardIDs: number[]): void{
        for(let card of this.getCardDivs())
            card.classList.toggle(HandHandler.CHOSEN_CARD_CLASS, cardIDs.includes(parseInt(card.getAttribute('data-card-id'))));
    }

    //card 10 redraw: cards leaving my hand fade out
    public async removeCards(cardIDs: number[]): Promise<void>{
        this.handData = this.handData.filter(handCard => !cardIDs.includes(handCard.card_id));

        const leavingCards = cardIDs.map(cardID => this.getCardDiv(cardID)).filter(card => card);
        leavingCards.forEach(card => card.classList.add('card-fading-out'));
        await this.game.bga.gameui.wait(HandHandler.FADE_ANIM_TIME);
        leavingCards.forEach(card => card.remove());
        this.recomputeCardSpacing();
    }

    //card 10 redraw: cards joining my hand take their sorted place and slide in from fromElement, or fade in
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

    //card 10 swap: the cards I give fly from their slots to the other player's board (boardRect, on screen), shrinking, the
    //cards I get fly from it into their sorted slots, growing, and the cards I keep slide from their old places to their new
    //ones. Every card is measured before the hand changes, the hand is laid out once in its final order, then every move
    //starts at the same time. Resolves when the last one has landed
    public async swapCards(leavingCardIDs: number[], arrivingCardsData: RivieraCard[], boardRect: DOMRect): Promise<void>{
        const animate = this.game.bga.gameui.bgaAnimationsActive();

        const oldRects = new Map<number, DOMRect>();
        for(let card of this.getCardDivs())
            oldRects.set(parseInt(card.getAttribute('data-card-id')), card.getBoundingClientRect());

        const moves: Promise<void>[] = [];
        for(let cardID of leavingCardIDs){
            const card = this.getCardDiv(cardID);
            if(!card)
                continue;

            if(animate)
                moves.push(this.game.animateSlideAway(card, boardRect, HandHandler.SLIDE_ANIM_TIME)); //places the copy on card before its first await,
            card.remove();                                                                            //so the card can go right away
        }

        this.handData = [...this.handData.filter(handCard => !leavingCardIDs.includes(handCard.card_id)), ...arrivingCardsData];
        for(let cardData of arrivingCardsData)
            this.insertCardToHand(cardData);
        for(let cardData of this.getSortedHandData()) //moves the cards I keep instead of recreating them, so they keep their tooltips
            this.cardsContainer.appendChild(this.getCardDiv(cardData.card_id));
        this.recomputeCardSpacing();

        if(animate){
            for(let card of this.getCardDivs()){
                const oldRect = oldRects.get(parseInt(card.getAttribute('data-card-id')));
                if(!oldRect)
                    moves.push(this.game.animateSlide(card, boardRect, null, HandHandler.SLIDE_ANIM_TIME));
                else if(HandHandler.hasMoved(oldRect, card.getBoundingClientRect()))
                    moves.push(this.game.animateSlide(card, oldRect, null, HandHandler.SLIDE_ANIM_TIME));
            }
        }

        await Promise.all(moves);
    }

    private static hasMoved(oldRect: DOMRect, newRect: DOMRect): boolean{
        return Math.abs(oldRect.left - newRect.left) > 0.5 || Math.abs(oldRect.top - newRect.top) > 0.5;
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

    //a new round's hand: the cards left from the previous round sweep out left as copies while the new hand is dealt card
    //by card. The final hand is laid out first (sorted and spaced) with every card hidden in its slot, then a copy of each card flies
    //in, rightmost first, and the real card shows when its copy lands, so no card moves during or after the deal. Every card
    //starts DEAL_X_OFFSET to the left of its slot, at the same page y DEAL_START_Y (the document's, not the viewport's:
    //scrolled down, the start is off-screen). Resolves when the last card has landed
    public async setHand(handData: RivieraCard[]): Promise<void>{
        const sweep = this.sweepOutCards(); //empties the hand at once, the deal doesn't wait for the copies

        this.handData = handData;
        this.displayHand();

        const cards = this.getCardDivs();
        cards.forEach(card => card.style.visibility = 'hidden');

        const deals: Promise<void>[] = [];
        for(let i = cards.length - 1; i >= 0; i--){
            if(i < cards.length - 1)
                await this.game.bga.gameui.wait(HandHandler.DEAL_STAGGER);

            const pageTop = document.documentElement.getBoundingClientRect().top; //the page's top on screen, read per card in case of a scroll
            const cardRect = cards[i].getBoundingClientRect();
            const startLeft = cardRect.left - window.innerWidth * HandHandler.DEAL_X_OFFSET;
            const startTop = pageTop + HandHandler.DEAL_START_Y - cardRect.height;
            const startRect = new DOMRect(startLeft, startTop, cardRect.width, cardRect.height);
            deals.push(this.game.animateSlide(cards[i], startRect, null, HandHandler.DEAL_DURATION, HandHandler.DEAL_EASING));
        }

        await Promise.all([sweep, ...deals]);
    }

    //every card in my hand is lifted out as a copy at its place on screen and the hand is emptied at once; the copies
    //slide left together until they are off the screen's left side
    private async sweepOutCards(): Promise<void>{
        const sweeps = this.getCardDivs().map(card => {
            const cardRect = card.getBoundingClientRect();
            const offScreenRect = new DOMRect(-cardRect.width - 20, cardRect.top, cardRect.width, cardRect.height); //20px more for the drop shadow
            return this.game.animateSlideAway(card, offScreenRect, HandHandler.OLD_HAND_SWEEP_DURATION, HandHandler.OLD_HAND_SWEEP_EASING);
        });
        this.cardsContainer.innerHTML = '';

        await Promise.all(sweeps);
    }

    private getCardDivs(): HTMLDivElement[]{ return Array.from(this.cardsContainer.querySelectorAll('.a-card')) as HTMLDivElement[]; }
    private getCardDiv(cardID: number): HTMLDivElement{ return this.cardsContainer.querySelector(`.a-card[data-card-id="${cardID}"]`); }

    public getCardCount(): number{ return this.cardsContainer.querySelectorAll('.a-card').length; }
    public getHandContainer(): HTMLDivElement{ return this.handContainer; }
}
