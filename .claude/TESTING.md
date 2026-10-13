# Riviera: BGA Studio test checklists

One section per milestone, written when the milestone ends. Tick items as you test; note failures inline.

## Milestone 1: Skeleton

Deploy: `img/`, `modules/`, `riviera.css`, `dbmodel.sql`, `*.jsonc` (SFTP uploads them on save; `src/`, `.claude/`, `node_modules/` are ignored). The schema changed, so start a **new** table each time.

Setup and DB (Studio DB view, or the SQL in each item):
- [ ] Games start with 2, 4, 5 and 6 players without errors.
- [ ] `SELECT card_location, COUNT(*) FROM cards GROUP BY 1`: 60 cards in total. With 2 to 4 players, 12 are `returned_to_box`; with 5 to 6, none.
- [ ] `SELECT * FROM dice`: with 2 to 4 players, exactly one colored die has `die_location = 'returned_to_box'`, and it's the same color as the removed cards. `gold` has `in_use_by_POWER11 = 'no'`.
- [ ] `SELECT card_location_arg, COUNT(*) FROM cards WHERE card_location='hand' GROUP BY 1`: 10 cards per player.
- [ ] `SELECT card_location_arg, color, COUNT(*) c FROM cards WHERE card_location='hand' GROUP BY 1,2 HAVING c > 6` returns no rows.
- [ ] In the browser console, `gameui.gamedatas` has `startPlayerId` (one of the players) and `roundNumber: 1`.

Game area, top to bottom:
- [ ] The dice in the colors in use, with blank faces (not rolled yet). No gold die.
- [ ] "Your hand" with 10 cards, sorted by color (red, green, purple, blue, orange), then value. The art matches each card (check a few against the DB).
- [ ] One empty played column per player, mine first (labelled "You", highlighted border), then turn order. Each shows "★ 0".
- [ ] The status bar reads "Card play is not available yet".

Player boards:
- [ ] Each board shows one card back + "x 10", with the Last Chance card to its right (in color, not greyed).
- [ ] Each board shows status "In" with its icon.
- [ ] The Start token (the black pawn image) is on exactly one board: the `startPlayerId` player's.

Debug functions (Studio debug menu):
- [ ] `debug_playRandomCards(5)`, then F5. Each player has 5 cards in their column, stacked so only the top star strip of the covered cards shows. The star totals are right (stars: 1-3 = 2, 4-7 = 1, 8-10 = 2, 11 = 3, 12 = 5). Each board shows 5 individual card backs.
- [ ] `debug_playRandomCards(1)` again, then F5: the boards show 4 backs; the new card sits at the bottom of each column.
- [ ] `debug_passStartToken()`: the token slides to the next player's board without a refresh. The log says "<name> receives the Start token". After F5 it is still there.
- [ ] `debug_redeal()`, then F5: fresh 10-card hands, empty columns, no new log line.

Spectator and display:
- [ ] A spectator sees every board (hand counts, Last Chance, status, Start token), every column and the dice, and no hand.
- [ ] Mobile layout (or a narrow window): the hand still fits on one row; nothing overflows horizontally.
- [ ] No errors in the browser console on load or F5.

## Milestone 2: Core loop

Deploy as for M1 (`modules/`, `riviera.css`, `dbmodel.sql`). The schema changed (4 new `player` columns), so start a **new** table. Keep the browser console open: report any error.

Round start:
- [x] The log starts with a "Round 1" row (sea-green background), then a dice row with mini dice (sand background). The dice in the game area show pips.
- [x] Status bar: "You must choose a card to play". Playable cards glow, the others look normal (not greyed).

Valid cards (Studio debug menu):
- [x] `debug_setDice('2,3,5,6')` (values go to the dice in color order; with 5 colors give 5 values). The glowing cards are exactly those matching one die (same color and value) or the sum of two dice (color of either die). Check a few by hand.
- [x] Clicking a card that doesn't glow does nothing. Clicking a glowing card raises it, the title reads "Play [card]?" and a "Confirm" button shows; clicking it again unselects it and hides the button.

