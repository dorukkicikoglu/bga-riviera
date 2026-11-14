/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * LastChanceSpotlight.ts
 */
import { Game } from "./Game";
import { PlayerSpotlightOverlay, SpotlightEntry } from "./PlayerSpotlightOverlay";

//[BGA] every Last Chance of a reveal (Game.notif_lastChanceAnimation): each entry's element is the player's Last Chance card on
//their board. A copy of it flies to the middle of the play area, grows, holds under the player's avatar and name, flies back
//and fades out there; the board card waits hidden meanwhile. Shown in one row of slots (two for 4 to 6 on a narrow screen)
export class LastChanceSpotlight extends PlayerSpotlightOverlay {
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

    private clones: HTMLDivElement[] = [];

    constructor(game: Game, entries: SpotlightEntry[]) {
        super(game, entries, _('Last Chance!'), 'last-chance-spotlight');
    }

    protected start(): { done: Promise<void>; duration: number } {
        const slots = this.entries.map(entry => this.createCardSlot(entry.playerID));
        this.layOutSlots(slots);
        const slotPlaces = slots.map(slot => slot.querySelector('.player-spotlight-card-place') as HTMLDivElement);

        const count = this.entries.length;
        const holdDuration = LastChanceSpotlight.HOLD_DURATION + (count - 1) * LastChanceSpotlight.CARD_STAGGER; //every copy holds as long, so they come back in the order they came
        const cardDuration = LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION + LastChanceSpotlight.BOARD_HOLD_DURATION + LastChanceSpotlight.BOARD_FADE_DURATION;

        //the overlay fades out while the cards fly back, so it no longer catches clicks while the copies fade out on the boards
        this.animateOverlay(LastChanceSpotlight.OVERLAY_FADE_IN_DURATION, LastChanceSpotlight.CARD_IN_DURATION + holdDuration, LastChanceSpotlight.CARD_OUT_DURATION);
        const cardFlights = this.entries.map((entry, index) => this.animateCard(entry.element, slotPlaces[index], index, holdDuration, cardDuration));
        this.animatePlayers();

        return { done: Promise.all(cardFlights).then(() => {}), duration: (count - 1) * LastChanceSpotlight.CARD_STAGGER + cardDuration };
    }

    //the player's tag above an empty place the card's size
    private createCardSlot(playerID: number): HTMLDivElement {
        const slot = this.createSlot(playerID);
        slot.appendChild(this.createPlayerTag(playerID));
        slot.insertAdjacentHTML('beforeend', '<div class="player-spotlight-card-place"></div>');
        return slot;
    }

    //each player's avatar and name come in as their card arrives
    private animatePlayers(): void {
        this.overlay.querySelectorAll('.player-spotlight-player').forEach((player, index) => {
            this.animations.push(player.animate([
                { opacity: 0, translate: '0px 6px' },
                { opacity: 1, translate: '0px 0px' },
            ], { duration: LastChanceSpotlight.PLAYER_FADE_IN_DURATION, delay: index * LastChanceSpotlight.CARD_STAGGER + LastChanceSpotlight.CARD_IN_DURATION / 2, easing: 'ease-out', fill: 'backwards' }));
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
        clone.style.setProperty('--my-card-width', `${placeRect.width / LastChanceSpotlight.getZoom(clone)}px`);
        this.clones.push(clone);
        element.style.visibility = 'hidden';

        const transformOnto = this.game.getSlidingCloneTransform(clone);
        const arrived = LastChanceSpotlight.CARD_IN_DURATION / duration;
        const leaving = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration) / duration;
        const back = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION) / duration;
        const fading = (LastChanceSpotlight.CARD_IN_DURATION + holdDuration + LastChanceSpotlight.CARD_OUT_DURATION + LastChanceSpotlight.BOARD_HOLD_DURATION) / duration;

        const flight = clone.animate([
            { transform: transformOnto(startRect), opacity: 1, offset: 0, easing: LastChanceSpotlight.CARD_IN_EASING },
            { transform: transformOnto(placeRect), opacity: 1, offset: arrived, easing: 'linear' },
            { transform: transformOnto(placeRect), opacity: 1, offset: leaving, easing: LastChanceSpotlight.CARD_OUT_EASING },
            { transform: transformOnto(startRect), opacity: 1, offset: back, easing: 'linear' },
            { transform: transformOnto(startRect), opacity: 1, offset: fading, easing: 'ease' },
            { transform: transformOnto(startRect), opacity: 0, offset: 1 },
        ], { duration: duration, delay: index * LastChanceSpotlight.CARD_STAGGER, fill: 'both' });
        this.animations.push(flight);

        return PlayerSpotlightOverlay.whenFinished(flight);
    }

    //the copy's measured zoom (it lives in <body>, outside BGA's mobile scaling), to turn on-screen px into its own px
    private static getZoom(element: HTMLElement): number {
        const cssWidth = parseFloat(getComputedStyle(element).width);
        return (cssWidth > 0) ? element.getBoundingClientRect().width / cssWidth : 1;
    }

    //the copies go and the board cards show again
    protected cleanUp(): void {
        this.clones.forEach(clone => clone.remove());
        this.entries.forEach(entry => entry.element.style.removeProperty('visibility'));
    }
}
