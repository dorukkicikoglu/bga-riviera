/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * BackgroundHandler.ts
 */
import { Game } from "./Game";

type SwayKeyframe = [percent: number, lean: number]; //lean: a multiple of the tree's --sway

export class BackgroundHandler{
    //tree count, picked at random on every build
    private static readonly minNumOfTrees = 4;
    private static readonly maxNumOfTrees = 7;

    //tree height in px, picked per tree; the width follows from the sprite's cell
    private static readonly minTreeHeight = 50;
    private static readonly maxTreeHeight = 156;
    private static readonly minTreeHeightMobile = 40;
    private static readonly maxTreeHeightMobile = 104;
    private static readonly maxHeightRatio = 1.95; //the tallest tree is at most this many times the shortest: getHeightRange() raises the min to enforce it
    private static readonly treeSinkRatio = 0.06; //share of a tree's height below the screen's bottom edge, so no gap shows under the trunk as it rotates
    private static readonly mobileBreakpoint = 700; //px of window width, at or under it the mobile heights apply (same as the 700px media query in Game.scss)
    private static readonly maxTreeHeightOfViewport = 0.85; //no tree is taller than this share of the window, so a landscape phone doesn't cut the canopies off

    //horizontal spacing: the trees stand in the bottom left corner, tallest on the left, each step measured in the width of the tree just placed
    private static readonly maxSpanOfWidth = 0.2; //the trees never reach past this share of the screen's width: the steps are squeezed to fit
    private static readonly treeSpacing = 0.9; //step to the next tree when there is room; under 1 neighbours overlap, over 1 there is a gap between them
    private static readonly spacingJitter = 0.15; //random change to each step, added to or taken from treeSpacing
    private static readonly edgeBleed = 0.3; //share of the first tree's width off the left edge of the screen

    //wind
    private static readonly minWindStrength = 0.75; //degrees of rotation at peak sway
    private static readonly maxWindStrength = 2.5;
    private static readonly minSwayDuration = 7.5; //seconds per cycle
    private static readonly maxSwayDuration = 11;
    private static readonly numOfSwayAnimations = 8; //baked keyframe variants, at most SWAY_SHAPES.length
    private static readonly animationReshuffleChance = 0.35; //probability a tree switches to a different variant each time its cycle ends
    private static readonly swaySkew = -0.3; //skewX per degree of rotation, the canopy trailing behind the lean (negative skews the same way as the rotation). Follows the wind strength: a weaker wind skews less on its own
    //every one eases to a stop on each keyframe, so a tree switching variant at the end of its cycle (at rest, upright) never jerks: no plain 'ease' or 'linear' here
    private static readonly swayEasings = ['ease-in-out', 'cubic-bezier(0.37, 0, 0.63, 1)', 'cubic-bezier(0.45, 0, 0.55, 1)', 'cubic-bezier(0.65, 0, 0.35, 1)'];

    //every variant starts and ends upright (lean 0): reshuffleTree() relies on it. A tree's --sway can be negative, which mirrors the shape
    private static readonly SWAY_SHAPES: SwayKeyframe[][] = [
        [[0, 0], [25, 1], [75, -1], [100, 0]], //gentle and symmetric
        [[0, 0], [17, 0.6], [50, -0.6], [83, 0.6], [100, 0]], //gentle and symmetric, smaller and busier
        [[0, 0], [50, 0.8], [100, 0]], //a slow lean and back
        [[0, 0], [25, 1], [100, 0]], //a strong push, a slow return
        [[0, 0], [25, 1], [60, -0.25], [100, 0]], //a strong push, overshooting on the way back
        [[0, 0], [30, 0.3], [50, 1], [80, -0.2], [100, 0]], //a gust building up
        [[0, 0], [25, 1], [40, 0.7], [55, 0.85], [100, 0]], //a strong push, held with a flutter
        [[0, 0], [20, 0.8], [32, 0.45], [44, 0.9], [58, 0.5], [100, 0]], //double flutter
    ];

    //sprite: img/bg_trees.webp, one tree per cell, left to right, top to bottom. These are the data-tree-color values Game.scss places
    private static readonly SPRITE_FILE = 'bg_trees.webp';
    private static readonly SPRITE_COLUMNS = 3;
    private static readonly SPRITE_ROWS = 2;
    private static readonly TREE_COLORS = ['teal', 'yellow', 'green', 'orange', 'pink', 'purple'];
    private static readonly excludedTreeColors: string[] = ['yellow']; //sprite cells no tree uses; empty this to bring them back
    private static readonly pickableTreeColors = BackgroundHandler.TREE_COLORS.filter(color => !BackgroundHandler.excludedTreeColors.includes(color));

