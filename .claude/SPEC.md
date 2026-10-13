# Riviera: game spec for the BGA adaptation

Source: official rulebook (EN). Items marked **[BGA]** are deliberate choices for the BGA version, either where the rules are silent or where we knowingly differ from the physical game.

## Components

- 60 numbered cards: values 1 to 12 in 5 colors (12 per color).
- 6 Last Chance cards (one per player).
- 6 dice: 5 colored dice (one per card color, standard d6) + 1 golden die.
- 1 Start token.

### Colors

Sprite and color index order: **1 red, 2 green, 3 purple, 4 blue, 5 orange**.
Each color has one matching die.

### Sprite

`img/riviera_cards.webp`, a 10-column x 7-row grid of 424x625 frames, row-major, in this order (62 used):
`[red 1..12] [green 1..12] [purple 1..12] [blue 1..12] [orange 1..12] [Last Chance] [card back]`
Frame index for a numbered card = `(colorIndex - 1) * 12 + (value - 1)`. Last Chance = 60, back = 61.
Column = `index % 10`, row = `floor(index / 10)`; `background-size: 1000% 700%`, `background-position: calc(col * 100% / 9) calc(row * 100% / 6)`.

### Stars per card value

Same for every color. Put this table in `material.inc.php`.

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stars | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 5 |

### Powers by value

| Value | Timing | Effect |
|---|---|---|
| 1 | Immediately after playing it | Play one extra card from hand, using the same roll. Must be a valid play. The extra card can trigger its own power (a second 1 chains). **[BGA]** The chain is part of the player's secret choice in step 3: after confirming a 1, they add another valid card or finish, again after each extra 1. Everything is revealed together. Faster on BGA than resolving card 1 after the reveal in turn order. |
| 2 | Before the next roll | On the next roll, the die of this card's color is reserved for you; opponents can't use it (alone or in a sum). **[BGA]** Not optional: reserved automatically after the reveal. The owner can still use it. A reserved die can't be reserved again. If the owner then chooses Stop, the reservation is cancelled when Stop is revealed, with a log row (publisher: a player who stops does not take part in the next turn, so a power meant for that turn does not activate). |
| 10 | Before the next roll | Choose 2 cards from your hand and an opponent still in the round (`round_status` 'in', so never a player who stopped) with at least 2 cards in hand; swap them for 2 random cards from that opponent's hand. The victim is passive. If no such opponent exists: discard and draw from the draw pile. **[BGA]** Only as many as can be drawn (hand size never changes; a confirm explains it when only 1 can be drawn). Reshuffle the discard pile (not the cards being discarded) into a short draw pile. With 0 cards to draw, the power is skipped. An owner with fewer than 2 cards in hand can't use it. |
| 11 | Before the next roll | The golden die is added to the next roll for everyone. It has no color: it can only be used summed with a colored die, and the card must match that colored die's color. Removed at end of that turn. **[BGA]** If another 11 is activated that turn, it stays and is rolled again on the next roll. If the owner then chooses Stop, the golden die is not added, with a log row **[UNCONFIRMED with publisher]**, by analogy with card 2. A second 11 in the same turn is still asked: the golden die stays as long as one player who added it doesn't stop. |
| 9 | After the next roll, before playing | Turn one die of your choice +1 or -1 (6 wraps to 1, 1 wraps to 6). Applies to everyone. A die already modified this turn can't be modified again. The golden die and a reserved die are valid targets. An owner who stopped before that roll can't use it. |

Activating a power is always optional (**[BGA]** except card 2). When several players trigger powers in the same step, resolve them clockwise starting from the Start token holder. Each player has at most one non-1 power per turn (a chain only continues on 1s), so powers resolve player by player.
**[BGA]** Effect lifetime: a card-2 reservation and the golden die apply only to the turn after the power is used, and are cleared after that turn's reveal (unless a new 11 is activated). An owner who chooses Stop right after using card 2 (or card 11, unconfirmed) cancels it.

## Setup

- 2 to 4 players: **[BGA]** remove one random color (its 12 cards and its die) for the whole game. They stay in the DB as `returned_to_box`.
- 5 to 6 players: use all cards and dice.
- Each player gets a Last Chance card (once per game, not per round).
- **[BGA]** The Start token goes to a random player.

### Round setup

- Shuffle all cards in use, deal 10 to each player, rest is the draw pile.
- **[BGA]** The "7+ cards of one color" rule is handled invisibly: the server redeals until every hand has at most 6 cards of any color. No log line, no animation; players never see a hand like that.
- Everyone is "in" the round (not stopped, not crashed).

