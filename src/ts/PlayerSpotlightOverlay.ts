/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * PlayerSpotlightOverlay.ts
 */
import { Game } from "./Game";

//one player in the spotlight: element is what is shown for them (a card on their player board). A copy of it flies from its
//place to the middle of the screen, grows, holds, flies back and fades out there; element itself waits hidden meanwhile
export type SpotlightEntry = {
    playerID: number;
    element: HTMLElement;
};

//a fixed overlay over the whole page (a light dim and a banner at the top) that shows one element per player in a row, the
//player's avatar and name above each, then sends them back. Both centre on the play area, not the whole screen (setPlayAreaBounds). Reusable: the theme class (on the overlay) styles the banner and
//the dim in Game.scss (.last-chance-spotlight). Sizes and gaps live in Game.scss; the timeline lives here.
//play() resolves once everything is gone; the caller then applies the end state. A click or tap on the overlay skips to that
//end at once. Nothing plays in a replay or with animations off (fast replay, instantaneous mode, hidden tab)
export class PlayerSpotlightOverlay {
    private static readonly OVERLAY_FADE_IN_DURATION = 250; //ms the dim and the banner take to appear
    private static readonly CARD_IN_DURATION = 550; //ms each copy takes from its player board to the middle of the screen
    private static readonly CARD_IN_EASING = 'ease-out';
    private static readonly CARD_STAGGER = 120; //ms between two copies leaving their boards (and again between two coming back)
    private static readonly HOLD_DURATION = 1300; //ms every copy stays still in the middle, counted from the last one's arrival
    private static readonly CARD_OUT_DURATION = 550; //ms each copy takes back to its player board, shrinking to the board card's size
    private static readonly CARD_OUT_EASING = 'ease-in-out';
    private static readonly BOARD_HOLD_DURATION = 100; //ms a copy stays fully shown on the board before it fades (like Game.BOARD_ARRIVAL_HOLD)
    private static readonly BOARD_FADE_DURATION = 400; //ms it then fades out there
    private static readonly PLAYER_FADE_IN_DURATION = 250; //ms a player's avatar and name take to appear, as their card arrives
    private static readonly FINISH_SAFETY_MARGIN = 1000; //ms past the timeline's end after which play() resolves anyway (a hidden tab's throttled animations)

    private overlay: HTMLDivElement;
    private clones: HTMLDivElement[] = [];
    private animations: Animation[] = [];
    private finished = false;
    private resolveSkip: () => void = () => {};

    constructor(private game: Game, private entries: SpotlightEntry[], private bannerText: string, private themeClass: string) {}

    public async play(): Promise<void> {
        if(this.entries.length === 0 || this.game.isReplay() || !this.game.bga.gameui.bgaAnimationsActive())
            return;

        const slotPlaces = this.createOverlay();
        const skipped = new Promise<void>(resolve => this.resolveSkip = resolve);
        this.overlay.addEventListener('click', () => this.resolveSkip());

        const count = this.entries.length;
        const holdDuration = PlayerSpotlightOverlay.HOLD_DURATION + (count - 1) * PlayerSpotlightOverlay.CARD_STAGGER; //every copy holds as long, so they come back in the order they came
        const cardDuration = PlayerSpotlightOverlay.CARD_IN_DURATION + holdDuration + PlayerSpotlightOverlay.CARD_OUT_DURATION + PlayerSpotlightOverlay.BOARD_HOLD_DURATION + PlayerSpotlightOverlay.BOARD_FADE_DURATION;
        const totalDuration = (count - 1) * PlayerSpotlightOverlay.CARD_STAGGER + cardDuration;

        this.animateOverlay(PlayerSpotlightOverlay.CARD_IN_DURATION + holdDuration);
        const cardFlights = this.entries.map((entry, index) => this.animateCard(entry.element, slotPlaces[index], index, holdDuration, cardDuration));
        this.animatePlayers();

        const timeout = new Promise<void>(resolve => setTimeout(resolve, totalDuration + PlayerSpotlightOverlay.FINISH_SAFETY_MARGIN));
        await Promise.race([Promise.all(cardFlights), skipped, timeout]);

        this.finish();
    }

