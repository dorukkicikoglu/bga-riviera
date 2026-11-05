/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * Game.ts
 */
import { PlayCard } from "./States/PlayCard";
import { StopOrMore } from "./States/StopOrMore";
import { ModifyDie } from "./States/ModifyDie";
import { ResolvePowers } from "./States/ResolvePowers";
import { SwapCards } from "./States/SwapCards";
import { GameEnd } from "./States/GameEnd";
import { PlayerHandler } from "./PlayerHandler";
import { HandHandler } from "./HandHandler";
import { DiceHandler } from "./DiceHandler";
import { StartTokenHandler } from "./StartTokenHandler";
import { LogMutationObserver } from "./LogMutationObserver";
import { UndoHandler } from "./UndoHandler";
import { TooltipHandler, POWER_CARD_VALUES } from "./TooltipHandler";
import { EndGameScoringHandler } from "./EndGameScoringHandler";
import { PrefHandler } from "./PrefHandler";
import { BackgroundHandler } from "./BackgroundHandler";

//optional settings of Game.animateSlide / animateSlideAway
export type SlideOptions = {
    easing?: string; //CSS timing function, Game.CARD_SLIDE_EASING by default
    keepSize?: boolean; //the copy keeps the element's size, centered on the other end, instead of changing size on the way
    delayMs?: number; //the copy waits this long at its start before it moves (a sweep's stagger)
    holdMs?: number; //animateSlideAway: the copy stays fully shown this long once it has arrived, before it fades or goes
    fadeOutMs?: number; //animateSlideAway: the copy fades out for this long once it has arrived (and held)
};

export class Game {
    //every card animation's timing, in one place to tune them together (HandHandler and PlayedColumnHandler read them too)
    public static readonly CARD_SLIDE_DURATION = 600; //ms of a card moving between two places in sight: the reveal into a column, a card 10 swap (and its card backs between two boards)
    public static readonly CARD_SLIDE_EASING = 'ease-in-out';
    public static readonly CHAIN_CARD_STAGGER = 150; //ms between two cards of a card-1 chain leaving for the column
    public static readonly SWAP_FADE_OUT_DURATION = 300; //ms a card I give in a card 10 swap takes to fade out on the other player's avatar
    public static readonly BOARD_STACK_OFFSET = 10; //px right and down each card lands from the one before when several fly onto the same board spot at once (a card 10 swap)
    public static readonly BOARD_ARRIVAL_HOLD = 100; //ms a card that has flown onto a player board (avatar or hand count) stays fully shown before it fades or goes
    public static readonly CARD_SWEEP_DURATION = 293; //ms each card leaving at a new round (hand and columns) takes to slide off-screen, quicker than the deal so the two read apart
    public static readonly CARD_SWEEP_STAGGER = 32; //ms between two cards starting their sweep at a new round
    public static readonly CRASH_SWEEP_DURATION = 440; //ms each card leaving at a crash (hand and column) takes to slide off-screen
    public static readonly CRASH_SWEEP_STAGGER = 29; //ms between two cards starting their sweep at a crash
    public static readonly CARD_SWEEP_EASING = 'ease-in-out';
    public static readonly CARD_DEAL_DURATION = 440; //ms each card of a new hand slides in for
    public static readonly CARD_DEAL_STAGGER = 48; //ms between the starts of two dealt cards (well under CARD_DEAL_DURATION: a few cards move at once)
    public static readonly CARD_DEAL_EASING = 'ease-out';
    public static readonly REDRAW_SWEEP_DURATION = 550; //card 10 redraw: the discarded cards' sweep, a little slower than a new round's (same easing)
    public static readonly REDRAW_SWEEP_STAGGER = 60;
    public static readonly REDRAW_DEAL_DURATION = 550; //card 10 redraw: the drawn cards' deal (same easing as a new hand's)
    public static readonly REDRAW_DEAL_STAGGER = 100;
    public static readonly CARD_SWEEP_ANGLE = 10; //degrees above horizontal of the sweeps' and deals' straight path: cards leave towards, and come in from, the top-left
    private static readonly OFF_SCREEN_MARGIN = 20; //px past the screen's left edge a card goes to (or comes from), for its drop shadow
    private static readonly AUTO_CHOICE_HOLD_TIME = 1500; //the status bar announces an automatic crash or Grand Slam this long
    private static readonly AUTO_CHOICE_DOT_STEP_TIME = 250; //its dots loop "." → ".." → "..." → ".", one step this often
    private static readonly AUTO_CHOICE_DOT_COUNT = 3;

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
    private startTokenFlight: Promise<void> = Promise.resolve(); //the Start token's pass, flying alongside the notifications after it

    public myself: PlayerHandler;
    public handHandler: HandHandler;
    public diceHandler: DiceHandler;
    public startTokenHandler: StartTokenHandler;
    public logMutationObserver: LogMutationObserver;
    public undoHandler: UndoHandler;
    public tooltipHandler: TooltipHandler;
    private endGameScoringHandler: EndGameScoringHandler;
    public prefHandler: PrefHandler;
    public backgroundHandler: BackgroundHandler;

