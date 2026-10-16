/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * StartTokenHandler.ts
 */
import { Game } from "./Game";

type ScreenPoint = { x: number; y: number; };

export class StartTokenHandler{
    private static readonly TILT = -7; //deg, the token's rotation on a board (tilted left); upright (0) in flight

    //the pass: a flight on a copy of the token, out of the player boards area (growing), a hold at the peak, then into the new board (shrinking back)
    private static readonly LIFT_DURATION = 520; //ms of phase 1, from the old board to the lift point: eases in leaving the board
    private static readonly PEAK_PAUSE = 20; //ms of real stillness at the lift point, at full size, between the two phases (0: no hold, no slowdown)
    private static readonly PEAK_EASE_FULL_PAUSE = 300; //PEAK_PAUSE (ms) from which the lift fully eases into the hold and the landing out of it; shorter pauses ease proportionally less
    private static readonly LAND_DURATION = 520; //ms of phase 2, from the lift point to the new board: eases out arriving on it
    private static readonly STRAIGHTEN_FRACTION = 0.22; //share of phase 1, from its start, in which the token rotates from TILT to upright
    private static readonly TILT_BACK_FRACTION = 0.22; //share of phase 2, up to its end, in which it rotates back to TILT, done as it lands
    private static readonly LIFT_SCALE = 2; //size of the token at the lift point, relative to its size on a board
    private static readonly DESKTOP_LIFT_DISTANCE = 140; //px from the boards column's inner edge to the token's center at the lift point (boards beside the game area)
    private static readonly MOBILE_LIFT_Y = 0.4; //share of the viewport height of the lift point (boards above the game area)
    private static readonly VIEWPORT_MARGIN = 10; //px the lifted token keeps from the viewport's edges
    private static readonly MIN_CURVE_SPAN = 120; //px, the least the path swings through the lift point, so boards right next to each other still get a curve
    private static readonly KEYFRAMES_PER_PHASE = 24; //points sampled along each phase for the animation's keyframes (a fixed count, computed once per pass)
    private static readonly FINISH_SAFETY_MARGIN = 300; //ms after the flight's duration at which the pass ends anyway, should the animation never report finished

    private startToken: HTMLDivElement;

    //the token's layers, bottom to top: the stroke in its owner's color, the pawn (see .start-token in Game.scss).
    //Shared with the mini token in log rows
    public static readonly LAYERS_HTML = '<div class="start-token-outline"></div><div class="start-token-pawn"></div>';

    constructor(private game: Game, private startPlayerID: number) {
        this.startToken = document.createElement('div');
        this.startToken.id = 'start-token';
        this.startToken.className = 'start-token';
        this.startToken.style.rotate = this.getTilt(); //never `transform` on the token or its copy: see moveTo
        this.startToken.innerHTML = StartTokenHandler.LAYERS_HTML;
        StartTokenHandler.setOutlineColor(this.startToken, this.getPlayerColorCSS(this.startPlayerID));

        const startTokenAnchor = this.game.players[this.startPlayerID]?.getStartTokenAnchor();
        if(startTokenAnchor)
            startTokenAnchor.appendChild(this.startToken);
	}

