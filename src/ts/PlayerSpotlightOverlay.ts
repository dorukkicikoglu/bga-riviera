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

//one player in the spotlight, with the element shown for them: what that element is and how it moves is up to each overlay
//(LastChanceSpotlight: their Last Chance card on their board; CrashSpotlight: their played column)
export type SpotlightEntry = {
    playerID: number;
    element: HTMLElement;
};

//the shared part of the announcement overlays: a fixed overlay over the whole page (a light dim and an art deco banner at the
//top), centred on the play area, not the whole screen (setPlayAreaBounds). Each subclass plays its own timeline (start()) with
//the helpers here: the player tag (avatar and name), slots laid out in rows like the Last Chance cards, the overlay's fade.
//The theme class (on the overlay) styles the banner and the dim in Game.scss (.last-chance-spotlight, .crash-spotlight). Sizes
//and gaps live in Game.scss; each timeline lives at the top of its subclass.
//play() resolves once everything is gone; the caller then applies the end state. A click or tap on the overlay skips to that
//end at once. Nothing plays in a replay or with animations off (fast replay, instantaneous mode, hidden tab)
export abstract class PlayerSpotlightOverlay<Entry extends SpotlightEntry = SpotlightEntry> {
    private static readonly FINISH_SAFETY_MARGIN = 1000; //ms past the timeline's end after which play() resolves anyway (a hidden tab's throttled animations)
    private static readonly TOP_BAR_SELECTOR = '#topbar'; //BGA's top bar: the banner never goes under it (on mobile it paints over everything)
    private static readonly STATUS_BAR_SELECTOR = '#page-title'; //BGA's status bar, the same element when BGA fixes it at the top once the page is scrolled: the banner sits on it
    private static readonly OVERLAY_Z_INDEX = 948; //Game.scss's, BGA's status bar's: the overlay comes later in <body>, so it paints over the bar
    private static readonly BANNER_TOP_GAP = 10; //px between BGA's top bar and the banner, when there is no status bar in sight to sit on
    private static readonly STAGE_GAP = 12; //px kept between the banner and the slots, and between the slots and the screen's bottom
    private static readonly MIN_FIT_SCALE = 0.35; //the slots never shrink below this share of their size to fit between the banner and the bottom
    private static readonly FIT_PASSES = 4; //measure and shrink passes, for the slots and the banner's text (parts of each don't shrink, so one pass falls short)

    protected overlay: HTMLDivElement;
    protected stage: HTMLDivElement;
    private banner: HTMLDivElement;
    protected animations: Animation[] = [];
    private finished = false;
    private resolveSkip: () => void = () => {};

    constructor(protected game: Game, protected entries: Entry[], private bannerText: string, private themeClass: string) {}

    public async play(): Promise<void> {
        if(this.entries.length === 0 || this.game.isReplay() || !this.game.bga.gameui.bgaAnimationsActive())
            return;

        this.createOverlay();
        const skipped = new Promise<void>(resolve => this.resolveSkip = resolve);
        this.overlay.addEventListener('click', () => this.resolveSkip());

        const timeline = this.start();

        const timeout = new Promise<void>(resolve => setTimeout(resolve, timeline.duration + PlayerSpotlightOverlay.FINISH_SAFETY_MARGIN));
        await Promise.race([timeline.done, skipped, timeout]);

        this.finish();
    }

    //starts every animation of the overlay (each pushed to this.animations, so a skip can stop it). done resolves at the end;
    //duration is the whole timeline's length in ms, for the safety timeout
    protected abstract start(): { done: Promise<void>; duration: number };

    //after a skip or at the end, once every animation has stopped and the overlay is gone: the subclass removes its own
    //temporary elements and shows again what it hid
    protected cleanUp(): void {}

    //the overlay with its banner and an empty stage for slots, in <body>
    private createOverlay(): void {
        this.overlay = document.createElement('div');
        this.overlay.className = 'player-spotlight-overlay ' + this.themeClass;
        this.overlay.innerHTML = `
            <div class="player-spotlight-banner" role="status">
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
                <span class="player-spotlight-banner-text">${this.bannerText}</span>
                <span class="player-spotlight-banner-ornament" aria-hidden="true"></span>
            </div>
            <div class="player-spotlight-stage"></div>
        `;
        this.setPlayAreaBounds();
        this.banner = this.overlay.querySelector('.player-spotlight-banner') as HTMLDivElement;
        this.stage = this.overlay.querySelector('.player-spotlight-stage') as HTMLDivElement;
        document.body.appendChild(this.overlay);

        this.fitBannerText(); //first: the banner's height, which placeBanner centres, depends on its font size
        this.placeBanner();
    }

