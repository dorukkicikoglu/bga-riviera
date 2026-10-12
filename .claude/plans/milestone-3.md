# Riviera: Milestone 3 (Powers) plan, revision 1

## Context

M1 and M2 are complete per the current user direction. M1 established the Fugu-shaped project, card/dice data, and `_POWER<n>` naming convention. M2 implemented the playable core loop, private simultaneous choices with Change my mind, reveal states, logging, and the debug setup tools. The current milestone adds cards **1, 2, 11, 9, and 10 in that order**, following `.claude/SPEC.md` for their timing and optional activation.

Fugu remains the reference for the structure and framework patterns of every corresponding file; it does not implement Riviera's powers. Relevant examples include Fugu `modules/php/States/PlayerTurn.php` and `NextPlayer.php`, `modules/php/FUGUTableManager.php`, `modules/php/Game.php`, `src/ts/Game.ts`, `src/ts/States/PlayerTurn.ts`, `src/ts/HandHandler.ts`, `src/ts/ModalBoxHandler.ts`, `src/ts/LogMutationObserver.ts`, and `src/scss/Game.scss`. Riviera's own M2 patterns take precedence where they have already adapted those conventions, especially state transitions, action validation, private notification payloads, and client-generated log rows.

**Build-size recommendation:** split implementation into three approval/build increments while preserving the requested power order:

1. **M3a: card 1, then cards 2 and 11.** Adds the BonusPlay chain and the initial pre-roll-power resolver, plus its notifications and tests.
2. **M3b: card 9.** Adds the post-roll, pre-play ModifyDie phase and tests.
3. **M3c: card 10.** Adds card exchange, hidden-information notifications, empty/short-pile handling, and tests.

These still form one M3 feature milestone, but card 10 has enough additional private-data and deck-edge-case behavior to validate separately. Do not start implementation or change other docs until this plan and the open rules below are approved.

Decisions required before implementation:
- The SPEC says to resolve powers clockwise from the Start token holder. Apply that order to all eligible owners; keep each choice/action optional.
- A card-1 bonus choice is simultaneous and therefore uses the existing Change-my-mind pattern. Card 9 and pre-roll powers are specified as clockwise sequential decisions, not simultaneous choices.
- Each public power effect gets a distinct notification/log class and its own SCSS background variable. Private choice/result notifications must not expose choices or cards to other players.
- Any new DB field, state, action, notification, DOM class, or log class introduced solely for a power uses `_POWER<n>` in its name.

## State flow

```text
RoundSetup(5) → RollDice(10)
  → ModifyDie(15)                  only for card-9 powers from the preceding turn
  → PlayCard(20, multi) → RevealCards(22)
      → BonusPlay(25, multi)        while a card-1 owner chooses another valid card or passes
      → Grand Slam check            after the card-1 chain
      → ResolvePowers(30, active)   clockwise card-2 / card-11 / card-10 owners
          → SwapCards(35, active)   for a card-10 owner
      → Grand Slam check            after the pre-roll powers
      → PassStartToken(40) → StopOrMore(50, multi) → RevealStopOrMore(55)
          → RollDice(10)            if anyone chose More
          → EndRound(60)             otherwise
```

- `ModifyDie` happens after the next roll and before `PlayCard`, matching card 9's timing.
- `BonusPlay` repeats its simultaneous choice window when one or more bonus cards are also 1s. A player who passes or plays a non-1 has no further card-1 choice in that chain.
- Card-1 bonuses use the same roll and same available dice as the immediately preceding play; they do not consume dice.
- `ResolvePowers` processes eligible players clockwise from the Start token holder. It lets the current player activate or skip a card-2/card-11 effect and dispatches card 10 to `SwapCards`.
- Grand Slam is checked after the card-1 chain and after pre-roll power resolution, as SPEC step 6 requires. A Grand Slam ends the game before Start-token passing or Stop/More.
- Preserve existing state IDs: `ModifyDie` 15, `BonusPlay` 25, `ResolvePowers` 30, and `SwapCards` 35. Their suggested state types and transitions need confirmation against the framework and the questions below.

## File-by-file

Legend: **NEW** = no Riviera equivalent · **EDIT** = existing Riviera file changed · **KEEP** = unchanged. For each file, Fugu is the structural reference; the content described here is Riviera-specific.