    //the token flies from its current player board's corner to playerID's on a position:fixed copy, so it shows wherever
    //the page is scrolled: one Web Animations API animation over the whole curved path, the lift and the landing each eased
    //in and out, with a hold at the peak between them. Resolves when the copy has landed and the real token shows on the new board.
    //Movement, rotation and size each have their own CSS property (translate, rotate, scale), on the token and on its copy
    //alike, and `transform` is never used for either: when the board tilt lived in `transform`, the copy inherited it and
    //every on-screen measurement of the copy came out rotated, so the whole flight was off
    public async moveTo(playerID: number){
        const targetAnchor = this.game.players[playerID]?.getStartTokenAnchor();
        if(!targetAnchor)
            return;

        const fromColor = this.getPlayerColorCSS(this.startPlayerID);
        const toColor = this.getPlayerColorCSS(playerID);
        this.startPlayerID = playerID;

        const sourceAnchor = this.startToken.parentElement as HTMLDivElement | null;
        if(sourceAnchor === targetAnchor)
            return;

        if(!sourceAnchor || !this.game.bga.gameui.bgaAnimationsActive()){ //nothing to fly from, or no animations (fast replay, hidden tab)
            targetAnchor.appendChild(this.startToken);
            StartTokenHandler.setOutlineColor(this.startToken, toColor);
            return;
        }

        const fromRect = this.getUntiltedRect(); //real on-screen places, even off-screen
        const flyingCopy = this.createFlyingCopy();
        const placeOnScreen = this.getFlyingCopyPlacement(flyingCopy);

        this.startToken.style.visibility = 'hidden';
        targetAnchor.appendChild(this.startToken);
        StartTokenHandler.setOutlineColor(this.startToken, toColor); //hidden until the copy lands
        const landingRect = this.getUntiltedRect();
        const targetBounce = this.game.players[playerID].getBounceOffset(); //a card 10 bounce may still be playing: land on the resting board
        const toRect = new DOMRect(landingRect.x, landingRect.y - targetBounce, landingRect.width, landingRect.height);

        const from = this.getCenter(fromRect);
        const to = this.getCenter(toRect);
        const liftHeight = fromRect.height * StartTokenHandler.LIFT_SCALE;
        const sideways = this.areBoardsBesideGameArea(sourceAnchor);
        const lift = this.getLiftPoint(sourceAnchor, targetAnchor, from, to, liftHeight);

        //two quadratic curves meeting at the lift point in the same direction, so the path has no corner there. Boards beside
        //the game area: the token passes the lift point moving up or down (a C, out sideways and back); boards above it: moving
        //sideways (a U, down and back up). Each curve's control point sits on that line through the lift point, at a distance
        //proportional to its phase's duration
        const liftShare = StartTokenHandler.LIFT_DURATION / (StartTokenHandler.LIFT_DURATION + StartTokenHandler.LAND_DURATION);
        const direction = sideways
            ? { x: 0, y: Math.sign(to.y - from.y) || 1 }
            : { x: Math.sign(to.x - from.x) || Math.sign(window.innerWidth / 2 - from.x) || 1, y: 0 };
        const span = Math.max(sideways ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x), StartTokenHandler.MIN_CURVE_SPAN);
        const liftControl = { x: lift.x - direction.x * span * liftShare, y: lift.y - direction.y * span * liftShare };
        const landControl = { x: lift.x + direction.x * span * (1 - liftShare), y: lift.y + direction.y * span * (1 - liftShare) };

        //where the copy is at a point of a phase (phaseProgress 0 to 1, already eased). At the start of the lift and the end of
        //the landing it sits exactly on the real token: same center, same untilted height, same TILT
        const placementAt = (isLifting: boolean, phaseProgress: number): { translate: string; scale: string; rotate: string; } => {
            const point = isLifting ? this.getCurvePoint(from, liftControl, lift, phaseProgress) : this.getCurvePoint(lift, landControl, to, phaseProgress);
            const height = isLifting
                ? fromRect.height + (liftHeight - fromRect.height) * phaseProgress
                : liftHeight + (toRect.height - liftHeight) * phaseProgress;

            const tiltBackStart = 1 - StartTokenHandler.TILT_BACK_FRACTION;
            const tilt = isLifting
                ? StartTokenHandler.TILT * (1 - Math.min(1, phaseProgress / StartTokenHandler.STRAIGHTEN_FRACTION))
                : StartTokenHandler.TILT * Math.max(0, (phaseProgress - tiltBackStart) / StartTokenHandler.TILT_BACK_FRACTION);

            return placeOnScreen(point, height, tilt);
        };

