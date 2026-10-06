import { PlayCard } from "./States/PlayCard";
import { PlayerHandler } from "./PlayerHandler";
import { HandHandler } from "./HandHandler";
import { DiceHandler } from "./DiceHandler";
import { StartTokenHandler } from "./StartTokenHandler";
import { LogMutationObserver } from "./LogMutationObserver";

export class Game {
    public bga: Bga<RivieraPlayer, RivieraGamedatas>;
    private gamedatas: RivieraGamedatas;

    public playCard: PlayCard;
    public players: Record<number, PlayerHandler> = {};
    private myPlayerID: number;
    private localCardIDCounter = 1;

    public myself: PlayerHandler;
    public handHandler: HandHandler;
    public diceHandler: DiceHandler;
    public startTokenHandler: StartTokenHandler;
    public logMutationObserver: LogMutationObserver;

    constructor(bga: Bga<RivieraPlayer, RivieraGamedatas>) {
        console.log('riviera constructor');
        this.bga = bga;

        // Declare the State classes
        this.playCard = new PlayCard(this, bga);
        this.bga.states.register('PlayCard', this.playCard);

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

                // list of special keys we want to replace with images, filled in from Milestone 2
                const keys: string[] = [];
                for(let key of keys) {
                    if(key in args) {
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
    public async notif_startTokenPassed(args: StartTokenPassedArgs) {
        await this.startTokenHandler.moveTo(args.player_id);
    }
}