    //stacking and rebuilding
    private static readonly treeContainerZIndex = 0; //like Fugu's background: first in <body>, so all of BGA's positioned content paints over it. Its own stacking context, so a tree's z-index stays inside it
    private static readonly resizeDebounceTime = 250; //ms
    private static readonly rebuildWidthChange = 0.15; //share of the width a resize must change it by to rebuild, so a phone's address bar showing or hiding (height only) or a small drag does nothing. Trees are placed in %, so they follow until then

    //the "Background trees" preference (gamepreferences.jsonc): any other value is On
    private static readonly TREES_PREF_NO_WIND = 2;
    private static readonly TREES_PREF_NO_TREES = 3;
    //the "Background animation" preference: the pattern on body::before drifts (Game.scss) unless this is set; any other value is On
    private static readonly DRIFT_PREF_OFF = 2;
    //custom properties on <html> that Game.scss reads for the drifting pattern: the leg's duration (set there) and the random start (set here)
    private static readonly DRIFT_LEG_DURATION_PROPERTY = '--bg-drift-leg-duration';
    private static readonly DRIFT_DELAY_PROPERTY = '--bg-drift-delay';
    private static readonly DRIFT_OFFSET_X_PROPERTY = '--bg-drift-offset-x';
    private static readonly DRIFT_OFFSET_Y_PROPERTY = '--bg-drift-offset-y';

    private static instance: BackgroundHandler | null = null; //guards against a second background if the game sets its UI up again

    private container: HTMLDivElement;
    private keyframesStyle: HTMLStyleElement;
    private readonly swayVariants: string[] = BackgroundHandler.SWAY_SHAPES.slice(0, BackgroundHandler.numOfSwayAnimations).map((_, variant) => `background-tree-sway-${variant}`); //the @keyframes names
    private spriteImage: HTMLImageElement;
    private treeAspect: number = null; //width / height of one sprite cell, read from the image once it has loaded
    private builtWidth = 0;
    private builtAsMobile = false;
    private treesEnabled = true;
    private resizeDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly onResize = () => this.scheduleRebuild();
    private readonly onSwayCycleEnd = (event: AnimationEvent) => this.reshuffleTree(event.target as HTMLElement);

    public static getInstance(game: Game): BackgroundHandler {
        return BackgroundHandler.instance ??= new BackgroundHandler(game);
    }

    private constructor(game: Game) {
        this.container = document.createElement('div');
        this.container.classList.add('background-trees-container');
        this.container.style.zIndex = `${BackgroundHandler.treeContainerZIndex}`;
        this.container.addEventListener('animationiteration', this.onSwayCycleEnd);
        document.body.insertAdjacentElement('afterbegin', this.container);

        this.keyframesStyle = document.createElement('style');
        this.keyframesStyle.textContent = this.getSwayKeyframesCSS();
        document.head.appendChild(this.keyframesStyle);

        //never drawn: only here to read the cell's aspect ratio. The trees themselves use the same file as a CSS background
        this.spriteImage = new Image();
        this.spriteImage.onload = () => {
            this.treeAspect = (this.spriteImage.naturalWidth / BackgroundHandler.SPRITE_COLUMNS) / (this.spriteImage.naturalHeight / BackgroundHandler.SPRITE_ROWS);
            this.buildTrees();
        };
        this.spriteImage.src = game.bga.images.getImgUrl(BackgroundHandler.SPRITE_FILE);

        window.addEventListener('resize', this.onResize);

        this.randomizeDrift();
    }

    //once per page load, so the background doesn't always start the same way: a random point in the drift's there-and-back cycle
    //(a negative delay of up to two legs, so it may start on either leg) and a random pattern offset of up to a tile each way.
    //Set whatever the preference says, so a still pattern is offset too; replays get their own random start like any page load
    private randomizeDrift(): void {
        const root = document.documentElement;
        const legDurationMs = BackgroundHandler.parseCSSTime(getComputedStyle(root).getPropertyValue(BackgroundHandler.DRIFT_LEG_DURATION_PROPERTY));
        if(legDurationMs !== null)
            root.style.setProperty(BackgroundHandler.DRIFT_DELAY_PROPERTY, `${-Math.round(Math.random() * 2 * legDurationMs)}ms`);

        root.style.setProperty(BackgroundHandler.DRIFT_OFFSET_X_PROPERTY, Math.random().toFixed(4));
        root.style.setProperty(BackgroundHandler.DRIFT_OFFSET_Y_PROPERTY, Math.random().toFixed(4));
    }

