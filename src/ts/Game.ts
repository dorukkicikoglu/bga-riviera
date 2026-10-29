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

export class Game {
    private static readonly CARD_BACK_SLIDE_ANIM_TIME = 600;
    private static readonly CHAIN_CARD_STAGGER_TIME = 150;
    private static readonly AUTO_CRASH_HOLD_TIME = 1500; //the status bar announces the crash this long before the reveal
    private static readonly AUTO_CRASH_DOT_STEP_TIME = 250; //its dots loop "." → ".." → "..." → ".", one step this often
    private static readonly AUTO_CRASH_DOT_COUNT = 3;

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
                const keys = ['NEW_ROUND_LOG_STR', 'DICE_ROLLED_LOG_STR', 'REVEAL_LOG_STR', 'LAST_CHANCE_LOG_STR', 'CRASH_LOG_STR', 'GRAND_SLAM_LOG_STR', 'START_TOKEN_LOG_STR', 'STOP_OR_MORE_LOG_STR', 'STARS_BANKED_LOG_STR',
                    'DIE_RESERVED_POWER2_LOG_STR', 'GOLDEN_DIE_POWER11_LOG_STR', 'DIE_MODIFIED_POWER9_LOG_STR', 'CARDS_SWAPPED_POWER10_LOG_STR', 'CARDS_REDRAWN_POWER10_LOG_STR', 'POWER_SKIPPED_LOG_STR', 'GAME_END_LOG_STR'];
                for(let key of keys) {
                    if(key in args) {
                        if(key == 'NEW_ROUND_LOG_STR')
                            log = this.logMutationObserver.createLogNewRound(args['round_number']).log_html;
                        else if(key == 'DICE_ROLLED_LOG_STR')
                            log = this.logMutationObserver.createLogDiceRolled(args['dice']).log_html;
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
                        else if(key == 'STOP_OR_MORE_LOG_STR')
                            log = this.logMutationObserver.createLogStopOrMoreRevealed(args['choices']).log_html;
                        else if(key == 'STARS_BANKED_LOG_STR')
                            log = this.logMutationObserver.createLogStarsBanked(args['player_id'], args['stars']).log_html;
                        else if(key == 'DIE_RESERVED_POWER2_LOG_STR')
                            log = this.logMutationObserver.createLogDieReservedPOWER2(args['player_id'], args['die']).log_html;
                        else if(key == 'GOLDEN_DIE_POWER11_LOG_STR')
                            log = this.logMutationObserver.createLogGoldenDiePOWER11(args['player_id']).log_html;
                        else if(key == 'DIE_MODIFIED_POWER9_LOG_STR')
                            log = this.logMutationObserver.createLogDieModifiedPOWER9(args['player_id'], args['die_color'], args['old_value'], args['new_value'], args['move_id']).log_html;
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
    //Everything before the first await runs synchronously, so `from` can be removed as soon as this is called
    public async animateSlide(element: HTMLDivElement, from: HTMLDivElement | DOMRect, to: HTMLDivElement | null, durationMs: number, easing: string = 'ease-in-out'): Promise<void> {
        const fromRect = this.getSlideSourceRect(from); //before element moves: from may be element itself
        const slidingClone = this.createSlidingClone(element);

        element.style.visibility = 'hidden';
        if(to)
            to.appendChild(element);
        const toRect = element.getBoundingClientRect();

        await this.moveSlidingClone(slidingClone, fromRect, toRect, durationMs, easing);

        element.style.visibility = null;
    }

    //the other way round: a copy of element flies from where element is now to toRect on screen, then disappears.
    //Element itself is left alone and can be removed as soon as this is called (the old hand's sweep at a new round)
    public async animateSlideAway(element: HTMLDivElement, toRect: DOMRect, durationMs: number, easing: string = 'ease-in-out'): Promise<void> {
        const fromRect = element.getBoundingClientRect();
        const slidingClone = this.createSlidingClone(element);

        await this.moveSlidingClone(slidingClone, fromRect, toRect, durationMs, easing);
    }

    private createSlidingClone(element: HTMLDivElement): HTMLDivElement {
        const slidingClone = element.cloneNode(true) as HTMLDivElement;
        slidingClone.removeAttribute('id');
        slidingClone.classList.add('sliding-clone');
        slidingClone.style.removeProperty('visibility'); //element may already wait hidden in its slot (the new hand's deal)
        document.body.appendChild(slidingClone);
        return slidingClone;
    }

    //moves the copy from fromRect to toRect (both on screen), then removes it
    private async moveSlidingClone(slidingClone: HTMLDivElement, fromRect: DOMRect, toRect: DOMRect, durationMs: number, easing: string): Promise<void> {
        const transformOnto = this.getSlidingCloneTransform(slidingClone);

        slidingClone.style.transform = transformOnto(fromRect);

        await this.bga.gameui.wait(20); //let the clone's start position paint before the transition kicks in

        slidingClone.style.transition = `transform ${durationMs}ms ${easing}`;
        slidingClone.style.transform = transformOnto(toRect);

        await this.bga.gameui.wait(durationMs);

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

    //the circular card icon (getStatusCardIconHTML) at text size, to sit inline in a sentence (tooltips), sized by .inline-card-icon
    public getInlineCardIconHTML(color: CardColor, value: number): string {
        return `<span class="inline-card-icon">${this.getStatusCardIconHTML({ card_id: null, color: color, value: value })}</span>`;
    }

    //the circular card icon followed, for a card with a power (1, 2, 9, 10, 11), by that power's icon (the power reference's
    //.power-icon, sized to the card icon in the status bar). The power icon gets its own id and the power-card-POWER<n> class,
    //so addTooltipsToCardsIn gives it the same power tooltip as the card icon. Cards without a power get the card icon alone
    public getStatusCardWithPowerHTML(card: RivieraCard | null): string {
        if(!card || !POWER_CARD_VALUES.includes(card.value))
            return this.getStatusCardIconHTML(card);

        const powerIconID = 'an-id-required-for-tooltips-' + this.localCardIDCounter;
        this.localCardIDCounter++;
        return this.getStatusCardIconHTML(card) + `<span id="${powerIconID}" class="power-icon ${TooltipHandler.getPowerCardClass(card.value)}" data-power-value="${card.value}" aria-hidden="true"></span>`;
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
                slides.push(this.animateCardBackSlide(firstRect, secondPlayer));
                slides.push(this.animateCardBackSlide(secondRect, firstPlayer));
            }
            await Promise.all(slides);
        }

        //a swap keeps hand sizes, this only redraws the backs
        firstPlayer.setHandCount(firstPlayer.getHandCount());
        secondPlayer.setHandCount(secondPlayer.getHandCount());
    }

    private async animateCardBackSlide(fromRect: DOMRect, toPlayer: PlayerHandler): Promise<void> {
        const cardBack = this.createCardBackDiv();
        cardBack.classList.add('mini-card-back');
        await this.animateSlide(cardBack, fromRect, toPlayer.getHandCountElement(), Game.CARD_BACK_SLIDE_ANIM_TIME);
        cardBack.remove();
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

        const columnsCleared: Promise<void>[] = [];
        for(let player_id in this.players){
            const player = this.players[player_id];
            columnsCleared.push(player.getPlayedColumn().clear());
            player.setRoundStatus('in');
            player.setHandCount(args.hand_counts[player_id] ?? 0);
        }
        //args.dice (blank, not rolled yet) is not shown: last round's dice stay up through the deal, until diceRolled

        await Promise.all(columnsCleared);
    }

    public async notif_newHand(args: NewHandArgs) {
        await this.handHandler?.setHand(args.cards); //old cards sweep out, then the new ones are dealt
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
                await this.bga.gameui.wait(Game.CHAIN_CARD_STAGGER_TIME);

            if(reveal.player_id === this.myPlayerID && this.handHandler)
                slides.push(this.handHandler.animateCardToColumn(revealedCards[i], player.getPlayedColumn()));
            else slides.push(player.getPlayedColumn().animateCardIn(revealedCards[i], player.getHandCountElement()));
        }
        await Promise.all(slides);
    }

