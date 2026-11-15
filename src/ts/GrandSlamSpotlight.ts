/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * GrandSlamSpotlight.ts
 */
import { Game } from "./Game";
import { PlayerSpotlightOverlay, SpotlightEntry } from "./PlayerSpotlightOverlay";

//one gold piece of confetti, in viewport px (the canvas is the viewport's size)
type ConfettiPiece = {
    x: number;
    y: number;
    vx: number; //px per second
    vy: number;
    width: number;
    height: number;
    color: string;
    rotation: number; //radians
    spin: number; //radians per second
    flipPhase: number; //its height is scaled by cos(flipPhase), a fake 3D flip
    flipSpeed: number; //radians per second
    swayPhase: number;
    swaySpeed: number; //radians per second
    swayAmplitude: number; //px per second of sideways drift, at its widest
};

//[BGA] every Grand Slam of a reveal (Game.notif_grandSlamAnimation), under a gold "Grand Slam!" banner (.grand-slam-spotlight):
//the banner settles in from a little oversized, then each winner's avatar, ringed in gold, pops in in the middle of the play
//area with their name on a gold-rimmed pill below, over a slowly turning sunburst of gold rays. Gold confetti bursts out of
//the avatars and falls, then rains gently from the top of the screen; everything fades out. Several winners side by side, laid
//out like the Last Chance cards. The confetti is one canvas, drawn on requestAnimationFrame and stopped in cleanUp().
//Each entry's element is the winner's played column: nothing moves from it, the overlay only needs the player
export class GrandSlamSpotlight extends PlayerSpotlightOverlay {
    //timeline, in ms from the start (the banner's settle and its lines are in Game.scss)
    private static readonly OVERLAY_FADE_IN_DURATION = 250; //ms the dim and the banner take to appear
    private static readonly WINNER_DELAY = 300; //ms after the banner the first winner pops in
    private static readonly WINNER_STAGGER = 120; //ms between two winners popping in
    private static readonly WINNER_POP_DURATION = 550; //ms from nothing to the peak and back to full size
    private static readonly WINNER_POP_SCALE = 1.12; //the pop's peak
    private static readonly WINNER_POP_PEAK = 0.6; //share of the pop at which it peaks
    private static readonly RAYS_FADE_IN_DURATION = 600; //ms the sunburst takes to appear, from the first winner's pop
    private static readonly RAYS_ROTATION = 200; //degrees the sunburst turns over the whole animation (it fades out with the overlay)
    private static readonly FADE_OUT_START = 3500; //ms: everything fades out from here
    private static readonly FADE_OUT_DURATION = 500;
    private static readonly TOTAL_DURATION = GrandSlamSpotlight.FADE_OUT_START + GrandSlamSpotlight.FADE_OUT_DURATION;

