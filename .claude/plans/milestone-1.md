> Status: approved plan, saved 2026-10-06. Step 0 (docs move to .claude/) is done; code not started.

# Riviera: Milestone 1 (Skeleton) plan, revision 2

## Context

Riviera is a fresh copy of the BGA template. Milestone 1 turns it into a project shaped like Fugu: the same folder layout and build, a Deck-based `cards` table, setup and deal with the silent redeal, `getAllDatas`, and a client that renders the dice, my hand, every player's played column, and player boards (hand counts, Last Chance, round status, Start token). Nothing is playable yet. Fugu is at `reference/fugu/`.

Decisions made so far:
- **Layout:** dice, then hand, then columns.
- **Fifth color:** orange.
- **Handler name:** `DiceHandler`.
- **Typing:** drop `color_back` in `divYou`/`divColoredPlayer`.
- **Start token:** a real element that slides between player boards.
- **Removed color:** all 60 cards stay in the DB.
- **Power naming convention:** names carry `_POWER<n>`.

**Changes since revision 1:** the Start token element and its animation; `returned_to_box` for the removed color's cards and die; `location_in_column`; `CARD_COLORS`; `GOLDEN_DIE` dropped; `MAX_PLAYERS_WITH_ONE_COLOR_REMOVED`; the `_POWER<n>` naming; DOM order; the player-board layout; spectator hand counts; Change my mind notes; the doc diffs, written out in full at the end.

---

## File-by-file

Legend: **NEW** = no Fugu equivalent · **COPY** = Fugu unchanged · **ADAPT** = Fugu file reshaped · **EDIT** = BGA template file edited · **KEEP** = template file already identical to Fugu · **DEL** = removed.

### Build / repo

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `src-disabled/` → `src/` | EDIT (git mv) | Fugu `src/` | As CLAUDE.md says. |
| `package.json` | EDIT | Fugu | Set `"author": "Doruk Kicikoglu"`. The scripts already match Fugu. |
| `package-lock.json` | ADAPT | Fugu | Copy it for identical versions, rename `fugu` to `riviera`, then `npm install`. |
| `rollup.config.mjs`, `tsconfig.json` | KEEP | Fugu (byte-identical) | none |
| `.gitignore` | EDIT | Fugu | Add `/node_modules` and `.claude/settings.local.json` (see Docs). |
| `riviera.css`, `modules/js/Game.js` | generated | Fugu | By `npm run build`. |
| `gameinfos.jsonc`, `gameoptions.jsonc`, `gamepreferences.jsonc`, `stats.jsonc` | KEEP | n/a | No M1 change. |

### PHP

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `dbmodel.sql` | EDIT | Fugu `dbmodel.sql` | Schema below. |
| `modules/php/material.inc.php` | NEW content, Fugu structure | Fugu `material.inc.php` | Constants below. The `if (!defined(...))` guard checks a constant that really exists. |
| `modules/php/Game.php` | ADAPT | Fugu `Game.php` | Details below. |
| `modules/php/RIVTableManager.php` | ADAPT | `FUGUTableManager.php` | `shuffleAndDealCards()` (silent redeal), `getCardsOnTable(int $currentPlayerId)`, `getDice()`, `getColorsInUse()`, `passStartToken()`. |
| `modules/php/States/RoundSetup.php` | NEW, NextPlayer shape | `States/NextPlayer.php` | `GAME`, id 5. `roundNumber++`; every `round_status` set to `'in'`; dice reset (only dice with `die_location='in_play'`; value NULL; `reserved_by_POWER2` NULL; `modified_by_POWER9 'no'`; `in_use_by_POWER11 'no'`); `shuffleAndDealCards()`; return `PlayCard::class`. |
| `modules/php/States/PlayCard.php` | NEW stub, PlayerTurn shape | `States/PlayerTurn.php` | `MULTIPLE_ACTIVE_PLAYER`, id 20. `onEnteringState` calls `setPlayersMultiactive(<players with round_status 'in'>, '', true)`. No actions. It's M1's resting state and M2 fills it in. |
| `modules/php/States/EndScore.php` | KEEP | identical to Fugu | none |
| `modules/php/States/PlayerTurn.php`, `NextPlayer.php` | DEL | n/a | Template examples. |

