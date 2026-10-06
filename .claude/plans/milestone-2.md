> Status: implemented 2026-10-06, awaiting Studio test. Doc diffs (end of this file) applied to SPEC.md and CLAUDE.md.

# Riviera: Milestone 2 (Core loop) plan, revision 2

## Context

M1 left the game resting in a stub `PlayCard` with a dealt hand, blank dice and no actions. M2 makes a full game playable without powers: roll, simultaneous card choice with valid-card highlighting and Change my mind, one reveal, Last Chance, crash, Start token passing, simultaneous Stop or More with Change my mind, round scoring, new rounds, the 40-point end, and Grand Slam. Fugu (`reference/fugu/`) stays the model for every file; the change-mind mechanism comes from `reference/yaxha-change-mind.md`, checked against Riviera's `_ide_helper.php` and `bga-framework.d.ts`.

Decisions made so far (this session):
- **Logs:** Fugu-style now. Every M2 game log is built client-side by a `LogMutationObserver.createLog*()` method (mini card and dice icons where relevant). Each method tags its row with its own class through `addLogClassTag`, and `Game.scss` gives each class its own background (see Logs below). M4 only polishes.
- **Card choice:** select, then confirm. Clicking a playable card selects it (raised); a "Play this card" status bar button sends it.
- **Grand Slam in M2:** when a hand empties after a card play, the game ends at once. That player's score becomes `max(100, highest other player's score + 1)`. Several players emptying on the same reveal all get that score and share the win. Log: "${player_name} plays all 10 cards: Grand Slam!".
- **Last Chance / Crash** are offered only when no card is valid (SPEC step 3), enforced on the server too.
- **Crash has no confirm dialog.** Change my mind is the safety net.
- **A used Last Chance card disappears** from the player board (not greyed). This changes M1's greyed + strike-icon display and the SPEC/CLAUDE.md wording (diffs at the end).

**Changes since revision 1:** Last Chance disappears when used; no Crash confirm; per-log-type background colors, which turn the remaining plain logs (Start token, stars banked, crash, Grand Slam, new round) into `createLog*` rows; crashes get their own `playerCrashed` notification and log row.

---

## State flow

```
setupNewGame → RoundSetup(5) → RollDice(10) → PlayCard(20, multi) → RevealCards(22) ─┬→ EndScore(98)            Grand Slam
                                                                                     └→ PassStartToken(40) → StopOrMore(50, multi) → RevealStopOrMore(55) ─┬→ RollDice(10)    someone chose More
                                                                                                                                                         └→ EndRound(60) ─┬→ RoundSetup(5)
                                                                                                                                                                          └→ EndScore(98)  someone ≥ 40