    //confetti
    private static readonly CONFETTI_COLORS = ['#e0a840', '#f5d27a', '#b8862b', '#fff2c4', '#d99a2b'];
    private static readonly BURST_START = GrandSlamSpotlight.WINNER_DELAY + GrandSlamSpotlight.WINNER_POP_DURATION * GrandSlamSpotlight.WINNER_POP_PEAK; //ms: at the first avatar's peak
    private static readonly BURST_COUNT = 135; //pieces bursting out of the avatars (shared between them), on a CONFETTI_REFERENCE_AREA screen
    private static readonly BURST_MIN_SPEED = 220; //px per second, each piece's start speed at random between these
    private static readonly BURST_MAX_SPEED = 720;
    private static readonly BURST_UPWARD_BOOST = 260; //px per second added upwards, so the burst rises before it falls
    private static readonly RAIN_START = 900; //ms: the gentle rain from the top of the screen
    private static readonly RAIN_DURATION = 2000;
    private static readonly RAIN_COUNT = 90; //pieces over the whole rain, on a CONFETTI_REFERENCE_AREA screen
    private static readonly RAIN_MIN_SPEED = 60; //px per second downwards at the start, at random between these
    private static readonly RAIN_MAX_SPEED = 140;
    private static readonly CONFETTI_REFERENCE_AREA = 1920 * 1080; //px²: the counts above are for a screen this big, scaled by the viewport's area
    private static readonly CONFETTI_MIN_SHARE = 0.35; //a small screen still gets this share of the counts
    private static readonly GRAVITY = 900; //px per second²
    private static readonly DRAG = 1.6; //per second: the velocity decays as exp(-DRAG * t), so the pieces float
    private static readonly MAX_FALL_SPEED = 320; //px per second
    private static readonly PIECE_MIN_WIDTH = 6; //px, at random between these
    private static readonly PIECE_MAX_WIDTH = 11;
    private static readonly PIECE_MIN_HEIGHT_RATIO = 0.4; //its height, a share of its width, at random between these
    private static readonly PIECE_MAX_HEIGHT_RATIO = 0.7;
    private static readonly MAX_SPIN = 9; //radians per second, either way
    private static readonly MIN_FLIP_SPEED = 6; //radians per second
    private static readonly MAX_FLIP_SPEED = 14;
    private static readonly MAX_SWAY_AMPLITUDE = 60; //px per second
    private static readonly MAX_FRAME_STEP = 0.05; //s: a longer frame (a stall) moves the pieces this much at most

    private confettiCanvas: HTMLCanvasElement | null = null;
    private confettiFrame: number | null = null;

    constructor(game: Game, entries: SpotlightEntry[]) {
        super(game, entries, _('Grand Slam!'), 'grand-slam-spotlight');
    }

