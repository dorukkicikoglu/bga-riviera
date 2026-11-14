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

    protected overlay: HTMLDivElement;
    protected stage: HTMLDivElement;
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
        this.stage = this.overlay.querySelector('.player-spotlight-stage') as HTMLDivElement;
        document.body.appendChild(this.overlay);
    }

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