    constructor(bga: Bga<RivieraPlayer, RivieraGamedatas>) {
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
        this.bga.states.register('gameEnd', new GameEnd(this, bga));

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
        this.gamedatas = gamedatas;

        document.body.setAttribute('data-player-count', Object.keys(gamedatas.players).length.toString());

        this.backgroundHandler = BackgroundHandler.getInstance(this);

        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="dice-container"></div>
            <div id="my-hand-container"></div>
            <div id="played-columns-container"></div>
        `);

        this.myPlayerID = this.bga.players.getCurrentPlayerId();
        this.diceHandler = new DiceHandler(this, gamedatas.dice);
        this.endGameScoringHandler = new EndGameScoringHandler(this);

        // Setting up player boards and played columns
        for(let player_id in gamedatas.players) {
            const {name, color, player_no, hand_count, round_status, last_chance_used, score} = this.gamedatas.players[player_id];
            const playedCardsData = gamedatas.cardsPlayed[parseInt(player_id)] || [];
            this.players[player_id] = new PlayerHandler(this, parseInt(player_id), name, color, player_no, hand_count, round_status, last_chance_used, playedCardsData, Number(score));
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

        //a Grand Slam ends the game, so this only matters after F5 at the end
        for(let player_id of gamedatas.grandSlamPlayerIds ?? [])
            this.players[player_id]?.setGrandSlam();

        this.startTokenHandler = new StartTokenHandler(this, gamedatas.startPlayerId);
        this.logMutationObserver = new LogMutationObserver(this);
        this.undoHandler = new UndoHandler(this);
        this.tooltipHandler = new TooltipHandler(this);
        this.prefHandler = new PrefHandler(this, gamedatas.pref_names);
        this.bga.gameui.onScreenWidthChange = () => this.onScreenWidthChange();

        if(gamedatas.hasOwnProperty('endGameScoring'))
            this.endGameScoringHandler.displayEndGameScore(gamedatas.endGameScoring);

        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();
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
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'LAST_CHANCE_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR',
                    'DIE_RESERVED_POWER2_LOG_STR', 'GOLDEN_DIE_POWER11_LOG_STR', 'DIE_MODIFIED_POWER9_LOG_STR', 'CARDS_SWAPPED_POWER10_LOG_STR', 'CARDS_REDRAWN_POWER10_LOG_STR', 'POWER_SKIPPED_LOG_STR', 'GAME_END_LOG_STR'];
                for(let key of keys) {
                    if(key in args) {
                        if(key == 'NEW_ROUND_LOG_STR')
                            log = this.logMutationObserver.createLogNewRound(args['round_number']).log_html;
                        else if(key == 'DICE_ROLLED_LOG_STR')
                            log = this.logMutationObserver.createLogDiceRolled(args['dice'], args['first_roll_of_round'] ?? false).log_html;
                        else if(key == 'REVEAL_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRevealed(args['reveals']).log_html;
                        else if(key == 'LAST_CHANCE_LOG_STR')
                            log = this.logMutationObserver.createLogLastChanceUsed(args['player_id']).log_html;
                        else if(key == 'CRASH_LOG_STR')
                            log = this.logMutationObserver.createLogPlayerCrashed(args['player_id']).log_html;
                        else if(key == 'GRAND_SLAM_LOG_STR')
                            log = this.logMutationObserver.createLogGrandSlam(args['player_id']).log_html;
                        else if(key == 'START_TOKEN_LOG_STR')
                            log = this.logMutationObserver.createLogStartTokenPassed(args['player_id']).log_html;
                        else if(key == 'STOP_OR_MORE_LOG_STR'){
                            console.log('[TEMP stopOrMore] log args', JSON.parse(JSON.stringify(args))); //TEMP: remove once the banked stars show
                            //rows logged before rows existed carry choices (and banked, for a while) instead
                            const rows: StopOrMoreRow[] = args['rows'] ?? Object.keys(args['choices'] ?? {}).map(player_id => ({ player_id: Number(player_id), choice: args['choices'][player_id], stars: args['banked']?.[player_id]?.stars }));
                            log = this.logMutationObserver.createLogStopOrMoreRevealed(rows).log_html;
                        }
                        else if(key == 'DIE_RESERVED_POWER2_LOG_STR')
                            log = this.logMutationObserver.createLogDieReservedPOWER2(args['player_id'], args['die']).log_html;
                        else if(key == 'GOLDEN_DIE_POWER11_LOG_STR')
                            log = this.logMutationObserver.createLogGoldenDiePOWER11(args['player_id']).log_html;
                        else if(key == 'DIE_MODIFIED_POWER9_LOG_STR')
                            log = this.logMutationObserver.createLogDieModifiedPOWER9(args['player_id'], args['card'] ?? null, args['die_color'], args['old_value'], args['new_value'], args['move_id']).log_html;
                        else if(key == 'CARDS_SWAPPED_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsSwappedPOWER10(args['owner_id'], args['target_id'], args['_private']?.['owner_gives'] ?? null, args['_private']?.['target_gives'] ?? null, args['count']).log_html;
                        else if(key == 'CARDS_REDRAWN_POWER10_LOG_STR')
                            log = this.logMutationObserver.createLogCardsRedrawnPOWER10(args['player_id'], args['_private']?.['discarded'] ?? null, args['_private']?.['drawn'] ?? null, args['count']).log_html;
                        else if(key == 'POWER_SKIPPED_LOG_STR')
                            log = this.logMutationObserver.createLogPowerSkipped(args['player_id'], args['value'], args['card'] ?? null, args['reason'] ?? '').log_html;
                        else if(key == 'GAME_END_LOG_STR')
                            log = this.logMutationObserver.createLogGameEnd(args['winner_ids'], args['winning_score']).log_html;
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
        if(POWER_CARD_VALUES.includes(cardData.value))
            aCard.classList.add(TooltipHandler.getPowerCardClass(cardData.value)); //power tooltip
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
        aCard.className = 'a-card last-chance-card';
        aCard.setAttribute('id', 'an-id-required-for-tooltips-' + this.localCardIDCounter);
        this.localCardIDCounter++;
        aCard.setAttribute('data-card-kind', 'last-chance');
        return aCard;
    }

    cloneCard(card: HTMLDivElement): HTMLDivElement {
        const cardClone: HTMLDivElement = card.cloneNode(true) as HTMLDivElement;
        cardClone.classList.add('cloned-card');
        return cardClone;
    }

    //slides element into the container `to`, starting from where `from` is now (from may be element itself).
    //A copy flies over the page while the real element waits hidden in `to`, like Fugu moves cards between containers.
    //With `to` null, element is already in its place (a card sorted into my hand) and only the copy moves.
    //The copy also changes size on the way: it starts at the size `from` has on screen (a hand card, or the top mini card
    //back of a player board) and lands exactly at the size and place of element, so nothing jumps at the end.
    //Everything is measured on screen (getBoundingClientRect), and the copy (in <body>, outside BGA's mobile scaling of the
    //game area) converts screen px into its own px with its measured zoom, so it matches on desktop and mobile alike.
    //`from` can also be a DOMRect on screen, for a start point with no element (the new hand's deal starts off the page).
    //With options.keepSize, the copy keeps element's size the whole way and starts centered on `from` (a card coming out
    //of a player board's mini card back or avatar stays a full card).
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    public async animateSlide(element: HTMLDivElement, from: HTMLDivElement | DOMRect, to: HTMLDivElement | null, durationMs: number, options: SlideOptions = {}): Promise<void> {
        const fromRect = this.getSlideSourceRect(from); //before element moves: from may be element itself
        const slidingClone = this.createSlidingClone(element);

        element.style.visibility = 'hidden';
        if(to)
            to.appendChild(element);
        const toRect = element.getBoundingClientRect();
        const startRect = options.keepSize ? Game.getCenteredRect(fromRect, toRect.width, toRect.height) : fromRect;

        await this.moveSlidingClone(slidingClone, startRect, toRect, durationMs, options);

        element.style.visibility = null;
    }

    //the other way round: a copy of element flies from where element is now to toRect on screen, then disappears.
    //Element itself is left alone and can be removed as soon as this is called (the old hand's sweep at a new round).
    //With options.keepSize, the copy keeps element's size and lands centered on toRect; with options.fadeOutMs, it fades
    //out once there. The copy shows at the opacity element shows at (a stopped column's dimmed cards), which it doesn't
    //inherit in <body>
    public async animateSlideAway(element: HTMLDivElement, toRect: DOMRect, durationMs: number, options: SlideOptions = {}): Promise<void> {
        const fromRect = element.getBoundingClientRect();
        const shownOpacity = Game.getShownOpacity(element);
        const slidingClone = this.createSlidingClone(element);
        if(shownOpacity < 1)
            slidingClone.style.opacity = shownOpacity.toString();
        const endRect = options.keepSize ? Game.getCenteredRect(toRect, fromRect.width, fromRect.height) : toRect;

        await this.moveSlidingClone(slidingClone, fromRect, endRect, durationMs, options);
    }

    //cards leaving the game (a new round, a crash, a card 10 redraw): each card is lifted out as a copy at its place on
    //screen, and the copies slide up-left along CARD_SWEEP_ANGLE, at their size, until they are off the screen's left
    //side, then go. They leave in
    //the order given, staggerMs apart; every copy is placed at once, so the cards can be removed as soon as this
    //is called. No copies with animations off (fast replay, hidden tab)
    public async sweepCardsOffScreen(cards: HTMLDivElement[], durationMs: number = Game.CARD_SWEEP_DURATION, staggerMs: number = Game.CARD_SWEEP_STAGGER): Promise<void> {
        if(!this.bga.gameui.bgaAnimationsActive())
            return;

        await Promise.all(cards.map((card, index) => {
            const offScreenRect = Game.getOffScreenUpLeftRect(card.getBoundingClientRect());
            return this.animateSlideAway(card, offScreenRect, durationMs, { easing: Game.CARD_SWEEP_EASING, delayMs: index * staggerMs });
        }));
    }

    //where a card on screen (cardRect) leaves for in a sweep, or comes from in a deal: up-left along CARD_SWEEP_ANGLE, so for
    //dx px left it also goes dx * tan(angle) px up. dx is at least minDistance and always takes the card wholly past the
    //screen's left edge, so it is out of view at that end whatever its height (a card near the top goes above the screen
    //too, which changes nothing: past the left edge is enough)
    public static getOffScreenUpLeftRect(cardRect: DOMRect, minDistance: number = 0): DOMRect {
        const dx = Math.max(minDistance, cardRect.right + Game.OFF_SCREEN_MARGIN);
        const dy = dx * Math.tan(Game.CARD_SWEEP_ANGLE * Math.PI / 180);
        return new DOMRect(cardRect.left - dx, cardRect.top - dy, cardRect.width, cardRect.height);
    }

    //a width x height rect on screen, centered on rect
    private static getCenteredRect(rect: DOMRect, width: number, height: number): DOMRect {
        return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
    }

    //element's own opacity times its ancestors'
    private static getShownOpacity(element: HTMLElement): number {
        let opacity = 1;
        for(let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement)
            opacity *= parseFloat(getComputedStyle(node).opacity);
        return opacity;
    }

    private createSlidingClone(element: HTMLDivElement): HTMLDivElement {
        const slidingClone = element.cloneNode(true) as HTMLDivElement;
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        slidingClone.style.removeProperty('visibility'); //element may already wait hidden in its slot (the new hand's deal)
        document.body.appendChild(slidingClone);
        return slidingClone;
    }

    //moves the copy from fromRect to toRect (both on screen), after options.delayMs at its start, fades it out there if
    //options.fadeOutMs (after options.holdMs of stillness), then removes it
    private async moveSlidingClone(slidingClone: HTMLDivElement, fromRect: DOMRect, toRect: DOMRect, durationMs: number, options: SlideOptions): Promise<void> {
        const { easing = Game.CARD_SLIDE_EASING, delayMs = 0, holdMs = 0, fadeOutMs = 0 } = options;
        const transformOnto = this.getSlidingCloneTransform(slidingClone);

        slidingClone.style.transform = transformOnto(fromRect);

        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in

        slidingClone.style.transition = `transform ${durationMs}ms ${easing} ${delayMs}ms`;
        slidingClone.style.transform = transformOnto(toRect);

        await this.bga.gameui.wait(delayMs + durationMs);

        if(holdMs > 0)
            await this.bga.gameui.wait(holdMs);

        if(fadeOutMs > 0){
            slidingClone.style.transition = `opacity ${fadeOutMs}ms ease`;
            slidingClone.style.opacity = '0';
            await this.bga.gameui.wait(fadeOutMs);
        }

        slidingClone.remove();
    }

    //returns the transform that puts the copy (a fresh createSlidingClone, untransformed) onto an on-screen rect: scaled to
    //rect's height (cards and the token keep their aspect) and centered on rect, so a source wider than the copy, like a row
    //of mini card backs, still sends it off from its middle. The copy converts screen px with its own measured zoom
    private getSlidingCloneTransform(slidingClone: HTMLDivElement): (rect: DOMRect) => string {
        const baseRect = slidingClone.getBoundingClientRect(); //on screen, untransformed at the viewport's top-left corner
        const cssWidth = parseFloat(getComputedStyle(slidingClone).width); //unrounded, unlike offsetWidth
        const zoom = (cssWidth > 0) ? baseRect.width / cssWidth : 1;

        return (rect: DOMRect): string => {
            const scale = (baseRect.height > 0) ? rect.height / baseRect.height : 1;
            const left = rect.left + (rect.width - baseRect.width * scale) / 2;
            return `translate(${(left - baseRect.left) / zoom}px, ${(rect.top - baseRect.top) / zoom}px) scale(${scale})`;
        };
    }

    //a player board's hand count is a row of mini card backs: a card leaving it starts from the top one
    private getSlideSourceRect(from: HTMLDivElement | DOMRect): DOMRect {
        if(from instanceof DOMRect)
            return from;
        if(!from.classList.contains('a-card')){
            const cards = from.querySelectorAll('.a-card');
            if(cards.length > 0)
                return cards[cards.length - 1].getBoundingClientRect();
        }
        return from.getBoundingClientRect();
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
    public onScreenWidthChange(): void { //BGA's resize hook (window resize, including orientation changes); also fires once at load
        this.handHandler?.recomputeCardSpacingAfterResize();
        for(let player_id in this.players){
            this.players[player_id].updateLastChanceInset();
            this.players[player_id].updateStartTokenPlace();
            this.players[player_id].updateEndGameScoreHighlight(); //after BGA has finished laying out the player panels
        }
    }
    public isDesktop(): boolean { return document.body.classList.contains('desktop_version'); }
    public isMobile(): boolean { return document.body.classList.contains('mobile_version'); }
    public isReplay(): boolean { return typeof g_replayFrom != 'undefined' || g_archive_mode; } //"replay from this move" in an ongoing game, or an archived game
    public isInterfaceLocked(): boolean { return document.body.classList.contains('lockedInterface'); } //gameui.isInterfaceLocked() is gone from this framework version; Fugu's SCSS already keys off this body class
    public updateStatusText(statusText): void{ $('gameaction_status').innerHTML = statusText; $('pagemaintitletext').innerHTML = statusText; }

    //power prompts (cards 1, 9, 10, 11): "may use" + the circular card icon of the card that gave the power, followed by
    //its power icon (like "Play [card]?"). setTitle substitutes its args as raw HTML (Fugu's pass button slot uses the
    //same), so the translatable string only holds the ${card} placeholder. The details live in the icons' power tooltip
    public setPowerPromptTitle(powerCard: RivieraCard | null, isCurrentPlayerActive: boolean): void {
        this.bga.statusBar.setTitle(isCurrentPlayerActive ? _('${you} may use ${card}') : _('${actplayer} may use ${card}'), { card: this.getStatusCardWithPowerHTML(powerCard) });
        this.tooltipHandler?.addTooltipsToCardsIn(document.getElementById('pagemaintitletext'));
    }

    //the circular card icon of status bar titles: a ring in the card's color around its number. The number is drawn from
    //img/card_icon_numbers.webp, so screen readers (and copy-paste) get the visually hidden text instead. The id and the
    //power-card-POWER<n> class let TooltipHandler.addTooltipsToCardsIn give it the same power tooltip as the log mini cards
    public getStatusCardIconHTML(card: RivieraCard | null): string {
        if(!card)
            return '';
        const cardText = _('${value} ${color}').replace('${value}', card.value.toString()).replace('${color}', this.getColorName(card.color));
        const powerClass = POWER_CARD_VALUES.includes(card.value) ? ' ' + TooltipHandler.getPowerCardClass(card.value) : '';
        const iconID = 'an-id-required-for-tooltips-' + this.localCardIDCounter;
        this.localCardIDCounter++;
        return `<span id="${iconID}" class="status-card-icon${powerClass}" data-color="${card.color}" data-value="${card.value}"><span class="status-card-icon-number" aria-hidden="true"></span><span class="status-card-icon-text">${cardText}</span></span>`;
    }

    //the piggy bank icon, inline (BGA's Font Awesome has none), for the banked column badge and the "Stop and bank" button.
    //Body, coin slot and eye are one evenodd path, so the slot and the eye are holes showing what is behind. Filled by CSS
    //(fill: currentColor on its class), the tail stroked in currentColor
    public getPiggyBankSVG(className: string): string {
        return `<svg class="${className}" viewBox="0 0 23 20" aria-hidden="true" focusable="false">
            <path fill-rule="evenodd" d="M2.5 10.5a8.5 6.5 0 1 0 17 0a8.5 6.5 0 1 0 -17 0Z M10.2 5.1h4.4v1.2h-4.4Z M14.6 8.3a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0Z"/>
            <path d="M5.5 6L6.8 1.8L9.8 4.4Z"/>
            <rect x="18.5" y="8.2" width="3.5" height="4.6" rx="1.2"/>
            <rect x="5.5" y="14.5" width="3" height="4.5" rx="1"/>
            <rect x="12.5" y="14.5" width="3" height="4.5" rx="1"/>
            <path d="M2.8 9C1 9 0.8 7 2.2 6.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>`;
    }