    //the banner sits on BGA's status bar, vertically centred on it, when the bar shows in the viewport (in place at the top of the
    //page, or fixed at the top once the page is scrolled). Never under BGA's top bar: pushed down just enough to clear it. With
    //no status bar in sight, just below the top bar (BANNER_TOP_GAP); with neither, Game.scss's default top. The overlay is fixed
    //at the viewport's top-left corner, so these on-screen px are its own
    private placeBanner(): void {
        const topBarRect = PlayerSpotlightOverlay.getShownRect(PlayerSpotlightOverlay.TOP_BAR_SELECTOR);
        const topBarBottom = topBarRect ? Math.max(0, topBarRect.bottom) : 0;
        const statusBarRect = PlayerSpotlightOverlay.getShownRect(PlayerSpotlightOverlay.STATUS_BAR_SELECTOR);

        let top: number | null = null;
        if(statusBarRect && statusBarRect.bottom > topBarBottom){ //some of it is in sight, not wholly under the top bar
            top = Math.max(topBarBottom, statusBarRect.top + (statusBarRect.height - this.banner.offsetHeight) / 2);
            this.raiseOverStatusBar(PlayerSpotlightOverlay.STATUS_BAR_SELECTOR);
        } else if(topBarRect)
            top = topBarBottom + PlayerSpotlightOverlay.BANNER_TOP_GAP;

        if(top !== null)
            this.banner.style.top = `${top}px`;
    }

    //the element's rect on screen, if it shows and reaches into the viewport
    private static getShownRect(selector: string): DOMRect | null {
        const element = document.querySelector(selector) as HTMLElement | null;
        if(!element)
            return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const shown = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        return (shown && rect.bottom > 0 && rect.top < window.innerHeight) ? rect : null;
    }

    //the overlay (948 in Game.scss, later in <body>) already paints over BGA's status bar; should BGA ever give the bar a higher
    //z-index, the overlay takes it, and still comes later
    private raiseOverStatusBar(selector: string): void {
        const statusBarZIndex = parseInt(getComputedStyle(document.querySelector(selector) as HTMLElement).zIndex);
        if(!isNaN(statusBarZIndex) && statusBarZIndex > PlayerSpotlightOverlay.OVERLAY_Z_INDEX)
            this.overlay.style.zIndex = statusBarZIndex.toString();
    }

    //the banner's text never wraps (Game.scss): its side lines shrink first, down to their minimum, and only then, if it still
    //overflows the banner's maximum width (a long translation on a narrow screen), the whole banner's font size comes down to fit
    private fitBannerText(): void {
        for(let pass = 0; pass < PlayerSpotlightOverlay.FIT_PASSES && this.banner.clientWidth > 0; pass++){ //the side lines' minimum doesn't scale, so one pass may fall short
            const overflow = this.banner.scrollWidth / this.banner.clientWidth;
            if(overflow <= 1.01)
                return;
            this.banner.style.fontSize = `${parseFloat(getComputedStyle(this.banner).fontSize) / overflow}px`;
        }
    }

    //the layout's bottom of the banner in viewport px: offsetTop and offsetHeight ignore the banner's own scale and shake
    protected getBannerBottom(): number { return this.banner.offsetTop + this.banner.offsetHeight; }

    //the slots and the banner centre on the game's play area (bga.gameArea, beside the player boards and the log on desktop, the
    //whole width on mobile), the part of it inside the viewport, and the slots fit its width (--spotlight-area-width, in
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

    //the slots (already in the page or not) on the stage: 1 to 3 large, 4 to 6 smaller, in one row, or two when one row would
    //make them narrower than --spotlight-min-card-width (4 to 6 on a narrow screen). Each slot is --spotlight-card-width wide
    protected layOutSlots(slots: HTMLDivElement[]): void {
        const count = slots.length;
        this.overlay.setAttribute('data-size', count <= 3 ? 'large' : 'small');
        this.fillRows(slots, count);

        const minCardWidth = parseFloat(getComputedStyle(this.overlay).getPropertyValue('--spotlight-min-card-width')) || 0;
        const slotWidth = slots[0].getBoundingClientRect().width;
        if(count > 3 && slotWidth < minCardWidth)
            this.fillRows(slots, Math.ceil(count / 2));

        this.fitStageBelowBanner();
    }

