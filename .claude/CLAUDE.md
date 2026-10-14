# Riviera: BGA adaptation

This folder is the BGA Studio project for **Riviera** (Valentin Demion, Helvetiq).
Game rules and every design decision live in `.claude/SPEC.md` (imported below, so it loads every session). Read it before writing game logic.
Per-milestone BGA Studio test checklists live in `.claude/TESTING.md`. The current milestone's implementation plan lives in `.claude/plans/`.

@SPEC.md

## Reference project: Fugu

`reference/fugu/` (inside this repo, gitignored and excluded from SFTP upload) is my previous BGA game (same author, same publisher, same framework version).
**Riviera must be built to look like Fugu's code.** Before creating any file, open the Fugu equivalent and copy its structure, naming, and patterns. When in doubt, do what Fugu does.

Mirror these specifically:

- **Folder layout**: `src/ts/*.ts` and `src/scss/Game.scss` compiled by rollup/sass into `modules/js/Game.js` and `riviera.css`. Same `package.json` scripts, `rollup.config.mjs`, `tsconfig.json`. The template ships TS sources in `src-disabled/`; move them to `src/` like Fugu.
- **TS architecture**: one `Game.ts` that owns handler classes, one class per concern in its own file (`PlayerHandler`, `HandHandler`, `PlayedColumnHandler`, `DiceHandler` (Fugu's `CenterHandler`), `StartTokenHandler`, `TooltipHandler`, `PrefHandler`, `ModalBoxHandler`, `LogMutationObserver`, `EndGameScoringHandler`, ...), and client state classes under `src/ts/States/`. Reuse Fugu files as-is where they are truly game-agnostic (ModalBoxHandler, the core of LogMutationObserver). PrefHandler and TooltipHandler contain Fugu-specific code, so adapt them like the rest.
- **Logs**: same approach as Fugu. Notifications put `log-class-tag` markup into log strings and `LogMutationObserver` post-processes log divs (including replay logs and mobile chatbar). Card mentions in logs render as small card icons the way Fugu does it.
- **PHP**: namespace `Bga\Games\Riviera`, `Game.php` + `material.inc.php` + a `RIVTableManager.php` (like `FUGUTableManager.php`) for reading table state, one class per state in `modules/php/States/` using the new `GameState` class API exactly like Fugu's `PlayerTurn.php`, `NextPlayer.php`, `EndScore.php`.
- **Notifications**: same decorator in the `Game` constructor, same naming style, same way Fugu animates then resolves notifications on the client.
- **DB**: Deck component with a `cards` table, extra columns as needed, same style as Fugu's `dbmodel.sql`.
- **Code style**: tabs/spaces, brace style, camelCase, type annotations, comment style: match Fugu.

## Assets

- `img/riviera_cards.webp` is one sprite sheet: a 10-column x 7-row grid of 424x625 frames, row-major in this order:
  `[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [orange 1..12] [Last Chance] [card back]` (62 frames, rest of the last row blank).
  Compute `background-position` from an index (see SPEC.md > Sprite); never hardcode per-card positions.
- Dice have no art yet. Draw them in CSS (rounded square in the die color, pips or a number). Gold die for the golden die.
  Pips are 9 absolutely placed `.die-pip` spans of one fixed size (20% of `--die-size`), centered at 22%, 50% and 78% of the die on each axis, shown per `data-value`. Never size pips with grid tracks or percentages (they came out uneven and oval before M3), and never give `.a-die` a % padding (a share of the parent's width, which blows the die up).
- `img/start_token.webp` is the Start token (a black pawn, portrait), fitted inside the 30x30px `#start-token` and the 14x14px mini token in log rows.
- `img/card_icon_numbers.webp` is the numbers 1 to 12 for the status bar card icon (`span.status-card-icon`): a 1 x 12 strip of equal 76x63 frames, left to right, gold on an opaque `#05141a` background (10 to 12 are wider glyphs inside the same frame width). Compute `background-position` from the value (see SPEC.md > Sprite). The icon keeps a visually hidden "<value> <color>" text for screen readers.
- `img/power_icons_sprite.webp` (380x63, transparent) holds the 5 power icons left to right: cards 1, 2, 9, 10, 11. The frames are not equal (card 1 is narrower, card 10 wider and only 48px tall): their measured boxes live in the `$power-icons` SCSS map, and each icon is cut to its box and scaled to the same height. Re-measure if the image changes.

## Layout (client)

- **Background**: sea blue gradient on `body` (Fugu sets its background on `body` too).
- **Playable cards** glow; unplayable cards keep their normal look (no grey-out).
- **Game area order**, top to bottom: dice container, my hand, then one row of every player's played column (mine first, then turn order), wrapping onto more rows when they don't fit (always on mobile).
- Every player's played cards are visible (stacked vertically, overlapping so only the top strip with stars shows, as in the rules).
- **Player boards** (BGA side panels) show the number of cards in hand, visible to everyone including spectators: with 6 cards or fewer, one small card-back div per card, overlapping, like my game Odin; with more than 6, a single card back followed by "x N". The Last Chance card sits to the right of the card backs and disappears once used. Also show round status (in / stopped / crashed) and the Start token.
- **Start token** is a single element that slides from player board to player board when it passes (animated like moving a card between containers).
- **Dice container** in the game area: show current roll, reserved dice (card 2) with the owner's color, golden die when active, and dice modified by card 9. No roll animation needed yet; a simple fade/scale on change is enough.

## Workflow rules

- Work milestone by milestone (see `.claude/SPEC.md` > Milestones). Stop at the end of each milestone, write what to test in BGA Studio as a new section of `.claude/TESTING.md`, and tell me.
- After any TS/SCSS change run `npm run build` and fix all compiler errors before saying you're done.
- Run `php -l` on every PHP file you touch.
- I deploy to BGA Studio and test there myself; I'll paste errors back. Don't invent framework APIs: check `bga-framework.d.ts`, `_ide_helper.php`, and how Fugu does it.
- All player-facing strings go through `clienttranslate()` / `_()`.
- Never use em dashes in UI strings or comments.

## Conventions

- **Power naming**: any field, DB column or variable that exists only because of a special power carries the power's card value in its name: `reserved_by_POWER2`, `modified_by_POWER9`, `in_use_by_POWER11`. Same suffix in PHP, SQL, TS and data attributes (`data-reserved-by-power2`).
- **Card ids reveal identity**: cards are inserted in a fixed order, so a `card_id` tells its color and value. Never send ids of cards a player isn't allowed to see; send counts instead.
- **Color order**: the `color` ENUM is declared in sprite order (red, green, purple, blue, orange), so `ORDER BY color, value` sorts like the sprite. Keep `CARD_COLORS` (PHP) and `$card-colors` (SCSS) in that same order.
- **Removed color**: in 2 to 4 player games its cards stay in `cards` at location `returned_to_box` and its die stays in `dice` with `die_location = 'returned_to_box'`. "Colors in use" is read from `dice`.
- **State ids**: RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, RevealCards 22, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, RevealStopOrMore 55, EndRound 60, EndScore 98. (25 was BonusPlay, dropped in M3: the card-1 chain lives in PlayCard.)
- **Framework typing differs from Fugu's**: Riviera's `bga-framework.d.ts` is newer. `Player` has no `color_back` and `playerorder` is `number[]`. Ported helpers (`divYou`, `divColoredPlayer`) drop `color_back`.
- **No `gameui.isInterfaceLocked()`** in this framework version: use `this.game.isInterfaceLocked()`, which reads the `lockedInterface` body class.
- **Globals** go through `$this->bga->globals` (`startPlayerId`, `roundNumber`); Fugu has none. Throw `\Bga\GameFramework\SystemException`, not the deprecated `\BgaSystemException`.
- **Score display**: use BGA's default score counter (`bga.playerPanels.getScoreCounter(id)` when it changes), not a second `ebg.counter` like Fugu's `PlayerHandler`.
- **Scores on the server**: never touch `player_score` / `player_score_aux` with SQL (BGA's deploy check flags it): always go through `$this->bga->playerScore` (`get`, `getAll`, `getMax`, `set`, `setAll`, `inc`; pass `null` as the message when a game notification updates the counter itself). Don't write the column name in comments either.
- **Simultaneous choices**: a multiactive state stores each choice as pending `player` columns and never applies it there. The last chooser's `setPlayerNonMultiactive` moves to a GAME "reveal" state (`RevealCards`, `RevealStopOrMore`) that applies every choice and sends one notification. Change my mind goes through `RIVChangeMindManager` (`resetChoices` / `recordChoice` / `changeMind`) and the client `ChangeMindHandler`; the revert action carries `#[PossibleAction]` + `#[CheckAction(false)]`.
- **Turn order and power timing** live in SPEC.md > Turn sequence (settled with Helvetiq). `RevealCards` only reveals, checks Grand Slam, clears last turn's dice effects and marks pending powers, then goes to `PassStartToken`. Cards 2, 10 and 11 resolve in the walk that `RevealStopOrMore` starts (`RIVPowerManager::goToNextPreRollPower()`), only for players still `in`, i.e. who chose More, ending in `RollDice`. Never resolve them right after the reveal, and never "cancel" a power on Stop: a stopper's power simply never resolves.
- **Private state args**: per-player data goes in `getArgs()` as `['_private' => [playerId => [...]]]`; the client reads `args._private`. Act methods take the magic `int $currentPlayerId` (multiactive) parameter.
- **Logs**: every log type has a `${X_LOG_STR}` server placeholder (plain fallback text as its value, plus `preserve` for the args the row needs), one `LogMutationObserver.createLog*()` method, one `*-log` class, and one `--bg-log-*` variable in `:root` (listed in `$log-types` in `Game.scss`).
- **Slide animations**: use `Game.animateSlide(element, from, to, ms)` for anything moving between containers. The flying copy changes size on the way: it starts at the on-screen size of `from` (a hand card, or the top mini card back when `from` is a player board's hand count) and lands at exactly the size and place of `element`, so nothing jumps at the end. Measure everything with `getBoundingClientRect()` (on-screen px) and move the copy with one `transform` (translate + scale): the copy lives in `<body>`, outside BGA's mobile scaling of the game area, so it converts screen px with its own measured zoom (`getBoundingClientRect().width` / unrounded computed width; `offsetWidth` rounds and drifts by a pixel). Never animate `left`/`top` or rely on the copy's CSS size matching the destination.
- **Mobile sizing (like Fugu)**: `gameinfos` keeps `game_interface_width.min` at 740, so BGA lays the game out at 740px or more and scales it down on a phone. Card and die sizes on `.mobile_version` are therefore large logical sizes: `--card-width: min(28.5vw, 150px)` (Fugu's value) and `--die-size: min(13.3vw, 55px)` (the desktop die/card proportion). Played columns use the same `--card-width` and wrap. My hand is always one horizontal line, every card at the same height, overlapping horizontally so the whole hand fits the container width; the only vertical movement is a selected or set-aside card being raised. On mobile `HandHandler.applyMobileCardSpacing()` (Fugu's) sets inline %-margins so the row spans 99% of the hand width (never spreading a short hand, never covering more than 85% of a card); no zig-zag. Desktop keeps the `--hand-card-overlap` logic. Both run from `recomputeCardSpacing()` after any hand change, and debounced from `Game.onScreenWidthChange`.
- **One-shot animation classes** (fade-ins, fade-outs, `die-changed`) must be removed once they have played: a leftover one becomes the element's fallback `animation` and replays whenever another animation (like the playable glow) stops applying. Found in M3: the new hand's `cards-fading-in` class stayed on, so confirming a card (which stops the playable glow) replayed the fade-in on the whole hand, as if it re-rendered.
- **`dbmodel.sql` comments**: put them on their own `--` lines, never after a `;` and never containing a `;`. BGA splits the file into statements itself and silently dropped an `ALTER` that had a trailing comment.
- **Statistics** go through `$this->game->bga->playerStats` / `->tableStats` (Fugu uses `$this->game->playerStats`). Every stat is initialized in `setupNewGame` except `lastChanceRound`, which is left unset on purpose so games without a Last Chance don't skew its average. A power's stat carries the power suffix (`powerUsed_POWER2`).
- **Tooltips**: tooltips only reach elements already on the page, and need an id on each element (`createCardDiv` / `createLastChanceDiv` give one). Every card in the game area (my hand, every played column) gets the power reference (`getPowerReferenceHTML`, the rulebook's powers page: entries grouped by timing, icon floated left, the hovered card's power highlighted; one cached HTML per highlighted value). Call `tooltipHandler.addTooltipsToCards()` after any notification that creates cards. Log mini cards keep a single-power tooltip, added per row by `LogMutationObserver` through `addTooltipsToCardsIn(node)`. Safari mobile gets the same reference HTML at the bottom of the page instead.
- **Zombies** are level 1 (report it in the Game Metadata Manager): a zombie that would stay active (a card-1 chain) finishes everything inside the same `zombie()` call, since the framework doesn't call it again.
- **Copyright header**: every PHP and TS source file starts with the same header as `Game.php` (BGA checklist).
- **Deleting or renaming PHP files**: SFTP now runs with `autoDelete: true`, so a file removed locally is removed on Studio on the next sync. Still check after a delete or rename: the framework loads every class in `modules/php/States/`, and a stale state class collides on its state id (the template's `PlayerTurn.php` took id 10 and broke game creation once `RollDice` used 10).

## Keeping the docs current

These files are the project's memory between sessions, so keep them true:

- All docs live in `.claude/` (`CLAUDE.md`, `SPEC.md`, `TESTING.md`, `plans/`), tracked in git (except `settings.local.json`) and excluded from SFTP upload.
- **End of every milestone**: in `.claude/SPEC.md` > Milestones, mark it done, add a short "Notes" list under it (what was built, known bugs, anything deferred), add its test checklist to `.claude/TESTING.md`, then tell me.
- **Whenever I decide something new or change a rule** during a session: update the relevant section of `.claude/SPEC.md` right away, marked **[BGA]** if it differs from the rulebook.
- **New code conventions** (a pattern we settle on, a framework gotcha, how something differs from Fugu): add it to this file.
- Don't rewrite or reorganise these files beyond what changed. Show me the diff of any doc edit.