    //the circular card icon (getStatusCardIconHTML) at text size, to sit inline in a sentence (tooltips), sized by .inline-card-icon
    public getInlineCardIconHTML(color: CardColor, value: number): string {
        return `<span class="inline-card-icon">${this.getStatusCardIconHTML({ card_id: null, color: color, value: value })}</span>`;
    }

    //the circular card icon followed, for a card with a power (1, 2, 9, 10, 11), by that power's icon (the power reference's
    //.power-icon, sized to the card icon in the status bar). The power icon gets its own id and the power-card-POWER<n> class,
    //so addTooltipsToCardsIn gives it the same power tooltip as the card icon. The two are wrapped in one .status-card-with-power,
    //which holds them closer than separate cards and on the same line. Cards without a power get the card icon alone
    public getStatusCardWithPowerHTML(card: RivieraCard | null): string {
        if(!card || !POWER_CARD_VALUES.includes(card.value))
            return this.getStatusCardIconHTML(card);

        return `<span class="status-card-with-power">${this.getStatusCardIconHTML(card)}${this.getPowerIconHTML(card.value)}</span>`;
    }

    //a power's icon (the power reference's .power-icon) with its own id and the power-card-POWER<n> class, so
    //addTooltipsToCardsIn gives it that power's tooltip. Sized by where it sits (status bar title, reveal log row)
    public getPowerIconHTML(value: number): string {
        const powerIconID = 'an-id-required-for-tooltips-' + this.localCardIDCounter;
        this.localCardIDCounter++;
        return `<span id="${powerIconID}" class="power-icon ${TooltipHandler.getPowerCardClass(value)}" data-power-value="${value}" aria-hidden="true"></span>`;
    }
    public getGameStateName(): string { return this.gamedatas.gamestate.name; }