    //the log row only: cardsRevealed already took the Last Chance card off the player board
    public async notif_lastChanceUsed(args: LastChanceUsedArgs) {
    }

    //[BGA] the last player in had only Crash, so the server chose it: no buttons or selectable cards, the status bar says
    //who crashes, then the queue holds before the reveal (which comes after this, so after the roll has landed too)
    public async notif_autoCrashAnnounced(args: AutoCrashAnnouncedArgs) {
        this.bga.statusBar.removeActionButtons();
        this.handHandler?.clearSelectableCards();

        //the dots stay out of the translated text. All of them are there from the start, hidden, so the text never moves
        const dotsHTML = '<span class="auto-crash-dots">' + '<span>.</span>'.repeat(Game.AUTO_CRASH_DOT_COUNT) + '</span>';
        if(args.player_id === this.myPlayerID)
            this.bga.statusBar.setTitle(_('${you} crash') + dotsHTML);
        else this.bga.statusBar.setTitle(_('${player_name} crashes') + dotsHTML, { player_name: this.bga.players.getFormattedPlayerName(args.player_id) });

        const dots = Array.from(document.querySelectorAll<HTMLElement>('#pagemaintitletext .auto-crash-dots > span'));
        //no hold in a replay, or with no animations (fast forward, instantaneous mode, hidden tab): the whole "..." at once
        if(this.isReplay() || !this.bga.gameui.bgaAnimationsActive()){
            dots.forEach(dot => dot.classList.add('shown-dot'));
            return;
        }

        //"." at once, then a step every AUTO_CRASH_DOT_STEP_TIME, back to "." after "...", for the whole hold
        let shownDotCount = 0;
        const showNextDots = () => {
            shownDotCount = shownDotCount % dots.length + 1;
            dots.forEach((dot, index) => dot.classList.toggle('shown-dot', index < shownDotCount));
        };
        showNextDots();
        const dotsTimer = setInterval(showNextDots, Game.AUTO_CRASH_DOT_STEP_TIME);
        try {
            await this.bga.gameui.wait(Game.AUTO_CRASH_HOLD_TIME);
        } finally {
            clearInterval(dotsTimer);
        }
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

    public async notif_stopOrMoreRevealed(args: StopOrMoreRevealedArgs) {
        for(let player_id in args.choices){
            if(args.choices[player_id] === 'stop')
                this.players[player_id]?.setRoundStatus('stopped');
        }
    }

    public async notif_starsBanked(args: ScoreChangedArgs) {
        this.players[args.player_id]?.setScore(args.score);
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

        await this.handHandler.removeCards(args._private.discarded.map(card => card.card_id));
        await this.handHandler.addCards(args._private.drawn, null);
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
