/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * CrashSpotlight.ts
 */
import { Game } from "./Game";
import { PlayerSpotlightOverlay, SpotlightEntry } from "./PlayerSpotlightOverlay";

//a crashed player: element is their played column (the area that flashes and shakes), cardGroups the cards that tumble out of
//it, each group last card first (the column's, and for the player who crashed, their hand's too). The groups tumble together
export type CrashSpotlightEntry = SpotlightEntry & {
    cardGroups: HTMLElement[][];
};

//[BGA] every crash of a reveal (Game.notif_crashAnimation), under a "Crashed!" banner (.crash-spotlight). Each crashed player's
//column animates where it is, nothing scrolls: a red glow on its border and one short shake, their avatar and name just
//above it, then its cards tumble (a random turn, a small drop, a fade), last card first. A column that isn't on screen also
//gets a large tile with the avatar and name in the middle of the play area, laid out like the Last Chance cards. Players
//start PLAYER_STAGGER apart. The caller discards the cards at the end (the tumbled cards stay hidden until then)
export class CrashSpotlight extends PlayerSpotlightOverlay<CrashSpotlightEntry> {
    private static readonly OVERLAY_FADE_IN_DURATION = 150; //ms the dim and the banner take to appear (the banner's slam and shake are in Game.scss)
    private static readonly PLAYER_STAGGER = 100; //ms between two crashed players' animations
    private static readonly AREA_FLASH_DURATION = 750; //ms of the red glow on the column's border, up and down
    private static readonly AREA_SHAKE_DURATION = 400; //ms of the column's one short shake, with the glow
    private static readonly AREA_SHAKE_DISTANCE = 6; //px of the shake's widest swing (in the column's own px)
    private static readonly TAG_FADE_IN_DURATION = 250; //ms the avatar and name above the column (or the off-screen tile) take to appear
    private static readonly TAG_GAP = 6; //px between the tag and the top of the column
    private static readonly TUMBLE_START = 400; //ms after a player's start their cards begin to tumble (once the shake is over)
    private static readonly CARD_TUMBLE_DURATION = 520; //ms each card takes to turn, drop and fade out
    private static readonly CARD_TUMBLE_STAGGER = 50; //ms between two cards of a group starting to tumble
    private static readonly CARD_TUMBLE_EASING = 'ease-in';
    private static readonly CARD_TUMBLE_MAX_ROTATION = 15; //degrees, either way, at random per card
    private static readonly CARD_TUMBLE_DROP = 28; //px each card drops (in its own px)
    private static readonly HOLD_DURATION = 500; //ms everything stays once the last card is gone, before the overlay fades out
    private static readonly OVERLAY_FADE_OUT_DURATION = 300; //ms the dim, the banner, the tags and the tiles take to fade out
    private static readonly MIN_VISIBLE_SHARE = 0.4; //a column with less than this share of its height in the viewport counts as off screen (it gets a tile)
    private static readonly GLOW_COLOR = 'rgba(217, 72, 59, 0.9)'; //the banner's red (#d9483b)
    private static readonly GLOW_HALO_COLOR = 'rgba(217, 72, 59, 0.6)';

    constructor(game: Game, entries: CrashSpotlightEntry[]) {
        super(game, entries, _('Crashed!'), 'crash-spotlight');
    }

    protected start(): { done: Promise<void>; duration: number } {
        //measured before anything moves: which columns are on screen, and where to put their tags
        const areaRects = this.entries.map(entry => entry.element.getBoundingClientRect());
        const onScreen = areaRects.map(rect => CrashSpotlight.isOnScreen(rect));

        const offScreenTiles: HTMLDivElement[] = [];
        const offScreenIndexes: number[] = [];
        this.entries.forEach((entry, index) => {
            if(onScreen[index])
                this.addAreaTag(entry.playerID, areaRects[index], index);
            else{
                offScreenTiles.push(this.createTileSlot(entry.playerID));
                offScreenIndexes.push(index);
            }
        });
        if(offScreenTiles.length > 0){
            this.layOutSlots(offScreenTiles);
            offScreenTiles.forEach((slot, tileIndex) => this.fadeIn(slot.querySelector('.player-spotlight-tile') as HTMLDivElement, offScreenIndexes[tileIndex]));
        }

        let lastCardGone = 0;
        this.entries.forEach((entry, index) => {
            const delay = index * CrashSpotlight.PLAYER_STAGGER;
            this.animateArea(entry.element, delay);
            lastCardGone = Math.max(lastCardGone, delay + CrashSpotlight.AREA_FLASH_DURATION);
            for(let cards of entry.cardGroups){
                cards.forEach((card, cardIndex) => this.tumbleCard(card, delay + CrashSpotlight.TUMBLE_START + cardIndex * CrashSpotlight.CARD_TUMBLE_STAGGER));
                if(cards.length > 0)
                    lastCardGone = Math.max(lastCardGone, delay + CrashSpotlight.TUMBLE_START + (cards.length - 1) * CrashSpotlight.CARD_TUMBLE_STAGGER + CrashSpotlight.CARD_TUMBLE_DURATION);
            }
        });

        const fadeOutStart = lastCardGone + CrashSpotlight.HOLD_DURATION;
        const done = this.animateOverlay(CrashSpotlight.OVERLAY_FADE_IN_DURATION, fadeOutStart, CrashSpotlight.OVERLAY_FADE_OUT_DURATION);
        return { done: done, duration: fadeOutStart + CrashSpotlight.OVERLAY_FADE_OUT_DURATION };
    }