    public getColorIndex(color: CardColor): number {
        for(const colorIndex in this.gamedatas.cardColors){
            if(this.gamedatas.cardColors[colorIndex] === color)
                return parseInt(colorIndex);
        }
        return 0;
    }
    public getStarsForValue(value: number): number { return this.gamedatas.starsByValue[value] || 0; }
    public getColorName(color: CardColor): string {
        const colorNames: Record<CardColor, string> = { red: _('red'), green: _('green'), purple: _('purple'), blue: _('blue'), orange: _('orange') }; //same strings as CARD_COLOR_NAMES in material.inc.php
        return colorNames[color];
    }
    public getPlayerColor(playerID: number): string { return this.gamedatas.players[playerID]?.color; }
    public getWinningScore(): number { return this.gamedatas.winningScore; }
    //BGA's final state, or the end-game table already shown (it arrives in EndScore, just before gameEnd)
    public isGameOver(): boolean { return this.getGameStateName() === 'gameEnd' || !!this.endGameScoringHandler?.isDisplayed(); }
    public updateEndGameScoreHighlights(): void {
        for(let player_id in this.players)
            this.players[player_id].updateEndGameScoreHighlight();
    }
    public getPlayerName(playerID: number): string { return this.gamedatas.players[playerID]?.name ?? ''; }