    //a CSS <time> ("20s", "500ms") in ms; null if it can't be read (the stylesheet not loaded), and the drift then starts at 0s
    private static parseCSSTime(value: string): number | null {
        const match = value.trim().match(/^(-?[\d.]+)(m?s)$/);
        if(!match)
            return null;

        const amount = parseFloat(match[1]);
        return isNaN(amount) ? null : (match[2] == 's' ? amount * 1000 : amount);
    }

    //from PrefHandler, on setup and whenever the player changes it. No wind is a class in Game.scss, the same rule as prefers-reduced-motion, which applies whatever this says
    public applyTreePreference(value: number): void {
        this.treesEnabled = value != BackgroundHandler.TREES_PREF_NO_TREES;
        this.container.classList.toggle('no-wind', value == BackgroundHandler.TREES_PREF_NO_WIND);
        this.container.style.display = this.treesEnabled ? '' : 'none';

        if(!this.treesEnabled)
            this.container.replaceChildren();
        else if(this.treeAspect !== null && !this.container.hasChildNodes()) //not loaded yet: the sprite's onload builds them
            this.buildTrees();
    }

    //from PrefHandler, on setup and whenever the player changes it. Off is a class on <html> in Game.scss, the same rule as
    //prefers-reduced-motion, which stops the drift whatever this says
    public applyDriftPreference(value: number): void {
        document.documentElement.classList.toggle('no-background-drift', value == BackgroundHandler.DRIFT_PREF_OFF);
    }

    public destroy(): void {
        this.spriteImage.onload = null; //the image may still be loading
        window.removeEventListener('resize', this.onResize);
        if(this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);

        this.container.removeEventListener('animationiteration', this.onSwayCycleEnd);
        this.container.remove();
        this.keyframesStyle.remove();

        BackgroundHandler.instance = null;
    }

    private getSwayKeyframesCSS(): string {
        return this.swayVariants.map((variantName, variant) => {
            const keyframes = BackgroundHandler.SWAY_SHAPES[variant].map(([percent, lean]) =>
                `${percent}% { transform: rotate(calc(var(--sway) * ${lean})) skewX(calc(var(--sway) * ${lean * BackgroundHandler.swaySkew})); }`
            );
            return `@keyframes ${variantName} { ${keyframes.join(' ')} }`;
        }).join('\n');
    }

    private isMobileWidth(): boolean { return window.innerWidth <= BackgroundHandler.mobileBreakpoint; }

    private scheduleRebuild(): void {
        if(this.resizeDebounceTimeout)
            clearTimeout(this.resizeDebounceTimeout);

        this.resizeDebounceTimeout = setTimeout(() => {
            this.resizeDebounceTimeout = null;
            if(this.treeAspect === null) //not loaded yet: the first build will read the new size
                return;

            const crossedBreakpoint = this.isMobileWidth() !== this.builtAsMobile;
            const widthChange = Math.abs(window.innerWidth - this.builtWidth) / this.builtWidth;
            if(crossedBreakpoint || widthChange >= BackgroundHandler.rebuildWidthChange)
                this.buildTrees();
        }, BackgroundHandler.resizeDebounceTime);
    }

    private buildTrees(): void {
        if(!this.treesEnabled)
            return;

        this.builtWidth = window.innerWidth;
        this.builtAsMobile = this.isMobileWidth();

        let previousColor: string | null = null;
        const treeElements = this.getTreePlacements().map(placement => {
            previousColor = BackgroundHandler.randomItemExcept(BackgroundHandler.pickableTreeColors, previousColor);
            return this.createTree(placement, previousColor);
        });
        this.container.replaceChildren(...treeElements);
    }

