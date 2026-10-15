# Riviera: game spec for the BGA adaptation

Source: official rulebook (EN). Items marked **[BGA]** are deliberate choices for the BGA version, either where the rules are silent or where we knowingly differ from the physical game.

## Glossary

- **Round**: from the deal of 10 cards each until every player is stopped or crashed (`roundNumber`, `RoundSetup` → `EndRound`). The game is several rounds.
- **Turn**: one pass through the turn sequence: roll, card 9, play, reveal, Stop or More, Start token pass, cards 2/10/11. One turn = one dice roll (the `turns` table stat).
- **Roll**: rolling every die in play at the start of a turn (`RollDice`).
- **Die in play**: a colored die of a color in use (`die_location = 'in_play'`), plus the golden die when added. **Colors in use**: the colors whose die is in play (4 colors at 2 to 4 players, 5 at 5 to 6).
- **Returned to the box**: the color removed at 2 to 4 players, its 12 cards (`card_location`) and its die (`die_location`) `returned_to_box` for the whole game.
- **Hand**: a player's secret cards (`card_location = 'hand'`). Others only see the hand count.
- **Playable card**: a card in hand that is a valid play on the current dice (`getPlayableCardIDs()`): same value and color as one available die, or value equal to the sum of 2 available dice and color of one of them. An **available die** is one not reserved by another player.
- **Play choice**: what a player still in picks in `PlayCard`: a card (`card`), Last Chance (`last_chance`) or Crash (`crash`). Pending until the reveal.
- **Pending choice**: a play choice or Stop/More choice saved in `player` columns but not applied yet; only the reveal applies it.
- **Set aside**: the look of chosen cards (first card and chain) raised in the hand until the reveal or Undo.
- **Undo**: taking back your pending choice and choosing again, until the last player has chosen (`RIVUndoManager`, `UndoHandler`).
- **Reveal**: the GAME state that applies every pending choice at once and sends one notification: the card reveal (`RevealCards`) and the Stop/More reveal (`RevealStopOrMore`). "The reveal" alone means the card reveal.
- **Column**: a player's played cards this round (`card_location = 'played'`, ordered by `location_in_column`), stacked so only the top strip with stars shows. Its stars are the **column stars**.
- **Round status**: `in` (still playing this round), `stopped` (chose Stop, stars banked, out until the next round) or `crashed` (out with 0 points this round, column and hand discarded). **Out of the round** = stopped or crashed.
- **Stop or More**: the simultaneous choice every player still in makes after the reveal. **Stop** (also **bank**: "Stop and bank N ★") ends your round and adds your column stars to your score at the Stop/More reveal (the `starsBanked` notification). **More** keeps you in for the next turn.
- **Crash**: the play choice offered only when no card is playable: out of the round with 0 points, column and hand discarded.
- **Last Chance**: each player's one card per game: play nothing this turn and stay in (`last_chance_used`). It sits on the player board until used.
- **Power**: the effect of a card of value 1, 2, 9, 10 or 11, named by that value (`POWER2` suffix). **Power owner**: the player whose revealed card has it.
- **Chain** (card 1): the extra cards a player adds after confirming a 1, inside their play choice, each on the same roll (`chain_position_POWER1`). Revealed with the first card. Only the last card of a chain can leave a non-1 power.
- **Pending power**: a card 2, 9, 10 or 11 power marked after the reveal (`pending_POWER2/9/10/11`) and not resolved yet. **Pre-roll powers**: 2, 10 and 11, resolved after the Start token pass for owners who chose More. Card 9 resolves after the next roll.
- **Resolve**: a pending power taking effect, used or skipped by its owner (`powerUsed_POWER*` stats count uses).
- **Reserved die** (card 2): the die of the card's color, kept for its owner on the next roll (`reserved_by_POWER2`); other players can't use it, alone or in a sum.
- **Golden die** (card 11): an extra colorless die added to the next roll (`in_use_by_POWER11`); it only counts in a sum with a colored die, which gives the color.
- **Modified die** (card 9): a die turned +1 or -1 this roll (`modified_by_POWER9`); it can't be turned again this roll.
- **Swap / redraw** (card 10): swapping 2 own cards for 2 random cards of an opponent who chose More, or, with no such opponent, the fallback of discarding and drawing from the **draw pile** (`deck`, refilled from the **discard pile**, `discard`).
- **Start token holder**: the player with the Start token (`startPlayerId`). Reveal rows, banking order and every power resolve clockwise from them. **Start token pass**: the token moving to the next player still in, once per turn after Stop or More.
- **Grand Slam**: a player's hand empty after a reveal (all 10 cards played this round); they win at once and the game ends.
- **Round score**: what a round gave each player, one `round_scores` row: `stopped` (stars banked), `crashed`, `grand_slam` or `unfinished` (still in when a Grand Slam ended the round). Shown in the end-game table.
- **Score**: a player's total banked stars over the game; 40 or more at the end of a round ends the game.

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