## Turn sequence

1. **Roll**: roll all colored dice in use (plus golden die if a card 11 was played last turn). Apply card 2 reservations from last turn.
2. **Card 9 powers** (from cards 9 played last turn): each owner, clockwise from Start token holder, may change one die by +/-1 or pass.
3. **Play a card (simultaneous)**: every player still in the round secretly picks one card. Valid plays:
   - a card whose value and color equal one available die, or
   - a card whose value equals the sum of 2 available dice and whose color matches one of those 2 dice (golden die counts in sums but never provides the color).
   Dice reserved by another player are unavailable to you.
   - **[BGA]** The server computes valid cards and only offers those. If none is valid, the only buttons are "Use Last Chance" (when available) and "Crash".
   - **[BGA]** Choosing is two clicks: select a playable card, then "Confirm". "Crash" has no confirm dialog; Change my mind is the safety net.
   - **[BGA]** Card 1 chain: confirming a 1 asks at once for another valid card (same roll) or "Finish", again after each extra 1. If nothing more is playable, the chain finishes on its own. Change my mind rolls back the whole chain.
   - Use Last Chance: play nothing this turn, stay in the round. Last Chance is then used for the rest of the game.
   - Crash: eliminated from the round, all played cards and hand are discarded, 0 points this round.
   - **[BGA]** The chosen card (or Last Chance / Crash) is not final until everyone has chosen: players can change their mind with the same "Change my mind" mechanism as Stop or More (step 8). The chosen card stays visibly set aside in their hand, and pressing "Change my mind" returns it and re-activates them.
   - Once everyone has chosen, all cards are revealed together.
4. **Grand Slam check** **[BGA: once, after the reveal]**: anyone whose hand is now empty (all 10 cards played this round, card-1 chains included) wins instantly; the game ends before any card 2/9/10/11 power.
5. **Pre-roll powers** (cards 2, 10, 11 just played): resolved player by player, clockwise from the Start token holder. Card 2 is automatic, card 11 is add/skip, card 10 needs a choice (own cards and one opponent, or the discard/draw fallback). Card 9 waits for step 2 of the next turn.
6. (merged into step 4)
7. **Pass the Start token** to the next player in turn order, regardless of their round status. Use the framework's player order helpers (`getPlayerAfter()` / `getNextPlayerTable()`, check what Fugu and `_ide_helper.php` provide) rather than reading `player_no` by hand; fall back to `player_no` only if no helper fits.
8. **Stop or More** **[BGA: simultaneous, differs from the rules, confirmed with publisher]**: every player still in the round chooses Stop or More at the same time (multiactive state).
   - Choices stay hidden until everyone has chosen; then all are revealed in one notification.
   - **Players can change their mind until the last player decides** (see "Change my mind" below).
   - Stop: banks the stars of all cards in front of them, out for the rest of the round.
   - More: stays in for the next turn.
   - A user preference for auto-"More" is a later nice-to-have.
9. If at least one player said More, go to step 1. Otherwise the round ends.

Round ends when everyone has stopped or crashed.

### Change my mind (shared mechanism)

Used in `PlayCard` (step 3) and `StopOrMore` (step 8). Build it once and reuse it in both states.

- After choosing, the player becomes inactive but still sees their choice and a "Change my mind" button.
- Pressing it re-activates them (`setPlayersMultiactive([$playerId], '', false)`) and lets them choose again. Their previous choice is cleared on the server.
- This action must be callable by a non-active player: on the client call it with `checkAction: false`, and on the server check the game state yourself instead of relying on the active-player check.
- Starting point: `reference/yaxha-change-mind.md` (built before in Yaxha). Check it against the current framework first: server `#[CheckAction(false)]` attribute, client `bga.actions.performAction(..., { checkAction: false })` and `bga.actions.checkPossibleActions()`.
- Once the last player chooses, the state ends immediately and choices are revealed; there is no going back after that.
- Choices are never sent to other players before the reveal (only "has chosen" / "is choosing").

## Scoring and game end