```
- **Two new GAME states, 22 and 55.** A multiactive state ends inside the last chooser's `setPlayerNonMultiactive`, so the reveal needs a game state of its own (the standard BGA pattern, and gotcha 4 in the Yaxha notes: nothing is finalized at decision time). In M3, `RevealCards` returns `BonusPlay`/`ResolvePowers` instead of `PassStartToken`.
- `PlayCard` with nobody in the round returns `RevealCards::class`; `StopOrMore` with nobody in (everyone crashed) returns `EndRound::class`. The Start token still passes on a turn where everyone crashed (step 7 comes before step 8).

---

## File-by-file

Legend: **NEW** = no Fugu equivalent · **ADAPT** = Fugu file reshaped · **EDIT** = existing Riviera file changed · **KEEP** = unchanged.

### PHP

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `dbmodel.sql` | EDIT | Fugu `dbmodel.sql` | 4 player columns, below. |
| `modules/php/material.inc.php` | EDIT | Fugu | `DIE_FACES = 6`, `GRAND_SLAM_MIN_SCORE = 100`. |
| `modules/php/Game.php` | EDIT | Fugu `Game.php` | `$changeMindManager`; `applyGrandSlam()`; `getCardLogHTML()` (Fugu's, used as log fallback text); new debug functions. Details below. |
| `modules/php/RIVTableManager.php` | EDIT | `FUGUTableManager.php` | `rollDice()`, `getAvailableDice(int $playerID)`, `getPlayableCardIDs(int $playerID)`, `getHandCounts()`, `getStarsInColumn(int $playerID)`, `getPlayerIDsInTurnOrderFrom(int $firstPlayerID)` (Fugu `NextPlayer`'s `getNextPlayerTable()` loop), `discardPlayerCards(int $playerID)`. `passStartToken()` (M1) changes its message to `'${START_TOKEN_LOG_STR}'` (Fugu's `PLAYER_PASSED_STR` pattern). |
| `modules/php/RIVChangeMindManager.php` | NEW, FUGUTableManager shape | `FUGUTableManager.php` + Yaxha notes | The shared Change my mind server side, used by `PlayCard` and `StopOrMore`. Below. |
| `States/RoundSetup.php` | EDIT | `NextPlayer.php` | After the deal: `notify->all('newRound', '${NEW_ROUND_LOG_STR}', ...)` and one private `notify->player($id, 'newHand', '', ['cards' => ...])` each. Returns `RollDice::class`. |
| `States/RollDice.php` | NEW | `NextPlayer.php` | GAME 10. `tableManager->rollDice()`, `notify->all('diceRolled', '${DICE_ROLLED_LOG_STR}', ...)`, return `PlayCard::class`. |
| `States/PlayCard.php` | EDIT (stub → real) | `PlayerTurn.php` | MULTIPLE_ACTIVE_PLAYER 20. Below. |
| `States/RevealCards.php` | NEW | `NextPlayer.php` | GAME 22. Below. |
| `States/PassStartToken.php` | NEW | `NextPlayer.php` | GAME 40. `tableManager->passStartToken()` (from M1), return `StopOrMore::class`. |
| `States/StopOrMore.php` | NEW | `PlayerTurn.php` | MULTIPLE_ACTIVE_PLAYER 50. Below. |
| `States/RevealStopOrMore.php` | NEW | `NextPlayer.php` | GAME 55. Below. |
| `States/EndRound.php` | NEW | `NextPlayer.php` | GAME 60, `updateGameProgression: true`. Below. |
| `States/EndScore.php` | KEEP | Fugu | none |

#### dbmodel.sql (added after `last_chance_used`)
```sql
ALTER TABLE `player` ADD `play_choice` ENUM('card', 'last_chance', 'crash') NULL AFTER `last_chance_used`;
ALTER TABLE `player` ADD `play_choice_card_id` INT UNSIGNED NULL AFTER `play_choice`;           -- card set aside, still in 'hand' until RevealCards
ALTER TABLE `player` ADD `stop_or_more_choice` ENUM('stop', 'more') NULL AFTER `play_choice_card_id`;
ALTER TABLE `player` ADD `made_choice_this_state` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `stop_or_more_choice`; -- extra time only on the first choice
```
Pending choices are only columns; the card stays at `card_location = 'hand'`, so Change my mind is just "set the columns back to NULL" (Yaxha gotcha 4).

#### RIVChangeMindManager
```php
class RIVChangeMindManager{
    function resetChoices(array $choiceColumns): void        // on entering PlayCard / StopOrMore: columns = NULL, made_choice_this_state = 'no'
    function recordChoice(int $playerID, array $choiceValues, string $notifName, array $notifArgs, string $nextState): void
        // giveExtraTime only if made_choice_this_state = 'no'; UPDATE the columns + made_choice_this_state = 'yes';
        // notify->player($playerID, $notifName, '', $notifArgs); gamestate->setPlayerNonMultiactive($playerID, $nextState)
    function changeMind(string $actionName, int $playerID, array $choiceColumns, string $notifName): void
        // gamestate->checkPossibleAction($actionName); return if zombie; throw UserException if the player is still active
        // (nothing to change); columns = NULL; notify->player($playerID, $notifName, '', []);
        // gamestate->setPlayersMultiactive([$playerID], '', false)
    function isPlayerZombie(int $playerID): bool               // Yaxha's helper
}
```
`$choiceValues` is a column ⇒ value map; values are ints or the ENUM literals above, never user strings.

#### PlayCard (20)
- `onEnteringState()`: `changeMindManager->resetChoices(['play_choice', 'play_choice_card_id'])`. With nobody in the round, return `RevealCards::class`. Otherwise `setPlayersMultiactive($inRoundIDs, RevealCards::class, true)`.
- `getArgs()`: `['_private' => [<id> => ['playableCardIDs' => int[], 'canUseLastChance' => bool, 'pendingPlayChoice' => null | ['choice' => ..., 'card_id' => ?int]]]]` for each player in the round. Valid cards never reach other players.
- `#[PossibleAction] actPlayCard(int $cardID, int $currentPlayerId)`: the card must be in `getPlayableCardIDs($currentPlayerId)`. Then `recordChoice(..., 'playChoiceConfirmed', ['choice' => 'card', 'card_id' => $cardID], RevealCards::class)`. Normal active-player check: a player who already chose is inactive and can't overwrite.
- `#[PossibleAction] actUseLastChance(int $currentPlayerId)`: requires no playable card and `last_chance_used = 'no'`.
- `#[PossibleAction] actCrash(int $currentPlayerId)`: requires no playable card.
- `#[PossibleAction] #[CheckAction(false)] actChangeMindPlayCard(int $currentPlayerId)`: `changeMindManager->changeMind('actChangeMindPlayCard', ...)`.
- `zombie(int $playerId)`: a random playable card (`getRandomZombieChoice`), else Last Chance if available, else crash. M4 refines zombie mode.

