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
- Start token has no art yet: a 30x30px black square with a red border.

## Layout (client)

- **Game area order**, top to bottom: dice container, my hand, then one row of every player's played column (mine first, then turn order).
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
- **State ids**: RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, RevealCards 22, BonusPlay 25, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, RevealStopOrMore 55, EndRound 60, EndScore 98.
- **Framework typing differs from Fugu's**: Riviera's `bga-framework.d.ts` is newer. `Player` has no `color_back` and `playerorder` is `number[]`. Ported helpers (`divYou`, `divColoredPlayer`) drop `color_back`.
- **No `gameui.isInterfaceLocked()`** in this framework version: use `Game.isInterfaceLocked()`, which reads the `lockedInterface` body class.
- **Globals** go through `$this->bga->globals` (`startPlayerId`, `roundNumber`); Fugu has none. Throw `\Bga\GameFramework\SystemException`, not the deprecated `\BgaSystemException`.
- **Score display**: use BGA's default score counter (`bga.playerPanels.getScoreCounter(id)` when it changes), not a second `ebg.counter` like Fugu's `PlayerHandler`.

## Keeping the docs current

These files are the project's memory between sessions, so keep them true:

- All docs live in `.claude/` (`CLAUDE.md`, `SPEC.md`, `TESTING.md`, `plans/`), tracked in git (except `settings.local.json`) and excluded from SFTP upload.
- **End of every milestone**: in `.claude/SPEC.md` > Milestones, mark it done, add a short "Notes" list under it (what was built, known bugs, anything deferred), add its test checklist to `.claude/TESTING.md`, then tell me.
- **Whenever I decide something new or change a rule** during a session: update the relevant section of `.claude/SPEC.md` right away, marked **[BGA]** if it differs from the rulebook.
- **New code conventions** (a pattern we settle on, a framework gotcha, how something differs from Fugu): add it to this file.
- Don't rewrite or reorganise these files beyond what changed. Show me the diff of any doc edit.