- At round end, each player who stopped adds their stars to their running score (`player_score`). Crashed players add 0.
- If anyone has 40+ points after a round: highest score wins; ties share the win (equal `player_score`, no tiebreaker).
- Grand Slam ends the game immediately with a sudden-death win for that player. **[BGA]** Checked once, after every reveal (card-1 chains included), before any power. The player's score becomes `max(100, highest other player's score + 1)` so BGA ranks them first; players who empty their hands on the same reveal all get that score and share the win. Log: "<name> plays all 10 cards: Grand Slam!".
- Otherwise start a new round. The Start token keeps passing in turn order.

## Hidden information

- Hands are private. Others only see hand **counts** (card backs on player boards).
- The card each player chooses in step 3 stays hidden until all have chosen (reveal in one notification).
- Stop/More choices stay hidden until all have chosen.
- Card 10: the swapper sees which cards they received; the victim sees what they lost and got. Others only see that 2 cards were swapped. **[BGA]** Everyone gets exactly one swap log row: the owner and victim see the real cards, everyone else (spectators too) sees one card back per card moved.

### Player board display

- Hand count: 6 cards or fewer, one small card back per card; more than 6, one card back followed by "x N". Visible to everyone, spectators included.
- Last Chance card to the right of the card backs; it disappears once used.
- Round status (in / stopped / crashed) and the Start token. The token is a single element that slides from board to board when it passes.

## BGA states (suggestion, refine with Fugu's patterns)

- `RoundSetup` (game)
- `RollDice` (game)
- `ModifyDie` (active player, 15, loops clockwise over card-9 owners still in the round)
- `PlayCard` (multiple active, with change-mind)
- `RevealCards` (game, 22: applies every play choice, one reveal notification, Grand Slam check)
- `ResolvePowers` (active player, 30: card-11 add/skip; card 2 is applied while walking owners, card 10 goes to `SwapCards`)
- `SwapCards` (active player, 35: card 10 swap or discard/draw fallback)
- `PassStartToken` (game)
- `StopOrMore` (multiple active, with change-mind)
- `RevealStopOrMore` (game, 55: applies Stop choices, one reveal notification, More → RollDice, else EndRound)
- `EndRound` (game: scoring, check 40)
- `EndScore`

## Statistics (stats.jsonc)

Per player: rounds played, rounds stopped, crashes, Last Chance used (turn number), stars banked, best round, cards played, powers used per value, grand slam.
Table: rounds, turns.

## Milestones

1. **Skeleton** (done, awaiting Studio test): rename template to Fugu structure, build pipeline working, material (cards, stars, colors), DB, setup + deal (with the silent redeal), `getAllDatas`, client renders my hand, played columns, hand-count card backs on player boards, dice container. Nothing playable yet.
   - Notes:
     - Built: Fugu folder layout and build (`npm run build` clean); `cards` (all 60, removed color in `returned_to_box`) and `dice` tables; `RIVTableManager` with the silent redeal; `RoundSetup` (id 5) then a stub `PlayCard` (id 20, multiactive, no actions) where the game rests.
     - Client: `DiceHandler`, `HandHandler` (my hand, sorted by color then value), `PlayedColumnHandler` (stacked columns with star totals), `PlayerHandler` (hand count, Last Chance, round status), `StartTokenHandler` (slide animation), `LogMutationObserver` core.
     - Debug functions for testing without gameplay: `debug_redeal()`, `debug_playRandomCards($count)`, `debug_passStartToken()`.
     - Differs from the plan: no custom score `ebg.counter` (BGA's default score display is used; scores don't change until M2).
     - Deferred: new-round deal notification, roll, card play (M2); `ModalBoxHandler`, `PrefHandler`, `TooltipHandler`, `EndGameScoringHandler` (when first needed); mobile card spacing (M4).
     - Known limits: dice show blank faces until M2 rolls them; `debug_redeal` and `debug_playRandomCards` need F5 to show their result.
2. **Core loop** (done, tested in Studio): roll, simultaneous play with valid-card highlighting and change-mind, reveal, Start token passing, simultaneous Stop/More with change-mind, crash, Last Chance, round scoring, 40-point end, Grand Slam, Fugu-style logs (card and dice icons, one background color per log type) for every M2 notification. Playable without powers.
   - Notes:
     - Built: states `RollDice` (10), `PlayCard` (20), `RevealCards` (22), `PassStartToken` (40), `StopOrMore` (50), `RevealStopOrMore` (55), `EndRound` (60); `RoundSetup` now notifies `newRound` + a private `newHand`. Pending choices are `player` columns (`play_choice`, `play_choice_card_id`, `stop_or_more_choice`, `made_choice_this_state`); the chosen card stays in `hand` until `RevealCards`.
     - Change my mind: `RIVChangeMindManager` (server) and `ChangeMindHandler.ts` (client), shared by `PlayCard` and `StopOrMore`.
     - Valid cards: `RIVTableManager::getPlayableCardIDs()` already honors `reserved_by_POWER2` and `in_use_by_POWER11`, so M3 only has to set those columns.
     - Client: `Game.animateSlide()` is the one slide animation (cards and Start token). Eight `createLog*` rows, each with its own `--bg-log-*` background.
     - Debug: `debug_setDice('2,3,5,6')`, `debug_setScores(38)`, `debug_trimHands(1)`; `debug_redeal()` now goes through `RoundSetup` notifications.
     - Zombies: random playable card, else Last Chance, else crash; Stop in Stop or More. M4 refines.
     - Verified in Studio: `#[CheckAction(false)]` on a state-class method (Change my mind from an inactive player), and `getArgs()` `_private` reaching the client as `args._private`.
     - Known limits: the Grand Slam board highlight is not restored after F5 (the game is over by then); log rows are formatted on the client, so the server fallback text only shows if the client fails.