    //sizes and places a new forest in the bottom left corner, left to right, heights descending
    private getTreePlacements(): { left: number, width: number, height: number }[] {
        const { minHeight, maxHeight } = this.getHeightRange();
        const treeCount = BackgroundHandler.minNumOfTrees + Math.floor(Math.random() * (BackgroundHandler.maxNumOfTrees - BackgroundHandler.minNumOfTrees + 1));
        const rawHeights = Array.from({ length: treeCount }, () => BackgroundHandler.randomBetween(minHeight, maxHeight)).sort((a, b) => b - a);

        //whole px, so the sprite's percentages land on whole pixels too and no neighbouring cell's edge shows through
        const sizes = rawHeights.map(rawHeight => ({ height: Math.round(rawHeight), width: Math.round(rawHeight * this.treeAspect) }));
        const steps = sizes.slice(0, -1).map(size => size.width * (BackgroundHandler.treeSpacing + BackgroundHandler.randomBetween(-BackgroundHandler.spacingJitter, BackgroundHandler.spacingJitter)));

        //squeezed so the last tree's right edge stays within maxSpanOfWidth
        const firstLeft = -sizes[0].width * BackgroundHandler.edgeBleed;
        const room = this.builtWidth * BackgroundHandler.maxSpanOfWidth - sizes[sizes.length - 1].width - firstLeft;
        const totalSteps = steps.reduce((total, step) => total + step, 0);
        const stepScale = totalSteps > room ? Math.max(room, 0) / totalSteps : 1;

        let left = firstLeft;
        return sizes.map((size, index) => {
            if(index > 0)
                left += steps[index - 1] * stepScale;
            return { left, ...size };
        });
    }

    private getHeightRange(): { minHeight: number, maxHeight: number } {
        const maxHeight = Math.min(this.builtAsMobile ? BackgroundHandler.maxTreeHeightMobile : BackgroundHandler.maxTreeHeight, window.innerHeight * BackgroundHandler.maxTreeHeightOfViewport);
        const minHeight = Math.min(this.builtAsMobile ? BackgroundHandler.minTreeHeightMobile : BackgroundHandler.minTreeHeight, maxHeight);
        return { minHeight: Math.max(minHeight, maxHeight / BackgroundHandler.maxHeightRatio), maxHeight };
    }

    private createTree(placement: { left: number, width: number, height: number }, color: string): HTMLDivElement {
        const tree = document.createElement('div');
        tree.classList.add('background-tree');
        tree.dataset.treeColor = color;
        tree.style.left = `${placement.left / this.builtWidth * 100}%`;
        tree.style.width = `${placement.width}px`;
        tree.style.height = `${placement.height}px`;
        tree.style.zIndex = `${Math.round(BackgroundHandler.maxTreeHeight - placement.height)}`; //taller trees further back

        tree.style.bottom = `${-Math.round(placement.height * BackgroundHandler.treeSinkRatio)}px`; //the rotation's pivot (transform-origin: bottom center) sinks with it, so the trunk's bottom stays below the screen

        const duration = this.applyRandomSway(tree);
        tree.style.animationDelay = `${-Math.random() * duration}s`; //negative: starts mid-cycle, so the trees aren't in sync

        return tree;
    }

    //gives the tree a new variant, strength, duration and easing; returns the duration
    private applyRandomSway(tree: HTMLElement): number {
        const duration = BackgroundHandler.randomBetween(BackgroundHandler.minSwayDuration, BackgroundHandler.maxSwayDuration);
        const strength = BackgroundHandler.randomBetween(BackgroundHandler.minWindStrength, BackgroundHandler.maxWindStrength);
        const direction = Math.random() < 0.5 ? -1 : 1;

        tree.style.setProperty('--sway', `${(strength * direction).toFixed(2)}deg`);
        tree.style.animationName = BackgroundHandler.randomItemExcept(this.swayVariants, tree.style.animationName);
        tree.style.animationDuration = `${duration.toFixed(2)}s`;
        tree.style.animationTimingFunction = BackgroundHandler.randomItemExcept(BackgroundHandler.swayEasings, null);

        return duration;
    }

    //runs as a cycle ends, when the tree is upright and at rest, so nothing jumps. The new variant name starts a fresh animation
    //from its beginning: the delay has to go, or the tree would jump into the middle of its new cycle
    private reshuffleTree(tree: HTMLElement): void {
        if(Math.random() >= BackgroundHandler.animationReshuffleChance)
            return;

        this.applyRandomSway(tree);
        tree.style.animationDelay = '0s';
    }

    private static randomBetween(min: number, max: number): number { return min + Math.random() * (max - min); }
    private static randomItemExcept<T>(items: T[], excluded: T | null): T {
        const candidates = items.filter(item => item !== excluded);
        const pickFrom = candidates.length > 0 ? candidates : items; //a single item left to pick (one tree color not excluded) repeats rather than giving nothing
        return pickFrom[Math.floor(Math.random() * pickFrom.length)];
    }
}
