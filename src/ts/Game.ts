import { PlayCard } from "./States/PlayCard";
import { StopOrMore } from "./States/StopOrMore";
import { ModifyDie } from "./States/ModifyDie";
import { ResolvePowers } from "./States/ResolvePowers";
import { SwapCards } from "./States/SwapCards";
import { PlayerHandler } from "./PlayerHandler";
import { HandHandler } from "./HandHandler";
import { DiceHandler } from "./DiceHandler";
import { StartTokenHandler } from "./StartTokenHandler";
import { LogMutationObserver } from "./LogMutationObserver";
import { ChangeMindHandler } from "./ChangeMindHandler";

export class Game {
    private static readonly CARD_BACK_SLIDE_ANIM_TIME = 600;
    private static readonly CHAIN_CARD_STAGGER_TIME = 150;

    public bga: Bga<RivieraPlayer, RivieraGamedatas>;
    private gamedatas: RivieraGamedatas;

    public playCard: PlayCard;
    public stopOrMore: StopOrMore;
    public modifyDie: ModifyDie;
    public resolvePowers: ResolvePowers;
    public swapCards: SwapCards;
    public players: Record<number, PlayerHandler> = {};
    private myPlayerID: number;
    private localCardIDCounter = 1;

    public myself: PlayerHandler;
    public handHandler: HandHandler;
    public diceHandler: DiceHandler;
    public startTokenHandler: StartTokenHandler;
    public logMutationObserver: LogMutationObserver;
    public changeMindHandler: ChangeMindHandler;

    constructor(bga: Bga<RivieraPlayer, RivieraGamedatas>) {
        console.log('riviera constructor');
        this.bga = bga;

        // Declare the State classes
        this.playCard = new PlayCard(this, bga);
        this.bga.states.register('PlayCard', this.playCard);
        this.stopOrMore = new StopOrMore(this, bga);
        this.bga.states.register('StopOrMore', this.stopOrMore);
        this.modifyDie = new ModifyDie(this, bga);
        this.bga.states.register('ModifyDie', this.modifyDie);
        this.resolvePowers = new ResolvePowers(this, bga);
        this.bga.states.register('ResolvePowers', this.resolvePowers);
        this.swapCards = new SwapCards(this, bga);
        this.bga.states.register('SwapCards', this.swapCards);

        // Uncomment the next line to show debug informations about state changes in the console. Remove before going to production!
        // this.bga.states.logger = console.log;
    }

    /*
        setup:

        This method must set up the game user interface according to current game situation specified
        in parameters.

        The method is called each time the game interface is displayed to a player, ie:
        _ when the game starts
        _ when a player refreshes the game page (F5)

        "gamedatas" argument contains all datas retrieved by your "getAllDatas" PHP method.
    */

