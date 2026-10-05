# Riviera: BGA Studio test checklists

One section per milestone, written when the milestone ends. Tick items as you test; note failures inline.

## Milestone 1: Skeleton (not built yet; checklist from `.claude/plans/milestone-1.md`)

Setup and DB:
- [ ] Start games with 2, 4, 5 and 6 players.
- [ ] `cards` always has 60 rows. With 2 to 4 players, 12 of them (one color) are in `returned_to_box`, and that color's die has `die_location = 'returned_to_box'`.
- [ ] Every player has 10 cards in `hand`.
- [ ] This query returns no rows: `SELECT card_location_arg, color, COUNT(*) c FROM cards WHERE card_location='hand' GROUP BY 1,2 HAVING c > 6`

Game area, top to bottom:
- [ ] Dice in the colors in use, with blank faces (not rolled yet).
- [ ] My hand, sorted by color, then value.
- [ ] One empty played column per player, mine first.

Player boards:
- [ ] One card back + "x 10", with the Last Chance card to its right.
- [ ] Status "In".
- [ ] The Start token (a 30x30 black square with a red border) is on exactly one board.

Debug functions:
- [ ] `debug_playRandomCards(5)`, then F5. Hands are at 5, so the boards show 5 individual backs. The columns stack showing only the star strips, and the star totals are right.
- [ ] `debug_passStartToken()`: the token slides to the next player's board and the log says who received it.
- [ ] `debug_redeal()` deals new hands with no log line.

Spectator:
- [ ] Sees every hand count, column and the dice, and no hand.