Choice and Change my mind:
- [x] "Confirm": the card stays in my hand, raised with a green outline. The status reads "You chose [card]. Waiting for other players" with a "Change my mind" button.
- [x] "Change my mind": I'm active again, the check is gone, the cards glow again. I can pick a different card.
- [x] The other player never sees which card I chose (only that I'm active or not). Their console/network shows no card id.
- [x] F5 while my choice is pending: the checked card and "Change my mind" come back.
- [x] A Change my mind sent after the last player chose fails quietly or with "This move is not authorized now" (the state has moved on).

Reveal:
- [x] When the last player confirms, every chosen card slides at once into its column: mine from my hand, the others from their player board's card backs. Hand counts drop by 1, the ★ totals update.
- [x] One reveal log row (blue background) lists every player with a mini card.

No valid card, Last Chance, Crash:
- [x] `debug_setDice` to values none of my cards match (e.g. `'1,1,1,1,1'` and check). Status: "You cannot play any card", with only "Use Last Chance" and "Crash" (red, no confirm dialog).
- [x] "Use Last Chance", then reveal: my Last Chance card shrinks away from my board; the reveal row shows a mini Last Chance card for me. It stays gone after F5 and for other players. I'm still in the round.
- [x] Next time I have no valid card, only "Crash" is offered.
- [x] "Crash", then "Change my mind": undone. "Crash" again, then reveal: my column and hand fade out, my board shows 0 cards and "Crashed", my column is dimmed. A separate crash log row (coral, bomb icon) appears.

Start token:
- [x] After each reveal the token slides to the next board in turn order, with a log row (grey, mini token). Also on a turn where everyone crashed.

Stop or More:
- [x] Status: "You must choose: Stop or More", buttons "Stop and bank N ★" (N = my ★ total) and "More".
- [x] Choosing shows "You chose to stop / to continue. Waiting for other players" + "Change my mind", which works as in card play. F5 restores it.
- [x] Nobody sees choices before the last player decides. Then one log row (lavender) lists "Stop: ..." and "More: ...". Stoppers' boards show "Stopped".
- [x] A stopped player is not active in the next card play ("Other players must choose a card").

Round end and game end:
- [x] When nobody is left in, each stopper gets a "banks N ★" row (apricot) and their score rises by N. Crashed players get nothing.
- [x] A new round follows: "Round 2" row, fresh 10-card hand (fades in), every column empty, every status "In", every board "x 10". Used Last Chance cards stay gone.
- [x] `debug_setScores(38)`, then play a round where someone stops with 2 ★ or more: the game ends after the round and the highest score wins. Equal scores share the win.
- [x] Grand Slam: `debug_trimHands(1)`, then `debug_setDice` so my last card is valid, and play it. A gold row "<name> plays all 10 cards: Grand Slam!", my score becomes max(100, best other + 1), my board and column glow gold, and the game ends with me first.
- [x] Grand Slam by two players on the same reveal: both get that score and share the win.

Logs:
- [x] Each row type has its own background; plain logs (Studio debug, framework messages) stay neutral grey. All text readable, including light player colors (orange, light green).
- [x] Same rows and colors in replay and on mobile (chatbar).

Other:
- [x] A spectator sees reveals, statuses, scores, the token and the dice, and never a hand or a pending choice.
- [x] Kick a player (zombie) during card play and during Stop or More: the game does not block.
- [x] If "Change my mind" fails with "This is not your turn" or similar on the server, `#[CheckAction(false)]` isn't honored on state-class methods: paste the error.

## Milestone 3: Powers

Deploy as before (`modules/`, `riviera.css`, `dbmodel.sql`). The schema changed (`cards.chain_position_POWER1` and 5 `player` columns), so start a **new** table. SFTP now deletes on Studio, but check that `modules/php/States/` on Studio holds exactly: EndRound, EndScore, ModifyDie, PassStartToken, PlayCard, ResolvePowers, RevealCards, RevealStopOrMore, RollDice, RoundSetup, StopOrMore, SwapCards. Keep the browser console open and paste any error.

Every debug function below is in the Studio debug menu and reloads the page. Use a 3-player table for card 10 (a victim and a bystander).

Card 1 / Grand Slam (`debug_POWER1()`: gives me two 1s and a 2, all playable):
- [ ] The play button reads "Confirm".
- [ ] I play a 1 and add a 5: both are revealed together with everyone else's cards, in that order in my column.
- [ ] I play a 1, add a second 1, and am asked again; I add a third card: all three are revealed.
- [ ] I play a 1 and press "Finish": only the 1 is revealed.
- [ ] I play a 1 when no other card is playable: I'm not asked anything and my choice is final at once.
- [ ] After a chain of three, I press "Change my mind": all three cards go back to my hand and I choose a first card again.
- [ ] I press "Change my mind" in the middle of a chain (still choosing): the same thing happens.
- [ ] I press F5 in the middle of a chain: the chosen cards are still set aside and the "add a card or finish" prompt is back. Same after F5 once the chain is finished (waiting for others).
- [ ] The other player only sees that I'm still choosing or done, and their network traffic shows no card id.
- [ ] My chain ends on a 2, 10 or 11: that card's power resolves after the reveal. A chain that ends on a 1 triggers no other power.
- [ ] The reveal log row shows the chain as card + card + card.
- [ ] I play my last cards through a chain (`debug_trimHands(3)`, then `debug_POWER1()`): Grand Slam, the game ends, and the last card's power does not resolve.
- [ ] Two players empty their hands on the same reveal, one with a chain and one with a single card: both get the Grand Slam score and share the win.
- [ ] One player makes a Grand Slam while another just played a 10: the game ends with no swap prompt.

Card 2 (`debug_POWER2()`):
- [ ] After the reveal the die is outlined in my color, with no button, and an indigo log row appears.
- [ ] On the next turn only I get cards valid with it, alone or in a sum; the other player's glowing cards ignore it.
- [ ] After that turn's reveal the outline is gone.
- [ ] If I choose Stop in that turn's Stop or More: after the reveal the outline disappears, a terracotta "stops: [2] no longer reserves [die]" row appears, and on the next roll the other player can use that die. Same after F5.

Card 11 (`debug_POWER11()`):
- [ ] After the reveal I'm asked "Add the golden die" / "Skip"; the other player sees that I may add it.
- [ ] "Add the golden die": a blank gold die appears and a champagne log row. It is rolled next turn and works only in a sum, never for its own color.
- [ ] It is gone after that turn's reveal, unless a new 11 is added, in which case it stays and is rolled again.
- [ ] "Skip" logs a slate "does not use" row.
- [ ] If I choose Stop after adding it: the gold die disappears and a terracotta "stops: [11] does not add [gold die]" row appears; it is not rolled next turn.
- [ ] A second 11 in the same turn is asked with "Add it too". If both players add it and only one stops, the gold die stays (no cancel row). If both stop, it goes, with one row each.

Card 9 (`debug_POWER9(true)` to start at once, or `debug_POWER9()` to play the 9 first):
- [ ] After the next roll I'm asked to pick a die; the modifiable dice glow. Others see that I may change a die.
- [ ] Picking a die shows "Turn to N" twice: 1 can go to 6 and 2, 6 can go to 5 and 1.
- [ ] The die changes for everyone, gets the "±" badge, and a teal log row shows old and new die.
- [ ] Playable cards reflect the new value.
- [ ] A modified die can't be picked by a later owner (two 9s in the same turn, clockwise from the Start token holder).
- [ ] The gold die can be picked when it is in use.
- [ ] "Skip" works and logs a skip row.
- [ ] An owner who chose Stop after playing the 9 is not asked.

Card 10 (`debug_POWER10()`; fallback: `debug_POWER10(true)`):
- [ ] Swap: I select 2 cards, then "Swap with <name>" (no confirm). My 2 cards fade out and 2 random cards slide in from their board.
- [ ] The victim never has to click. Their hand changes the same way.
- [ ] The owner and victim each see a single pink log row with the real cards. A third player and a spectator see a single row with 2 backs, and 2 backs slide each way between the two boards. Hand counts don't change.
- [ ] Targets: only opponents still in the round with at least 2 cards get a "Swap with" button. A player who stopped never does (stop one of two opponents, then play a 10).
- [ ] An opponent down to 1 card gets no button, and if every opponent still in is down to 1 card I get the discard-and-draw fallback instead (no debug helper trims a single hand: play the opponent's hand down).
- [ ] With fewer than 2 cards in my own hand, my 10 is skipped with a "(fewer than 2 cards in hand)" row: `debug_trimHands(2)`, then `debug_POWER10()` (the 10 replaces one of my 2 cards), then play the 10 so 1 card is left.
- [ ] Redraw fallback (`debug_POWER10(true)`): with nobody else in the round I discard and draw; a lime log row shows my cards to me and backs to others.
- [ ] `debug_setDrawPile(1, 0)` first: only 1 card is replaced, after the confirmation.
- [ ] `debug_setDrawPile(0, 3)` first: the discard pile is reshuffled in, and the cards just discarded never come back.
- [ ] `debug_setDrawPile(0, 0)` first: the power is skipped with a "no card left to draw" log row.
- [ ] "Skip" works.

Every power:
- [ ] F5 in ModifyDie, ResolvePowers and SwapCards restores the prompt (and the dice / card selection).
- [ ] An invalid or stale action is rejected by the server.
- [ ] Each new log type has its own background, in the live log, in replay and in the mobile chatbar.
- [ ] A zombie in each new state skips, and a zombie that plays a 1 does not chain.
- [ ] A new round clears every pending power and dice effect.
- [ ] If two power owners in a row are both asked in the same state (two 11s cannot be, but two 9s or two 10s can), the second one really becomes active. If not, paste what happens: re-entering the same active state is the one thing I couldn't verify locally.
- [ ] If "Swap with" or "Discard and draw" fails with a parameter error, `#[IntArrayParam]` doesn't read the comma-separated `cardIDs`: paste the error.
