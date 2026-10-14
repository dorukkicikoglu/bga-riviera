> Status: approved 2026-10-14, not implemented yet. Docs updated only (this plan saved as `.claude/plans/milestone-4.md`, decisions recorded in SPEC.md); no code until the go-ahead.

# Riviera: Milestone 4 (Polish) plan

## Context

M1 to M3 built the whole game: the core loop, simultaneous choices with Change my mind, every power, and Fugu-style logs. M4 is the last milestone before alpha. It covers what BGA needs to accept the game and what players need to understand it:
- power tooltips
- statistics
- the end-game scoring display
- zombie mode
- game progression
- one user preference
- the last logs
- alpha metadata

M3 is not verified in Studio yet. Nothing in M4 depends on M3 behaving a particular way, except that the zombie code calls the M3 actions. Everything is tested together at the end.

Fugu (`reference/fugu/`) stays the model. `EndGameScoringHandler.ts`, `TooltipHandler.ts`, `PrefHandler.ts`, `NextPlayer::saveGameEndStats()`, `stats.jsonc` and `gamepreferences.jsonc` are the direct sources.

**Decisions (this session):**
- **Zombie: level 1 everywhere.**
  - Card play is greedy: the playable card with the most stars, ties at random. A 1 chains greedily inside the same `zombie()` call.
  - With no playable card: Last Chance if it is still available, else crash (unchanged).
  - Stop or More: always Stop (banking now is the greedy move).
  - Card 9: a random choice among skip and every modifiable die turned -1 or +1.
  - Card 11: a random choice between add and skip.
  - Card 10: a random choice among skip and every target. A swap gives 2 random own cards. In redraw mode, the choice is between skip and redraw with random cards.
  - Report **level 1** in the Game Metadata Manager.
- **Preferences:** one preference, "One-click card play" (off by default). **Auto-More is dropped:** BGA's checklist forbids sending actions programmatically.
- **Last Chance stats:** `lastChanceUsed` (bool) plus `lastChanceRound` (the round it was used in, only set when used).
- **End-game display:**
  - One row per round with the stars each player banked: a bomb for a crash, a gold cell for a Grand Slam, a dash for a round cut short by a Grand Slam.
  - Then a Total row.
  - The data comes from a new `round_scores` table.

**Conflicts with the brief or with Fugu (my recommendation in bold):**
- **gameinfos has no designer or artist fields** in this framework version, and Fugu's file has none either. Valentin Demion, Simon Caruso, the year and the presentation text go in the **Studio Game Metadata Manager**, not in code.
- **`bgg_id` 478651 is confirmed. `estimated_duration` becomes 20** (the box says 20 min).
- **The BGA checklist asks for a CSS class prefix** (for example `riv-`). **Skipped, like Fugu** (confirmed).
- **Auto-More (SPEC step 8 nice-to-have):** dropped, as above. SPEC is updated to say so.

---

## State flow

No new states and no id changes. Only these change:
```text
RoundSetup(5)    updateGameProgression: true (moved from EndRound, see Progression)
RevealCards(22)  updateGameProgression: true
EndRound(60)     writes round_scores; updateGameProgression removed
EndScore(98)     notifies displayEndGameScoring (with the game-end log row), then 99
```

## File-by-file

Legend: **NEW** = no Riviera equivalent · **EDIT** = existing Riviera file changed · **KEEP** = unchanged.

### Root / metadata

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `stats.jsonc` | EDIT | Fugu `stats.jsonc` | Below. |
| `gamepreferences.jsonc` | EDIT | Fugu `gamepreferences.jsonc` | `"101": { "name": "One-click card play", "values": { "0": { "name": "Off: select, then confirm" }, "1": { "name": "On" } }, "default": 0 }` |
| `gameinfos.jsonc` | EDIT | Fugu | `estimated_duration`: 25 → 20. Everything else stays (2 to 6 players, Helvetiq, publisher BGG id 21478, `bgg_id` 478651). `tie_breaker_description` stays `""`: equal scores share the win. |
| `gameoptions.jsonc` | KEEP | | No options. |
| `dbmodel.sql` | EDIT | Fugu `dbmodel.sql` | `round_scores` table, below. |