    //card ids for an action's comma-separated cardIDs param, sorted numerically so the request is the same whatever order
    //they were clicked in (BGA tutorials compare the request's params)
    public getCardIDsParam(cardIDs: number[]): string { return [...cardIDs].sort((a, b) => a - b).join(','); }

    //a status bar button that picks a player: BGA's secondary button with the .player-choice-button look, ringed in that
    //player's color through --player-color. label is HTML (setTitle-style), e.g. the player's name in bold
    public addPlayerChoiceButton(playerID: number, label: string, callback: () => void, params: { id?: string; disabled?: boolean; } = {}): HTMLButtonElement {
        const button = this.bga.statusBar.addActionButton(label, callback, { ...params, color: 'secondary', classes: 'player-choice-button' });
        button.style.setProperty('--player-color', '#' + (this.getPlayerColor(playerID) ?? '000000'));
        return button;
    }

    //a hand card was clicked: the current state handles the selection
    public handSelectionChanged(): void {
        const stateName = this.getGameStateName();
        if(stateName === 'PlayCard')
            this.playCard.selectionChanged();
        else if(stateName === 'SwapCards')
            this.swapCards.selectionChanged();
    }

    //card 10, seen by everyone but the two players involved: N card backs fly each way between their boards, all at once.
    //Both start points are measured before any back is added to a board, so one direction never starts from the other's back
    private async animateCardBacksSwap(firstPlayerID: number, secondPlayerID: number, count: number): Promise<void> {
        const firstPlayer = this.players[firstPlayerID];
        const secondPlayer = this.players[secondPlayerID];
        if(!firstPlayer || !secondPlayer)
            return;

        if(this.bga.gameui.bgaAnimationsActive()){
            const firstRect = this.getSlideSourceRect(firstPlayer.getHandCountElement());
            const secondRect = this.getSlideSourceRect(secondPlayer.getHandCountElement());

            const slides: Promise<void>[] = [];
            for(let i = 0; i < count; i++){
                slides.push(this.animateCardBackSlide(firstRect, Game.getStackedRect(secondRect, i)));
                slides.push(this.animateCardBackSlide(secondRect, Game.getStackedRect(firstRect, i)));
            }
            await Promise.all(slides);
        }

        //a swap keeps hand sizes, this only redraws the backs
        firstPlayer.setHandCount(firstPlayer.getHandCount());
        secondPlayer.setHandCount(secondPlayer.getHandCount());
    }