### PHP

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `dbmodel.sql` | EDIT | Fugu `dbmodel.sql`; Riviera's existing power-aware `dice` schema | Add only the minimal persistent, `_POWER<n>`-named state needed to survive state transitions/reloads. Candidate player columns: pending/eligible markers for `POWER1`, `POWER2`, `POWER9`, `POWER10`, and `POWER11`; separate pending choice and selected card fields for card 1 if they cannot safely reuse the M2 pending-choice columns. Keep existing `reserved_by_POWER2`, `modified_by_POWER9`, and `in_use_by_POWER11`; do not duplicate them. Resolve whether pending markers can be derived reliably from just-played cards before adding columns. |
| `modules/php/material.inc.php` | EDIT | Fugu `material.inc.php` | Add only power-specific constants that simplify real shared rules (for example the gold die's name if agreed). Preserve existing `CARD_COLORS`, `STARS_BY_VALUE`, and M2 constants; use `_POWER<n>` names for power-only constants. |
| `modules/php/Game.php` | EDIT | Fugu `Game.php` | Register/own any small shared power manager if needed, add debug setup actions for each power, and expose no private card identities through `getAllDatas()`. Grand Slam continues through `applyGrandSlam()` after the new bonus and pre-roll checkpoints. Debug setup helpers should use the real card/deck state and framework `#[Debug(reload: true)]` convention. |
| `modules/php/RIVTableManager.php` | EDIT | Fugu `FUGUTableManager.php` | Add focused methods for retrieving newly played powers, marking/clearing pending power markers, selecting random cards from a target hand or draw pile, performing an atomic card-10 exchange, and reporting updated hand counts/dice. Reuse `getPlayableCardIDs()` for card-1 validity; it already accounts for POWER2 reservations and POWER11's gold die. Preserve card visibility rules and validate every requested card/target against current state. |
| `modules/php/States/RevealCards.php` | EDIT | Fugu `States/NextPlayer.php`; current M2 reveal-state pattern | Identify newly played cards that trigger powers, record their pending markers (including card 9 for the next turn), and dispatch to `BonusPlay` when card 1 is pending, otherwise to the next applicable phase. Move the Grand Slam checkpoint to after the card-1 chain rather than ending before it. Keep current turn-order reveal, hidden-choice handling, crash notifications, and M2 behavior intact. |
| `modules/php/States/BonusPlay.php` | NEW | Fugu `States/PlayerTurn.php`; Riviera `PlayCard.php` and `RIVChangeMindManager.php` | MULTIPLE_ACTIVE_PLAYER, id 25. Card-1 owners simultaneously choose one currently valid extra card or pass. Validate the card server-side with `getPlayableCardIDs()`. Persist pending choice privately, support Change my mind until the last eligible player decides, then reveal and apply all bonus plays together. If a chosen card is 1, retain that player for the next chain; otherwise clear their eligibility. Send a public bonus-card reveal notification and hand-count updates. |
| `modules/php/States/ModifyDie.php` | NEW | Fugu `modules/php/States/PlayerTurn.php`; Riviera `RollDice.php` and `DiceHandler.ts` patterns | ACTIVE_PLAYER, id 15. Walk card-9 owners clockwise from the Start token holder, allowing each to modify one eligible die by +1, -1, or pass. Wrap 1↔6, update `modified_by_POWER9`, notify the table, and advance to the next owner or `PlayCard`. Do not let a die be modified twice during the same roll. Clear/consume each pending POWER9 marker. |
| `modules/php/States/ResolvePowers.php` | NEW | Fugu `modules/php/States/NextPlayer.php`; Riviera `PassStartToken.php` and active-state actions | ACTIVE_PLAYER (proposed), id 30. Resolve pending cards 2, 11, and 10 in clockwise player order. Card 2 and 11 each offer activate/skip. Activation reserves the matching colored die for that owner or enables the golden die, respectively. A card-10 owner transitions to `SwapCards`. Clear effects from the previous roll only after all BonusPlay choices have finished and before applying newly selected effects. When the queue is empty, check Grand Slam and continue to `PassStartToken` or `EndScore`. |
| `modules/php/States/SwapCards.php` | NEW | Fugu `modules/php/States/PlayerTurn.php` action validation; Riviera `PlayCard.php` validation pattern | ACTIVE_PLAYER, id 35. For card 10, validate two distinct selected cards in the current player's hand and an eligible opponent still in the round. If no other player is eligible, follow the approved discard/draw fallback. Select the opponent's cards randomly on the server, update card ownership atomically, and do not reveal opponent-hand IDs to uninvolved players. Return to `ResolvePowers` for the next owner. |
| `modules/php/States/RollDice.php` | EDIT | Fugu `modules/php/States/NextPlayer.php` | Preserve existing roll and notification. Apply active card-2 reservations to later validity checks and roll the golden die only when enabled by POWER11. Keep its POWER11 state available through the entire ensuing card-play/BonusPlay turn, then expire it before new card-11 activations. |
| `modules/php/States/PlayCard.php` | EDIT | Fugu `modules/php/States/PlayerTurn.php`; current M2 multiactive state | Preserve M2 choice and Change-my-mind behavior. No power should make a card playable if the existing server validity calculation rejects it. Ensure valid-card arguments are recomputed from the current reservation/golden-die state after ModifyDie. |
| `modules/php/States/PassStartToken.php` | EDIT or KEEP | Fugu `modules/php/States/NextPlayer.php` | Prefer no change if the new flow transitions into the existing state only after all power resolution. Keep turn-order and notification behavior unchanged. |
| `modules/php/States/RoundSetup.php` | EDIT | Fugu `modules/php/States/NextPlayer.php` | Reset all newly added per-turn pending markers and expire POWER2/POWER11/POWER9 state at the correct round boundary. Do not clear a lasting card-2/11 effect before its scheduled next roll. |
| `modules/php/RIVChangeMindManager.php` | EDIT if required | Fugu `modules/php/FUGUTableManager.php` shape; existing Riviera shared manager | Reuse its current API for BonusPlay only if the power-specific columns and private notifications fit without weakening M2 validation or privacy. Otherwise extend it narrowly with typed POWER1 choice support. Do not add Change my mind to the clockwise sequential states. |
| `modules/php/States/RevealStopOrMore.php`, `EndRound.php`, `EndScore.php` | KEEP | Fugu `modules/php/States/NextPlayer.php` / `EndScore.php` | No power rules occur here after the new pre-roll phases; retain existing transitions and scoring. Only change if tests show an unavoidable stale pending marker or effect lifetime crossing a round boundary. |

### TypeScript

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `src/ts/Game.ts` | EDIT | Fugu `src/ts/Game.ts` | Register new client state handlers, map each public power notification to its own log formatter, and update dice/hand/score UI from notification payloads. Keep log formatting in `bgaFormatText` and do not send hidden card data to all players. |
| `src/ts/types.d.ts` | EDIT | Fugu `src/ts/types.d.ts` | Add typed args and payloads for POWER1 choices/reveals, POWER2/POWER11 activations, POWER9 die changes, and POWER10 exchange notifications. Model card/die fields with existing types; mark private payloads separately from public notification data. |
| `src/ts/States/BonusPlay.ts` | NEW | Fugu `src/ts/States/PlayerTurn.ts`; Riviera `PlayCard.ts` and `StopOrMore.ts` | Render the eligible player's playable-card selection, optional pass, and Change my mind while the simultaneous window remains open. Restore pending choice after refresh, clear actions/classes on leaving, and show only the current player's choice. |
| `src/ts/States/ModifyDie.ts` | NEW | Fugu `src/ts/States/PlayerTurn.ts`; Riviera `PlayCard.ts` | For the active card-9 owner, render the die +/-/pass controls, show the changed die selection clearly, and submit one validated action. Others see who is resolving the power but not controls for the active player. |
| `src/ts/States/ResolvePowers.ts` | NEW | Fugu `src/ts/States/PlayerTurn.ts`; Riviera `StopOrMore.ts` | Present optional activate/skip actions for the current POWER2/POWER11 owner and a brief status for waiting players. Card 10 transitions to its own state. |
| `src/ts/States/SwapCards.ts` | NEW | Fugu `src/ts/States/PlayerTurn.ts`; Fugu `src/ts/HandHandler.ts` selection pattern | Let the POWER10 owner select two of their cards and an eligible opponent, or choose the approved fallback when no opponent remains. Show a server-confirm action only when selection is complete; never render an opponent's card identities before the private result notification. |
| `src/ts/HandHandler.ts` | EDIT | Fugu `src/ts/HandHandler.ts`; Riviera selection patterns | Add only state-gated POWER10 card selection if the existing card-selection mechanism cannot be shared safely. Keep normal M2 playable-card selection and card-1 reveal animation unchanged. Clear power-specific selected classes on state exit and reload. |
| `src/ts/DiceHandler.ts` | EDIT | Fugu `src/ts/CenterHandler.ts`; current Riviera handler | Keep rendering from `RivieraDie`. Support any selection/highlight needed by ModifyDie and update reservation/golden-die state after notifications. Continue to reflect existing `reserved_by_POWER2`, `modified_by_POWER9`, and `in_use_by_POWER11` values. |
| `src/ts/LogMutationObserver.ts` | EDIT | Fugu `src/ts/LogMutationObserver.ts` | Add a distinct formatter and row class for each public power effect/reveal: proposed classes are `bonus-play-POWER1`, `reserved-die-POWER2`, `modified-die-POWER9`, `golden-die-POWER11`, and `cards-swapped-POWER10`. Keep individual public effects identifiable, card/die icon rendering shared with existing helpers, and card-10 public text limited to “two cards swapped.” |
| `src/ts/Game.ts` / client state notification handlers | EDIT | Fugu `src/ts/Game.ts` notification pattern | Private notifications for pending/change-mind and POWER10 outcomes should update only the recipient's UI and must not create public log rows containing private information. Each public log-producing notification gets exactly one distinct log class. |
| `src/ts/PlayerHandler.ts` | EDIT only if needed | Fugu `src/ts/PlayerHandler.ts` | Reflect current round-visible status only; do not expose private power choices or hand cards. No persistent power badge is planned unless the rule decision requires one. |
| `src/ts/ModalBoxHandler.ts` | KEEP / reuse if useful | Fugu `src/ts/ModalBoxHandler.ts` | Reuse for anchored selection guidance only if necessary; do not add a modal dependency merely for simple status-bar/state controls. |

### SCSS

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `src/scss/Game.scss` | EDIT | Fugu `src/scss/Game.scss`; existing Riviera log/card/die styles | Add selection and feedback styling for bonus cards, die modification, optional-power controls, and card-10 selections. Add one `--bg-log-*` variable for every new public log type and its own log class selector. Include desktop/mobile layout and replay/chatbar log styling. Do not dim normal unplayable cards or change existing M2 visuals. |

### Debug, testing, and docs

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `modules/php/Game.php` debug methods | EDIT | Fugu `modules/php/Game.php` debug convention | Provide a `#[Debug(reload: true)]` setup action for each power, or one clearly named setup action per power that calls a shared helper. A shared `debug_giveCard(int $playerID, string $color, int $value)` may place a specific card into a hand, but each power must have a direct test entry point and establish the correct timing/state/dice without waiting for the deal. Cover card-1 chains, both card-2/11 options, card-9 boundaries, and card-10 exchange/fallback. |
| `.claude/TESTING.md` | EDIT after implementation approval | M2 checklist | Add Studio steps for each activation and skip path, card-1 chains and Grand Slam, clockwise order, reservation/gold validity, card-9 wrap and once-per-roll behavior, card-10 privacy and deck fallback, F5 restoration in every new state, spectators, mobile/replay log colors, and zombie handling. |
| `.claude/SPEC.md` | EDIT after implementation approval | Existing M1/M2 milestone notes | Record approved answers to open rules and update M3 status/implementation notes. Do not silently resolve any question below in code or the spec. |
| `.claude/CLAUDE.md` | EDIT after implementation approval | Current project conventions | Document new state IDs/flows, persistent fields, notification/log conventions, and power testing/debug conventions only after verified implementation. |
| `.claude/plans/milestone-3.md` | NEW (this file) | `.claude/plans/milestone-2.md` format | Plan only. No code or other documentation is changed as part of this planning request. |
| `modules/js/Game.js`, `riviera.css` | generated | Fugu build outputs | Regenerate via the existing build after approved source changes; do not hand-edit. |

## Core behavior and verification

- **Card 1:** only an owner who just played a 1 may choose a bonus. A chosen extra card must still be in that player's hand and valid under the same roll. Passing is allowed. Choices are private until the simultaneous reveal; eligible players can change their choice until the last eligible player acts. A revealed 1 can continue the chain.
- **Card 2:** optional reservation of the matching color die for its owner on the next roll/turn; other players cannot use it alone or in a sum. Ensure the card's owner can still use it.
- **Card 11:** optional activation of the gold die for the next roll for everyone. Gold contributes only to sums and never supplies a card color. The gold die remains usable for the whole following turn, including card-1 bonus plays, then expires.
- **Card 9:** after the next roll and before card choice, each owner in Start-token clockwise order may change one die by +1, -1, or pass. Values wrap at 1 and 6. Once a die has been modified for that roll, no owner may modify it again.
- **Card 10:** optional selection of two cards from the owner's hand and an opponent still in the round; the opponent contributes two random cards. The owner and victim receive the private card details specified in SPEC; all other players see only that two cards were exchanged.
- **Every power:** verify activation and skip; server-side rejection of invalid or stale actions; choice restoration on F5; non-leakage to opponents/spectators; clockwise ownership resolution; state transitions; hand counts; turn/round cleanup; notifications and unique log background in normal logs, chatbar, and replay.
- **Card 1 / Grand Slam:** verify a bonus chain that does not empty the hand, one that does, and multiple players reaching zero in the same bonus reveal. Confirm the intended winner/score behavior before implementation.
- **Card 2 / card 11:** verify their state survives the between-turn states and affects exactly the intended next roll/turn, but not later rolls.
- **Card 9:** test 1→6 and 6→1, one-modification limit, passing, multiple owners, and a golden die if allowed by the final rule.
- **Card 10:** test with a living opponent, no other player in the round, a full draw pile, a partially depleted pile, and insufficient cards in the owner's/opponent's hands. Verify only the owner/victim receive private card details.

## Questions / conflicts

1. **Card 1 chain and Grand Slam timing:** SPEC says card-1 powers can chain and checks Grand Slam after step 4, but a chain may empty a hand before every eligible player has finished the same simultaneous wave. Should all card-1 choices in that wave resolve before the check, and do all players emptying on that same wave share the Grand Slam as on the normal reveal? Does an early Grand Slam cancel later bonus choices or the card-2/10/11 window?
2. **Bonus-play Change my mind:** card 1 says bonus play is simultaneous, so this plan applies Change my mind up to the last eligible owner's choice, following M2. Confirm that a player can change an extra-card choice to pass (and vice versa) while others are still deciding.
3. **Ordering within the pre-roll window:** SPEC requires owners to resolve clockwise but lists powers 2, 10, and 11 in that step; M3 implementation order is 2, 11, 9, 10 by milestone request. Should the game resolve all eligible owners strictly clockwise regardless of power type, with that owner's own card effect then handled, or group the effects by type? If one owner has multiple powers due to a card-1 chain, resolve them together before advancing clockwise?
4. **Two card-2 owners reserve the same die:** if multiple players play the same-color 2 in one reveal and both activate, only one `reserved_by_POWER2` owner can be stored. Does the first clockwise activation win, the last clockwise activation replace it, or should later activations be skipped/rejected?
5. **Card 11 duration and overlap:** confirm the gold die stays active through the following turn's card-1 chain and expires before resolving newly played card 11s. If card 11 is activated again on that following turn, does it simply extend/restart the next-roll effect? Is the golden die a valid target for card 9?
6. **Card 9 eligible dice:** SPEC says “one die of your choice” and “applies to everyone,” but does that include the gold die when card 11 activated it? If allowed, does `modified_by_POWER9` apply to gold exactly like colored dice?
7. **Card 10 draw fallback:** the SPEC's no-opponent fallback discards two and draws two, but at six players the draw pile starts empty; a pile can also become smaller than two after earlier swaps. What happens with zero or one card left in the draw pile: discard anyway, draw fewer, or cancel/skip the power? Should a player be allowed to activate it if their hand has fewer than two cards?
8. **Card 10 target hand size:** can the selected opponent have fewer than two cards in hand? If so, should the exchange use all available cards, reject that target, or choose a different target? Confirm the analogous rule for the card-10 owner's own hand after a card-1 chain.
9. **Card 10 no-opponent detection:** is “no other player is left in the round” exactly `round_status = 'in'` excluding the owner, or can a stopped player be a target? The proposed interpretation is only another player still `in`.
10. **Card 10 notifications and privacy:** SPEC says the owner sees the received cards, the victim sees what they lost and got, and everyone else only sees that two cards were swapped. Confirm this is the exact visibility. The public swap log can have its own background; private result notifications should have no log row to avoid exposing private details. If “one log type per new notification” is intended to include private no-log updates, specify a privacy-safe expectation.
11. **Effect cleanup / card 2 lifetime:** M2's existing dice columns have no generation/turn field. Proposed cleanup is to keep old POWER2/POWER11 effects available through the next turn's BonusPlay, then expire them in `ResolvePowers` before storing new activations. Confirm this matches “on the next roll” and “removed at end of that turn.”
12. **Card-10 priority versus other powers:** card 10 is resolved before the next roll, while cards 2/11 have effects on that roll. Confirm that card-10 swaps do not alter which card-2/11 effects are pending, and that all card-10 swaps happen in the same clockwise pre-roll queue.
13. **State type/API confirmation:** the SPEC suggests `ModifyDie` active, `BonusPlay` multiple-active, `ResolvePowers` game/dispatcher, and `SwapCards` active. This plan proposes active `ResolvePowers` to support optional sequential actions. Confirm the active-player ownership/dispatcher pattern is acceptable with the framework before coding.
14. **Milestone size:** approve the suggested M3a/M3b/M3c splits or ask to keep all five powers in one implementation build. The order remains 1, 2, 11, 9, 10 either way.
