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