    protected start(): { done: Promise<void>; duration: number } {
        const slots = this.entries.map(entry => this.createWinnerSlot(entry.playerID));
        this.layOutSlots(slots);

        //measured before anything scales: the avatars' centres and size, for the rays and the burst
        const avatarRects = slots.map(slot => (slot.querySelector('.grand-slam-avatar') as HTMLElement).getBoundingClientRect());

        const done = this.animateOverlay(GrandSlamSpotlight.OVERLAY_FADE_IN_DURATION, GrandSlamSpotlight.FADE_OUT_START, GrandSlamSpotlight.FADE_OUT_DURATION);
        this.animateRays(avatarRects);
        slots.forEach((slot, index) => this.popWinner(slot.querySelector('.grand-slam-winner') as HTMLDivElement, index));
        this.startConfetti(avatarRects.map(rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })));

        return { done: done, duration: GrandSlamSpotlight.TOTAL_DURATION };
    }

    //the winner's avatar in its gold ring, their name on a gold-rimmed pill below
    private createWinnerSlot(playerID: number): HTMLDivElement {
        const slot = this.createSlot(playerID);
        slot.innerHTML = `
            <div class="grand-slam-winner">
                <span class="player-spotlight-avatar grand-slam-avatar"></span>
                <div class="grand-slam-name-pill">
                    ${this.game.divColoredPlayer(playerID, {class: 'playername player-spotlight-name'}, false)}
                </div>
            </div>
        `;
        this.game.fillPlayerAvatar(slot.querySelector('.grand-slam-avatar') as HTMLSpanElement, playerID, 'player-spotlight-avatar-image', 'player-spotlight-avatar-initial');
        return slot;
    }

    //nothing → WINNER_POP_SCALE → full size
    private popWinner(winner: HTMLDivElement, index: number): void {
        this.animations.push(winner.animate([
            { scale: 0, offset: 0, easing: 'ease-out' },
            { scale: GrandSlamSpotlight.WINNER_POP_SCALE, offset: GrandSlamSpotlight.WINNER_POP_PEAK, easing: 'ease-in-out' },
            { scale: 1, offset: 1 },
        ], { duration: GrandSlamSpotlight.WINNER_POP_DURATION, delay: GrandSlamSpotlight.WINNER_DELAY + index * GrandSlamSpotlight.WINNER_STAGGER, fill: 'backwards' }));
    }

    //a sunburst behind each avatar, in a layer under the banner and the slots (so a neighbour's rays never cover an avatar). It
    //fades in with the first pop and turns RAYS_ROTATION degrees over the whole animation; the overlay's fade takes it out
    private animateRays(avatarRects: DOMRect[]): void {
        const layer = document.createElement('div');
        layer.className = 'grand-slam-rays-layer';
        this.overlay.prepend(layer);

        const total = GrandSlamSpotlight.TOTAL_DURATION;
        for(let rect of avatarRects){
            const rays = document.createElement('div');
            rays.className = 'grand-slam-rays';
            rays.style.setProperty('--rays-center-x', `${rect.left + rect.width / 2}px`);
            rays.style.setProperty('--rays-center-y', `${rect.top + rect.height / 2}px`);
            rays.style.setProperty('--rays-avatar-size', `${rect.width}px`);
            layer.appendChild(rays);

            this.animations.push(rays.animate([
                { opacity: 0, rotate: '0deg', offset: 0 },
                { opacity: 0, offset: GrandSlamSpotlight.WINNER_DELAY / total },
                { opacity: 1, offset: (GrandSlamSpotlight.WINNER_DELAY + GrandSlamSpotlight.RAYS_FADE_IN_DURATION) / total },
                { opacity: 1, rotate: `${GrandSlamSpotlight.RAYS_ROTATION}deg`, offset: 1 },
            ], { duration: total, fill: 'both' }));
        }
    }

    //the confetti: one canvas over the whole overlay, the viewport's size in device px (sharp on a phone), drawn on
    //requestAnimationFrame until the end. The burst comes out of the avatars at BURST_START, the rain from the top of the
    //screen from RAIN_START for RAIN_DURATION. Fewer pieces on a smaller screen
    private startConfetti(origins: { x: number; y: number }[]): void {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = window.devicePixelRatio || 1;

        const canvas = document.createElement('canvas');
        canvas.className = 'grand-slam-confetti';
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        const context = canvas.getContext('2d');
        if(!context)
            return;
        this.overlay.appendChild(canvas);
        this.confettiCanvas = canvas;

        const share = Math.min(1, Math.max(GrandSlamSpotlight.CONFETTI_MIN_SHARE, (width * height) / GrandSlamSpotlight.CONFETTI_REFERENCE_AREA));
        const burstPerOrigin = Math.round(GrandSlamSpotlight.BURST_COUNT * share / Math.max(1, origins.length));
        const rainTimes = Array.from({ length: Math.round(GrandSlamSpotlight.RAIN_COUNT * share) }, () => GrandSlamSpotlight.RAIN_START + Math.random() * GrandSlamSpotlight.RAIN_DURATION).sort((a, b) => a - b);

        let pieces: ConfettiPiece[] = [];
        let burstDone = false;
        let rainIndex = 0;
        let startTime: number | null = null;
        let lastTime = 0;

        const drawFrame = (now: number) => {
            if(startTime === null){
                startTime = now;
                lastTime = now;
            }
            const elapsed = now - startTime;
            const step = Math.min(GrandSlamSpotlight.MAX_FRAME_STEP, (now - lastTime) / 1000);
            lastTime = now;

            if(!burstDone && elapsed >= GrandSlamSpotlight.BURST_START){
                burstDone = true;
                for(let origin of origins)
                    for(let index = 0; index < burstPerOrigin; index++)
                        pieces.push(GrandSlamSpotlight.createBurstPiece(origin.x, origin.y));
            }
            while(rainIndex < rainTimes.length && rainTimes[rainIndex] <= elapsed){
                pieces.push(GrandSlamSpotlight.createRainPiece(width));
                rainIndex++;
            }

            pieces = pieces.filter(piece => GrandSlamSpotlight.movePiece(piece, step, height));

            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
            for(let piece of pieces){
                //device px, then the piece's place, turn and flip
                context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
                context.translate(piece.x, piece.y);
                context.rotate(piece.rotation);
                context.scale(1, Math.cos(piece.flipPhase));
                context.fillStyle = piece.color;
                context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
            }

            this.confettiFrame = (elapsed < GrandSlamSpotlight.TOTAL_DURATION) ? requestAnimationFrame(drawFrame) : null;
        };
        this.confettiFrame = requestAnimationFrame(drawFrame);
    }

    private static createPiece(x: number, y: number, vx: number, vy: number): ConfettiPiece {
        const width = GrandSlamSpotlight.random(GrandSlamSpotlight.PIECE_MIN_WIDTH, GrandSlamSpotlight.PIECE_MAX_WIDTH);
        const colors = GrandSlamSpotlight.CONFETTI_COLORS;
        return {
            x: x, y: y, vx: vx, vy: vy,
            width: width,
            height: width * GrandSlamSpotlight.random(GrandSlamSpotlight.PIECE_MIN_HEIGHT_RATIO, GrandSlamSpotlight.PIECE_MAX_HEIGHT_RATIO),
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            spin: GrandSlamSpotlight.random(-GrandSlamSpotlight.MAX_SPIN, GrandSlamSpotlight.MAX_SPIN),
            flipPhase: Math.random() * Math.PI * 2,
            flipSpeed: GrandSlamSpotlight.random(GrandSlamSpotlight.MIN_FLIP_SPEED, GrandSlamSpotlight.MAX_FLIP_SPEED),
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: GrandSlamSpotlight.random(1.5, 3.5),
            swayAmplitude: Math.random() * GrandSlamSpotlight.MAX_SWAY_AMPLITUDE,
        };
    }

    //out of an avatar, in any direction, a little upwards
    private static createBurstPiece(x: number, y: number): ConfettiPiece {
        const angle = Math.random() * Math.PI * 2;
        const speed = GrandSlamSpotlight.random(GrandSlamSpotlight.BURST_MIN_SPEED, GrandSlamSpotlight.BURST_MAX_SPEED);
        return GrandSlamSpotlight.createPiece(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - GrandSlamSpotlight.BURST_UPWARD_BOOST);
    }

    //from just above the top of the screen, anywhere across it
    private static createRainPiece(width: number): ConfettiPiece {
        return GrandSlamSpotlight.createPiece(Math.random() * width, -GrandSlamSpotlight.PIECE_MAX_WIDTH, GrandSlamSpotlight.random(-30, 30), GrandSlamSpotlight.random(GrandSlamSpotlight.RAIN_MIN_SPEED, GrandSlamSpotlight.RAIN_MAX_SPEED));
    }

    //one frame of gravity, drag, sway, spin and flip; false once the piece has fallen below the screen
    private static movePiece(piece: ConfettiPiece, step: number, height: number): boolean {
        const drag = Math.exp(-GrandSlamSpotlight.DRAG * step);
        piece.vx *= drag;
        piece.vy = Math.min(GrandSlamSpotlight.MAX_FALL_SPEED, (piece.vy + GrandSlamSpotlight.GRAVITY * step) * drag);
        piece.swayPhase += piece.swaySpeed * step;
        piece.x += (piece.vx + Math.sin(piece.swayPhase) * piece.swayAmplitude) * step;
        piece.y += piece.vy * step;
        piece.rotation += piece.spin * step;
        piece.flipPhase += piece.flipSpeed * step;
        return piece.y < height + GrandSlamSpotlight.PIECE_MAX_WIDTH * 2;
    }

    private static random(min: number, max: number): number { return min + Math.random() * (max - min); }

    //the confetti loop stops and its canvas goes (the overlay, with the rays and the slots, is already gone)
    protected cleanUp(): void {
        if(this.confettiFrame !== null)
            cancelAnimationFrame(this.confettiFrame);
        this.confettiFrame = null;
        this.confettiCanvas?.remove();
        this.confettiCanvas = null;
    }
}