**Valid cards** (`RIVTableManager::getPlayableCardIDs`): available dice = colored dice in play, plus gold when `in_use_by_POWER11 = 'yes'`, minus dice whose `reserved_by_POWER2` is another player. Build the set of `color:value` pairs: each colored die alone, and each pair summed under the color of each colored die in it (gold adds to a sum but never gives a color). Hand cards in that set are playable. The POWER2 and POWER11 columns are always empty in M2, so M3 only has to set them.

#### RevealCards (22)
1. Walk the players in the round clockwise from the Start token holder (`getPlayerIDsInTurnOrderFrom`) and apply each `play_choice`:
   - `card`: move it to `'played'` with the next `location_in_column` (the WHERE clause also checks it is still in that player's hand).
   - `last_chance`: `last_chance_used = 'yes'`.
   - `crash`: `round_status = 'crashed'`, then `discardPlayerCards()` moves the hand and column to `'discard'`.
2. Clear the play columns.
3. One notification for the cards and Last Chances: `notify->all('cardsRevealed', '${REVEAL_LOG_STR}', ['preserve' => ['reveals'], 'reveals' => [...], 'hand_counts' => [...], 'REVEAL_LOG_STR' => <fallback text>])`. Each reveal is `{player_id, choice: 'card'|'last_chance', card: PlayedCard|null}`. A played card is public now, so sending its id is fine. If everyone crashed, there are no reveals and the message is `''`.
4. Then one `notify->all('playerCrashed', '${CRASH_LOG_STR}', ['preserve' => ['player_id'], 'player_id' => ...])` per crash, in the same turn order. It carries no card ids. Crashes get their own row so they can have their own log color.
5. **Grand Slam:** if any player who played a card now has 0 cards in hand, call `game->applyGrandSlam($ids)` and return `EndScore::class`. Otherwise return `PassStartToken::class`.

`Game::applyGrandSlam(array $playerIDs)` (M3's BonusPlay calls it too): `highestOther` = max `player_score` among the other players (0 if none). Score = `max(GRAND_SLAM_MIN_SCORE, highestOther + 1)`. For each id: `bga->playerScore->set($id, $score, null)`, then `notify->all('grandSlam', '${GRAND_SLAM_LOG_STR}', ['preserve' => ['player_id', 'score'], 'player_id' => $id, 'score' => $score])`. The client row reads "<name> plays all 10 cards: Grand Slam!".

Every `*_LOG_STR` arg carries a plain fallback text built on the server (Fugu's `SWAP_NOTIF_STR` + `getCardLogHTML()` pattern). The client always replaces it in `bgaFormatText`.

#### StopOrMore (50)
- `onEnteringState()`: `resetChoices(['stop_or_more_choice'])`. With nobody in the round, return `EndRound::class`. Otherwise `setPlayersMultiactive($inRoundIDs, RevealStopOrMore::class, true)`.
- `getArgs()`: `['_private' => [<id> => ['pendingStopOrMoreChoice' => 'stop'|'more'|null]]]`.
- `actStop(int $currentPlayerId)` and `actMore(...)`: `recordChoice(..., 'stopOrMoreChoiceConfirmed', ['choice' => ...], RevealStopOrMore::class)`.
- `#[CheckAction(false)] actChangeMindStopOrMore(int $currentPlayerId)`: the same shared `changeMind()`.
- `zombie()`: `actStop`.

#### RevealStopOrMore (55)
Players who chose `stop` get `round_status = 'stopped'`. Then one `notify->all('stopOrMoreRevealed', '${STOP_OR_MORE_LOG_STR}', ['preserve' => ['choices'], 'choices' => [<id> => 'stop'|'more']])` and the column is cleared. If anyone chose `more`, return `RollDice::class`; otherwise `EndRound::class`.

#### EndRound (60)
For each stopped player: `stars = getStarsInColumn()`, `score = bga->playerScore->inc($id, $stars, null)`, then `notify->all('starsBanked', '${STARS_BANKED_LOG_STR}', ['preserve' => ['player_id', 'stars', 'score'], ...])`. The client row reads "<name> banks N ★". Crashed players score 0 (their crash is already logged). If `MAX(player_score) >= WINNING_SCORE`, return `EndScore::class` (ties share the win through equal scores); otherwise `RoundSetup::class`.

Score: `null` as the counter message means the framework sends nothing. Our `starsBanked` / `grandSlam` handler calls `bga.playerPanels.getScoreCounter(id).toValue(score)`, as CLAUDE.md asks.

#### Game.php debug functions (all `#[Debug(reload: true)]`)
- `debug_setDice(string $values = '1,2,3,4,5')`: values in color order for the dice in play, then `jumpToState(20)` so PlayCard recomputes the playable cards.
- `debug_setScores(int $score = 38)`: every player's score.
- `debug_trimHands(int $count = 1)`: each player keeps `$count` hand cards and the rest go to `'discard'` (for Grand Slam).
- `debug_redeal` now notifies through RoundSetup. The M1 "needs F5" limit is gone.

### TypeScript (`src/ts/`)

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `Game.ts` | EDIT | Fugu `Game.ts` | Registers `PlayCard` and `StopOrMore`, creates `ChangeMindHandler`. `bgaFormatText` keys (Fugu's pattern), one per `createLog*` method: `DICE_ROLLED_LOG_STR`, `REVEAL_LOG_STR`, `CRASH_LOG_STR`, `GRAND_SLAM_LOG_STR`, `START_TOKEN_LOG_STR`, `STOP_OR_MORE_LOG_STR`, `STARS_BANKED_LOG_STR`, `NEW_ROUND_LOG_STR`. Adds `animateSlide(element, from, to, ms)`, extracted from `StartTokenHandler.moveTo` (a clone on `document.body`, `placeOnObject(..., true)`, a top/left transition), so cards and the token share one implementation. Notification handlers below. |
| `ChangeMindHandler.ts` | NEW | built like `ModalBoxHandler` (small, game-agnostic) | `addChangeMindButton(actionName)`: a secondary "Change my mind" status bar button. On click, `if(bga.actions.checkPossibleActions(actionName)) bga.actions.performAction(actionName, {}, { checkAction: false })`. Shared by both client states. |
| `States/PlayCard.ts` | EDIT | Fugu `States/PlayerTurn.ts` | Below. |
| `States/StopOrMore.ts` | NEW | Fugu `States/PlayerTurn.ts` | Below. |
| `HandHandler.ts` | EDIT | Fugu `HandHandler.ts` | `setPlayableCards(ids)` / `clearPlayableCards()` (`playable-card` / `unplayable-card` classes); `selected-hand-card` toggling on click (only on a `.playable-card`, while active and unlocked, in `PlayCard`), which calls `game.playCard.selectionChanged()`; `setChosenCard(cardID \| null)` (`chosen-card`, set aside); `async animateCardToColumn(card, column)`; `async discardAll()` (crash); `setHand(cards)` (new round, fade-in). Keeps `handData` in sync. |
| `PlayedColumnHandler.ts` | EDIT | same file | `async animateCardIn(card, fromElement)`, `async clear()` (fade out, reset data and ★), `getStarsTotal()`. |
| `PlayerHandler.ts` | EDIT | same file | `getHandCountElement()` (where other players' cards slide from), `setGrandSlam()` (board highlight). `setLastChanceUsed(true)` now removes the Last Chance card from the board (a short fade/shrink when it happens live, absent on reload) instead of greying it. The M1 strike icon is removed. |
| `DiceHandler.ts` | EDIT | same file | `createDieDiv` becomes public, so logs reuse it. |
| `StartTokenHandler.ts` | EDIT | same file | `moveTo` calls `game.animateSlide`. Same behavior. |
| `LogMutationObserver.ts` | EDIT | Fugu `createLogSwapCards`, `createLogPlayerPassed` | One method per log type, each tagged through `addLogClassTag` with its own class. The table is in Logs below. |
| `types.d.ts` | EDIT | Fugu | Types below. |

**Client `PlayCard`** (multiactive; `onEnteringState` ends with `this.onPlayerActivationChange(args, isActive)`, as the stub's comment says):
- Keeps `pendingChoice` (from `args._private.pendingPlayChoice` on entry and reload; updated by the confirm/revert notifs) and calls `handHandler.setChosenCard(...)`.
- `onPlayerActivationChange`: clears the status bar buttons and highlights, then:
  - **Active, with playable cards:** `${you} must choose a card to play`. The playable cards glow and the others are dimmed. A "Play this card" button is hidden until a card is selected (Fugu's swap-button pattern) and sends `actPlayCard({cardID})`.
  - **Active, nothing playable:** `${you} cannot play any card`, then "Use Last Chance" (if available) and "Crash" (`color: 'alert'`, no confirm dialog; Change my mind covers it).
  - **Inactive with a pending choice:** "You chose a card / your Last Chance / to crash. Waiting for other players", plus `changeMindHandler.addChangeMindButton('actChangeMindPlayCard')`.
  - **Otherwise** (spectator, out of the round): `Other players must choose a card`.
- `onLeavingState`: clears the highlights and selection, but keeps `chosen-card`: `notif_cardsRevealed` comes after the state change and moves that card.

**Client `StopOrMore`**: the same shape. Active: `${you} must choose: Stop or More`, with "Stop and bank N ★" (N = my column's `getStarsTotal()`) and "More". Inactive with a pending choice: "You chose to stop / to continue. Waiting for other players" + Change my mind.

**Notification handlers in `Game.ts`**

| Server notif | To | Client |
|---|---|---|
| `newRound` | all | Clear every column, every status back to `in`, hand counts to 10, blank dice. |
| `newHand` | player | `handHandler.setHand(cards)`. |
| `diceRolled` | all | `diceHandler.updateDice(dice)` (the M1 fade/scale). |
| `playChoiceConfirmed` / `playChoiceReverted` | player | `playCard.setPendingChoice(...)` + `setChosenCard`. The status bar follows through `onPlayerActivationChange`. |
| `cardsRevealed` | all | `Promise.all` over the reveals. A card slides from my hand (me) or from the board's hand count (others) into the column. Last Chance removes the Last Chance card from that player's board. Then the hand counts are set. |
| `playerCrashed` | all | Clears that player's column (and my hand if it's me), sets the hand count to 0 and the status to `crashed`. |
| `grandSlam` | all | Score counter `toValue`, board highlight. |
| `startTokenPassed` | all | M1 slide, unchanged. Only the log changes. |
| `stopOrMoreChoiceConfirmed` / `...Reverted` | player | `stopOrMore.setPendingChoice(...)`. |
| `stopOrMoreRevealed` | all | `setRoundStatus('stopped')` for the stoppers. |
| `starsBanked` | all | Score counter `toValue`. |

**types.d.ts additions**
```ts
type PlayChoice = 'card' | 'last_chance' | 'crash';
type StopOrMoreChoice = 'stop' | 'more';
interface PendingPlayChoice { choice: PlayChoice; card_id: number | null; }
interface PlayCardArgs { _private?: { playableCardIDs: number[]; canUseLastChance: boolean; pendingPlayChoice: PendingPlayChoice | null; }; }
interface StopOrMoreArgs { _private?: { pendingStopOrMoreChoice: StopOrMoreChoice | null; }; }
interface CardReveal { player_id: number; choice: 'card' | 'last_chance'; card: PlayedCard | null; }
interface PlayerCrashedArgs { player_id: number; }
interface CardsRevealedArgs { reveals: CardReveal[]; hand_counts: Record<number, number>; }
interface DiceRolledArgs { dice: RivieraDie[]; }
interface StopOrMoreRevealedArgs { choices: Record<number, StopOrMoreChoice>; }
interface NewRoundArgs { round_number: number; hand_counts: Record<number, number>; dice: RivieraDie[]; }
interface NewHandArgs { cards: RivieraCard[]; }
interface ScoreChangedArgs { player_id: number; stars?: number; score: number; }
```

### SCSS (`src/scss/Game.scss`)
- `.a-die` moves out of `#dice-container` so a log can show a small die (`--die-size: 16px`). `#dice-container` keeps the layout only.
- Hand: `.playable-card` glow (Fugu's `selectable-card-glow-pulse` + the mobile keyframes, under `body.current_player_is_active:not(.lockedInterface)`), `.unplayable-card` (dimmed), `.selected-hand-card` (raised + outline, like Fugu), `.chosen-card` (set aside: raised, with a check badge).
- Logs: see Logs below. Also `.minimised-card-icon` (Riviera's sprite scales on its own, so a `.a-card` with `--my-card-width: 24px` needs no Fugu crop hack), `.log-arrow`, and the `playername` shade rules (from Fugu's log section).
- Player board: the Last Chance indicator is hidden when `data-used="true"` (fade/shrink transition). The M1 grey filter and `.last-chance-used-icon` are removed.
- The Grand Slam board highlight, and a crash fade on the column.

### Logs

Fugu's mechanism, unchanged. The server message is a `${X_LOG_STR}` placeholder. `bgaFormatText` swaps in a `createLog*()` row, `addLogClassTag` appends `<div log-class-tag="...">`, and `LogMutationObserver.processLogDiv` moves that class onto the `.log` / `.gamelogreview` div (live, replay and the mobile chatbar alike). `Game.scss` styles each class the way Fugu styles `--bg-gradient-logs`: `.log.<class> .roundedbox` and `.gamelogreview.<class>` use `background: var(--bg-log-<type>)`, and every variable is defined in `:root`.

| Notif | `createLog*` | Log class | Row content | `:root` variable (gradient, top-left to bottom-right) |
|---|---|---|---|---|
| `newRound` | `createLogNewRound(round)` | `new-round-log` | "Round N" centered, bold | `--bg-log-new-round`: sea-foam green `#e3f2ea → #c6e3d2` |
| `diceRolled` | `createLogDiceRolled(dice)` | `dice-rolled-log` | a row of mini dice | `--bg-log-dice-rolled`: warm sand `#fbf4e4 → #efdfbd` |
| `cardsRevealed` | `createLogCardsRevealed(reveals)` | `cards-revealed-log` | one entry per player: name + mini card, or the mini Last Chance card | `--bg-log-cards-revealed`: pale Riviera blue `#e8f3fa → #c9e1ef` |
| `playerCrashed` | `createLogPlayerCrashed(id)` | `crash-log` | bomb icon + "<name> crashes" | `--bg-log-crash`: coral red `#fbe6e3 → #f1c2bc` |
| `grandSlam` | `createLogGrandSlam(id)` | `grand-slam-log` | "<name> plays all 10 cards: Grand Slam!" bold | `--bg-log-grand-slam`: gold `#fff1b8 → #e9c45a` |
| `startTokenPassed` | `createLogStartTokenPassed(id)` | `start-token-log` | mini start token + "<name> receives the Start token" | `--bg-log-start-token`: light stone grey `#f2f0ee → #dcd8d4` |
| `stopOrMoreRevealed` | `createLogStopOrMoreRevealed(choices)` | `stop-or-more-log` | "Stop: A, B · More: C" | `--bg-log-stop-or-more`: soft lavender `#f1ecf8 → #dacfec` |
| `starsBanked` | `createLogStarsBanked(id, stars)` | `stars-banked-log` | "<name> banks N ★" | `--bg-log-stars-banked`: apricot `#fff0e0 → #f6d2a8` |

- Each tint is a pale take on a card color or the coast (sea blue, sand, apricot from orange, lavender from purple, coral from red), so the mini cards stay the most saturated thing in a row. Every gradient stays light enough for the default dark log text (`#27271c`, Fugu's) at well over 4.5:1. Player names keep Fugu's per-color `text-shade` rules.
- **Plain server logs** (framework messages, the Studio debug `message()` and anything not tagged) keep a neutral default: a base rule gives every `.log .roundedbox` / `.gamelogreview` `--bg-log-default` (`#f4f4f2 → #e8e8e4`), and the type classes above override it.
- All row strings go through `_()` on the client. The server fallback text is never shown when the client is running.

---

## Change my mind: checked against the current framework

| Yaxha | Riviera (current framework) | Source |
|---|---|---|
| `#[CheckAction(false)]` on Game.php methods | the same attribute on the state-class method, next to `#[PossibleAction]` | `_ide_helper.php`: `Bga\GameFramework\Actions\CheckAction(bool $enabled)` |
| `checkPossibleAction('act...')` | `$this->game->gamestate->checkPossibleAction(...)`: "does NOT check if the current player is active" | `_ide_helper.php` line 778 |
| `setPlayersMultiactive([$id], '')` | the same, 3rd arg `false` | line 1035 |
| `getCurrentPlayerId()` | the magic `int $currentPlayerId` act parameter | line 1482 |
| states.inc `possibleactions` | `#[PossibleAction]` methods in the state class (Fugu's `PlayerTurn.php`) | Fugu |
| client `checkAction: false` | `bga.actions.performAction(name, {}, { checkAction: false })` + `bga.actions.checkPossibleActions(name)` | `bga-framework.d.ts` lines 401, 429 |
| `zombieTurn` + `$zombieCallerPlayerID` | the state class's `zombie(int $playerId)`, called only for active players, so no revert is needed | Fugu `PlayerTurn::zombie` |
| `$this->not_a_move_notification = true` | **not in `_ide_helper.php`**, so it is left out | grep |
| Yaxha's duplicate revert notif bug | not copied | Yaxha notes |

## Questions / conflicts

1. **New state ids 22 (`RevealCards`) and 55 (`RevealStopOrMore`)** are added to the CLAUDE.md id list (diff below). The alternative, revealing inside the last chooser's action, breaks for zombies and duplicates code.
2. **SPEC milestone scope moves.** Grand Slam and the Fugu-style logs (for M2's own notifications) move from M4 to M2. M4 keeps tooltips, stats, end-game display, zombie refinement, progression and preferences.
3. **Things I can't verify locally** (the first Studio run will tell):
   - (a) `#[CheckAction(false)]` honored on a state-class method;
   - (b) a class state's `getArgs()` `_private` reaching the client as `args._private`.

   If (a) fails, the fallback is a `checkPossibleActions`-free client call plus a state-name guard (the Yaxha pyramid variant).
4. **`ModalBoxHandler`**: M1's plan pencilled it in for M2, but nothing in M2 needs it. It stays deferred until first use.

## Verification
1. `npm run build`: clean. `php -l` on every PHP file touched.
2. In Studio (this becomes the M2 section of `.claude/TESTING.md`). Start a **new** table (the schema changed).
   - Round 1 starts with a "Round 1" log row, a dice-roll log row with mini dice, and dice showing pips.
   - **Valid cards:** `debug_setDice('2,3,5,6')` (with 4 colors). Exactly the cards matching one die (color + value) or a sum of two dice (color of either die) glow; the others are dimmed. Check a few by hand.
   - **Choice:** click a card, and "Play this card" appears. Play it: the card stays set aside, the status says I'm waiting, and "Change my mind" shows. Press it: active again, card back in hand. The other player sees only that I'm active/inactive, never which card.
   - **Reveal:** when the last player confirms, all cards slide at once (mine from the hand, others from their boards), the hand counts drop, ★ totals update, and one reveal log row shows every player's mini card.
   - **No valid card:** `debug_setDice` to values none of my cards match. Only "Use Last Chance" and "Crash" show. Last Chance makes the Last Chance card disappear from my board (also after F5, and as seen by others), and I stay in. Next time without a valid card only "Crash" shows. Crash has no confirm dialog; "Change my mind" undoes it until the last player chooses. Once revealed, my column and hand are discarded, my status becomes Crashed, and a separate crash log row appears.
   - **Log colors:** new round, dice roll, reveal, crash, Grand Slam, Start token, Stop/More and stars banked rows each have their own background, also in replay and on mobile (chatbar). Plain logs are neutral. All text stays readable.
   - **Start token:** slides one board each turn, including turns where everyone crashed.
   - **Stop or More:** both buttons, Change my mind works, nobody sees choices before the reveal, and one log row lists Stop/More. A stopped player is skipped next turn.
   - **Round end:** when nobody is in, each stopper's score rises by their ★ total ("banks N ★"), crashed players get 0, and a new round deals 10 fresh cards with the columns cleared.
   - **40 points:** `debug_setScores(38)`, then stop with ≥ 2 ★: the game ends and the highest score wins. Equal scores share the win.
   - **Grand Slam:** `debug_trimHands(1)` + `debug_setDice` so my last card is valid, then play it. The log reads "<name> plays all 10 cards: Grand Slam!", my score becomes max(100, best other + 1), and the game ends with me first. Two players at once: both get that score and share the win.
   - **F5** in every state (mid-choice with a pending card, mid Stop/More) restores the set-aside card and the Change my mind button.
   - A spectator sees reveals, statuses and scores, and never a hand or a pending choice.
   - Zombie (kick a player in Studio) doesn't block PlayCard or StopOrMore.

At the end of M2: SPEC milestone notes, the TESTING.md section, and CLAUDE.md conventions (the change-mind manager, `_private` args, `$currentPlayerId`, the reveal-state pattern, one log class + `--bg-log-*` variable per log type), with diffs shown.

---

## Doc diffs (applied right after approval)

### .claude/SPEC.md
```diff
@@ Scoring and game end
-- Grand Slam ends the game immediately with a sudden-death win for that player. How to make BGA rank them first (score override, `player_score_aux`, etc.) is to be discussed before implementing.
+- Grand Slam ends the game immediately with a sudden-death win for that player. **[BGA]** Checked after every reveal (and after card 1 bonus plays in M3). The player's score becomes `max(100, highest other player's score + 1)` so BGA ranks them first; players who empty their hands on the same reveal all get that score and share the win. Log: "<name> plays all 10 cards: Grand Slam!".
@@ Turn sequence, step 3
+   - **[BGA]** Choosing is two clicks: select a playable card, then "Play this card". "Crash" has no confirm dialog; Change my mind is the safety net.
@@ Hidden information > Player board display
-- Last Chance card to the right of the card backs (greyed once used).
+- Last Chance card to the right of the card backs; it disappears once used.
@@ BGA states (suggestion, refine with Fugu's patterns)
 - `PlayCard` (multiple active, with change-mind)
+- `RevealCards` (game, 22: applies every play choice, one reveal notification, Grand Slam check)
 - `BonusPlay` (multiple active, card 1 owners, loops while chains continue)
@@
 - `StopOrMore` (multiple active, with change-mind)
+- `RevealStopOrMore` (game, 55: applies Stop choices, one reveal notification, More → RollDice, else EndRound)
 - `EndRound` (game: scoring, check 40)
@@ Milestones
-2. **Core loop**: roll, simultaneous play with valid-card highlighting and change-mind, reveal, Start token passing, simultaneous Stop/More with change-mind, crash, Last Chance, round scoring, 40-point end. Playable without powers.
+2. **Core loop**: roll, simultaneous play with valid-card highlighting and change-mind, reveal, Start token passing, simultaneous Stop/More with change-mind, crash, Last Chance, round scoring, 40-point end, Grand Slam, Fugu-style logs (card and dice icons, one background color per log type) for every M2 notification. Playable without powers.
@@
-4. **Polish**: Fugu-style logs with card icons, tooltips for powers, Grand Slam, statistics, end-game scoring display, zombie mode, game progression, preferences.
+4. **Polish**: Fugu-style logs for the remaining notifications, tooltips for powers, statistics, end-game scoring display, zombie mode, game progression, preferences.
```

### .claude/CLAUDE.md
```diff
@@ Layout (client)
-- **Player boards** (BGA side panels) show the number of cards in hand, visible to everyone including spectators: with 6 cards or fewer, one small card-back div per card, overlapping, like my game Odin; with more than 6, a single card back followed by "x N". The Last Chance card sits to the right of the card backs (greyed once used). Also show round status (in / stopped / crashed) and the Start token.
+- **Player boards** (BGA side panels) show the number of cards in hand, visible to everyone including spectators: with 6 cards or fewer, one small card-back div per card, overlapping, like my game Odin; with more than 6, a single card back followed by "x N". The Last Chance card sits to the right of the card backs and disappears once used. Also show round status (in / stopped / crashed) and the Start token.
@@ Conventions
-- **State ids**: RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, BonusPlay 25, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, EndRound 60, EndScore 98.
+- **State ids**: RoundSetup 5, RollDice 10, ModifyDie 15, PlayCard 20, RevealCards 22, BonusPlay 25, ResolvePowers 30, SwapCards 35, PassStartToken 40, StopOrMore 50, RevealStopOrMore 55, EndRound 60, EndScore 98.
```