        //keyframes evenly spread in time, linear between them, eased here per phase: the lift eases in leaving the board and
        //the landing eases out arriving, while around the peak they ease into and out of the hold only as much as PEAK_PAUSE
        //calls for (peakEasing 0: through the peak at full speed; 1: to rest and from rest). The hold itself is two equal
        //keyframes at the peak, exactly PEAK_PAUSE ms apart
        const peakEasing = Math.min(1, StartTokenHandler.PEAK_PAUSE / StartTokenHandler.PEAK_EASE_FULL_PAUSE);
        const durationMs = StartTokenHandler.LIFT_DURATION + StartTokenHandler.PEAK_PAUSE + StartTokenHandler.LAND_DURATION;
        const landStart = (StartTokenHandler.LIFT_DURATION + StartTokenHandler.PEAK_PAUSE) / durationMs; //offset where the landing starts
        const keyframes: Keyframe[] = [];
        for(let i = 0; i <= StartTokenHandler.KEYFRAMES_PER_PHASE; i++){
            const t = i / StartTokenHandler.KEYFRAMES_PER_PHASE;
            keyframes.push({ offset: t * StartTokenHandler.LIFT_DURATION / durationMs, ...placementAt(true, this.easeLift(t, peakEasing)) });
        }
        for(let i = 0; i <= StartTokenHandler.KEYFRAMES_PER_PHASE; i++){ //its first keyframe ends the hold at the lift point
            const t = i / StartTokenHandler.KEYFRAMES_PER_PHASE;
            keyframes.push({ offset: landStart + t * (1 - landStart), ...placementAt(false, this.easeLand(t, peakEasing)) });
        }
        keyframes[keyframes.length - 1].offset = 1; //exactly, whatever the rounding

        Object.assign(flyingCopy.style, placementAt(true, 0)); //in place before the animation's first frame
        const flightTiming: KeyframeAnimationOptions = { duration: durationMs, easing: 'linear', fill: 'forwards' };
        const flight = flyingCopy.animate(keyframes, flightTiming);

        //the stroke keeps the old owner's color through the lift and the hold, and blends into the new owner's through the
        //landing, done as it lands. Only that layer's background-color animates
        flyingCopy.querySelector('.start-token-outline')?.animate([
            { offset: 0, backgroundColor: fromColor },
            { offset: landStart, backgroundColor: fromColor },
            { offset: 1, backgroundColor: toColor },
        ], flightTiming);

        await Promise.race([ //the timeout guarantees the pass ends even if `finished` never settles
            flight.finished.catch(() => undefined),
            this.game.bga.gameui.wait(durationMs + StartTokenHandler.FINISH_SAFETY_MARGIN),
        ]);