**State ids reserved now:** RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, BonusPlay 25, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, EndRound 60, EndScore 98.

**`Game.php`**
- Constructor: Fugu's `addDecorator`, `require_once 'material.inc.php'`, `$this->cardsDeck = $this->deckFactory->createDeck('cards')`, `$this->tableManager = new RIVTableManager($this)`. The template's `playerEnergy` and `$CARD_TYPES` are removed.
- `setupNewGame`: players insert as in Fugu. Then:
  1. Insert **all 60 cards** with raw SQL (Fugu style) at location `'deck'`.
  2. Insert **5 colored dice and the `gold` die**.
  3. With `count($players) <= MAX_PLAYERS_WITH_ONE_COLOR_REMOVED`, pick a color with `bga_rand(1, 5)`. Move its 12 cards to `'returned_to_box'` and set its die's `die_location` to `'returned_to_box'`.
  4. Globals `startPlayerId` (random player) and `roundNumber = 0`.
  5. Return `RoundSetup::class`.
- `getAllDatas`: shape below.
- `getGameProgression`: `min(100, floor(maxScore * 100 / WINNING_SCORE))`.
- Debug: the template's `debug_goToState`, plus:
  - `debug_redeal()`: jump to RoundSetup.
  - `debug_playRandomCards(int $count = 3)`: moves N random hand cards per player into `'played'`; then you press F5.
  - `debug_passStartToken()`: calls `tableManager->passStartToken()`, so the slide animation can be tested in M1.
- Copy Fugu's `message()` helper.

**`RIVTableManager::passStartToken()`**: `$next = $this->game->getPlayerAfter($current)`, set the `startPlayerId` global, and send `notify->all('startTokenPassed', clienttranslate('${player_name} receives the Start token'), ['player_id' => $next])`. M2's `PassStartToken` state calls the same method.