    //the overlay, its banner and one slot per player (avatar and name above an empty place the card's size), in one row, or two
    //when one row would make the cards narrower than --spotlight-min-card-width (4 to 6 players on a narrow screen). Returns
    //each player's card place, in the entries' order
    private createOverlay(): HTMLDivElement[] {
        const count = this.entries.length;
        this.overlay = document.createElement('div');
        this.overlay.className = 'player-spotlight-overlay ' + this.themeClass;
        this.overlay.setAttribute('data-size', count <= 3 ? 'large' : 'small');
        this.overlay.innerHTML = `
            <div class="player-spotlight-banner" role="status">
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
                <span class="player-spotlight-banner-text">${this.bannerText}</span>
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
            </div>
            <div class="player-spotlight-stage"></div>
        `;
        this.setPlayAreaBounds();

        const stage = this.overlay.querySelector('.player-spotlight-stage') as HTMLDivElement;
        const slots = this.entries.map(entry => this.createSlot(entry.playerID));
        document.body.appendChild(this.overlay);

        this.layOutSlots(stage, slots, count);
        const minCardWidth = parseFloat(getComputedStyle(this.overlay).getPropertyValue('--spotlight-min-card-width')) || 0;
        const cardWidth = slots[0].querySelector('.player-spotlight-card-place').getBoundingClientRect().width;
        if(count > 3 && cardWidth < minCardWidth)
            this.layOutSlots(stage, slots, Math.ceil(count / 2));

        return slots.map(slot => slot.querySelector('.player-spotlight-card-place') as HTMLDivElement);
    }

    //the cards and the banner centre on the game's play area (bga.gameArea, beside the player boards and the log on desktop, the
    //whole width on mobile), the part of it inside the viewport, and the cards fit its width (--spotlight-area-width, in
    //Game.scss's card width). Vertically they centre on the viewport. Measured once, as the animation starts
    private setPlayAreaBounds(): void {
        const viewportWidth = document.documentElement.clientWidth; //without a vertical scrollbar
        const areaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
        let left = Math.max(0, areaRect.left);
        let right = Math.min(viewportWidth, areaRect.right);
        if(right - left <= 0){ //off-screen or not laid out: the whole viewport
            left = 0;
            right = viewportWidth;
        }

        this.overlay.style.setProperty('--spotlight-center-x', `${(left + right) / 2}px`);
        this.overlay.style.setProperty('--spotlight-area-width', `${right - left}px`);
    }

    //the slots in rows of perRow; Game.scss sizes the cards from --spotlight-per-row and data-rows
    private layOutSlots(stage: HTMLDivElement, slots: HTMLDivElement[], perRow: number): void {
        stage.innerHTML = '';
        const rowCount = Math.ceil(slots.length / perRow);
        this.overlay.style.setProperty('--spotlight-per-row', perRow.toString());
        this.overlay.setAttribute('data-rows', rowCount.toString());

        for(let rowIndex = 0; rowIndex < rowCount; rowIndex++){
            const row = document.createElement('div');
            row.className = 'player-spotlight-row';
            slots.slice(rowIndex * perRow, (rowIndex + 1) * perRow).forEach(slot => row.appendChild(slot));
            stage.appendChild(row);
        }
    }

    private createSlot(playerID: number): HTMLDivElement {
        const slot = document.createElement('div');
        slot.className = 'player-spotlight-slot';
        slot.style.setProperty('--player-color', '#' + (this.game.getPlayerColor(playerID) ?? '000000'));
        slot.innerHTML = `
            <div class="player-spotlight-player">
                <span class="player-spotlight-avatar"></span>
                ${this.game.divColoredPlayer(playerID, {class: 'playername player-spotlight-name'}, false)}
            </div>
            <div class="player-spotlight-card-place"></div>
        `;
        this.game.fillPlayerAvatar(slot.querySelector('.player-spotlight-avatar') as HTMLSpanElement, playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return slot;
    }

    //the dim and the banner fade in, stay while the cards are shown, and fade out while the cards fly back (from fadeOutStart);
    //then the overlay goes, so it no longer catches clicks while the copies fade out on the boards
    private animateOverlay(fadeOutStart: number): void {
        const duration = fadeOutStart + PlayerSpotlightOverlay.CARD_OUT_DURATION;
        const overlayAnimation = this.overlay.animate([
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: PlayerSpotlightOverlay.OVERLAY_FADE_IN_DURATION / duration },
            { opacity: 1, offset: fadeOutStart / duration },
            { opacity: 0, offset: 1 },
        ], { duration: duration, fill: 'forwards' });
        this.animations.push(overlayAnimation);
        overlayAnimation.finished.then(() => this.overlay.remove()).catch(() => {}); //cancelled by a skip, which removes it itself
    }