    //a mini card back flies from fromRect onto toRect (on the other board's hand count, stacked), stays there a moment
    //(BOARD_ARRIVAL_HOLD), then goes; the hand count itself is redrawn after
    private async animateCardBackSlide(fromRect: DOMRect, toRect: DOMRect): Promise<void> {
        const cardBack = this.createCardBackDiv();
        cardBack.classList.add('mini-card-back');
        await this.moveSlidingClone(this.createSlidingClone(cardBack), fromRect, toRect, Game.CARD_SLIDE_DURATION, { holdMs: Game.BOARD_ARRIVAL_HOLD });
    }

    //cards flying onto the same spot of a player board land as a visible stack: the index-th one (0 = the first, at the
    //back) lands BOARD_STACK_OFFSET px further right and down per index, and later ones come later in <body>, so on top
    public static getStackedRect(rect: DOMRect, index: number): DOMRect {
        const offset = index * Game.BOARD_STACK_OFFSET;
        return new DOMRect(rect.left + offset, rect.top + offset, rect.width, rect.height);
    }
    public getMyPlayerID(): number{ return this.myPlayerID; }
    public getPlayerOrder(): number[]{ return this.gamedatas.playerorder; } //turn order, starting with myself

    //end utility

    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications

    /*
        setupNotifications:

        In this method, you associate each of your game notifications with your local method to handle it.

        Note: game notification names correspond to "bga->notify->all" calls in your Game.php file.

    */
    setupNotifications() {
        // automatically listen to the notifications, based on the `notif_xxx` function on this class.
        // Uncomment the logger param to see debug information in the console about notifications.
        //minDuration: BGA holds every notification with log text for 500ms by default, even when nothing animates (the
        //Stop/More reveal, each "banks N ★" row). A notification now lasts as long as its handler awaits a real animation
        this.bga.notifications.setupPromiseNotifications({
            minDuration: 1,
            // logger: console.log
        });
    }

