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
- [ ] Mobile layout (or a narrow window): the hand still fits on one row; nothing overflows horizontally. (Replaced after M4: see M4 > Layout.)
- [ ] No errors in the browser console on load or F5.

## Milestone 2: Core loop

Deploy as for M1 (`modules/`, `riviera.css`, `dbmodel.sql`). The schema changed (4 new `player` columns), so start a **new** table. Keep the browser console open: report any error.

Round start:
- [x] The log starts with a "Round 1" row (sea-green background), then a dice row with mini dice (sand background). The dice in the game area show pips.
- [x] Status bar: "You must choose a card to play". Playable cards glow, the others look normal (not greyed).

Valid cards (Studio debug menu):
- [x] `debug_setDice('2,3,5,6')` (values go to the dice in color order; with 5 colors give 5 values). The glowing cards are exactly those matching one die (same color and value) or the sum of two dice (color of either die). Check a few by hand.
- [x] Clicking a card that doesn't glow does nothing. Clicking a glowing card raises it, the title reads "Play [card]?" and a "Confirm" button shows; clicking it again unselects it and hides the button.

Choice and Undo:
- [x] "Confirm": the card stays in my hand, raised with a green outline. The status reads "You chose [card]. Waiting for other players" with an "Undo" button.
- [x] "Undo": I'm active again, the check is gone, the cards glow again. I can pick a different card.
- [x] The other player never sees which card I chose (only that I'm active or not). Their console/network shows no card id.
- [x] F5 while my choice is pending: the checked card and "Undo" come back.
- [x] An Undo sent after the last player chose fails quietly or with "This move is not authorized now" (the state has moved on).

Reveal:
- [x] When the last player confirms, every chosen card slides at once into its column: mine from my hand, the others from their player board's card backs. Hand counts drop by 1, the ★ totals update.
- [x] One reveal log row (blue background) lists every player with a mini card.

No valid card, Last Chance, Crash:
- [x] `debug_setDice` to values none of my cards match (e.g. `'1,1,1,1,1'` and check). Status: "You cannot play any card", with only "Use Last Chance" and "Crash" (red, no confirm dialog).
- [x] "Use Last Chance", then reveal: my Last Chance card shrinks away from my board; the reveal row shows a mini Last Chance card for me. It stays gone after F5 and for other players. I'm still in the round.
- [x] Next time I have no valid card, only "Crash" is offered.
- [x] "Crash", then "Undo": undone. "Crash" again, then reveal: my column and hand fade out, my board shows 0 cards and "Crashed", my column is dimmed. A separate crash log row (coral, bomb icon) appears.

Start token:
- [x] After each reveal the token slides to the next board in turn order, with a log row (grey, mini token). Also on a turn where everyone crashed. (Changed after M4: it now skips players out of the round, and sits on the board's corner with a curved two-phase flight, and since 2026-10-15 passes after the Stop/More reveal instead of after the card reveal, see M4 > Start token.)

Stop or More:
- [x] Status: "You may bank your stars or risk more", buttons "Stop and bank N ★" (N = my ★ total) and "Stay for More".
- [x] Choosing shows "You chose to stop / to continue. Waiting for other players" + "Undo", which works as in card play. F5 restores it.
- [x] Nobody sees choices before the last player decides. Then one log row (lavender) lists "Stop: ..." and "More: ...". Stoppers' boards show "Stopped".
- [x] A stopped player is not active in the next card play ("Other players must choose a card").

Round end and game end:
- [x] When nobody is left in, each stopper gets a "banks N ★" row (apricot) and their score rises by N. Crashed players get nothing. (Changed after M4: banking now happens at the Stop reveal, see M4 > Banking.)
- [x] A new round follows: "Round 2" row, fresh 10-card hand (fades in), every column empty, every status "In", every board "x 10". Used Last Chance cards stay gone. (Changed after M4: the hand is dealt card by card, see M4 > Layout.)
- [x] `debug_setScores(38)`, then play a round where someone stops with 2 ★ or more: the game ends after the round and the highest score wins. Equal scores share the win.
- [x] Grand Slam: `debug_trimHands(1)`, then `debug_setDice` so my last card is valid, and play it. A gold row "<name> plays all 10 cards: Grand Slam!", my score becomes max(100, best other + 1), my board and column glow gold, and the game ends with me first.
- [x] Grand Slam by two players on the same reveal: both get that score and share the win.

Logs:
- [x] Each row type has its own background; plain logs (Studio debug, framework messages) stay neutral grey. All text readable, including light player colors (orange, light green).
- [x] Same rows and colors in replay and on mobile (chatbar).

Other:
- [x] A spectator sees reveals, statuses, scores, the token and the dice, and never a hand or a pending choice.
- [x] Kick a player (zombie) during card play and during Stop or More: the game does not block.
- [x] If "Undo" fails with "This is not your turn" or similar on the server, `#[CheckAction(false)]` isn't honored on state-class methods: paste the error.

## Milestone 3: Powers

Deploy as before (`modules/`, `riviera.css`, `dbmodel.sql`). The schema changed (`cards.chain_position_POWER1` and 4 `player` columns), so start a **new** table. SFTP now deletes on Studio, but check that `modules/php/States/` on Studio holds exactly: EndRound, EndScore, ModifyDie, PassStartToken, PlayCard, ResolvePowers, RevealCards, RevealStopOrMore, RollDice, RoundSetup, StopOrMore, SwapCards. Keep the browser console open and paste any error.

Every debug function below is in the Studio debug menu and reloads the page. Use a 3-player table for card 10 (a victim and a bystander).

Power timing (settled with the publisher after M4): cards 2, 10 and 11 resolve after Stop or More, only for owners who chose **More**, clockwise from the player who just received the Start token. So for those cards: play it, then choose More.

Card 1 / Grand Slam (`debug_POWER1()`: gives me two 1s and a 2, all playable):
- [ ] The play button reads "Confirm".
- [ ] I play a 1 and add a 5: both are revealed together with everyone else's cards, in that order in my column.
- [ ] I play a 1, add a second 1, and am asked again; I add a third card: all three are revealed.
- [ ] I play a 1 and press "Skip": only the 1 is revealed.
- [ ] I play a 1 when no other card is playable: I'm not asked anything and my choice is final at once.
- [ ] After a chain of three, I press "Undo": all three cards go back to my hand and I choose a first card again.
- [ ] I press "Undo" in the middle of a chain (still choosing): the same thing happens.
- [ ] I press F5 in the middle of a chain: the chosen cards are still set aside and the "You may use [1]" prompt (the 1 as a circular card icon) is back. Same after F5 once the chain is finished (waiting for others).
- [ ] The other player only sees that I'm still choosing or done, and their network traffic shows no card id.
- [ ] After confirming a 1, the status bar reads "You may use [1]", the 1 drawn as the circular card icon (a ring in its color around the number, like "Play [card]?"); hovering it shows the card 1 power tooltip, the same as a 1 in the log. Selecting a card switches the title to "Add [card]?".
- [ ] My chain ends on a 2, 10 or 11: that card's power resolves after Stop or More if I choose More. A chain that ends on a 1 triggers no other power.
- [ ] The reveal log row shows the chain as card + card + card.
- [ ] I play my last cards through a chain (`debug_trimHands(3)`, then `debug_POWER1()`): Grand Slam, the game ends, and the last card's power does not resolve.
- [ ] Two players empty their hands on the same reveal, one with a chain and one with a single card: both get the Grand Slam score and share the win.
- [ ] One player makes a Grand Slam while another just played a 10: the game ends with no swap prompt.

Card 2 (`debug_POWER2()`, then More):
- [ ] Nothing happens at the reveal. After the Stop or More reveal the die is outlined in my color, with no button, and an indigo log row appears.
- [ ] On the next turn only I get cards valid with it, alone or in a sum; the other player's glowing cards ignore it.
- [ ] After that turn's reveal the outline is gone.
- [ ] If I choose Stop instead: no outline and no row, ever; on the next roll the other player can use that die.

Card 11 (`debug_POWER11()`, then More):
- [ ] After the Stop or More reveal (not before) the status bar reads "You may use [11]" (my 11 as a circular card icon in its color) with "Add golden die" / "Skip"; the other player and a spectator see "<my name> may use [11]". Hovering the icon shows the card 11 power tooltip, for everyone.
- [ ] "Add golden die": only a champagne log row ("adds the golden die to the next roll", no die drawn); no die appears in the dice container yet. It is rolled next turn and works only in a sum, never for its own color.
- [ ] golden die never appears without pips; it appears with the roll.
- [ ] It is gone after that turn's reveal, unless a new 11 is added after that turn's Stop or More, in which case it comes back and is rolled again.
- [ ] "Skip" logs a slate "does not use" row.
- [ ] If I choose Stop instead: I'm never asked, no golden die, no row.
- [ ] Two 11s in the same turn, both owners More: the first owner (clockwise from the new Start token holder) is asked; if they add it, the second owner is not asked and gets no row. If the first skips, the second is asked.

Card 9 (`debug_POWER9(true)` to start at once, or `debug_POWER9()` to play the 9 first):
- [ ] After the next roll each die I can turn shows a small up arrow above it and a small down arrow below it; the status bar reads "You may use [9]" (my 9 as a circular card icon, with the card 9 power tooltip on hover) and only has "Skip". Others and spectators see no arrows, just "<my name> may use [9]".
- [ ] The gap between a die and its arrow looks the same above and below.
- [ ] Clicking an arrow selects it (it stays highlighted) and the status bar reads "Turn [die] 4 → 5?" with "Confirm" and "Skip"; nothing is sent yet. Clicking the top half of a die selects its up arrow, the bottom half its down arrow.
- [ ] Clicking another arrow (or half) switches the selection; clicking the selected one again clears it and the status bar goes back to "You may use [9]". "Confirm" turns the die.
- [ ] Preview: selecting the green 6's down arrow makes that die show 5 with a soft glow, instantly (no shrink/expand animation, also when the real value comes back), while the status bar still shows "Turn [green 6] 6 → 5?". A new roll and the turned die after "Confirm" still animate, for everyone. Only one die is previewed: selecting another arrow (other die, or the other arrow of the same die) puts the first die back to its real value and previews the new choice; clearing the selection puts it back too.
- [ ] The preview disappears and the real value comes back on "Skip", on F5, and when leaving the state; after "Confirm" the die shows the real new value from the server (no glow).
- [ ] Another player and a spectator never see the preview: their dice keep the real values while I'm choosing.
- [ ] With "One-click card play" on, clicking an arrow or a die half turns the die at once, with no Confirm.
- [ ] On desktop, hovering anywhere from an arrow's tip to the die's middle line (the arrow, the gap or that half of the die) lights that arrow; there is no spot between the two arrows that lights neither. Hovering shows the result: 1's down arrow "1 → 6", 6's up arrow "6 → 1".
- [ ] Outside card 9 (and for other players, spectators, and a die already turned) hovering a die shows its normal tooltip and clicking it does nothing.
- [ ] The dice don't move when the arrows appear or disappear (compare the dice row before, during and after card 9), on desktop and on a phone.
- [ ] On a phone: tapping an arrow, the gap, or either half of the die selects the matching choice.
- [ ] A die already turned this roll (with its "±" badge) has no arrows.
- [ ] The die changes for everyone, gets the "±" badge, and a teal log row shows old and new die.
- [ ] Playable cards reflect the new value.
- [ ] A modified die shows no arrows for a later owner (two 9s in the same turn, clockwise from the Start token holder).
- [ ] The gold die gets arrows when it is in use; a reserved die (card 2) gets them too.
- [ ] "Skip" works and logs a skip row.
- [ ] An owner who chose Stop after playing the 9 is not asked (no row).

Card 10 (`debug_POWER10()`, then More; fallback: `debug_POWER10(true)`, then More):
- [ ] The status bar reads "You may use [10]" (my 10 as a circular card icon, with the card 10 power tooltip on hover); others and spectators see "<my name> may use [10]". The "Swap with <name>" buttons (or "Discard and draw" in the fallback) show at once, disabled. After 1 card the title is "Choose 2 cards to swap" ("Choose 2 cards to discard" in the fallback); after 2, "Choose an opponent to swap with" ("Discard these cards and draw 2?") and the buttons are enabled. Unselecting a card disables them again.
- [ ] Swap: I select 2 cards, then "Swap with <name>" (no confirm). My 2 cards fade out and 2 random cards slide in from their board.
- [ ] The victim never has to click. Their hand changes the same way.
- [ ] The owner and victim each see a single pink log row with the real cards. A third player and a spectator see a single row with 2 backs, and 2 backs slide each way between the two boards. Hand counts don't change.
- [ ] Targets: only opponents who chose More this turn and have at least 2 cards get a "Swap with" button. An opponent who chose Stop in the same Stop or More gets none.
- [ ] If I choose Stop instead: no swap prompt, no row.
- [ ] An opponent down to 1 card gets no button, and if every opponent who chose More is down to 1 card (or all of them stopped) I get the discard-and-draw fallback instead (no debug helper trims a single hand: play the opponent's hand down).
- [ ] With fewer than 2 cards in my own hand, my 10 is skipped with a "(fewer than 2 cards in hand)" row: `debug_trimHands(2)`, then `debug_POWER10()` (the 10 replaces one of my 2 cards), then play the 10 so 1 card is left.
- [ ] Redraw fallback (`debug_POWER10(true)`, then More): with nobody else in the round I discard and draw; a lime log row shows my cards to me and backs to others.
- [ ] `debug_setDrawPile(1, 0)` first: only 1 card is replaced, after the confirmation.
- [ ] `debug_setDrawPile(0, 3)` first: the discard pile is reshuffled in, and the cards just discarded never come back.
- [ ] `debug_setDrawPile(0, 0)` first: the power is skipped with a "no card left to draw" log row.
- [ ] "Skip" works.

Every power:
- [ ] F5 in ModifyDie, ResolvePowers and SwapCards restores the prompt (and the dice / card selection).
- [ ] An invalid or stale action is rejected by the server.
- [ ] Each new log type has its own background, in the live log, in replay and in the mobile chatbar.
- [ ] Zombies: see the M4 Zombie items (M4 replaced the M3 zombies).
- [ ] A new round clears every pending power and dice effect.
- [ ] Owners of 2, 10 and 11 resolve clockwise from the player who received the Start token this turn (two owners who both chose More: the one closer after the new holder goes first).
- [ ] A Grand Slam ends the game before the token passes and before any power.
- [ ] No terracotta "stops: ..." cancel row ever appears (that row type is gone).
- [ ] If two power owners in a row are both asked in the same state (two 11s cannot be, but two 9s or two 10s can), the second one really becomes active. If not, paste what happens: re-entering the same active state is the one thing I couldn't verify locally.
- [ ] If "Swap with" or "Discard and draw" fails with a parameter error, `#[IntArrayParam]` doesn't read the comma-separated `cardIDs`: paste the error.

Display fixes made during M3:
- [ ] Dice pips are round and all the same size for every value, in the dice area and in log rows (mini dice), on desktop and mobile.
- [ ] The Start token is the black pawn image, on its board and as a mini token in its log rows.
- [ ] Confirming a card, or adding one to a 1, doesn't replay the hand's fade-in (the deal since M4): the other cards stay still. Same in the round after a new hand was dealt.

## Milestone 4: Polish

Deploy as before (`modules/`, `riviera.css`, `dbmodel.sql`, `*.jsonc`). The schema changed (new `round_scores` table, and `player.added_golden_die_POWER11` removed with the power timing change) and `stats.jsonc` / `gamepreferences.jsonc` changed, so start a **new** table. Keep the browser console open and paste any error. M3 is tested in the same pass: run its section first.

Tooltips:
- [ ] Hovering any card in my hand or in any played column, power card or not, shows the power reference: teal, three bold timing headings, five entries each with its icon on the left and the text wrapping around it.
- [ ] Desktop: two columns (left: card 1, then cards 2 and 10; right: card 11, then card 9), about 640px wide at most. Phone or narrow window: one column, same order. The tooltip is not cut off (if it is, paste a screenshot: BGA may cap tooltip widths).
- [ ] Entries have no border or box, only spacing between them. Hovering a 1, 2, 9, 10 or 11 boxes that card's entry (lighter background, rounded corners, thin border); hovering any other value boxes nothing.
- [ ] Desktop: a thin vertical line between the two columns; no line when they stack in one column.
- [ ] All five icons are about two lines tall and none shows a sliver of its neighbor; card 10's is the wider one.
- [ ] The reference reads the same in BGA's dark mode.
- [ ] Log rows: a mini 1, 2, 9, 10 or 11 still shows its single-power tooltip (title with ★, timing, effect).
- [ ] The Last Chance card (board and reveal row), Start token, hand backs, round status, column ★ and each die have tooltips.
- [ ] A reserved die's tooltip names its owner (card 2) and loses that line once the reservation ends. A turned die says so (card 9). The gold die explains it only counts in a sum.
- [ ] New cards get tooltips too: after a new round, after a reveal, after a card 10 swap or redraw.
- [ ] Safari on a phone: no card tooltips; the same power reference (one column, nothing highlighted) shows at the bottom of the page.

Statistics (play a game to the end, then the Statistics tab):
- [ ] Rounds and turns (dice rolls) are right.
- [ ] A player who crashed once, used the Last Chance in round 2 and stopped the other rounds: crashes 1, Last Chance used yes, round 2, stars banked equal to their score.
- [ ] A player who never used the Last Chance shows no Last Chance round (if the end of the game fails with a stats error on `lastChanceRound`, paste it: it then needs an init to 0).
- [ ] Best round, rounds stopped and rounds played are right.
- [ ] A chain of three cards counts 3 cards played and 2 extra cards (card 1).
- [ ] Cards 2, 10 and 11 count only when they resolve (owner chose More): a 2 played before a Stop adds nothing. Card 9 counts each die turned, card 10 the cards swapped or redrawn (2 per use).
- [ ] A Grand Slam sets Grand Slam to yes.

End-game display:
- [ ] `debug_setScores(38)`, then finish a round with someone banking 2 ★ or more: a gold "<name> wins with N ★" log row, then the table fades in cell by cell. Clicking anywhere fast-forwards. The winners' names jump.
- [ ] One row per round: "N ★" when stopped, a bomb when crashed. The Total row equals the BGA score (after `debug_setScores` the round rows don't add up to it: expected).
- [ ] Collapse and show buttons work. F5 at game end shows the table at once.
- [ ] Grand Slam ending (`debug_trimHands(1)` + a playable card): the Grand Slam cell is gold with "+N", players still in show "-" for that round, a bomb if they crashed, and "N ★" if they had already stopped that round. After F5 the board and column glow is still there.
- [ ] Two winners on equal scores: "<a>, <b> win with N ★" and both names jump.
- [ ] Full replay to the end shows the table without errors.

Zombie (friendly mode, kick a player in each state; a 3-player table helps):
- [ ] Card play: the zombie plays a playable card with the most stars. If it is a 1 and more cards are playable, it chains in the same turn (check the reveal row). No playable card: Last Chance, then crash.
- [ ] Stop or More: the zombie stops.
- [ ] A zombie always stops, so its own 2, 9, 10 and 11 never resolve (no prompt, no row).
- [ ] Kick a player while they are the active power owner in ModifyDie, ResolvePowers or SwapCards: the game never blocks. Over a few tries the zombie sometimes uses the power (turns a die, adds the golden die, swaps 2 cards with a real player) and sometimes skips.
- [ ] A zombie swap with me: my hand changes and I get the private row with the real cards.

Start token (passes after Stop or More, skips players out of the round), on a 3- or 4-player table:
- [ ] The token no longer moves after the card reveal: it passes once the Stop/More row and any "banks N ★" rows are in the log, with its usual flight and log row, before any card 2, 10 or 11 power (reservation row, golden die prompt, swap prompt).
- [ ] It skips players who stopped or crashed, this turn's stoppers included, and slides to the next player clockwise who is still in.
- [ ] A player who crashes on this reveal is skipped by this turn's pass too.
- [ ] Card 2, 10 and 11 owners who chose More resolve clockwise from the player who just received the token; card 9 owners at the next roll start from that same player.
- [ ] If the holder is the only player who chose More, the token stays with them: no slide and no log row.
- [ ] Everyone crashes on the reveal (no Stop or More): the token still slides to the next player in turn order, right after the crash rows, then the round ends.
- [ ] Nobody chooses More (everyone stopped or crashed): the token slides to the next player in turn order after the Stop/More and banks rows, before the new round's columns clear.
- [ ] Never more than one token pass per turn (count the log rows over a few turns; none only when the holder keeps it).
- [ ] At the start of a new round the token stays where it is and keeps passing from there; the reveal row, the Stop/More row and the banking order of a turn follow the player holding the token during that turn (the one who received it at the end of the previous turn).
- [ ] The Start token's tooltip says it passes to the next player still in the round.

Start token placement and flight (`debug_passStartToken()` passes it at will):
- [ ] The token sits on the top-left corner of its owner's whole player board, over the board content (slightly over the corner, not clipped). The board's rows don't leave room for it, and no board changes height or shifts when the token arrives or leaves.
- [ ] Desktop (boards in a column beside the game area): the token lifts out to the side of the boards column, toward the game area (about 140px past it), growing to 2x, holds still at the peak for exactly `PEAK_PAUSE` ms, then curves back into the new owner's corner, shrinking back to its size. With `PEAK_PAUSE` 0 it sweeps through the peak at full speed with no slowdown; longer pauses ease into and out of the hold more (fully from 300 ms).
- [ ] Mobile (boards stacked above the game area): the token lifts down to about 40% of the screen height, growing, then curves back up into the new board, shrinking.
- [ ] Scrolled down so the boards are out of view (on mobile, or a short desktop window): the lift still shows on screen, coming from and going back to the boards' real places off-screen.
- [ ] A narrow desktop window where BGA puts the boards above the game area uses the mobile (downward) flight; a wide one uses the sideways flight.
- [ ] The next log row / state only comes once the token has landed; the real token is then on the new board with its tooltip. F5: the token is on the right board, no flight. In-game replay animates the same way; fast replay just moves it.
- [ ] The mini token in log rows is unchanged.

Banking at the Stop reveal:
- [ ] When the Stop/More row appears, each player who stopped gets a "banks N ★" row right after it (clockwise from the Start token holder), and their score on the player board rises by N at that moment, not at the end of the round.
- [ ] At the end of the round no second "banks" row appears and nobody's score changes again.
- [ ] A player who stops at 40 or more doesn't end the game while others are still in; the game ends when the round ends.
- [ ] A Grand Slam later in the same round: the earlier stopper keeps the stars they banked, and the end table shows "N ★" for them in that round.
- [ ] Stats: stars banked, best round and rounds stopped are right after a game where players stopped in different turns of the same round.

Progression:
- [ ] The progress bar moves during round 1 after each reveal, sits at the leader's banked score at each new round, and is 100 at game end. It doesn't jump when a player stops (their stars move from the column to the score, not counted twice).

Preference ("One-click card play" in the game preferences menu):
- [ ] On: clicking a glowing card plays it at once, no Confirm button. Also for the cards added to a 1. Undo still works.
- [ ] Off (default): select, then Confirm, as before. Switching it while choosing doesn't break the status bar.

Layout:
- [ ] Desktop, wide window: unchanged from before (same card and die sizes, hand on one straight row with a small overlap, columns on one row when they fit).
- [ ] Desktop, narrow window: my 10 cards still fit on one straight row, overlapping more; they spread again when the window widens or cards leave.
- [ ] On a phone (BGA mobile layout): my hand cards are large enough to read the number and stars; all of them sit on one horizontal line at the same height, overlapping more so the hand spans the full width with no horizontal scroll, and each card's number and stars stay visible. With fewer cards they keep a small overlap and stay centered (no spreading out). Rotating the phone respaces the hand.
- [ ] On a phone: dice and played-column cards are readable too, in proportion to the hand; the columns wrap onto several rows.
- [ ] On desktop and on a phone: only a selected card and a set-aside (chosen) card move, raised above the line; selecting, confirming, the playable glow and Undo still work.
- [ ] Every card slide changes size smoothly and lands exactly at its destination's size, with no jump at the end, on desktop and on a phone: my card into my column; another player's card from their board's mini card back into their column; card 10 cards sliding in from the other player's board; card backs between boards (card 10 seen by a third player).
- [ ] Card 10's fade-out / fade-in happens in place at the hand's size.
- [ ] New round (`debug_redeal()` or a real new round, ending it with cards still in my hand), on desktop and on a phone, in this order: the previous columns clear; then, at the same time, the cards left in my hand slide left off-screen together (about 0.2 s, starting from exactly where they were, no jump) and my 10 new cards fly in one after the other, rightmost first and leftmost last, each from above the page and far to the left of its slot, all along the same path (shifted to their own slots), already at hand-card size, each landing in its final slot (about 1.3 s); the dice roll only once the last new card has landed. No card shifts during or after the deal.
- [ ] Through the sweep and the deal the dice keep last round's values (never blank); they change, with their change animation, only when the roll comes after the deal. A spectator sees the same dice behavior (no sweep, no deal).
- [ ] A player who crashed in the last round (empty hand) gets no sweep, just the deal.
- [ ] Scrolled down when the new round starts: the cards come from above the visible area (their start isn't visible), and still land in the right slots.
- [ ] F5 during or after the deal: the hand is simply there, no deal. A spectator sees no deal; every player board's card backs update to "x 10".
- [ ] After the deal, the playable glow, selecting and confirming work as usual, and confirming doesn't replay any deal or fade-in.
- [ ] Status bar card icon ("Play [card]?", "Add [card]?", "You chose [cards]"): the number comes from `img/card_icon_numbers.webp`, gold on navy inside a ring of the card's color, same size as before; 10, 11 and 12 fit inside the ring; no square edge shows around the number. A screen reader reads "<value> <color>".
- [ ] BGA dark mode: every log row stays readable (dark text on its pale background), including plain framework rows.

Dice roll-in:
- [ ] Roll-in: on every new roll each die comes in from the top right at 45 degrees (as far right as up, starting above the dice area), spinning (half a turn to a full turn, either way) and slowing into its slot with no bounce, in about half a second; the dice are slightly staggered, not one block. The faces flicker through a few random values and the real value is showing when each die stops (check against the dice log row).
- [ ] Fade-out at the same time: the previous roll's dice fade out (and shrink a little) in place while the new ones are already coming in; nothing waits for the fade. At a new round, last round's dice stay up through the deal, then fade as the new roll comes in.
- [ ] Golden die fades out: after a turn with the golden die, it keeps its face through the reveal, Stop or More and the powers, then fades out with the others at the next roll (no new 11); it never vanishes instantly. With a new 11, it fades out and a new golden die rolls in with the others.
- [ ] Card 9 doesn't re-roll: turning a die only gives that die a quick scale-in with its new value; no die slides or spins. The card 2 outline and the card 9 "±" badge show correctly on the dice once they have rolled in.
- [ ] No animation on reload: F5 at any point shows the dice in place, no roll-in, no fade. Fast replay (and a hidden tab) changes the dice instantly.
- [ ] The entry is never hidden: the dice pass over BGA's status bar (and over the player boards on a phone), also when scrolled so the dice area is just under the status bar. No scrollbar appears or flickers while they fly, on desktop and on a phone, and the page never widens.
- [ ] Nothing else (log rows, the card 9 prompt, the play prompt) starts before the last die has stopped.

BGA alpha checklist:
- [ ] Game management page: turn on "Use minified JS" and "Use minified CSS", commit, and play a turn. No "Connecting to game" hang.
- [ ] Test spectator: sees boards, columns, dice and logs, never a hand or a pending choice.
- [ ] In-game replay from a log row, and the full replay after the end, without errors.
- [ ] A realtime table: no timeouts during normal play.
- [ ] Firefox and Safari (desktop) work as Chrome.
- [ ] A game starts from the waiting screen (express start and a normal start).
- [ ] Control panel: "Dry run build" passes.
- [ ] Game Metadata Manager filled in: designer Valentin Demion, artist Simon Caruso, year, presentation text, zombie level 1, box image with a transparent background, banner, icon, display images.