`img/card_icon_numbers.webp` (912x63) draws the number inside the status bar card icon (a ring in the card's color): 12 equal 76x63 frames, numbers 1 to 12 left to right, all on the same baseline. Frame for value `v` = `v - 1`; `background-size: 1200% 100%`, `background-position: calc((v - 1) * 100% / 11) 0%`. Log rows show cards as mini cards, not this icon.

`img/power_icons_sprite.webp` (380x63, transparent) holds the 5 power icons left to right: cards 1, 2, 9, 10, 11. Unequal boxes, measured: card 1 x 16 w 44, card 2 x 82 w 63, card 9 x 158 w 63, card 10 x 228 y 7 w 76 h 48, card 11 x 310 w 63 (the others are the full 63px tall).

### Stars per card value

Same for every color. Put this table in `material.inc.php`.

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stars | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 5 |

### Powers by value

| Value | Timing | Effect |
|---|---|---|
| 1 | Immediately after playing it | Play one extra card from hand, using the same roll. Must be a valid play. The extra card can trigger its own power (a second 1 chains). **[BGA]** The chain is part of the player's secret choice in step 3: after confirming a 1, they add another valid card or finish, again after each extra 1. Everything is revealed together. Faster on BGA than resolving card 1 after the reveal in turn order. |
| 2 | After Stop or More, before the next roll (only if the owner chose More) | **[BGA]** Automatic, no button. Reserves the die of this card's color for its owner on the next roll; opponents can't use it, alone or in a sum. The owner can still use it. A reserved die can't be reserved again. Cleared after that turn's reveal. |
| 10 | After Stop or More, before the next roll (only if the owner chose More) | Choose 2 cards from your hand and an opponent who chose More (`round_status` 'in' once the Stops are applied) with at least 2 cards in hand; swap them for 2 random cards from that opponent's hand. The victim is passive. If no such opponent exists: discard and draw from the draw pile. **[BGA]** Only as many as can be drawn (hand size never changes; a confirm explains it when only 1 can be drawn). Reshuffle the discard pile (not the cards being discarded) into a short draw pile. With 0 cards to draw, the power is skipped. An owner with fewer than 2 cards in hand can't use it. |
| 11 | After Stop or More, before the next roll (only if the owner chose More) | Optional. Adds the golden die to the next roll for everyone. It has no color: it only counts in a sum with a colored die, and the card must match that colored die's color. Cleared after that turn's reveal, unless a new 11 is added (then it stays and is rolled again). **[BGA]** A second 11 in the same turn, when the golden die is already added, is skipped without a prompt or log row. |
| 9 | After the next roll, before playing | Turn one die of your choice +1 or -1 (6 wraps to 1, 1 wraps to 6). Applies to everyone. A die already modified this roll can't be modified again. The golden die and a reserved die are valid targets. Only if the owner is still in the round (an owner who stopped loses it). **[BGA]** If every die has already been turned this roll, a later owner is skipped without a prompt or log row. |

Activating a power is always optional (**[BGA]** except card 2). When several players trigger powers in the same step, resolve them clockwise starting from the Start token holder (the player who received it at step 6 of that turn, after Stop or More). Each player has at most one non-1 power per turn (a chain only continues on 1s), so powers resolve player by player.
**[BGA, confirmed with publisher]** A player who stops doesn't benefit from their powers: cards 2, 10 and 11 resolve after Stop or More (turn step 7), only for owners who chose More. Owners who stopped lose them silently (no prompt, no log row). Card 9 needs its owner still in the round at the next roll. This differs from the rulebook, which resolves cards 2, 10 and 11 before Stop or More.
**[BGA]** Effect lifetime: a card-2 reservation and the golden die apply to the next roll's turn only, and are cleared after that turn's reveal (the golden die stays, and is rolled again, only if a new 11 adds it). Only the last card a player revealed can leave a non-1 power (the end of a card-1 chain). A Grand Slam ends the game before any power. A new round clears every pending power, reservation and golden die.

## Setup

- 2 to 4 players: **[BGA]** remove one random color (its 12 cards and its die) for the whole game. They stay in the DB as `returned_to_box`.
- 5 to 6 players: use all cards and dice.
- Each player gets a Last Chance card (once per game, not per round).
- **[BGA]** The Start token goes to a random player.

### Round setup

- Shuffle all cards in use, deal 10 to each player, rest is the draw pile.
- **[BGA]** The "7+ cards of one color" rule is handled invisibly: the server redeals until every hand has at most 6 cards of any color. No log line, no animation; players never see a hand like that.
- Everyone is "in" the round (not stopped, not crashed).
- **[BGA]** Client: once the previous round's columns are cleared, the cards left in my hand sweep out to the left while my new hand is dealt card by card (right to left, each card flying in along the same path from off the page, above it and to the left); the dice roll once the last card has landed. Last round's dice values stay shown until that roll. No sweep or deal on F5 or for spectators.

## Turn sequence

1. **Roll**: roll all colored dice in use, plus the golden die if a card 11 added it last turn. A card 2 reservation set last turn applies to this roll.
2. **Card 9 powers** (from cards 9 played last turn): owners still in the round, clockwise from the Start token holder, each may change one die by +/-1 or pass. **[BGA]** The active owner clicks an up (+1) or down (-1) arrow on a die that can still be turned (each arrow's click area reaches over its half of the die), then "Confirm" ("Turn [die] 4 → 5?"); another click switches or clears the choice, "Skip" passes. While a choice is selected, that die shows the value it would become, with a soft glow, for the owner only (no one else sees the preview); the status bar icon keeps the real value. With "One-click card play" on, the click turns the die at once.
3. **Play a card (simultaneous)**: every player still in the round secretly picks one card. Valid plays:
   - a card whose value and color equal one available die, or
   - a card whose value equals the sum of 2 available dice and whose color matches one of those 2 dice (golden die counts in sums but never provides the color).
   Dice reserved by another player are unavailable to you.
   - **[BGA]** The server computes valid cards and only offers those. If none is valid, the only buttons are "Use Last Chance" (when available) and "Crash".
   - **[BGA]** Choosing is two clicks: select a playable card, then "Confirm" (one click with the "One-click card play" preference, see Preferences). "Crash" has no confirm dialog; Undo is the safety net.
   - **[BGA]** Card 1 chain: confirming a 1 asks at once for another valid card (same roll) or "Skip", again after each extra 1. If nothing more is playable, the chain finishes on its own. Undo rolls back the whole chain.
   - Use Last Chance: play nothing this turn, stay in the round. Last Chance is then used for the rest of the game.
   - Crash: eliminated from the round, all played cards and hand are discarded, 0 points this round.
   - **[BGA]** The chosen card (or Last Chance / Crash) is not final until everyone has chosen: players can change their mind with the same "Undo" mechanism as Stop or More (step 5). The chosen card stays visibly set aside in their hand, and pressing "Undo" returns it and re-activates them.
   - Once everyone has chosen, all cards are revealed together.
4. **Reveal and Grand Slam check**: all chosen cards are revealed together. **[BGA: once, after the reveal]** Anyone whose hand is now empty (all 10 cards played this round, card-1 chains included) wins instantly; the game ends with no power. Otherwise last turn's card 2 reservation and golden die are cleared.
5. **Stop or More** **[BGA: simultaneous, differs from the rules, confirmed with publisher]**: every player still in the round chooses Stop or More at the same time (multiactive state).
   - Choices stay hidden until everyone has chosen; then all are revealed in one notification.
   - **Players can change their mind until the last player decides** (see "Undo" below).
   - Stop: banks the stars of all cards in front of them, out for the rest of the round. **[BGA]** The stars go into their score as soon as the Stop is revealed (score counter on the player boards updated at once, one "banks N ★" log row per stopper, clockwise from the Start token holder): a stopped column can't change, so they are final. The 40-point end check still waits for the end of the round.
   - More: stays in for the next turn.
   - **[BGA]** No auto-"More" preference: BGA forbids sending actions programmatically.
6. **Pass the Start token** to the next player clockwise, **[BGA, confirmed with publisher]** once everyone's Stop or More is revealed (after the stoppers' "banks N ★" rows), not right after the card reveal. It passes once every turn: if everyone crashed on the reveal (no Stop or More), it passes right after the reveal; if nobody chose More, it still passes before the round ends. **[BGA]** Players out of the round (stopped or crashed, this turn's stoppers included) are skipped: it goes to the next player clockwise who is still in (the rulebook just says "the next player clockwise"). If the holder is the only one still in, they keep it. If nobody is still in, it goes to the next player in turn order. Use the framework's player order helpers (`getPlayerAfter()` / `getNextPlayerTable()`, check what Fugu and `_ide_helper.php` provide) rather than reading `player_no` by hand; fall back to `player_no` only if no helper fits.
7. **Powers of cards 2, 10 and 11** played this turn **[BGA, confirmed with publisher: differs from the rulebook, which resolves them before Stop or More]**: only for owners who chose More, player by player, clockwise from the Start token holder (the new holder, after step 6). Card 2 is automatic, card 11 is add/skip, card 10 needs a choice (own cards and one opponent who chose More, or the discard/draw fallback). Owners who stopped lose these powers. Card 9 waits for step 2 of the next turn.
8. If at least one player chose More, go to step 1. Otherwise the round ends.

Round ends when everyone has stopped or crashed.

### Undo (shared mechanism)

Used in `PlayCard` (step 3) and `StopOrMore` (step 5). Build it once and reuse it in both states.

- After choosing, the player becomes inactive but still sees their choice and an "Undo" button.
- Pressing it re-activates them (`setPlayersMultiactive([$playerId], '', false)`) and lets them choose again. Their previous choice is cleared on the server.
- This action must be callable by a non-active player: on the client call it with `checkAction: false`, and on the server check the game state yourself instead of relying on the active-player check.
- Starting point: `reference/yaxha-change-mind.md` (built before in Yaxha). Check it against the current framework first: server `#[CheckAction(false)]` attribute, client `bga.actions.performAction(..., { checkAction: false })` and `bga.actions.checkPossibleActions()`.
- Once the last player chooses, the state ends immediately and choices are revealed; there is no going back after that.
- Choices are never sent to other players before the reveal (only "has chosen" / "is choosing").

## Scoring and game end

- Each player who stops adds their stars to their running score (`player_score`) **[BGA]** when their Stop is revealed (turn step 5), not at the end of the round: the total is the same, players just see it sooner. Crashed players add 0.
- If anyone has 40+ points at the end of a round: highest score wins; ties share the win (equal `player_score`, no tiebreaker). **[BGA]** Reaching 40 by stopping mid-round doesn't end the game until the round ends.
- Grand Slam ends the game immediately with a sudden-death win for that player. **[BGA]** Checked once, after every reveal (card-1 chains included), before any power. The player's score becomes `max(100, highest other player's score + 1)` so BGA ranks them first; players who empty their hands on the same reveal all get that score and share the win. Players who stopped earlier in that round keep the stars they banked. Log: "<name> plays all 10 cards: Grand Slam!".
- Otherwise start a new round. The Start token stays where it is (everyone is in again) and keeps passing from there.
- **[BGA]** End-game display (Fugu-style table, fading in cell by cell, winners jumping): one row per round with the stars each player banked (a bomb for a crash, a gold cell for a Grand Slam, "-" for a player still in when a Grand Slam cut the round short; a player who had already stopped shows the stars they banked), then a Total row equal to `player_score`. Stored in a `round_scores` table, each row written the moment the player's round result is final: at the Stop reveal (`stopped`), at the reveal (`crashed`), or at the Grand Slam (`grand_slam`, `unfinished`). A game-end log row names the winner(s).
- **[BGA]** Game progression: the highest `player_score` plus column stars of players still in the round (a stopper's stars are already in their score), out of 40, capped at 99 until the game ends.

## Zombie mode [BGA]

Level 1 (report it in the Game Metadata Manager):
- Card play: the playable card with the most stars (ties at random); a 1 chains greedily. No playable card: Last Chance if available, else crash.
- Stop or More: always Stop, so a zombie's cards 2, 9, 10 and 11 never resolve. The power choices below only apply to a player who leaves while they are the active power owner.
- Card 9: random among skip and every modifiable die turned -1 or +1.
- Card 11: random add or skip.
- Card 10: random among skip and every target (2 random own cards); in the redraw fallback, random redraw or skip.

## Power reference [BGA]

Hovering any card in the game area (my hand, every played column), power card or not, shows one power reference laid out like the rulebook's powers page: teal background, dark text, bold timing headings, each power's icon floated left with "Card N:" in bold. Two columns on desktop (left: card 1, then cards 2 and 10; right: card 11, then card 9), one column on narrow screens, about 640px wide at most. The hovered card's power, if any, is highlighted. The text follows our BGA rules, not the rulebook's wording:
- Immediately after playing the card: card 1.
- Before the next dice roll, only if you choose More: card 2 (automatic), card 10 (an opponent who chose More with at least 2 cards, otherwise discard and draw), card 11.
- After the next dice roll and before playing a card: card 9 (the golden or a reserved die can be turned, only if you are still in the round).

Entries are separated by spacing only: no borders or boxes, except the hovered card's power, which gets a box (soft lighter background, rounded corners, thin border) so it stands out at a glance. Hovering a card with no power highlights nothing. A thin vertical line separates the two columns (none when they stack).

Log mini cards keep a single-power tooltip. Safari on a phone shows the same reference at the bottom of the page instead of tooltips.

## Preferences [BGA]

- "One-click card play" (off by default): clicking a playable card plays it at once, with no Confirm step, card-1 chain cards included. It also skips the card 9 Confirm: clicking a die's arrow (or half) turns it at once.

## Hidden information

- Hands are private. Others only see hand **counts** (card backs on player boards).
- The card each player chooses in step 3 stays hidden until all have chosen (reveal in one notification).
- Stop/More choices stay hidden until all have chosen.
- Card 10: the swapper sees which cards they received; the victim sees what they lost and got. Others only see that 2 cards were swapped. **[BGA]** Everyone gets exactly one swap log row: the owner and victim see the real cards, everyone else (spectators too) sees one card back per card moved.

### Player board display

- Hand count: 6 cards or fewer, one small card back per card; more than 6, one card back followed by "x N". Visible to everyone, spectators included.
- Last Chance card to the right of the card backs; it disappears once used.
- Round status (in / stopped / crashed) and the Start token. The token is a single element on the top-left corner of its owner's board, over the board content and taking no layout space. When it passes it lifts out of the boards area (to the side of the boards column on desktop, down to 40% of the screen on mobile), growing to 200%, holds still for a moment at the peak, then curves into the new owner's corner, shrinking back. No flight on F5.

## BGA states (suggestion, refine with Fugu's patterns)

- `RoundSetup` (game)
- `RollDice` (game)
- `ModifyDie` (active player, 15, loops clockwise over card-9 owners still in the round)
- `PlayCard` (multiple active, with Undo)
- `RevealCards` (game, 22: applies every play choice, one reveal notification, Grand Slam check, clears last turn's dice effects → `StopOrMore`)
- `ResolvePowers` (active player, 30: card-11 add/skip, a second 11 is skipped when the golden die is already added; card 2 is applied while walking owners, card 10 goes to `SwapCards`)
- `SwapCards` (active player, 35: card 10 swap or discard/draw fallback)
- `StopOrMore` (multiple active, with Undo; everyone crashed → `PassStartToken`)
- `RevealStopOrMore` (game, 55: applies Stop choices, one reveal notification, then banks each stopper's stars → `PassStartToken`)
- `PassStartToken` (game, 40: passes the token; if anyone chose More, walks their card 2/10/11 powers clockwise from the new holder, then `RollDice`; else `EndRound`)
- `EndRound` (game: 40-point check only; stars are banked at the Stop reveal)
- `EndScore`

## Statistics (stats.jsonc)

Per player: rounds played, rounds stopped, crashes, Last Chance used (bool) and the round it was used in (set only when used, so unused games don't skew the average), stars banked, best round, cards played (chain cards included), powers used per value, counted when they resolve (1: extra cards added; 2, 9, 11: uses; 10: cards swapped or redrawn), grand slam (bool).
Table: rounds, turns (dice rolls).
Full list with ids: `.claude/plans/milestone-4.md`.

## Milestones

1. **Skeleton** (done, awaiting Studio test): rename template to Fugu structure, build pipeline working, material (cards, stars, colors), DB, setup + deal (with the silent redeal), `getAllDatas`, client renders my hand, played columns, hand-count card backs on player boards, dice container. Nothing playable yet.
   - Notes:
     - Built: Fugu folder layout and build (`npm run build` clean); `cards` (all 60, removed color in `returned_to_box`) and `dice` tables; `RIVTableManager` with the silent redeal; `RoundSetup` (id 5) then a stub `PlayCard` (id 20, multiactive, no actions) where the game rests.
     - Client: `DiceHandler`, `HandHandler` (my hand, sorted by color then value), `PlayedColumnHandler` (stacked columns with star totals), `PlayerHandler` (hand count, Last Chance, round status), `StartTokenHandler` (slide animation), `LogMutationObserver` core.
     - Debug functions for testing without gameplay: `debug_redeal()`, `debug_playRandomCards($count)`, `debug_passStartToken()`.
     - Differs from the plan: no custom score `ebg.counter` (BGA's default score display is used; scores don't change until M2).
     - Deferred: new-round deal notification, roll, card play (M2); `ModalBoxHandler`, `PrefHandler`, `TooltipHandler`, `EndGameScoringHandler` (when first needed); mobile card spacing (M4).
     - Known limits: dice show blank faces until M2 rolls them; `debug_redeal` and `debug_playRandomCards` need F5 to show their result.
2. **Core loop** (done, tested in Studio): roll, simultaneous play with valid-card highlighting and Undo, reveal, Start token passing, simultaneous Stop/More with Undo, crash, Last Chance, round scoring, 40-point end, Grand Slam, Fugu-style logs (card and dice icons, one background color per log type) for every M2 notification. Playable without powers.
   - Notes:
     - Built: states `RollDice` (10), `PlayCard` (20), `RevealCards` (22), `PassStartToken` (40), `StopOrMore` (50), `RevealStopOrMore` (55), `EndRound` (60); `RoundSetup` now notifies `newRound` + a private `newHand`. Pending choices are `player` columns (`play_choice`, `play_choice_card_id`, `stop_or_more_choice`, `made_choice_this_state`); the chosen card stays in `hand` until `RevealCards`.
     - Undo: `RIVUndoManager` (server) and `UndoHandler.ts` (client), shared by `PlayCard` and `StopOrMore`.
     - Valid cards: `RIVTableManager::getPlayableCardIDs()` already honors `reserved_by_POWER2` and `in_use_by_POWER11`, so M3 only has to set those columns.
     - Client: `Game.animateSlide()` is the one slide animation (cards and Start token). Eight `createLog*` rows, each with its own `--bg-log-*` background.
     - Debug: `debug_setDice('2,3,5,6')`, `debug_setScores(38)`, `debug_trimHands(1)`; `debug_redeal()` now goes through `RoundSetup` notifications.
     - Zombies: random playable card, else Last Chance, else crash; Stop in Stop or More. M4 refines.
     - Verified in Studio: `#[CheckAction(false)]` on a state-class method (Undo from an inactive player), and `getArgs()` `_private` reaching the client as `args._private`.
     - Known limits: the Grand Slam board highlight is not restored after F5 (the game is over by then); log rows are formatted on the client, so the server fallback text only shows if the client fails.
3. **Powers** (done, awaiting Studio test): 1, 2, 11, 9, 10, built in one go (plan: `.claude/plans/milestone-3.md`, revision 2).
   - Notes:
     - Built: card-1 chain inside `PlayCard` (extra cards marked with `cards.chain_position_POWER1`, revealed with the first card in `RevealCards`). New active-player states `ModifyDie` (15, card 9), `ResolvePowers` (30, card 11) and `SwapCards` (35, card 10). State 25 (BonusPlay) is gone.
     - `RIVPowerManager`: `RevealCards` expires last turn's reservation and golden die, sets `pending_POWER2/9/10/11` from each player's last revealed card, then `goToNextPreRollPower()` walks owners clockwise from the Start token holder (card 2 applied inline, `changeActivePlayer()` + state for 10 and 11). `RollDice` uses `goToNextPOWER9Owner()` the same way.
     - `RIVUndoManager::recordChoice()` is split: `savePendingChoice()` saves without deactivating (chain steps), and `undo()` can carry notification args. The private PlayCard notifications carry the next `playableCardIDs`, since a player who stays active gets no new args.
     - Card 10 logs: private `cardsSwapped_POWER10` / `cardsRedrawn_POWER10` rows with the real cards for the players involved, public `...Public_POWER10` rows with card backs. The involved players hide the public row with a second `duplicate-log` tag.
     - Six new log types, each with its own `--bg-log-*`: `die-reserved-power2`, `golden-die-power11`, `die-modified-power9`, `cards-swapped-power10`, `cards-redrawn-power10`, `power-skipped`. The chain shows inside the existing reveal row.
     - Client: `ModifyDie.ts`, `ResolvePowers.ts`, `SwapCards.ts`. `HandHandler` selection is generic (`setSelectableCards(ids, max)`, `selectable-card` class, multi-select for card 10), `DiceHandler` has die selection, `animateSlide()` accepts `to = null` for an element already in place.
     - Also fixed from the M2 catch-up: the play button reads "Confirm", `debug_passStartToken()` has `#[Debug]`.
     - Debug: `debug_POWER1()`, `debug_POWER2()`, `debug_POWER9($resolveNow)`, `debug_POWER10($othersStopped)`, `debug_POWER11()`, `debug_setDrawPile($deckCount, $discardCount)` (leftover cards go to the box for the rest of that table).
     - Zombies skip every power; a zombie that plays a 1 does not chain.
     - Unverified until Studio: re-entering the same active state with a new active player (`ResolvePowers` → `ResolvePowers`, `ModifyDie` → `ModifyDie`, `SwapCards` → `SwapCards`; fallback: a small GAME dispatcher state on a free id such as 32); `#[IntArrayParam]` reading the comma-separated `cardIDs` the client sends.
     - Publisher answers after the build: simultaneous reveal, simultaneous Stop/More, Grand Slam scoring, card 9 on the golden or a reserved die, and stopped players excluded from cards 9 and 10 are confirmed. Changed to match: a Stop cancelled the player's card 2 reservation and the golden die they added (`player.added_golden_die_POWER11`, `powerCancelled` notification, `power-cancelled-log` row), and a second 11 was asked instead of skipped (both superseded by the power timing settled after M4, see M4 notes); card 10 only targets opponents with at least 2 cards, always swaps 2 (no short swap or confirm), and an owner with fewer than 2 cards skips.
4. **Polish** (done, awaiting Studio test; plan: `.claude/plans/milestone-4.md`): Fugu-style logs for the remaining notifications, tooltips for powers, statistics, end-game scoring display, zombie mode, game progression, preferences, alpha checklist items. `estimated_duration` becomes 20 (box), `bgg_id` 478651 confirmed, no CSS class prefix (like Fugu). Designer, artist and images go in the Studio Game Metadata Manager.
   - Notes:
     - Built: `stats.jsonc` (2 table, 14 player stats, initialized in `setupNewGame` except `lastChanceRound`) and the stat calls in every state that changes them; `round_scores` table, written by `EndRound` and `applyGrandSlam()`; `EndScore` sends `displayEndGameScoring` with a new `game-end-log` row; `getAllDatas` gains `pref_names`, `grandSlamPlayerIds` and `endGameScoring` (at game end).
     - Client: `TooltipHandler` (power cards by `power-card-POWER<n>` class, Last Chance, Start token, hand backs, round status, column stars, one tooltip per die kept in sync by `DiceHandler.updateDice`; Safari mobile gets the power reference at the bottom of the page, like Fugu), `EndGameScoringHandler` (Fugu's table: one row per round, then Total), `PrefHandler` ("One-click card play", pref 101), `HandHandler.recomputeCardSpacing()` (bigger overlap when 10 cards don't fit on one row).
     - Zombies are level 1: greedy card play with greedy card-1 chains in one `zombie()` call, Stop, random choices for cards 9, 10 and 11. This replaces M3's "zombies skip every power".
     - Progression: highest banked score plus column stars of players not crashed, out of 40, capped at 99; recomputed in `RoundSetup` and `RevealCards` (no longer in `EndRound`).
     - Alpha items: copyright header on every PHP and TS file, `console.log` removed, log text color forced dark for BGA's dark mode, `estimated_duration` 20. The Grand Slam glow now survives F5 (M2 known limit fixed).
     - Differs from the plan: `clickOrTap()` is not ported (the fast-forward hint is two whole translatable strings, since Fugu's `_()` of a built string can't be translated); the card-9 zombie builds its choices in `ModifyDie` (no shared helper, it is the only user); log rows get their card tooltips through `LogMutationObserver` (`addTooltipsToCardsIn`) instead of whole-page passes.
     - Unverified until Studio: `playerStats->set` on the never-initialized `lastChanceRound` (fallback: init it to 0); `getBestZombieChoice` (fallback: pick the max with `bga_rand` tie-breaks); BGA's dark mode selectors (only the log text color is forced).
     - After M4: game-area cards show the power reference (see Power reference) instead of a per-card power tooltip; log mini cards keep the per-card one. Icons from `img/power_icons_sprite.webp`.
     - Power timing settled with Helvetiq (2026-10-14): cards 2, 10 and 11 resolve after Stop or More, only for owners who chose More, clockwise from the new Start token holder (`RevealStopOrMore` starts the walk, `RevealCards` goes straight to `PassStartToken`). This replaces M3's cancel-on-Stop: `added_golden_die_POWER11`, the `powerCancelled` notification, the `power-cancelled-log` row and the stat decrements are gone. A second 11 in the same turn is skipped silently.
     - Banking at the Stop reveal (2026-10-14): `RevealStopOrMore` banks each stopper's stars at once (score, `starsBanked` row, `round_scores` `stopped` row, `starsBanked` / `bestRound` stats); `RevealCards` writes the `crashed` row; `EndRound` only does the 40-point check. A Grand Slam no longer turns an earlier stopper's round into "unfinished", and progression counts column stars only for players still in.
     - Mobile layout like Fugu (2026-10-14): `.mobile_version` cards at `min(28.5vw, 150px)` and dice at `min(13.3vw, 55px)` (they were `min(9vw, 90px)` / `min(7vw, 34px)`, tiny once BGA scales the 740px layout down to a phone); my hand stays one horizontal line (no zig-zag), overlapping more so it spans the hand's width with Fugu's %-margin spacing (`applyMobileCardSpacing`); columns wrap. `Game.animateSlide()` now scales the flying copy from the source's on-screen size to the destination's and positions it with a transform measured on screen, so a card lands at the column size with no jump (it used to fly at the unscaled size, outside BGA's scaling). Desktop sizes unchanged.
     - Card 9 arrows (2026-10-14): the "select a die, then Turn to N" flow is replaced by an up (+1) and down (-1) arrow on each die that can still be turned, for the active owner only; an arrow (its click area covers the triangle, the gap and its half of the die) selects the choice and previews it on that die (local only), "Confirm" sends it (or the click itself with "One-click card play"), the title shows the result ("6 → 1"), "Skip" stays. `#dice-container` always reserves the arrows' space, so the dice never move.
     - Start token skips players out of the round (2026-10-15): `RIVTableManager::passStartToken()` gives it to the next player clockwise still `in`; the holder keeps it (no notification) when they are the only one in; with nobody in it goes to the next player in turn order, as before.
     - Start token passes after Stop or More (2026-10-15, confirmed with publisher): `RevealCards` → `StopOrMore` → `RevealStopOrMore` → `PassStartToken`, which now starts the card 2/10/11 walk (or goes to `EndRound`). With everyone crashed, `StopOrMore` goes straight to `PassStartToken`. This turn's stoppers are already out when it passes, so they are skipped. Animation and log row unchanged.
     - Not code, yours: the Game Metadata Manager (designer Valentin Demion, artist Simon Caruso, year, presentation text, zombie level 1, banner, icon, display images, a transparent box image).