        this.startToken.style.visibility = null;
        flyingCopy.remove();
    }

    //the copy for the flight: in <body>, pinned to the viewport's top-left corner (.flying-start-token), with none of the
    //token's own translate, rotate or scale, so its first measurement is its untransformed box
    private createFlyingCopy(): HTMLDivElement {
        const flyingCopy = this.startToken.cloneNode(true) as HTMLDivElement;
        flyingCopy.removeAttribute('id');
        flyingCopy.style.removeProperty('visibility');
        flyingCopy.style.removeProperty('rotate');
        flyingCopy.classList.add('flying-start-token');
        document.body.appendChild(flyingCopy);
        return flyingCopy;
    }

    //returns the translate, scale and rotate that put the copy's center on an on-screen point, at an on-screen height and
    //tilt. The copy rotates and scales around its center, so the three never depend on each other. Its measured zoom
    //converts screen px into its own px (it lives outside BGA's mobile scaling of the page)
    private getFlyingCopyPlacement(flyingCopy: HTMLDivElement): (center: ScreenPoint, height: number, tilt: number) => { translate: string; scale: string; rotate: string; } {
        const baseRect = flyingCopy.getBoundingClientRect(); //untransformed, at the viewport's top-left corner
        const baseCenter = this.getCenter(baseRect);
        const cssWidth = parseFloat(getComputedStyle(flyingCopy).width); //unrounded, unlike offsetWidth
        const zoom = (cssWidth > 0) ? baseRect.width / cssWidth : 1;

        return (center: ScreenPoint, height: number, tilt: number) => ({
            translate: `${(center.x - baseCenter.x) / zoom}px ${(center.y - baseCenter.y) / zoom}px`,
            scale: `${(baseRect.height > 0) ? height / baseRect.height : 1}`,
            rotate: `${tilt}deg`,
        });
    }

    //where the token lifts to, in viewport coordinates, so the lift shows even when the boards are scrolled out of view
    private getLiftPoint(sourceAnchor: HTMLDivElement, targetAnchor: HTMLDivElement, from: ScreenPoint, to: ScreenPoint, liftHeight: number): ScreenPoint {
        const margin = liftHeight / 2 + StartTokenHandler.VIEWPORT_MARGIN;
        const clamp = (value: number, max: number): number => Math.min(Math.max(value, margin), Math.max(margin, max - margin));

        if(this.areBoardsBesideGameArea(sourceAnchor)){ //out of the boards column, toward the game area
            const sourceRect = sourceAnchor.getBoundingClientRect();
            const targetRect = targetAnchor.getBoundingClientRect();
            const gameAreaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
            const x = (sourceRect.left >= gameAreaRect.left)
                ? Math.min(sourceRect.left, targetRect.left) - StartTokenHandler.DESKTOP_LIFT_DISTANCE
                : Math.max(sourceRect.right, targetRect.right) + StartTokenHandler.DESKTOP_LIFT_DISTANCE;
            return { x: clamp(x, window.innerWidth), y: clamp((from.y + to.y) / 2, window.innerHeight) };
        }

        return { x: clamp((from.x + to.x) / 2, window.innerWidth), y: window.innerHeight * StartTokenHandler.MOBILE_LIFT_Y };
    }

    //decided by where the boards are, not by the screen width: beside the game area (desktop) when they don't share any
    //horizontal range with it, above it (mobile) otherwise
    private areBoardsBesideGameArea(anchor: HTMLDivElement): boolean {
        const boardRect = anchor.getBoundingClientRect();
        const gameAreaRect = this.game.bga.gameArea.getElement().getBoundingClientRect();
        return boardRect.left >= gameAreaRect.right - 1 || boardRect.right <= gameAreaRect.left + 1;
    }

    //the token's on-screen box without its tilt (a rotated box measures bigger); its center is the same either way
    private getUntiltedRect(): DOMRect {
        this.startToken.style.rotate = 'none';
        const rect = this.startToken.getBoundingClientRect();
        this.startToken.style.rotate = this.getTilt();
        return rect;
    }

    private getCurvePoint(from: ScreenPoint, control: ScreenPoint, to: ScreenPoint, t: number): ScreenPoint {
        return {
            x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
            y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
        };
    }

    //the stroke's color: the token's --start-token-color, read by .start-token-outline
    public static setOutlineColor(token: HTMLElement, color: string): void { token.style.setProperty('--start-token-color', color); }
    private getPlayerColorCSS(playerID: number): string { return '#' + (this.game.getPlayerColor(playerID) ?? '000000'); }
    private getTilt(): string { return `${StartTokenHandler.TILT}deg`; }
    //quadratic easings for the two phases, blended by peakEasing (0 to 1) between ease-in (lift) or ease-out (landing) and
    //ease-in-out. At peakEasing 0 the lift ends at speed 2 and the landing starts at speed 2 (per unit of its own time); the
    //path's control points scale with each phase's duration, so the token crosses the peak at one steady speed, no jerk
    private easeLift(t: number, peakEasing: number): number { return (1 - peakEasing) * t * t + peakEasing * this.easeInOutQuad(t); }
    private easeLand(t: number, peakEasing: number): number { return (1 - peakEasing) * (1 - (1 - t) * (1 - t)) + peakEasing * this.easeInOutQuad(t); }
    private easeInOutQuad(t: number): number { return (t < 0.5) ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); }
    private getCenter(rect: DOMRect): ScreenPoint { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

    public getStartPlayerID(): number { return this.startPlayerID; }
}