    //enough of the column inside the viewport, on both axes, to see it animate
    private static isOnScreen(rect: DOMRect): boolean {
        if(rect.width <= 0 || rect.height <= 0)
            return false;
        const visibleWidth = Math.min(rect.right, document.documentElement.clientWidth) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        return visibleWidth > 0 && visibleHeight >= rect.height * CrashSpotlight.MIN_VISIBLE_SHARE;
    }

    //the player's tag just above their column, centred on it and kept inside the viewport (the overlay is fixed over the whole
    //viewport, so its children are placed in viewport px). Below the banner when the column starts higher than that
    private addAreaTag(playerID: number, areaRect: DOMRect, index: number): void {
        const tag = this.createPlayerTag(playerID);
        tag.classList.add('player-spotlight-area-tag');
        this.overlay.appendChild(tag);

        const tagRect = tag.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const centeredLeft = areaRect.left + (areaRect.width - tagRect.width) / 2;
        tag.style.left = `${Math.max(4, Math.min(centeredLeft, viewportWidth - tagRect.width - 4))}px`;
        tag.style.top = `${Math.max(this.getBannerBottom() + CrashSpotlight.TAG_GAP, areaRect.top - CrashSpotlight.TAG_GAP - tagRect.height)}px`; //never over the banner

        this.fadeIn(tag, index);
    }

    //a column off screen: a large tile with the avatar and the name, in the middle of the play area
    private createTileSlot(playerID: number): HTMLDivElement {
        const slot = this.createSlot(playerID);
        slot.innerHTML = `
            <div class="player-spotlight-tile">
                <span class="player-spotlight-avatar"></span>
                ${this.game.divColoredPlayer(playerID, {class: 'playername player-spotlight-name'}, false)}
            </div>
        `;
        this.game.fillPlayerAvatar(slot.querySelector('.player-spotlight-avatar') as HTMLSpanElement, playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return slot;
    }

    //a tag or a tile comes in with its player's turn
    private fadeIn(element: HTMLElement, index: number): void {
        this.animations.push(element.animate([
            { opacity: 0, translate: '0px 6px' },
            { opacity: 1, translate: '0px 0px' },
        ], { duration: CrashSpotlight.TAG_FADE_IN_DURATION, delay: index * CrashSpotlight.PLAYER_STAGGER, easing: 'ease-out', fill: 'backwards' }));
    }

    //the column, where it is: a red glow on its border (box-shadow, up and down) and one short shake (translate), together
    private animateArea(area: HTMLElement, delay: number): void {
        const noGlow = `0 0 0 0px rgba(217, 72, 59, 0), 0 0 0px 0px rgba(217, 72, 59, 0)`;
        const glow = `0 0 0 3px ${CrashSpotlight.GLOW_COLOR}, 0 0 22px 6px ${CrashSpotlight.GLOW_HALO_COLOR}`;
        this.animations.push(area.animate([
            { boxShadow: noGlow, offset: 0 },
            { boxShadow: glow, offset: 0.2 },
            { boxShadow: glow, offset: 0.45 },
            { boxShadow: noGlow, offset: 1 },
        ], { duration: CrashSpotlight.AREA_FLASH_DURATION, delay: delay, easing: 'ease-out' }));

        const distance = CrashSpotlight.AREA_SHAKE_DISTANCE;
        this.animations.push(area.animate([
            { translate: '0px 0px' },
            { translate: `${-distance}px 0px` },
            { translate: `${distance}px 0px` },
            { translate: `${-distance * 0.6}px 0px` },
            { translate: `${distance * 0.6}px 0px` },
            { translate: `${-distance * 0.25}px 0px` },
            { translate: '0px 0px' },
        ], { duration: CrashSpotlight.AREA_SHAKE_DURATION, delay: delay, easing: 'ease-in-out' }));
    }

    //a card turns a random amount either way, drops a little and fades out, then stays hidden (fill forwards) until the caller
    //discards it. rotate and translate are their own properties, so a hand card's transform (its lift) is untouched
    private tumbleCard(card: HTMLElement, delay: number): void {
        const rotation = (Math.random() * 2 - 1) * CrashSpotlight.CARD_TUMBLE_MAX_ROTATION;
        this.animations.push(card.animate([
            { rotate: '0deg', translate: '0px 0px', opacity: 1 },
            { rotate: `${rotation}deg`, translate: `0px ${CrashSpotlight.CARD_TUMBLE_DROP}px`, opacity: 0 },
        ], { duration: CrashSpotlight.CARD_TUMBLE_DURATION, delay: delay, easing: CrashSpotlight.CARD_TUMBLE_EASING, fill: 'forwards' }));
    }
}