    setup(gamedatas: RivieraGamedatas) {
        console.log( "Starting game setup" );
        this.gamedatas = gamedatas;

        document.body.setAttribute('data-player-count', Object.keys(gamedatas.players).length.toString());

        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="dice-container"></div>
            <div id="my-hand-container"></div>
            <div id="played-columns-container"></div>
        `);

        this.myPlayerID = this.bga.players.getCurrentPlayerId();
        this.diceHandler = new DiceHandler(this, gamedatas.dice);

        // Setting up player boards and played columns
        for(let player_id in gamedatas.players) {
            const {name, color, player_no, hand_count, round_status, last_chance_used} = this.gamedatas.players[player_id];
            const playedCardsData = gamedatas.cardsPlayed[parseInt(player_id)] || [];
            this.players[player_id] = new PlayerHandler(this, parseInt(player_id), name, color, player_no, hand_count, round_status, last_chance_used, playedCardsData);
        }

        //played columns follow turn order, starting with myself (playerorder starts with the current player)
        for(let next_player_id of gamedatas.playerorder) {
            const nextColumnContainer = this.players[next_player_id].getPlayedColumn().getColumnContainer();
            nextColumnContainer.parentElement!.append(nextColumnContainer);
        }

        if(this.players.hasOwnProperty(this.myPlayerID)){ //spectators have no hand
            this.myself = this.players[this.myPlayerID];
            this.myself.getPlayedColumn().setMyColumn(true);
            this.handHandler = new HandHandler(this, gamedatas.cardsInMyHand);
        }

        this.startTokenHandler = new StartTokenHandler(this, gamedatas.startPlayerId);
        this.logMutationObserver = new LogMutationObserver(this);
        this.changeMindHandler = new ChangeMindHandler(this);

        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();

        console.log( "Ending game setup" );
    }

    ///////////////////////////////////////////////////
    //// Utility methods

    /*

        Here, you can defines some utility methods that you can use everywhere in your javascript
        script. Typically, functions that are used in multiple state classes or outside a state class.

    */
    private bgaFormatText(log, args) {
        try {
            log = _(log);
            if (log && args && !args.processed) {
                args.processed = true;

                // list of special keys we want to replace with images
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR', 'STARS_BANKED_LOG_STR',
                    'DIE_RESERVED_POWER2_LOG_STR', 'GOLDEN_DIE_POWER11_LOG_STR', 'DIE_MODIFIED_POWER9_LOG_STR', 'CARDS_SWAPPED_POWER10_LOG_STR', 'CARDS_REDRAWN_POWER10_LOG_STR', 'POWER_SKIPPED_LOG_STR', 'POWER_CANCELLED_LOG_STR'];
                for(let key of keys) {
                    if(key in args) {
                        if(key == 'NEW_ROUND_LOG_STR')
                            log = this.logMutationObserver.createLogNewRound(args['round_number']).log_html;
                        else if(key == 'DICE_ROLLED_LOG_STR')
                            log = this.logMutationObserver.createLogDiceRolled(args['dice']).log_html;
                        else if(key == 'REVEAL_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRevealed(args['reveals']).log_html;
                        else if(key == 'CRASH_LOG_STR')
                            log = this.logMutationObserver.createLogPlayerCrashed(args['player_id']).log_html;
                        else if(key == 'GRAND_SLAM_LOG_STR')
                            log = this.logMutationObserver.createLogGrandSlam(args['player_id']).log_html;
                        else if(key == 'START_TOKEN_LOG_STR')
                            log = this.logMutationObserver.createLogStartTokenPassed(args['player_id']).log_html;
                        else if(key == 'STOP_OR_MORE_LOG_STR')
                            log = this.logMutationObserver.createLogStopOrMoreRevealed(args['choices']).log_html;
                        else if(key == 'STARS_BANKED_LOG_STR')
                            log = this.logMutationObserver.createLogStarsBanked(args['player_id'], args['stars']).log_html;
                        else if(key == 'DIE_RESERVED_POWER2_LOG_STR')
                            log = this.logMutationObserver.createLogDieReservedPOWER2(args['player_id'], args['die']).log_html;
                        else if(key == 'GOLDEN_DIE_POWER11_LOG_STR')
                            log = this.logMutationObserver.createLogGoldenDiePOWER11(args['player_id']).log_html;
                        else if(key == 'DIE_MODIFIED_POWER9_LOG_STR')
                            log = this.logMutationObserver.createLogDieModifiedPOWER9(args['player_id'], args['die_color'], args['old_value'], args['new_value']).log_html;
                        else if(key == 'CARDS_SWAPPED_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsSwappedPOWER10(args['owner_id'], args['target_id'], args['owner_gives'] ?? null, args['target_gives'] ?? null, args['count']).log_html;
                        else if(key == 'CARDS_REDRAWN_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRedrawnPOWER10(args['player_id'], args['discarded'] ?? null, args['drawn'] ?? null, args['count']).log_html;
                        else if(key == 'POWER_SKIPPED_LOG_STR')
                            log = this.logMutationObserver.createLogPowerSkipped(args['player_id'], args['value'], args['card'] ?? null, args['reason'] ?? '').log_html;
                        else if(key == 'POWER_CANCELLED_LOG_STR')
                            log = this.logMutationObserver.createLogPowerCancelled(args['player_id'], args['value'], args['card'] ?? null, args['die']).log_html;
                    }
                }
            }
        } catch (e) {
            console.error(log,args,"Exception thrown", e.stack);
        }
        return { log, args };
    }
    public divYou(attributes = {}): string {
        let color = this.gamedatas.players[this.myPlayerID].color;
        attributes['player-color'] = color;
        let html = "<span style=\"font-weight:bold;color:#" + color + ";\" " + this.getAttributesHTML(attributes) + ">" + _("You") + "</span>";
        return html;
    }
    public divColoredPlayer(player_id, attributes = {}, detectYou = true): string {
        if(detectYou && parseInt(player_id) === this.myPlayerID)
            return this.divYou(attributes);

        player_id = player_id.toString();

        let color = this.gamedatas.players[player_id].color;
        attributes['player-color'] = color;
        let html = "<span style=\"color:#" + color + ";\" " + this.getAttributesHTML(attributes) + ">" + this.gamedatas.players[player_id].name + "</span>";
        return html;
    }
    private getAttributesHTML(attributes): string{ return Object.entries(attributes || {}).map(([key, value]) => `${key}="${value}"`).join(' '); }

    createCardDiv(cardData: RivieraCard): HTMLDivElement {
        let aCard = document.createElement('div');
        aCard.className = 'a-card';
        aCard.setAttribute('id', 'an-id-required-for-tooltips-' + this.localCardIDCounter);
        this.localCardIDCounter++;
        aCard.setAttribute('data-color', cardData.color);
        aCard.setAttribute('data-value', String(cardData.value));
        aCard.setAttribute('data-card-id', String(cardData.card_id));
        return aCard;
    }

    createCardBackDiv(): HTMLDivElement {
        let aCard = document.createElement('div');
        aCard.className = 'a-card';
        aCard.setAttribute('data-card-kind', 'back');
        return aCard;
    }

    createLastChanceDiv(): HTMLDivElement {
        let aCard = document.createElement('div');
        aCard.className = 'a-card';
        aCard.setAttribute('data-card-kind', 'last-chance');
        return aCard;
    }

    cloneCard(card: HTMLDivElement): HTMLDivElement {
        const cardClone: HTMLDivElement = card.cloneNode(true) as HTMLDivElement;
        cardClone.classList.add('cloned-card');
        return cardClone;
    }

    public placeOnObject(mobileObj: HTMLDivElement, targetObj: HTMLDivElement, forceBoundingClientRect: boolean = false): void {
        mobileObj.style.left = '0px';
        mobileObj.style.top = '0px';

        // Get current positions
        const mobileWithinPageContent = document.getElementById('page-content').contains(mobileObj);
        const targetWithinPageContent = document.getElementById('page-content').contains(targetObj);

        let targetRect = mobileWithinPageContent ? this.getPos(targetObj) : targetObj.getBoundingClientRect();
        let mobileRect = targetWithinPageContent ? this.getPos(mobileObj) : mobileObj.getBoundingClientRect();

        if(forceBoundingClientRect){
            targetRect = targetObj.getBoundingClientRect();
            mobileRect = mobileObj.getBoundingClientRect();
        }

        // Calculate the difference in position
        const deltaX = targetRect.left - mobileRect.left;
        const deltaY = targetRect.top - mobileRect.top;

        // Get current position values
        const currentLeft = parseFloat(mobileObj.style.left || '0');
        const currentTop = parseFloat(mobileObj.style.top || '0');

        // Apply the position difference to current position
        mobileObj.style.left = (currentLeft + deltaX) + 'px';
        mobileObj.style.top = (currentTop + deltaY) + 'px';
    }
    //slides element into the container `to`, starting from where `from` is now (from may be element itself).
    //A copy flies over the page while the real element waits hidden in `to`, like Fugu moves cards between containers.
    //With `to` null, element is already in its place (a card sorted into my hand) and only the copy moves.
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    public async animateSlide(element: HTMLDivElement, from: HTMLDivElement, to: HTMLDivElement | null, durationMs: number): Promise<void> {
        const slidingClone = element.cloneNode(true) as HTMLDivElement;
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        document.body.appendChild(slidingClone);
        this.placeOnObject(slidingClone, from, true);

        element.style.visibility = 'hidden';
        if(to)
            to.appendChild(element);

        const elementRect = element.getBoundingClientRect();
        const cloneRect = slidingClone.getBoundingClientRect();
        const targetLeft = parseFloat(slidingClone.style.left || '0') + (elementRect.left - cloneRect.left);
        const targetTop = parseFloat(slidingClone.style.top || '0') + (elementRect.top - cloneRect.top);

        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in

        slidingClone.style.transition = `left ${durationMs}ms ease-in-out, top ${durationMs}ms ease-in-out`;
        slidingClone.style.left = targetLeft + 'px';
        slidingClone.style.top = targetTop + 'px';

        await this.bga.gameui.wait(durationMs);

        element.style.visibility = null;
        slidingClone.remove();
    }
    public rgbToHex(rgb: string): string { // Extract the numeric values using a regex
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match){
            console.error('-- rgb --', rgb);
            throw new Error("Invalid RGB format");
        }

        // Convert each component to a two-character hexadecimal
        const [, r, g, b] = match;
        return [r, g, b]
            .map((num) => {
                const hex = parseInt(num, 10).toString(16);
                return hex.padStart(2, '0'); // Ensure two digits
            })
            .join(''); // Combine into a single string
    }
    public getPos(node: HTMLDivElement): DOMRect {
        let pos = this.bga.gameui.getBoundingClientRectIgnoreZoom(node);
        return pos;
    }
    public isDesktop(): boolean { return document.body.classList.contains('desktop_version'); }
    public isMobile(): boolean { return document.body.classList.contains('mobile_version'); }
    public isInterfaceLocked(): boolean { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    public getGameStateName(): string { return this.gamedatas.gamestate.name; }

    public getColorIndex(color: CardColor): number {
        for(const colorIndex in this.gamedatas.cardColors){
            if(this.gamedatas.cardColors[colorIndex] === color)
                return parseInt(colorIndex);
        }
        return 0;
    }
    public getStarsForValue(value: number): number { return this.gamedatas.starsByValue[value] || 0; }
    public getPlayerColor(playerID: number): string { return this.gamedatas.players[playerID]?.color; }
    public getPlayerName(playerID: number): string { return this.gamedatas.players[playerID]?.name ?? ''; }

    //a hand card was clicked: the current state handles the selection
    public handSelectionChanged(): void {
        const stateName = this.getGameStateName();
        if(stateName === 'PlayCard')
            this.playCard.selectionChanged();
        else if(stateName === 'SwapCards')
            this.swapCards.selectionChanged();
    }

    //card 10, seen by everyone but the two players involved: N card backs slide each way between their boards
    private async animateCardBacksBetweenBoards(fromPlayerID: number, toPlayerID: number, count: number): Promise<void> {
        const fromPlayer = this.players[fromPlayerID];
        const toPlayer = this.players[toPlayerID];
        if(!fromPlayer || !toPlayer)
            return;

        const slides: Promise<void>[] = [];
        for(let i = 0; i < count; i++){
            const cardBack = this.createCardBackDiv();
            cardBack.classList.add('mini-card-back');
            slides.push(this.animateSlide(cardBack, fromPlayer.getHandCountElement(), toPlayer.getHandCountElement(), Game.CARD_BACK_SLIDE_ANIM_TIME).then(() => cardBack.remove()));
        }
        await Promise.all(slides);

        toPlayer.setHandCount(toPlayer.getHandCount()); //a swap keeps hand sizes, this only redraws the backs
    }
    public getMyPlayerID(): number{ return this.myPlayerID; }

    //end utility

    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications

    /*
        setupNotifications:

        In this method, you associate each of your game notifications with your local method to handle it.

        Note: game notification names correspond to "bga->notify->all" calls in your Game.php file.

    */
    setupNotifications() {
        console.log( 'notifications subscriptions setup' );

        // automatically listen to the notifications, based on the `notif_xxx` function on this class.
        // Uncomment the logger param to see debug information in the console about notifications.
        this.bga.notifications.setupPromiseNotifications({
            // logger: console.log
        });
    }

    // Add the notification handlers
    public async notif_newRound(args: NewRoundArgs) {
        const columnsCleared: Promise<void>[] = [];
        for(let player_id in this.players){
            const player = this.players[player_id];
            columnsCleared.push(player.getPlayedColumn().clear());
            player.setRoundStatus('in');
            player.setHandCount(args.hand_counts[player_id] ?? 0);
        }
        this.diceHandler.updateDice(args.dice);

        await Promise.all(columnsCleared);
    }

    public async notif_newHand(args: NewHandArgs) {
        this.handHandler?.setHand(args.cards);
    }

    public async notif_diceRolled(args: DiceRolledArgs) {
        this.diceHandler.updateDice(args.dice);
    }

    public async notif_playChoiceConfirmed(args: PlayChoiceConfirmedArgs) {
        this.playCard.onChoiceConfirmed(args);
    }

    public async notif_playChainUpdated_POWER1(args: PlayChainUpdatedPOWER1Args) {
        this.playCard.onChainUpdated(args);
    }

    public async notif_playChoiceReverted(args: PlayChoiceRevertedArgs) {
        this.playCard.onChoiceReverted(args);
    }

    //every revealed card slides at once: mine from my hand, the others from their player board's hand count
    public async notif_cardsRevealed(args: CardsRevealedArgs) {
        await Promise.all(args.reveals.map(reveal => this.animateReveal(reveal)));

        for(let player_id in args.hand_counts)
            this.players[player_id]?.setHandCount(args.hand_counts[player_id]);
    }

    private async animateReveal(reveal: CardReveal): Promise<void> {
        const player = this.players[reveal.player_id];
        if(!player)
            return;

        if(reveal.choice === 'last_chance'){
            await player.setLastChanceUsed(true, true);
            return;
        }

        //a card-1 chain follows its first card into the column, slightly behind it
        const revealedCards = [reveal.card, ...(reveal.extra_cards_POWER1 ?? [])];
        const slides: Promise<void>[] = [];
        for(let i = 0; i < revealedCards.length; i++){
            if(i > 0)
                await this.bga.gameui.wait(Game.CHAIN_CARD_STAGGER_TIME);

            if(reveal.player_id === this.myPlayerID && this.handHandler)
                slides.push(this.handHandler.animateCardToColumn(revealedCards[i], player.getPlayedColumn()));
            else slides.push(player.getPlayedColumn().animateCardIn(revealedCards[i], player.getHandCountElement()));
        }
        await Promise.all(slides);
    }

    public async notif_playerCrashed(args: PlayerCrashedArgs) {
        const player = this.players[args.player_id];
        if(!player)
            return;

        const discards: Promise<void>[] = [player.getPlayedColumn().clear()];
        if(args.player_id === this.myPlayerID && this.handHandler)
            discards.push(this.handHandler.discardAll());

        await Promise.all(discards);
        player.setHandCount(0);
        player.setRoundStatus('crashed');
    }

    public async notif_grandSlam(args: ScoreChangedArgs) {
        this.bga.playerPanels.getScoreCounter(args.player_id).toValue(args.score);
        this.players[args.player_id]?.setGrandSlam();
    }

    public async notif_startTokenPassed(args: StartTokenPassedArgs) {
        await this.startTokenHandler.moveTo(args.player_id);
    }

    public async notif_stopOrMoreChoiceConfirmed(args: StopOrMoreChoiceArgs) {
        this.stopOrMore.setPendingChoice(args.choice);
    }

    public async notif_stopOrMoreChoiceReverted(args: {}) {
        this.stopOrMore.setPendingChoice(null);
    }

    public async notif_stopOrMoreRevealed(args: StopOrMoreRevealedArgs) {
        for(let player_id in args.choices){
            if(args.choices[player_id] === 'stop')
                this.players[player_id]?.setRoundStatus('stopped');
        }
    }

    public async notif_starsBanked(args: ScoreChangedArgs) {
        this.bga.playerPanels.getScoreCounter(args.player_id).toValue(args.score);
    }

    //last turn's card-2 reservation and golden die expire after the reveal
    public async notif_diceUpdated(args: DiceUpdatedArgs) {
        this.diceHandler.updateDice(args.dice);
    }

    public async notif_dieReserved_POWER2(args: DieReservedPOWER2Args) {
        this.diceHandler.updateDice(args.dice);
    }

    public async notif_goldenDieAdded_POWER11(args: GoldenDieAddedPOWER11Args) {
        this.diceHandler.updateDice(args.dice);
    }

    public async notif_dieModified_POWER9(args: DieModifiedPOWER9Args) {
        this.diceHandler.updateDice(args.dice);
    }

    //private, to the owner and the victim only: my side of the swap
    public async notif_cardsSwapped_POWER10(args: CardsSwappedPOWER10Args) {
        if(!this.handHandler)
            return;

        const iAmOwner = args.owner_id === this.myPlayerID;
        const cardsILose = (iAmOwner ? args.owner_gives : args.target_gives) ?? [];
        const cardsIGet = (iAmOwner ? args.target_gives : args.owner_gives) ?? [];
        const otherPlayerID = iAmOwner ? args.target_id : args.owner_id;

        await this.handHandler.removeCards(cardsILose.map(card => card.card_id));
        await this.handHandler.addCards(cardsIGet, this.players[otherPlayerID]?.getHandCountElement() ?? null);
    }

    //public: the owner and the victim already animated their private notification
    public async notif_cardsSwappedPublic_POWER10(args: CardsSwappedPOWER10Args) {
        if(args.owner_id === this.myPlayerID || args.target_id === this.myPlayerID)
            return;

        await Promise.all([
            this.animateCardBacksBetweenBoards(args.owner_id, args.target_id, args.count),
            this.animateCardBacksBetweenBoards(args.target_id, args.owner_id, args.count),
        ]);
    }

    //private, to the owner only
    public async notif_cardsRedrawn_POWER10(args: CardsRedrawnPOWER10Args) {
        if(!this.handHandler)
            return;

        await this.handHandler.removeCards((args.discarded ?? []).map(card => card.card_id));
        await this.handHandler.addCards(args.drawn ?? [], null);
    }

    //public: hand sizes don't change, the log row is all there is
    public async notif_cardsRedrawnPublic_POWER10(args: CardsRedrawnPOWER10Args) {
    }

    public async notif_powerSkipped(args: PowerSkippedArgs) {
    }

    //the stopping player's reservation outline or golden die goes away
    public async notif_powerCancelled(args: PowerCancelledArgs) {
        this.diceHandler.updateDice(args.dice);
    }
}