### TypeScript (`src/ts/`)

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `Game.ts` | ADAPT | Fugu `Game.ts` | Same skeleton. `setup()` inserts the containers in the order **`#dice-container`, `#my-hand-container`, `#played-columns-container`**. It creates `DiceHandler`, one `PlayerHandler` per player, `HandHandler` (not for spectators), `StartTokenHandler`, then `LogMutationObserver`. Utilities: `createCardDiv`, `createCardBackDiv`, `createLastChanceDiv`, `placeOnObject`, `getPos`, `rgbToHex`, `isDesktop/isMobile`, `getGameStateName`, `getMyPlayerID`, `divYou`/`divColoredPlayer` (ported **without `color_back`**), and `bgaFormatText` (empty key list). Notification: `notif_startTokenPassed` awaits `startTokenHandler.moveTo(player_id)`. |
| `types.d.ts` | ADAPT | Fugu | Types below. |
| `PlayerHandler.ts` | ADAPT | Fugu | Score `ebg.counter` as in Fugu. Builds the player-board block (below) and owns a `PlayedColumnHandler`. Setters: `setHandCount(n)`, `setRoundStatus(s)`, `setLastChanceUsed(b)`. Getter: `getStartTokenSlot()`. |
| `HandHandler.ts` | ADAPT | Fugu `HandHandler.ts` | My hand only. Same title and `.cards-container` structure. Sorted by color index, then value. Click handler gated like Fugu's (a no-op in M1). The mobile FLIP spacing is not ported; CSS overlap is enough. |
| `PlayedColumnHandler.ts` | NEW | built like `HandHandler.ts` | Column title (name in the player's color, plus ★ total) and a `.cards-column` stack. `addCard()` for M2. |
| `DiceHandler.ts` | NEW (renamed from CenterHandler) | Fugu `CenterHandler.ts` | Renders the dice in play. The gold die only shows when `in_use_by_POWER11`. `updateDice()` adds a `die-changed` fade/scale. |
| `StartTokenHandler.ts` | NEW | slide pattern from `HandHandler.animateCardSwap` / `CenterHandler.animateCardReplace` | Owns `#start-token`. `constructor` places it in the start player's `.start-token-slot`. `async moveTo(playerId)`: clone the token, `placeOnObject` on the old slot, hide the original, append it to the new slot, transition the clone's `top/left` to the new slot's position (~600ms, `bga.gameui.wait`), then remove the clone and show the original. Player panels are outside `#page-content` on mobile, so it uses `placeOnObject(..., forceBoundingClientRect)` the way Fugu handles that case. |
| `LogMutationObserver.ts` | ADAPT (core verbatim) | Fugu | `observeLogs`, `processLogDiv`, `addLogClassTag` unchanged. The Fugu `createLog*` methods are removed. |
| `States/PlayCard.ts` | NEW stub | Fugu `States/PlayerTurn.ts` | Same shape; sets a title only. |
| `libs.ts` | KEEP | identical to Fugu | none |
| `States/PlayerTurn.ts` (template) | DEL | n/a | none |

Deferred: `ModalBoxHandler` (copy as is, M2), `PrefHandler` and `TooltipHandler` (adapted, M4), `EndGameScoringHandler` (M4). Not ported: `BackgroundHandler`, `CardIconDisplayHandler`, `AnchorCardsDisplayHandler`, `SoloDiscardDisplayHandler`.

### SCSS: `src/scss/Game.scss` (ADAPT from Fugu `Game.scss`)
Fugu's section order and mixins. It covers:
- `:root` vars: `--card-width: min(6vw, 110px)`, `--card-height: calc(var(--card-width) * 625 / 424)`, the sprite, and per-color die vars.
- The `.a-card` sprite loop.
- Dice, hand and played columns.
- The player board: mini backs, the "x N" label, Last Chance, status.
- `#start-token`: `30px × 30px`, `background: #000`, `border: 2px solid red`, `box-sizing: border-box`.
- The `.a-game-log` base and `.cloned-card`.

### Docs: move to `.claude/` (step 0, before any code)

| File | Kind | Content |
|---|---|---|
| `CLAUDE.md` → `.claude/CLAUDE.md` | git mv + edit | Claude Code auto-loads it from there. Gets the diff at the end, plus an import line so SPEC.md loads every session. |
| `SPEC.md` → `.claude/SPEC.md` | git mv + edit | Diff at the end. |
| `.claude/TESTING.md` | NEW | The BGA Studio checklist for each milestone. The workflow rule "tell me what to test" now also writes it here. M1's section is the Verification section below. |
| `.gitignore` | EDIT | Add `/node_modules` and `.claude/settings.local.json`. The rest of `.claude/` stays tracked. |
| `.vscode/sftp.json` | EDIT | Add `".claude/**"` to `ignore`. It is gitignored local config, so the edit happens on disk only. |

Every path reference is updated: CLAUDE.md lines 4, 37, 48 and 49 point to `.claude/SPEC.md`, and the new references point to `.claude/TESTING.md`. README.md has no doc references.

**Import line conflict:** you asked for `@.claude/SPEC.md`. Claude Code resolves `@` imports **relative to the file that contains them**, so inside `.claude/CLAUDE.md` that line would look for `.claude/.claude/SPEC.md` and silently load nothing. I'll write `@SPEC.md` instead, which resolves to `.claude/SPEC.md`. When M1 starts, I'll confirm it loads in a fresh session with `/memory`. If you'd rather keep the literal `@.claude/SPEC.md`, the other fix is a root-level `CLAUDE.md` containing only that line.

Exact content diffs are at the end of this plan.

---

## dbmodel.sql

```sql
CREATE TABLE IF NOT EXISTS `cards` (
  `card_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `card_type` varchar(16) NOT NULL,                  -- always 'number' (Fugu: 'card')
  `card_type_arg` int(11) NOT NULL,                  -- 0, unused (as in Fugu)
  `card_location` ENUM('deck', 'hand', 'played', 'discard', 'returned_to_box') NOT NULL,
  `card_location_arg` int(11) NOT NULL,              -- deck: shuffle order; hand/played/discard: player_id
  `location_in_column` TINYINT UNSIGNED NULL,        -- order in the player's played column, 1 = first played this round
  `color` ENUM('red', 'green', 'purple', 'blue', 'orange') NOT NULL,
  `value` TINYINT NOT NULL,
  PRIMARY KEY (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 AUTO_INCREMENT=1;

CREATE TABLE IF NOT EXISTS `dice` (
  `die_color` ENUM('red', 'green', 'purple', 'blue', 'orange', 'gold') NOT NULL,
  `die_location` ENUM('in_play', 'returned_to_box') NOT NULL DEFAULT 'in_play',
  `die_value` TINYINT UNSIGNED NULL,                           -- NULL until the first roll
  `reserved_by_POWER2` INT UNSIGNED NULL,                      -- player_id holding the card-2 reservation
  `modified_by_POWER9` ENUM('yes', 'no') NOT NULL DEFAULT 'no',
  `in_use_by_POWER11` ENUM('yes', 'no') NOT NULL DEFAULT 'no', -- only meaningful on the gold die
  PRIMARY KEY (`die_color`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `player` ADD `round_status` ENUM('in', 'stopped', 'crashed') NOT NULL DEFAULT 'in' AFTER `player_state`;
ALTER TABLE `player` ADD `last_chance_used` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `round_status`;
```
- **Colors in use:** `RIVTableManager::getColorsInUse()` returns `SELECT die_color FROM dice WHERE die_location = 'in_play' AND die_color <> 'gold'`. The gold die is always `'in_play'`; whether it is rolled is `in_use_by_POWER11`.
- **Globals** (`$this->bga->globals`): `startPlayerId`, `roundNumber`.
- **Last Chance** is a player column; sprite frame 60 is used for display only.
- `ENUM` declaration order = color order, so `ORDER BY color, value` gives sprite order.
- **Silent redeal** (`shuffleAndDealCards`):
  1. Move `'hand'`, `'played'` and `'discard'` to `'deck'`. `'returned_to_box'` is never touched.
  2. Clear `location_in_column`.
  3. Loop: `shuffle('deck')`, then `pickCards(CARDS_PER_HAND, 'deck', $pid)` for each player. If `GROUP BY card_location_arg, color HAVING COUNT(*) > MAX_CARDS_OF_ONE_COLOR_IN_HAND` finds any row, move `'hand'` to `'deck'` and repeat.
  4. The loop has a 1000-try cap followed by a `BgaSystemException`. No log line, no notification.

## material.inc.php

```php
define("CARD_COLORS", [1 => 'red', 2 => 'green', 3 => 'purple', 4 => 'blue', 5 => 'orange']); // key = sprite/color index
define("VALUES_PER_COLOR", 12);
define("STARS_BY_VALUE", [1 => 2, 2 => 2, 3 => 2, 4 => 1, 5 => 1, 6 => 1, 7 => 1, 8 => 2, 9 => 2, 10 => 2, 11 => 3, 12 => 5]);
define("CARDS_PER_HAND", 10);
define("MAX_CARDS_OF_ONE_COLOR_IN_HAND", 6);
define("MAX_PLAYERS_WITH_ONE_COLOR_REMOVED", 4);
define("WINNING_SCORE", 40);
define("CARD_COLOR_NAMES", ['red' => clienttranslate('red'), /* ... */ 'orange' => clienttranslate('orange')]); // logs, M2
```
**`GOLDEN_DIE` is dropped.** It was only the string `'gold'`, which already lives in the `dice.die_color` ENUM. A constant would have guarded against typos, but the ENUM rejects a misspelled value anyway, and Fugu doesn't wrap ENUM values in constants (it writes `'facedown'`, `'anchor'` inline). So Riviera writes `'gold'` inline too.

## getAllDatas shape

```php
[
  'players' => [ <id> => [
      'player_id', 'player_no', 'score',
      'round_status'     => 'in'|'stopped'|'crashed',
      'last_chance_used' => bool,
      'hand_count'       => int,          // for EVERY player, sent to players and spectators alike
  ]],
  'cardsInMyHand' => [ ['card_id', 'color', 'value'], ... ],    // current player only; [] for spectators
  'cardsPlayed'   => [ <player_id> => [ ['card_id', 'color', 'value', 'location_in_column'], ... ] ],
  'dice'          => [ ['color', 'value' => ?int, 'reserved_by_POWER2' => ?int,
                        'modified_by_POWER9' => bool, 'in_use_by_POWER11' => bool], ... ],  // die_location 'in_play' only
  'startPlayerId' => int,
  'roundNumber'   => int,
  'cardColors'    => CARD_COLORS,
  'starsByValue'  => STARS_BY_VALUE,
]
```
Security: card ids are created in a fixed order, so an id reveals its color and value. Ids of other players' hand cards are never sent, only `hand_count`.

```ts
type CardColor = 'red' | 'green' | 'purple' | 'blue' | 'orange';
type DieColor = CardColor | 'gold';
type RoundStatus = 'in' | 'stopped' | 'crashed';
interface RivieraCard { card_id: number; color: CardColor; value: number; }
interface PlayedCard extends RivieraCard { location_in_column: number; }
interface RivieraDie { color: DieColor; value: number | null; reserved_by_POWER2: number | null; modified_by_POWER9: boolean; in_use_by_POWER11: boolean; }
interface RivieraPlayer extends Player { player_no: number; round_status: RoundStatus; last_chance_used: boolean; hand_count: number; }
interface RivieraGamedatas extends Gamedatas<RivieraPlayer> {
  cardsInMyHand: RivieraCard[]; cardsPlayed: Record<number, PlayedCard[]>; dice: RivieraDie[];
  startPlayerId: number; roundNumber: number; cardColors: Record<number, CardColor>; starsByValue: Record<number, number>;
}
```

## Client DOM

```html
<!-- game area, in this order -->
<div id="dice-container">
  <div class="a-die" data-color="red" data-value="4" data-reserved-by-power2="" data-modified-by-power9="false">
    <span class="pip"></span> ×9                     <!-- 3×3 grid; CSS shows pips per data-value; "" = blank face -->
  </div> …
  <div class="a-die" data-color="gold" …></div>       <!-- only while in_use_by_POWER11 -->
</div>

<div id="my-hand-container" class="a-hand-container" data-owner-id="…">   <!-- not created for spectators -->
  <div class="my-hand-title"><div class="my-hand-title-text">Your hand</div></div>
  <div class="cards-container"> <div class="a-card" data-color="red" data-value="3" data-card-id="…"></div> … </div>
</div>

<div id="played-columns-container">                  <!-- flex row, wraps; mine first, then playerorder -->
  <div class="a-played-column" data-owner-id="…" data-is-myself="true" data-round-status="in" style="--column-owner-color:#…">
    <div class="played-column-title"><span class="played-column-name">You</span> <span class="played-column-stars">★ 7</span></div>
    <div class="cards-column"> <div class="a-card" …></div> … </div>   <!-- each card after the first: margin-top -75% of card height -->
  </div> …
</div>

<!-- inside bga.playerPanels.getElement(playerId), for every player, also for spectators -->
<div class="riviera-player-board">
  <div class="player-board-cards-row">
    <div class="hand-count-backs" data-count="10">
      <!-- count <= 6: one .mini-card-back per card, overlapping (Odin-style) -->
      <!-- count  > 6: one .mini-card-back + <span class="hand-count-text">x 10</span> -->
    </div>
    <div class="last-chance-indicator" data-used="false"><div class="mini-card" data-card-kind="last-chance"></div></div>
  </div>
  <div class="player-board-status-row">
    <div class="round-status-indicator" data-round-status="in"><i class="fa6 …"></i> In</div>   <!-- In / Stopped / Crashed via _() -->
    <div class="start-token-slot"></div>               <!-- 30×30 reserved space; #start-token lives in exactly one -->
  </div>
</div>
<div id="start-token"></div>                           <!-- 30×30 black square, red border; moved between slots -->
```
- The "x N" text is a number with a plain `x`, so it needs no translation.
- `setHandCount(n)` rebuilds `.hand-count-backs`, switching between the two forms at the 6/7 threshold.
- A used Last Chance card is greyed with a strike icon.

## Sprite index

`img/riviera_cards.webp` is 4240×4375: a **10 × 7 grid** of 424×625 frames, row-major in the documented order (62 frames used).
```
colorIndex = CARD_COLORS key (red 1, green 2, purple 3, blue 4, orange 5)
index      = (colorIndex - 1) * 12 + (value - 1)      // Last Chance = 60, back = 61
col = index % 10        row = floor(index / 10)
background-size: 1000% 700%;
background-position: calc(col * 100% / 9) calc(row * 100% / 6);
```
The positions are generated in SCSS, like Fugu's `@for` over `data-rank`: an `@each` over `$card-colors: red, green, purple, blue, orange` × `@for $value 1..12`, plus `[data-card-kind="last-chance"]` and `[data-card-kind="back"]`. Fugu's `col * -100%` only works because the background repeats; Riviera uses the exact formula.

## Change my mind (M2, noted now)

- Starting point: `reference/yaxha-change-mind.md` (it isn't in the repo yet; I'll read it when M2 starts).
- What the current framework provides, to check against the Yaxha code:
  - **Server:** `#[CheckAction(false)]` (`Bga\GameFramework\Actions\CheckAction` in `_ide_helper.php`) skips the active-player check on one action. The state check then has to be done by hand (`gamestate->checkPossibleAction`).
  - **Client:** `bga.actions.performAction(name, args, { checkAction: false })`, plus `bga.actions.checkPossibleActions(name)`, which ignores active status ("player may like to change their mind" is quoted in `bga-framework.d.ts`).
  - Reactivation: `gamestate->setPlayersMultiactive([$playerId], '', false)`.
- Built once, used by both `PlayCard` and `StopOrMore`.

## Remaining open items (defaults in brackets)
1. **Sprite weight:** 2.5 MB. [Keep it; offer a 50% downscale in M4.]
2. **Player colors vs card colors:** `ff0000`, `008000` and `0000ff` look like the card colors. [Revisit in M4.]
3. **6 players use all 60 cards**, so the draw pile is empty, which affects card 10's fallback. [Added to SPEC.md as an open question; decide in M3.]

## Verification
1. `npm install`, then `npm run build`: clean.
2. `php -l` on every PHP file touched.
3. In BGA Studio:
   - Start games with **2, 4, 5 and 6 players**. There are always 60 `cards` rows. With 2 to 4 players, 12 are in `'returned_to_box'` (one color) and that die has `die_location='returned_to_box'`. Each hand has 10 cards. `SELECT card_location_arg, color, COUNT(*) c FROM cards WHERE card_location='hand' GROUP BY 1,2 HAVING c > 6` returns nothing.
   - The UI shows, top to bottom, the dice in the colors in use (blank faces), my sorted hand, and the columns (mine first).
   - Each player board shows one back + "x 10" with the Last Chance card to its right, status "In", and the Start token on exactly one board.
   - `debug_playRandomCards(5)`, then F5: hands are at 5, so the boards show 5 individual backs. The columns stack showing only the star strips, and the ★ totals are right.
   - `debug_passStartToken()`: the token slides to the next player's board and the log says who received it.
   - `debug_redeal()` deals new hands with no log line.
   - A spectator sees all the hand counts, columns and dice, and no hand.

---

## Doc diffs (applied right after approval, after the `git mv` into `.claude/`)

### .claude/CLAUDE.md
```diff
@@ top
 # Riviera: BGA adaptation
 
 This folder is the BGA Studio project for **Riviera** (Valentin Demion, Helvetiq).
-Game rules and every design decision live in `SPEC.md`. Read it before writing game logic.
+Game rules and every design decision live in `.claude/SPEC.md` (imported below, so it loads every session). Read it before writing game logic.
+Per-milestone BGA Studio test checklists live in `.claude/TESTING.md`.
+
+@SPEC.md
@@ Workflow rules
-- Work milestone by milestone (see `SPEC.md` > Milestones). Stop at the end of each milestone and tell me what to test in BGA Studio.
+- Work milestone by milestone (see `.claude/SPEC.md` > Milestones). Stop at the end of each milestone, write what to test in BGA Studio as a new section of `.claude/TESTING.md`, and tell me.
@@ Keeping the docs current
-- **End of every milestone**: in `SPEC.md` > Milestones, mark it done, add a short "Notes" list under it (what was built, known bugs, anything deferred), then tell me.
-- **Whenever I decide something new or change a rule** during a session: update the relevant section of `SPEC.md` right away, marked **[BGA]** if it differs from the rulebook.
+- **End of every milestone**: in `.claude/SPEC.md` > Milestones, mark it done, add a short "Notes" list under it (what was built, known bugs, anything deferred), add its test checklist to `.claude/TESTING.md`, then tell me.
+- **Whenever I decide something new or change a rule** during a session: update the relevant section of `.claude/SPEC.md` right away, marked **[BGA]** if it differs from the rulebook.
+- All three docs live in `.claude/`, tracked in git (except `settings.local.json`) and excluded from SFTP upload.
@@ Reference project: Fugu
-`../reference/bga-fugu/` is my previous BGA game (same author, same publisher, same framework version).
+`reference/fugu/` (inside this repo, gitignored and excluded from SFTP upload) is my previous BGA game (same author, same publisher, same framework version).
@@
-- **TS architecture**: one `Game.ts` that owns handler classes, one class per concern in its own file (`PlayerHandler`, `HandHandler`, `CenterHandler`, `TooltipHandler`, `PrefHandler`, `ModalBoxHandler`, `LogMutationObserver`, `EndGameScoringHandler`, ...), and client state classes under `src/ts/States/`. Reuse Fugu files as-is where they are game-agnostic (LogMutationObserver, PrefHandler, ModalBoxHandler, TooltipHandler) and adapt the rest.
+- **TS architecture**: one `Game.ts` that owns handler classes, one class per concern in its own file (`PlayerHandler`, `HandHandler`, `PlayedColumnHandler`, `DiceHandler` (Fugu's `CenterHandler`), `StartTokenHandler`, `TooltipHandler`, `PrefHandler`, `ModalBoxHandler`, `LogMutationObserver`, `EndGameScoringHandler`, ...), and client state classes under `src/ts/States/`. Reuse Fugu files as-is where they are truly game-agnostic (ModalBoxHandler, the core of LogMutationObserver). PrefHandler and TooltipHandler contain Fugu-specific code, so adapt them like the rest.
@@ Assets
-- `img/riviera_card.webp` is one sprite sheet, one row-major strip in this order:
-  `[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [yellow 1..12] [Last Chance] [card back]` (62 frames).
-  Compute `background-position` from an index; never hardcode per-card positions.
+- `img/riviera_cards.webp` is one sprite sheet: a 10-column x 7-row grid of 424x625 frames, row-major in this order:
+  `[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [orange 1..12] [Last Chance] [card back]` (62 frames, rest of the last row blank).
+  Compute `background-position` from an index (see SPEC.md > Sprite); never hardcode per-card positions.
+- Start token has no art yet: a 30x30px black square with a red border.
@@ (new section, after "Workflow rules")
+## Conventions
+
+- **Power naming**: any field, DB column or variable that exists only because of a special power carries the power's card value in its name: `reserved_by_POWER2`, `modified_by_POWER9`, `in_use_by_POWER11`. Same suffix in PHP, SQL, TS and data attributes (`data-reserved-by-power2`).
+- **Card ids reveal identity**: cards are inserted in a fixed order, so a `card_id` tells its color and value. Never send ids of cards a player isn't allowed to see; send counts instead.
+- **Color order**: the `color` ENUM is declared in sprite order (red, green, purple, blue, orange), so `ORDER BY color, value` sorts like the sprite. Keep `CARD_COLORS` (PHP) and `$card-colors` (SCSS) in that same order.
+- **Removed color**: in 2 to 4 player games its cards stay in `cards` at location `returned_to_box` and its die stays in `dice` with `die_location = 'returned_to_box'`. "Colors in use" is read from `dice`.
+- **State ids**: RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, BonusPlay 25, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, EndRound 60, EndScore 98.
+- **Framework typing differs from Fugu's**: Riviera's `bga-framework.d.ts` is newer. `Player` has no `color_back` and `playerorder` is `number[]`. Ported helpers (`divYou`, `divColoredPlayer`) drop `color_back`.
```

### .claude/SPEC.md
```diff
@@ Colors
-Sprite and color index order: **1 red, 2 green, 3 purple, 4 blue, 5 yellow**.
+Sprite and color index order: **1 red, 2 green, 3 purple, 4 blue, 5 orange**.
 Each color has one matching die.
@@ Sprite
-`img/riviera_card.webp`, frames in this order (62 total):
-`[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [yellow 1..12] [Last Chance] [card back]`
-Frame index for a numbered card = `(colorIndex - 1) * 12 + (value - 1)`. Last Chance = 60, back = 61.
+`img/riviera_cards.webp`, a 10-column x 7-row grid of 424x625 frames, row-major, in this order (62 used):
+`[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [orange 1..12] [Last Chance] [card back]`
+Frame index for a numbered card = `(colorIndex - 1) * 12 + (value - 1)`. Last Chance = 60, back = 61.
+Column = `index % 10`, row = `floor(index / 10)`; `background-size: 1000% 700%`, `background-position: calc(col * 100% / 9) calc(row * 100% / 6)`.
@@ Setup
-- 2 to 4 players: **[BGA]** remove one random color (its 12 cards and its die) for the whole game.
+- 2 to 4 players: **[BGA]** remove one random color (its 12 cards and its die) for the whole game. They stay in the DB as `returned_to_box`.
@@ Powers by value (card 10 row, appended)
-| 10 | Before the next roll | Choose 2 cards ... draw 2 from the draw pile. |
+| 10 | Before the next roll | Choose 2 cards ... draw 2 from the draw pile. **Open question:** with 6 players all 60 cards are dealt, so the draw pile is empty; decide the fallback in Milestone 3. |
@@ Change my mind (shared mechanism)
-- This action must be callable by a non-active player: on the client call it with `checkAction: false`, and on the server check the game state yourself instead of relying on the active-player check. Look up how the current framework allows actions from inactive players before implementing.
+- This action must be callable by a non-active player: on the client call it with `checkAction: false`, and on the server check the game state yourself instead of relying on the active-player check.
+- Starting point: `reference/yaxha-change-mind.md` (built before in Yaxha). Check it against the current framework first: server `#[CheckAction(false)]` attribute, client `bga.actions.performAction(..., { checkAction: false })` and `bga.actions.checkPossibleActions()`.
@@ Player boards (new subsection under "Hidden information")
+### Player board display
+- Hand count: 6 cards or fewer, one small card back per card; more than 6, one card back followed by "x N". Visible to everyone, spectators included.
+- Last Chance card to the right of the card backs (greyed once used).
+- Round status (in / stopped / crashed) and the Start token. The token is a single element that slides from board to board when it passes.
```

### .claude/TESTING.md (new)
```markdown
# Riviera: BGA Studio test checklists

One section per milestone, written when the milestone ends. Tick items as you test; note failures inline.

## Milestone 1: Skeleton
<the Verification > step 3 checklist from this plan, as checkboxes>
```

### .gitignore
```diff
 **/.DS_Store
 **/*.css.map
 /.history
 **/sftp.json
 /reference
+/node_modules
+.claude/settings.local.json
```

### .vscode/sftp.json (local, untracked)
```diff
         "**/.DS_Store"
+        ,".claude/**"
     ]
```