#### stats.jsonc
```text
table:  rounds (10, int, "Rounds"), turns (11, int, "Turns")
player: roundsPlayed (10, int, "Rounds played")
        roundsStopped (11, int, "Rounds stopped")
        crashes (12, int, "Crashes")
        lastChanceUsed (13, bool, "Last Chance used")
        lastChanceRound (14, int, "Round the Last Chance was used in")
        starsBanked (15, int, "Stars banked")
        bestRound (16, int, "Most stars banked in one round")
        cardsPlayed (17, int, "Cards played")
        powerUsed_POWER1 (18, int, "Extra cards played with a 1")
        powerUsed_POWER2 (19, int, "Dice reserved (card 2)")
        powerUsed_POWER9 (20, int, "Dice turned (card 9)")
        powerUsed_POWER10 (21, int, "Cards swapped or redrawn (card 10)")
        powerUsed_POWER11 (22, int, "Golden dice added (card 11)")
        grandSlam (23, bool, "Grand Slam")
```
- Everything except `lastChanceRound` is initialized in `setupNewGame`. Fugu never inits; the template does, and BGA expects it.
- `lastChanceRound` stays unset until the Last Chance is used, so games without one don't drag the average down.
- `powerUsed_POWER2` and `powerUsed_POWER11` go back down by 1 when a Stop cancels the power, so they count only powers that took effect.
- Turns counts dice rolls.

| Stat | Updated in |
|---|---|
| `rounds`, `roundsPlayed` | `RoundSetup` (`tableStats->inc`, `playerStats->incAll`) |
| `turns` | `RollDice` |
| `cardsPlayed`, `powerUsed_POWER1`, `crashes`, `lastChanceUsed`, `lastChanceRound` | `RevealCards` |
| `roundsStopped` | `RevealStopOrMore` |
| `starsBanked`, `bestRound` | `EndRound` |
| `grandSlam` | `Game::applyGrandSlam()` |
| `powerUsed_POWER2` | `RIVPowerManager::applyReservationPOWER2()` (+1), `cancelPowersOfStoppingPlayers()` (-1) |
| `powerUsed_POWER9` | `ModifyDie::actModifyDie_POWER9` |
| `powerUsed_POWER10` | `SwapCards` swap and redraw actions (+ cards moved) |
| `powerUsed_POWER11` | `ResolvePowers::actAddGoldenDie_POWER11` (+1), cancel (-1) |

All stat calls go through `$this->game->bga->playerStats` / `->tableStats`. Fugu uses `$this->game->playerStats`; Riviera already routes globals through `bga`. This goes into CLAUDE.md conventions.

#### dbmodel.sql
```sql
-- one row per player per round, for the end-game scoring table
-- round_result: stopped banks stars, crashed scores 0, grand_slam ends the game, unfinished means a Grand Slam ended the round first
-- stars: points added to player_score that round (for grand_slam, the jump to the Grand Slam score)
CREATE TABLE IF NOT EXISTS `round_scores` (
  `round_number` TINYINT UNSIGNED NOT NULL,
  `player_id` INT UNSIGNED NOT NULL,
  `round_result` ENUM('stopped', 'crashed', 'grand_slam', 'unfinished') NOT NULL,
  `stars` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_number`, `player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```
Comments go on their own lines, without semicolons (CLAUDE.md rule). The schema is final before alpha, as the checklist asks.