3. **Powers** (done, awaiting Studio test): 1, 2, 11, 9, 10, built in one go (plan: `.claude/plans/milestone-3.md`, revision 2).
   - Notes:
     - Built: card-1 chain inside `PlayCard` (extra cards marked with `cards.chain_position_POWER1`, revealed with the first card in `RevealCards`). New active-player states `ModifyDie` (15, card 9), `ResolvePowers` (30, card 11) and `SwapCards` (35, card 10). State 25 (BonusPlay) is gone.
     - `RIVPowerManager`: `RevealCards` expires last turn's reservation and golden die, sets `pending_POWER2/9/10/11` from each player's last revealed card, then `goToNextPreRollPower()` walks owners clockwise from the Start token holder (card 2 applied inline, `changeActivePlayer()` + state for 10 and 11). `RollDice` uses `goToNextPOWER9Owner()` the same way.
     - `RIVChangeMindManager::recordChoice()` is split: `savePendingChoice()` saves without deactivating (chain steps), and `changeMind()` can carry notification args. The private PlayCard notifications carry the next `playableCardIDs`, since a player who stays active gets no new args.
     - Card 10 logs: private `cardsSwapped_POWER10` / `cardsRedrawn_POWER10` rows with the real cards for the players involved, public `...Public_POWER10` rows with card backs. The involved players hide the public row with a second `duplicate-log` tag.
     - Six new log types, each with its own `--bg-log-*`: `die-reserved-power2`, `golden-die-power11`, `die-modified-power9`, `cards-swapped-power10`, `cards-redrawn-power10`, `power-skipped`. The chain shows inside the existing reveal row.
     - Client: `ModifyDie.ts`, `ResolvePowers.ts`, `SwapCards.ts`. `HandHandler` selection is generic (`setSelectableCards(ids, max)`, `selectable-card` class, multi-select for card 10), `DiceHandler` has die selection, `animateSlide()` accepts `to = null` for an element already in place.
     - Also fixed from the M2 catch-up: the play button reads "Confirm", `debug_passStartToken()` has `#[Debug]`.
     - Debug: `debug_POWER1()`, `debug_POWER2()`, `debug_POWER9($resolveNow)`, `debug_POWER10($othersStopped)`, `debug_POWER11()`, `debug_setDrawPile($deckCount, $discardCount)` (leftover cards go to the box for the rest of that table).
     - Zombies skip every power; a zombie that plays a 1 does not chain.
     - Unverified until Studio: re-entering the same active state with a new active player (`ResolvePowers` → `ResolvePowers`, `ModifyDie` → `ModifyDie`, `SwapCards` → `SwapCards`; fallback: a small GAME dispatcher state on a free id such as 32); `#[IntArrayParam]` reading the comma-separated `cardIDs` the client sends.
     - Publisher answers after the build: simultaneous reveal, simultaneous Stop/More, Grand Slam scoring, card 9 on the golden or a reserved die, and stopped players excluded from cards 9 and 10 are confirmed. Changed to match: a Stop cancels the player's card 2 reservation, and (still [UNCONFIRMED with publisher]) the golden die they added (new `player.added_golden_die_POWER11`, `powerCancelled` notification, `power-cancelled-log` row); a second 11 is now asked instead of skipped; card 10 only targets opponents with at least 2 cards, always swaps 2 (no short swap or confirm), and an owner with fewer than 2 cards skips.
4. **Polish**: Fugu-style logs for the remaining notifications, tooltips for powers, statistics, end-game scoring display, zombie mode, game progression, preferences.