    //the slots start below the banner and end above the screen's bottom (STAGE_GAP each side): centred on the viewport when that
    //fits, pushed down when the banner reaches into them, and scaled down (--spotlight-fit-scale on the slots' width) when the
    //space between the banner and the bottom is shorter than they are. Done before anything measures the slots
    private fitStageBelowBanner(): void {
        const viewportHeight = window.innerHeight;
        const top = this.getBannerBottom() + PlayerSpotlightOverlay.STAGE_GAP;
        const bottom = viewportHeight - PlayerSpotlightOverlay.STAGE_GAP;
        const available = bottom - top;
        if(available <= 0)
            return;

        let scale = 1;
        for(let pass = 0; pass < PlayerSpotlightOverlay.FIT_PASSES && this.stage.offsetHeight > available && scale > PlayerSpotlightOverlay.MIN_FIT_SCALE; pass++){
            scale = Math.max(PlayerSpotlightOverlay.MIN_FIT_SCALE, scale * available / this.stage.offsetHeight);
            this.overlay.style.setProperty('--spotlight-fit-scale', scale.toString());
        }

        const height = this.stage.offsetHeight;
        const center = Math.max(top + height / 2, Math.min(viewportHeight / 2, bottom - height / 2));
        this.stage.style.top = `${center}px`;
    }

    //the slots in rows of perRow; Game.scss sizes them from --spotlight-per-row and data-rows
    private fillRows(slots: HTMLDivElement[], perRow: number): void {
        this.stage.innerHTML = '';
        const rowCount = Math.ceil(slots.length / perRow);
        this.overlay.style.setProperty('--spotlight-per-row', perRow.toString());
        this.overlay.setAttribute('data-rows', rowCount.toString());

        for(let rowIndex = 0; rowIndex < rowCount; rowIndex++){
            const row = document.createElement('div');
            row.className = 'player-spotlight-row';
            slots.slice(rowIndex * perRow, (rowIndex + 1) * perRow).forEach(slot => row.appendChild(slot));
            this.stage.appendChild(row);
        }
    }

    //an empty slot in the player's color (--player-color), for the subclass to fill
    protected createSlot(playerID: number): HTMLDivElement {
        const slot = document.createElement('div');
        slot.className = 'player-spotlight-slot';
        slot.style.setProperty('--player-color', this.getPlayerColor(playerID));
        return slot;
    }

    //the player tag: their BGA avatar and their name in their color, on a light pill
    protected createPlayerTag(playerID: number): HTMLDivElement {
        const tag = document.createElement('div');
        tag.className = 'player-spotlight-player';
        tag.style.setProperty('--player-color', this.getPlayerColor(playerID));
        tag.innerHTML = `
            <span class="player-spotlight-avatar"></span>
            ${this.game.divColoredPlayer(playerID, {class: 'playername player-spotlight-name'}, false)}
        `;
        this.game.fillPlayerAvatar(tag.querySelector('.player-spotlight-avatar') as HTMLSpanElement, playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return tag;
    }

    protected getPlayerColor(playerID: number): string { return '#' + (this.game.getPlayerColor(playerID) ?? '000000'); }

    //the dim and the banner fade in (fadeInMs), stay, and fade out from fadeOutStart (fadeOutMs); then the overlay goes, so it no
    //longer catches clicks. Resolves when it has faded out (or at once, after a skip)
    protected animateOverlay(fadeInMs: number, fadeOutStart: number, fadeOutMs: number): Promise<void> {
        const duration = fadeOutStart + fadeOutMs;
        const overlayAnimation = this.overlay.animate([
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: fadeInMs / duration },
            { opacity: 1, offset: fadeOutStart / duration },
            { opacity: 0, offset: 1 },
        ], { duration: duration, fill: 'forwards' });
        this.animations.push(overlayAnimation);
        return overlayAnimation.finished.then(() => this.overlay.remove()).catch(() => {}); //cancelled by a skip, which removes it itself
    }

    //an animation stopped by a skip (cancelled) resolves too, instead of rejecting
    protected static whenFinished(animation: Animation): Promise<void> {
        return animation.finished.then(() => {}).catch(() => {});
    }

    //the end, reached or skipped: every animation stops, the overlay goes, then the subclass's own clean-up (the caller applies the
    //end state right after, in the same task, so nothing paints in between)
    private finish(): void {
        if(this.finished)
            return;
        this.finished = true;

        this.animations.forEach(animation => animation.cancel());
        this.overlay.remove();
        this.cleanUp();
    }
}