    //each player's avatar and name come in as their card arrives
    private animatePlayers(): void {
        this.overlay.querySelectorAll('.player-spotlight-player').forEach((player, index) => {
            this.animations.push(player.animate([
                { opacity: 0, translate: '0px 6px' },
                { opacity: 1, translate: '0px 0px' },
            ], { duration: PlayerSpotlightOverlay.PLAYER_FADE_IN_DURATION, delay: index * PlayerSpotlightOverlay.CARD_STAGGER + PlayerSpotlightOverlay.CARD_IN_DURATION / 2, easing: 'ease-out', fill: 'backwards' }));
        });
    }

    //one copy's whole trip in one animation: board → place (CARD_IN), hold, place → board (CARD_OUT), stay, fade out. The copy is
    //made at the place's size, so it is crisp while it holds, and the transform scales it down to the board card at both ends.
    //Its start is measured now, before the board card is hidden (it doesn't move meanwhile)
    private animateCard(element: HTMLElement, place: HTMLDivElement, index: number, holdDuration: number, duration: number): Promise<void> {
        const boardRect = element.getBoundingClientRect();
        const placeRect = place.getBoundingClientRect();
        const startRect = (boardRect.width > 0 && boardRect.height > 0) ? boardRect : new DOMRect(placeRect.left + placeRect.width / 2, placeRect.top + placeRect.height / 2, 0, 0); //no board card on screen (display: none): it grows from the place's middle

        const clone = this.game.createSlidingClone(element as HTMLDivElement);
        clone.classList.add('player-spotlight-card');
        clone.style.setProperty('--my-card-width', `${placeRect.width / this.getZoom(clone)}px`);
        this.clones.push(clone);
        element.style.visibility = 'hidden';

        const transformOnto = this.game.getSlidingCloneTransform(clone);
        const arrived = PlayerSpotlightOverlay.CARD_IN_DURATION / duration;
        const leaving = (PlayerSpotlightOverlay.CARD_IN_DURATION + holdDuration) / duration;
        const back = (PlayerSpotlightOverlay.CARD_IN_DURATION + holdDuration + PlayerSpotlightOverlay.CARD_OUT_DURATION) / duration;
        const fading = (PlayerSpotlightOverlay.CARD_IN_DURATION + holdDuration + PlayerSpotlightOverlay.CARD_OUT_DURATION + PlayerSpotlightOverlay.BOARD_HOLD_DURATION) / duration;

        const flight = clone.animate([
            { transform: transformOnto(startRect), opacity: 1, offset: 0, easing: PlayerSpotlightOverlay.CARD_IN_EASING },
            { transform: transformOnto(placeRect), opacity: 1, offset: arrived, easing: 'linear' },
            { transform: transformOnto(placeRect), opacity: 1, offset: leaving, easing: PlayerSpotlightOverlay.CARD_OUT_EASING },
            { transform: transformOnto(startRect), opacity: 1, offset: back, easing: 'linear' },
            { transform: transformOnto(startRect), opacity: 1, offset: fading, easing: 'ease' },
            { transform: transformOnto(startRect), opacity: 0, offset: 1 },
        ], { duration: duration, delay: index * PlayerSpotlightOverlay.CARD_STAGGER, fill: 'both' });
        this.animations.push(flight);

        return flight.finished.then(() => {}).catch(() => {}); //a skip cancels it
    }

    //the copy's measured zoom (it lives in <body>, outside BGA's mobile scaling), to turn on-screen px into its own px
    private getZoom(element: HTMLElement): number {
        const cssWidth = parseFloat(getComputedStyle(element).width);
        return (cssWidth > 0) ? element.getBoundingClientRect().width / cssWidth : 1;
    }

    //the end, reached or skipped: every animation stops, the copies and the overlay go and the board elements show again (the
    //caller applies the end state right after, in the same task, so they never paint in between)
    private finish(): void {
        if(this.finished)
            return;
        this.finished = true;

        this.animations.forEach(animation => animation.cancel());
        this.clones.forEach(clone => clone.remove());
        this.overlay.remove();
        this.entries.forEach(entry => entry.element.style.removeProperty('visibility'));
    }
}
