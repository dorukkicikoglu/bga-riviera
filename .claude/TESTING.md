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
- [ ] The Start token (a 30x30 black square with a red border) is on exactly one board: the `startPlayerId` player's.

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
- [ ] The log starts with a "Round 1" row (sea-green background), then a dice row with mini dice (sand background). The dice in the game area show pips.
- [ ] Status bar: "You must choose a card to play". Playable cards glow, the others look normal (not greyed).

Valid cards (Studio debug menu):
- [ ] `debug_setDice('2,3,5,6')` (values go to the dice in color order; with 5 colors give 5 values). The glowing cards are exactly those matching one die (same color and value) or the sum of two dice (color of either die). Check a few by hand.
- [ ] Clicking a card that doesn't glow does nothing. Clicking a glowing card raises it and shows "Play this card"; clicking it again unselects it and hides the button.

Choice and Change my mind:
- [ ] "Play this card": the card stays in my hand, raised with a green check. The status reads "You chose a card. Waiting for other players" with a "Change my mind" button.
- [ ] "Change my mind": I'm active again, the check is gone, the cards glow again. I can pick a different card.
- [ ] The other player never sees which card I chose (only that I'm active or not). Their console/network shows no card id.
- [ ] F5 while my choice is pending: the checked card and "Change my mind" come back.
- [ ] A Change my mind sent after the last player chose fails quietly or with "This move is not authorized now" (the state has moved on).

Reveal:
- [ ] When the last player confirms, every chosen card slides at once into its column: mine from my hand, the others from their player board's card backs. Hand counts drop by 1, the ★ totals update.
- [ ] One reveal log row (blue background) lists every player with a mini card.

No valid card, Last Chance, Crash:
- [ ] `debug_setDice` to values none of my cards match (e.g. `'1,1,1,1,1'` and check). Status: "You cannot play any card", with only "Use Last Chance" and "Crash" (red, no confirm dialog).
- [ ] "Use Last Chance", then reveal: my Last Chance card shrinks away from my board; the reveal row shows a mini Last Chance card for me. It stays gone after F5 and for other players. I'm still in the round.
- [ ] Next time I have no valid card, only "Crash" is offered.
- [ ] "Crash", then "Change my mind": undone. "Crash" again, then reveal: my column and hand fade out, my board shows 0 cards and "Crashed", my column is dimmed. A separate crash log row (coral, bomb icon) appears.

Start token:
- [ ] After each reveal the token slides to the next board in turn order, with a log row (grey, mini token). Also on a turn where everyone crashed.

Stop or More:
- [ ] Status: "You must choose: Stop or More", buttons "Stop and bank N ★" (N = my ★ total) and "More".
- [ ] Choosing shows "You chose to stop / to continue. Waiting for other players" + "Change my mind", which works as in card play. F5 restores it.
- [ ] Nobody sees choices before the last player decides. Then one log row (lavender) lists "Stop: ..." and "More: ...". Stoppers' boards show "Stopped".
- [ ] A stopped player is not active in the next card play ("Other players must choose a card").

Round end and game end:
- [ ] When nobody is left in, each stopper gets a "banks N ★" row (apricot) and their score rises by N. Crashed players get nothing.
- [ ] A new round follows: "Round 2" row, fresh 10-card hand (fades in), every column empty, every status "In", every board "x 10". Used Last Chance cards stay gone.
- [ ] `debug_setScores(38)`, then play a round where someone stops with 2 ★ or more: the game ends after the round and the highest score wins. Equal scores share the win.
- [ ] Grand Slam: `debug_trimHands(1)`, then `debug_setDice` so my last card is valid, and play it. A gold row "<name> plays all 10 cards: Grand Slam!", my score becomes max(100, best other + 1), my board and column glow gold, and the game ends with me first.
- [ ] Grand Slam by two players on the same reveal: both get that score and share the win.

Logs:
- [ ] Each row type has its own background; plain logs (Studio debug, framework messages) stay neutral grey. All text readable, including light player colors (orange, light green).
- [ ] Same rows and colors in replay and on mobile (chatbar).

Other:
- [ ] A spectator sees reveals, statuses, scores, the token and the dice, and never a hand or a pending choice.
- [ ] Kick a player (zombie) during card play and during Stop or More: the game does not block.
- [ ] If "Change my mind" fails with "This is not your turn" or similar on the server, `#[CheckAction(false)]` isn't honored on state-class methods: paste the error.
