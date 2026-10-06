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
| 1 | Immediately after playing it | Play one extra card from hand, using the same roll. Must be a valid play. The extra card can trigger its own power (a second 1 chains). |
| 2 | Before the next roll | On the next roll, the die of this card's color is reserved for you; opponents can't use it (alone or in a sum). |
| 10 | Before the next roll | Choose 2 cards from your hand and an opponent still in the round; swap them for 2 random cards from that opponent's hand. If no other player is left in the round: discard 2 cards from hand and draw 2 from the draw pile. **Open question:** with 6 players all 60 cards are dealt, so the draw pile is empty; decide the fallback in Milestone 3. |
| 11 | Before the next roll | The golden die is added to the next roll for everyone. It has no color: it can only be used summed with a colored die, and the card must match that colored die's color. Removed at end of that turn. |
| 9 | After the next roll, before playing | Turn one die of your choice +1 or -1 (6 wraps to 1, 1 wraps to 6). Applies to everyone. A die already modified this turn can't be modified again. |

Activating a power is always optional. When several players trigger powers in the same step, resolve them clockwise starting from the Start token holder.

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
   - **[BGA]** Choosing is two clicks: select a playable card, then "Play this card". "Crash" has no confirm dialog; Change my mind is the safety net.
   - Use Last Chance: play nothing this turn, stay in the round. Last Chance is then used for the rest of the game.
   - Crash: eliminated from the round, all played cards and hand are discarded, 0 points this round.
   - **[BGA]** The chosen card (or Last Chance / Crash) is not final until everyone has chosen: players can change their mind with the same "Change my mind" mechanism as Stop or More (step 8). The chosen card stays visibly set aside in their hand, and pressing "Change my mind" returns it and re-activates them.
   - Once everyone has chosen, all cards are revealed together.
4. **Card 1 powers**: players who just played a 1 may play one extra valid card (same dice, same availability). Chains if the extra is a 1. Simultaneous among those players.
5. **Pre-roll powers** (cards 2, 10, 11 just played): resolved clockwise from the Start token holder. Card 2 and 11 need only confirm/skip; card 10 needs a choice (2 own cards, 1 opponent).
6. **Grand Slam check**: anyone whose hand is now empty (all 10 cards played this round) wins instantly; game ends. Check this after steps 4 and 5 too, since card 1 can empty a hand.
7. **Pass the Start token** to the next player in turn order, regardless of their round status. Use the framework's player order helpers (`getPlayerAfter()` / `getNextPlayerTable()`, check what Fugu and `_ide_helper.php` provide) rather than reading `player_no` by hand; fall back to `player_no` only if no helper fits.
8. **Stop or More** **[BGA: simultaneous, differs from the rules]**: every player still in the round chooses Stop or More at the same time (multiactive state).
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
- Grand Slam ends the game immediately with a sudden-death win for that player. **[BGA]** Checked after every reveal (and after card 1 bonus plays in M3). The player's score becomes `max(100, highest other player's score + 1)` so BGA ranks them first; players who empty their hands on the same reveal all get that score and share the win. Log: "<name> plays all 10 cards: Grand Slam!".
- Otherwise start a new round. The Start token keeps passing in turn order.

## Hidden information

- Hands are private. Others only see hand **counts** (card backs on player boards).
- The card each player chooses in step 3 stays hidden until all have chosen (reveal in one notification).
- Stop/More choices stay hidden until all have chosen.
- Card 10: the swapper sees which cards they received; the victim sees what they lost and got. Others only see that 2 cards were swapped.

### Player board display

- Hand count: 6 cards or fewer, one small card back per card; more than 6, one card back followed by "x N". Visible to everyone, spectators included.
- Last Chance card to the right of the card backs; it disappears once used.
- Round status (in / stopped / crashed) and the Start token. The token is a single element that slides from board to board when it passes.

## BGA states (suggestion, refine with Fugu's patterns)

- `RoundSetup` (game)
- `RollDice` (game)
- `ModifyDie` (active player, loops clockwise over card-9 owners)
- `PlayCard` (multiple active, with change-mind)
- `RevealCards` (game, 22: applies every play choice, one reveal notification, Grand Slam check)
- `BonusPlay` (multiple active, card 1 owners, loops while chains continue)
- `ResolvePowers` (game, dispatches to a `SwapCards` active-player state for card 10; 2 and 11 can be a simple confirm/skip in the same active state)
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
2. **Core loop**: roll, simultaneous play with valid-card highlighting and change-mind, reveal, Start token passing, simultaneous Stop/More with change-mind, crash, Last Chance, round scoring, 40-point end, Grand Slam, Fugu-style logs (card and dice icons, one background color per log type) for every M2 notification. Playable without powers.
3. **Powers**: 1, 2, 11, 9, 10 in that order.
4. **Polish**: Fugu-style logs for the remaining notifications, tooltips for powers, statistics, end-game scoring display, zombie mode, game progression, preferences.