    // Add the notification handlers
    public async notif_newRound(args: NewRoundArgs) {
        await this.startTokenFlight; //the end-of-round pass (EndRound) lands before the columns clear

        //every column and the cards left in my hand sweep out together, each with its own stagger; newHand deals once all have left
        const sweeps: Promise<void>[] = [];
        for(let player_id in this.players){
            const player = this.players[player_id];
            sweeps.push(player.getPlayedColumn().clear());
            player.setRoundStatus('in');
            player.setHandCount(args.hand_counts[player_id] ?? 0);
        }
        if(this.handHandler)
            sweeps.push(this.handHandler.discardAll());
        //args.dice (blank, not rolled yet) is not shown: last round's dice stay up through the deal, until diceRolled

        await Promise.all(sweeps);
    }

    public async notif_newHand(args: NewHandArgs) {
        await this.handHandler?.setHand(args.cards); //the old cards have already swept out (newRound): the new ones are dealt
        this.tooltipHandler.addTooltipsToCards();
    }

    //the roll starts at once, alongside a Start token pass still flying, and the notification waits for both
    public async notif_diceRolled(args: DiceRolledArgs) {
        await Promise.all([this.diceHandler.rollDice(args.dice), this.startTokenFlight]);
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

        this.tooltipHandler.addTooltipsToCards();
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
                await this.bga.gameui.wait(Game.CHAIN_CARD_STAGGER);

            if(reveal.player_id === this.myPlayerID && this.handHandler)
                slides.push(this.handHandler.animateCardToColumn(revealedCards[i], player.getPlayedColumn()));
            else slides.push(player.getPlayedColumn().animateCardIn(revealedCards[i], player.getHandCountElement()));
        }
        await Promise.all(slides);
    }

    //the log row only: cardsRevealed already took the Last Chance card off the player board
    public async notif_lastChanceUsed(args: LastChanceUsedArgs) {
    }

    //[BGA] the last player in had only Crash, so the server chose it. The reveal comes after this, so after the roll has landed too
    public async notif_autoCrashAnnounced(args: AutoCrashAnnouncedArgs) {
        await this.announceAutoChoice(args.player_id, _('${you} crash'), _('${player_name} crashes'));
    }

    //[BGA] the player's last card was playable, so the server played it. While others choose, only that player gets this (the
    //others still see them choosing), and their status bar goes back to the waiting title after the hold
    public async notif_autoGrandSlamAnnounced(args: AutoGrandSlamAnnouncedArgs) {
        if(args.player_id === this.myPlayerID)
            this.playCard.onAutoGrandSlam();

        await this.announceAutoChoice(args.player_id, _('${you} go for a Grand Slam'), _('${player_name} goes for a Grand Slam'));

        if(args.others_choosing)
            this.playCard.refresh();
    }

    //a choice the server made for a player: no buttons or selectable cards, the status bar says it with looping dots, then the
    //queue holds (not in a replay or with no animations)
    private async announceAutoChoice(playerID: number, myTitle: string, othersTitle: string): Promise<void> {
        this.bga.statusBar.removeActionButtons();
        this.handHandler?.clearSelectableCards();

        //the dots stay out of the translated text. All of them are there from the start, hidden, so the text never moves
        const dotsHTML = '<span class="auto-choice-dots">' + '<span>.</span>'.repeat(Game.AUTO_CHOICE_DOT_COUNT) + '</span>';
        if(playerID === this.myPlayerID)
            this.bga.statusBar.setTitle(myTitle + dotsHTML);
        else this.bga.statusBar.setTitle(othersTitle + dotsHTML, { player_name: this.bga.players.getFormattedPlayerName(playerID) });

        const dots = Array.from(document.querySelectorAll<HTMLElement>('#pagemaintitletext .auto-choice-dots > span'));
        //no hold in a replay, or with no animations (fast forward, instantaneous mode, hidden tab): the whole "..." at once
        if(this.isReplay() || !this.bga.gameui.bgaAnimationsActive()){
            dots.forEach(dot => dot.classList.add('shown-dot'));
            return;
        }

        //"." at once, then a step every AUTO_CHOICE_DOT_STEP_TIME, back to "." after "...", for the whole hold
        let shownDotCount = 0;
        const showNextDots = () => {
            shownDotCount = shownDotCount % dots.length + 1;
            dots.forEach((dot, index) => dot.classList.toggle('shown-dot', index < shownDotCount));
        };
        showNextDots();
        const dotsTimer = setInterval(showNextDots, Game.AUTO_CHOICE_DOT_STEP_TIME);
        try {
            await this.bga.gameui.wait(Game.AUTO_CHOICE_HOLD_TIME);
        } finally {
            clearInterval(dotsTimer);
        }
    }

    public async notif_playerCrashed(args: PlayerCrashedArgs) {
        const player = this.players[args.player_id];
        if(!player)
            return;

        player.getPlayedColumn().setRoundStatus('crashed'); //the badge turns to the bomb at once, while the cards fade out
        const discards: Promise<void>[] = [player.getPlayedColumn().clear(Game.CRASH_SWEEP_DURATION, Game.CRASH_SWEEP_STAGGER)];
        if(args.player_id === this.myPlayerID && this.handHandler)
            discards.push(this.handHandler.discardAll(Game.CRASH_SWEEP_DURATION, Game.CRASH_SWEEP_STAGGER)); //started with the column's: both sweep together

        await Promise.all(discards);
        player.setHandCount(0);
        player.setRoundStatus('crashed');
    }

    public async notif_grandSlam(args: ScoreChangedArgs) {
        this.players[args.player_id]?.setScore(args.score);
        this.players[args.player_id]?.setGrandSlam();
    }

    //the flight doesn't block: the card 2 and 11 notifications (no animation) and the roll play while it flies, and
    //diceRolled (or newRound, when the round ends) waits for it
    public async notif_startTokenPassed(args: StartTokenPassedArgs) {
        await this.startTokenFlight; //a previous pass still flying (debug passes back to back)
        this.startTokenFlight = this.startTokenHandler.moveTo(args.player_id);
    }

    public async notif_stopOrMoreChoiceConfirmed(args: StopOrMoreChoiceArgs) {
        this.stopOrMore.setPendingChoice(args.choice);
    }

    public async notif_stopOrMoreChoiceReverted(args: {}) {
        this.stopOrMore.setPendingChoice(null);
    }

    //each stopper is out, and the stars they banked are already in their score (banked)
    public async notif_stopOrMoreRevealed(args: StopOrMoreRevealedArgs) {
        console.log('[TEMP stopOrMore] notif args', JSON.parse(JSON.stringify(args))); //TEMP: remove once the banked stars show
        for(const row of args.rows){
            if(row.choice !== 'stop')
                continue;
            this.players[row.player_id]?.setRoundStatus('stopped');
            this.players[row.player_id]?.setScore(row.score);
        }
    }

    //last turn's card-2 reservation and golden die expire after the reveal
    public async notif_diceUpdated(args: DiceUpdatedArgs) {
        this.diceHandler.updateDice(args.dice);
    }

    public async notif_dieReserved_POWER2(args: DieReservedPOWER2Args) {
        this.diceHandler.updateDice(args.dice);
    }

    //the log row only: the golden die appears with the next roll (diceRolled), once it has a value
    public async notif_goldenDieAdded_POWER11(args: GoldenDieAddedPOWER11Args) {
    }

    public async notif_dieModified_POWER9(args: DieModifiedPOWER9Args) {
        this.diceHandler.updateDice(args.dice);
    }

    //[BGA] the only player still in took their card 9 change back: the die goes back and its log row goes away
    public async notif_dieChangeUndone_POWER9(args: DieChangeUndonePOWER9Args) {
        this.diceHandler.updateDice(args.dice);
        this.logMutationObserver.removeDieModifiedLogPOWER9(args.move_id);
    }

    //the owner and the victim get the cards (_private): my side of the swap. The cards I give fly to the other player's
    //avatar while the cards I get fly from it into my hand and my other cards slide to their new places, all at once.
    //Everyone else gets no cards: card backs slide each way between the two boards
    public async notif_cardsSwapped_POWER10(args: CardsSwappedPOWER10Args) {
        if(!args._private || !this.handHandler){
            await this.animateCardBacksSwap(args.owner_id, args.target_id, args.count);
            this.bouncePlayerBoards([args.owner_id, args.target_id]);
            return;
        }

        const iAmOwner = args.owner_id === this.myPlayerID;
        const cardsILose = iAmOwner ? args._private.owner_gives : args._private.target_gives;
        const cardsIGet = iAmOwner ? args._private.target_gives : args._private.owner_gives;
        const otherPlayer = this.players[iAmOwner ? args.target_id : args.owner_id];
        const boardRect = otherPlayer?.getAvatarRect() ?? this.handHandler.getHandContainer().getBoundingClientRect();

        //the owner is still active in SwapCards until the state changes: once BGA unlocks the interface at the end of the
        //animation, cards left selectable would glow until onLeavingState clears them
        this.handHandler.clearSelectableCards();
        await this.handHandler.swapCards(cardsILose.map(card => card.card_id), cardsIGet, boardRect);
        this.tooltipHandler.addTooltipsToCards();
        this.bouncePlayerBoards([args.owner_id, args.target_id]);
    }

    //the owner gets the cards (_private) and redraws in their hand. Hand sizes don't change, so everyone else only sees the
    //owner's board bounce
    public async notif_cardsRedrawn_POWER10(args: CardsRedrawnPOWER10Args) {
        if(!args._private || !this.handHandler){
            this.bouncePlayerBoards([args.player_id]);
            return;
        }

        await this.handHandler.redrawCards(args._private.discarded.map(card => card.card_id), args._private.drawn);
        this.tooltipHandler.addTooltipsToCards();
    }

    //card 10: the boards of the players involved bounce once the cards have landed, except my own (a swapper or victim
    //sees only the other player's board bounce); nothing waits for it
    private bouncePlayerBoards(playerIDs: number[]): void {
        for(let playerID of playerIDs){
            if(playerID !== this.myPlayerID)
                this.players[playerID]?.bounceBoard();
        }
    }

    public async notif_powerSkipped(args: PowerSkippedArgs) {
    }

    private async notif_displayEndGameScoring(args: DisplayEndGameScoringArgs) {
        this.updateStatusText(_('Final scores'));
        await this.endGameScoringHandler.displayEndGameScore(args.endGameScoring);
    }
}