### PHP

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `modules/php/Game.php` | EDIT | Fugu `Game.php` | Below. |
| `modules/php/RIVTableManager.php` | EDIT | `FUGUTableManager.php` | `saveRoundScore(int $roundNumber, int $playerID, string $result, int $stars)` (INSERT ... ON DUPLICATE KEY UPDATE, so `debug_redeal` replays don't fail). `getRoundScores(): array` returns round => player_id => {result, stars}. `getStarsInColumnByPlayer()` for progression. |
| `modules/php/RIVPowerManager.php` | EDIT | itself | Stat calls (table above). `getModifiableDieChoicesPOWER9()` is shared by `ModifyDie::zombie`. |
| `States/RoundSetup.php` | EDIT | `NextPlayer.php` (`updateGameProgression`) | `updateGameProgression: true`. Stats: `rounds`, `roundsPlayed`. |
| `States/RollDice.php` | EDIT | | `turns` +1. |
| `States/PlayCard.php` | EDIT | Fugu `PlayerTurn::zombie` | The level-1 zombie. Below. |
| `States/RevealCards.php` | EDIT | | `updateGameProgression: true`. Stats as in the table. |
| `States/RevealStopOrMore.php` | EDIT | | `roundsStopped`. |
| `States/EndRound.php` | EDIT | | `saveRoundScore()` for every player: stopped gets its stars, crashed gets 0. `starsBanked` and `bestRound` (`max(get, stars)`). `updateGameProgression` removed (see Progression). |
| `States/EndScore.php` | EDIT | Fugu `NextPlayer` end branch (`notify->all("displayEndGameScoring", ...)`) | Below. |
| `States/ModifyDie.php`, `ResolvePowers.php`, `SwapCards.php` | EDIT | Fugu `PlayerTurn::zombie` | Random zombies. Below. |
| `States/StopOrMore.php`, `PassStartToken.php` | KEEP | | The StopOrMore zombie already stops. |

#### Game.php
- `public array $userPrefs = ['one_click_play' => 101];`, exactly like Fugu's `$userPrefs`.
- `setupNewGame`: `$this->bga->tableStats->init(['rounds', 'turns'], 0)`. Then `playerStats->init` for the int stats at 0 and the two bools at `false`. `lastChanceRound` is not initialized.
- `getAllDatas`:
  - `pref_names` (Fugu).
  - `grandSlamPlayerIds`, read from `round_scores` with `grand_slam`. This fixes the M2 known limit: the Grand Slam glow is restored after F5.
  - `endGameScoring` when `getCurrentMainState()->name == 'gameEnd'` (Fugu's check).
- `applyGrandSlam()`:
  - `saveRoundScore(grand_slam, newScore - oldScore)` for each Grand Slam player.
  - For everyone else: `crashed` if crashed, else `unfinished`, with 0 stars.
  - `grandSlam` stat set to true.
- `getEndGameScoring(): array` (Fugu name), returning:
  - `winner_ids`: everyone at the top score.
  - `rounds`: `getRoundScores()`.
  - `scores`: player_id => `player_score`.

  The Total row shows `player_score` itself, so debug score changes can't make it disagree with BGA's ranking.
- `getGameProgression()`: below.

#### Progression
```php
// highest banked score plus the stars in front of a player not crashed this round, out of WINNING_SCORE; capped at 99 until the game really ends
max over players with round_status <> 'crashed' of (player_score + stars in their column) * 100 / WINNING_SCORE, min 0, max 99
```
- Today the bar sits at 0 for the whole first round. This version moves it every reveal.
- It is recomputed in `RoundSetup` and `RevealCards`.
- It is no longer computed in `EndRound`, where a stopped player's column would be counted twice (banked already, but not cleared until `RoundSetup`).
- It can drop slightly when the leader crashes. BGA allows that.

#### EndScore (98)
```php
$endGameScoring = $this->game->getEndGameScoring();
$this->notify->all('displayEndGameScoring', '${GAME_END_LOG_STR}', [
    'preserve' => ['winner_ids', 'winning_score'],
    'winner_ids' => ..., 'winning_score' => ...,
    'endGameScoring' => $endGameScoring,
    'GAME_END_LOG_STR' => '<names> win with N stars',
]);
return ST_END_GAME;
```
Both endings (40 points and Grand Slam) pass through `EndScore`, so the table always shows.

#### Zombies (level 1)

| State | Zombie |
|---|---|
| `PlayCard` | Mid-chain: add the best remaining card, or finish. Otherwise: `getBestZombieChoice([cardID => stars])`. If the card is a 1, loop in the same call: `actAddChainCard_POWER1(best remaining)` while the chain is open. A zombie stays active mid-chain, and the framework would not call `zombie()` again. Then the Last Chance, then a crash (unchanged). |
| `StopOrMore` | Stop (unchanged). |
| `ModifyDie` | `getRandomZombieChoice(['skip', 'red:-1', 'red:1', ...])` over `getModifiableDicePOWER9()`, then `actModifyDie_POWER9` or `actSkip_POWER9`. |
| `ResolvePowers` | `getRandomZombieChoice(['add', 'skip'])`. |
| `SwapCards` | Swap mode: `getRandomZombieChoice(['skip', ...target ids])`. For a target, give 2 random own cards (`getRandomHandCards`). Redraw mode: `['skip', 'redraw']`, with `maxCards` random own cards. |

- Each zombie returns the action's next-state class, like Fugu's `zombie() { return $this->actPass($playerId); }`.
- Never `getCurrentPlayerId()`.

### TypeScript (`src/ts/`)

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `TooltipHandler.ts` | NEW | Fugu `TooltipHandler.ts` (incl. the Safari-mobile fallback) | Below. |
| `EndGameScoringHandler.ts` | NEW | Fugu `EndGameScoringHandler.ts` (near copy) | Below. |
| `PrefHandler.ts` | NEW | Fugu `PrefHandler.ts` | Same constructor and `onChange` wiring. `onGameUserPreferenceChanged` stores `oneClickPlay`. Public `isOneClickPlay()`. No `hidePreferenceChoice` (no solo mode). |
| `Game.ts` | EDIT | Fugu `Game.ts` | Below. |
| `States/PlayCard.ts` | EDIT | | `selectionChanged()`: with one-click play on and a card just selected, call `confirmClicked()` at once, for the first card and for chain cards. The Confirm button is then never shown. This is a real user click, so it is not a programmatic action. |
| `LogMutationObserver.ts` | EDIT | | `createLogGameEnd(winnerIDs, score)`: "<names> win with N ★" / "${you} win with N ★", with the gold trophy icon `fa6 fa-trophy`. |
| `PlayedColumnHandler.ts`, `PlayerHandler.ts`, `DiceHandler.ts`, `StartTokenHandler.ts` | EDIT | | Give tooltip targets stable ids or classes: `#start-token` already has one. Dice get `id="die-<color>"` in the game area only, never in log copies. The board Last Chance gets `last-chance-card`. `DiceHandler.updateDice` refreshes each die's tooltip (below). |
| `HandHandler.ts` | EDIT | Fugu `HandHandler.recomputeMobileCardSpacing()` | `recomputeCardSpacing()`: the overlap grows so every card fits the container width on one row (deferred from M1). Called from `Game.onScreenWidthChange` and after the hand changes. |
| `types.d.ts` | EDIT | Fugu | `EndGameScoringData`, `RoundScoreEntry`, `GamePrefs`, `DisplayEndGameScoringArgs`. Gamedatas: `pref_names`, `grandSlamPlayerIds`, `endGameScoring?`. |
| `ChangeMindHandler.ts`, other state classes | KEEP | | |

#### Game.ts
- Owns `tooltipHandler`, `endGameScoringHandler` and `prefHandler`, created in `setup` in Fugu's order.
- `if(gamedatas.endGameScoring) this.endGameScoringHandler.displayEndGameScore(...)`.
- `gamedatas.grandSlamPlayerIds.forEach(id => this.players[id]?.setGrandSlam())`.
- `this.bga.gameui.onScreenWidthChange = () => this.onScreenWidthChange()` (Fugu).
- `bgaFormatText`: adds `GAME_END_LOG_STR` → `createLogGameEnd`.
- `notif_displayEndGameScoring`: Fugu's: `updateStatusText(_('Final scores'))`, then `await displayEndGameScore`.
- Helpers ported from Fugu: `clickOrTap()`, `capitalizeFirstLetter()`, `updateStatusText()`.
- Calls `tooltipHandler.addTooltipsToCards()` after anything that creates cards: setup, `newHand`, `cardsRevealed`, `cardsSwapped_POWER10`, `cardsRedrawn_POWER10`. Fugu does the same after `cardsSwapped`.
- **Cleanup (checklist):** the `console.log` calls in the constructor, `setup` and `setupNotifications` are removed.

#### TooltipHandler
Fugu's structure: `addTooltipsToCards()` calls `bga.gameui.addTooltipHtmlToClass(class, html, 400)`. On Safari mobile it instead renders the reference once at the bottom of the game area (Fugu's `addTooltipToBottomForSafari`).
- **Power cards:**
  - `createCardDiv` adds `power-card-POWER<n>` for values 1, 2, 9, 10 and 11.
  - The tooltip uses a Fugu `.tooltip-wrapper`: a title ("Card 2" with its ★), a timing line, then the effect.

| Card | Timing | Effect (player-facing, matches SPEC and the publisher answers) |
|---|---|---|
| 1 | Right away | Add one more playable card from your hand on the same dice. Another 1 lets you add again. |
| 2 | Next roll | The die of this card's color is reserved for you: opponents can't use it, alone or in a sum. Cancelled if you stop. |
| 9 | After the next roll | You may turn one die by 1 up or down (6 becomes 1, 1 becomes 6), for everyone. Each die can be turned once per roll. Lost if you stop. |
| 10 | Before the next roll | You may swap 2 cards of your choice for 2 random cards of an opponent still in the round. If none can be chosen, discard and draw instead. |
| 11 | Next roll | You may add the golden die for everyone. It only counts in a sum with a colored die and never gives its color. Cancelled if you stop. |

- **Other elements** (checklist: tooltips on graphic elements that aren't self-explanatory), as `addTooltip` / `addTooltipToClass` text:
  - Last Chance card: once per game, when you can't play, play nothing this turn and stay in.
  - Start token: powers resolve clockwise from this player; it passes every turn.
  - Hand count backs: cards in hand.
  - Round status: In / Stopped / Crashed meanings.
  - Column stars: stars of the cards played this round.
- **Dice:** one tooltip per die, refreshed by `updateDice`. It shows the color, and adds lines as they apply:
  - "Reserved by <name> (card 2)"
  - "Turned this roll (card 9)"
  - for gold: "Golden die (card 11): only in a sum"

#### EndGameScoringHandler
A port of Fugu's with the solo, bubble and anchor parts removed:
- Kept: fixed container, collapse/show buttons, scroll fade, cell-by-cell fade-in, click to fast-forward, winners jumping.
- `fillTable()`:
  - Header: one `divColoredPlayer` per player, in turn order.
  - One row per round, labelled "Round N".
  - Cells: "N ★", a bomb icon for `crashed`, a gold "Grand Slam" cell (+N) for `grand_slam`, and "-" for `unfinished`.
  - Then the Total row, which reads `scores`.
- Fugu's `addColumnTotal` stays: the total cell builds up as cells appear. The final value comes from `scores`.
- `setEndGamePlayerScores()` sets BGA's score counters (`getScoreCounter().toValue`) instead of Fugu's `updateScoring`.

### SCSS (`src/scss/Game.scss`)
- `.end-game-score-container`: ported from Fugu with Riviera colors (sea blue gradient, gold total row). Also `jumpAndTilt` and the `pearl-background` mixin, plus Fugu's mobile and landscape rules.
- Tooltips: `.tooltip-wrapper` with `.power-tooltip-title`, `.power-tooltip-timing` and `.power-tooltip-text`. Also Fugu's `.dijitTooltipContainer:has(.tooltip-wrapper)` and connector-arrow rules, the `--bg-gradient-tooltip*` variables (pale sea), and the Safari-mobile reference container.
- `game-end` added to `$log-types` with `--bg-log-game-end`: pale gold `#fff7d6 → #f0d98a`, still lighter than Grand Slam.
- **Dark mode (checklist):** every log row already sets a dark text color on a pale background. `.log .roundedbox, .gamelogreview` also gets `color: #27271c`, so plain rows stay readable when BGA's dark mode lightens default text. Verified in Studio.
- Hand spacing: `--hand-card-overlap` set by `HandHandler.recomputeCardSpacing()`.

### Logs

| Notif | `createLog*` | Log class | Row | `:root` variable |
|---|---|---|---|---|
| `displayEndGameScoring` | `createLogGameEnd(winner_ids, winning_score)` | `game-end-log` | "[trophy] <names> win with N ★" | `--bg-log-game-end` |

Every other notification with a message already has its row (`newRound` to `powerCancelled`, 15 types). `diceUpdated`, `newHand` and the private choice notifs have no message by design.

## Also needed for alpha (not in the brief)

| Item | Why |
|---|---|
| Stats initialized in `setupNewGame` | BGA's template does it, and stats that are never initialized don't show. |
| `round_scores` table now | The checklist says the schema must be final before alpha. The end table needs it. |
| Grand Slam glow restored after F5 | An M2 known limit. It is now free from `round_scores`. |
| Hand spacing on narrow screens | Deferred from M1. The checklist requires a mobile test. `game_interface_width.min` stays 740, like Fugu. |
| Tooltips on board elements and dice | Checklist: graphic elements that aren't self-explanatory need tooltips. |
| Dark mode log text color | Checklist: the game must be readable in dark mode. |
| Remove `console.log` | Checklist cleanup. |
| Copyright header on every PHP and TS source file | Checklist: "Put your name in the copyright header of all source files." The same short header as `Game.php`, added to the files that lack one (`RIV*Manager.php`, `States/*.php`, `src/ts/**/*.ts`). |
| Game Metadata Manager (Studio, **not code, yours**) | Designer Valentin Demion, artist Simon Caruso, year, presentation text, zombie level 1, a box image with a transparent background, banner, icon, display images. `misc/metadata` has `box3d.png`, `helvetiq.png` and `logo_title.png`, but no banner, icon or display images (Fugu had all three). |
| Checklist test passes | Minified JS/CSS, spectator, in-game and full replay, realtime timers, Firefox + Safari, mobile, dark mode, the waiting screen, and Dry run build. They go into the M4 TESTING section. |

## Docs now (before any code, diffs shown)
- Copy this plan to `.claude/plans/milestone-4.md`.
- **`SPEC.md`:**
  - Step 8: auto-More is dropped.
  - Statistics: the final list.
  - New short sections: Zombie and Preferences.
  - End-game display.
  - M4 milestone line: points to the plan, "planned, not built".

## Docs (at the end of the milestone, diffs shown)
- **`SPEC.md`:**
  - M4 is marked done, with Notes.
  - Statistics: the final list, with `lastChanceUsed` + `lastChanceRound`.
  - Step 8: auto-More is dropped (**[BGA]**, programmatic actions are forbidden).
  - New sections: Zombie (level 1 per state) and Preferences.
- **`CLAUDE.md`:** stats through `bga->playerStats` / `tableStats`, with lastChanceRound left uninitialized on purpose; tooltips are reapplied after card creation.
- **`TESTING.md`:** the M4 section.

## Verification
1. `npm run build` is clean, and `php -l` passes on every PHP file touched.
2. Start a **new** table, because the schema changed.
3. Studio checks (these become the M4 section of `TESTING.md`):

**Tooltips**
- Hovering a 1, 2, 9, 10 or 11 in my hand, in a column or in a log row shows its power. Other values show nothing.
- The Last Chance card, Start token, hand backs, round status, column stars and each die have tooltips. A reserved die names its owner, and the tooltip updates when the reservation ends.
- On Safari mobile, the power reference shows at the bottom of the page.

**Stats** (game end → Statistics tab)
- Rounds and turns are right.
- For a player who crashed once, used the Last Chance in round 2 and stopped the other rounds: `crashes` 1, `lastChanceUsed` yes, `lastChanceRound` 2, and `starsBanked` equals their score.
- `bestRound` is right.
- A chain of three cards counts 3 cards played and 2 extra cards.
- A card 2 reservation that a Stop cancelled is not counted.
- A Grand Slam sets `grandSlam`.

**End-game display**
- After a 40-point ending, the table fades in cell by cell. Clicking fast-forwards it, and the winners' names jump.
- There is one row per round: a bomb where someone crashed, and a Total that equals the BGA score.
- Collapse and show work. After F5 at game end, the table appears at once.
- A gold game-end log row names the winner(s).
- Grand Slam ending: the Grand Slam cell is gold with its points, and the others show "-" for that round. After F5, the board and column glow is still there.
- Replay to the end shows the table.

**Zombie** (kick a player in each state, friendly mode)
- PlayCard: plays its best card, and chains if it plays a 1.
- StopOrMore: stops.
- ModifyDie, ResolvePowers and SwapCards: the game never blocks. Over a few tries both "uses it" and "skips" happen.
- A zombie swap moves cards with a real player: their hand changes and they get the private row.

**Progression**
- The bar moves during round 1 after each reveal, sits at the leader's banked score at each new round, and is 100 at game end.

**Preference**
- With "One-click card play" on, clicking a glowing card plays it at once (no Confirm), and also in a card-1 chain.
- With it off, play is unchanged. Change my mind works in both.

**Alpha checklist**
- Minified JS/CSS on (game management page): the game loads and plays.
- Test spectator: sees everything public, no hand.
- In-game replay from a log row, and a full replay after the end.
- Realtime timers: no timeouts.
- Firefox and Safari.
- Phone width: the hand fits on one row.
- Dark mode: all log rows readable.
- The waiting screen.
- Dry run build passes.

## Questions / conflicts
None open: `bgg_id` 478651 confirmed, duration 20, CSS prefix skipped.

Not verifiable locally, with fallbacks:
  - `playerStats->set` on a stat never initialized (`lastChanceRound`). If BGA refuses, initialize it to 0 and accept the skewed average.
  - `getBestZombieChoice` has never been called on Studio (`getRandomZombieChoice` has). If it misbehaves, pick the max by hand with `bga_rand` tie-breaks.
