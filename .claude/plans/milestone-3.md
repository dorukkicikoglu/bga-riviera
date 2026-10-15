> Status: implemented 2026-10-13, awaiting Studio test (see .claude/TESTING.md).

# Riviera: Milestone 3 (Powers) plan, revision 2

## Context

M1 set up the Fugu-shaped project and M2 the playable core loop. That covers private simultaneous choices with Change my mind, the reveal states, client-built logs with one background per log type, and debug setup functions. M3 adds the powers of cards **1, 2, 11, 9 and 10**, in **one build** (no M3a/b/c split).

Fugu (`reference/fugu/`) stays the structural model, especially for the active-player pattern:
- `NextPlayer.php` calls `changeActivePlayer()` and then returns `PlayerTurn::class`.
- `PlayerTurn.php`/`.ts` is the action state.

Where Riviera's M2 patterns already adapt Fugu, they take precedence: `RIVChangeMindManager`, the reveal states, `_private` args, `${X_LOG_STR}` + `createLog*()`, and `Game.animateSlide()`.

**Decisions (this session):**
- **Card 1: the chain happens inside `PlayCard`, before the reveal. There is no BonusPlay state.** When I confirm a 1, I'm asked at once to add another valid card (same roll) or to finish. If that card is also a 1, I'm asked again. The whole chain is my one private choice for the turn. All cards, chains included, are revealed together in the single `RevealCards`. Change my mind rolls back the whole chain, back to choosing the first card. **[UNCONFIRMED with publisher: whether simultaneous reveal stays at all. Built as described for now.]**
- **Grand Slam** is checked once, after the reveal. Everyone who empties their hand on that reveal shares it, and the game ends before any card 2/9/10/11 power.
- **Card 2 is not optional [BGA].** The die is reserved automatically after the reveal, with no button. The owner can still use it. A die that is already reserved can't be reserved again; this shouldn't happen (one 2 per color), but it is guarded. **If the owner stops, the reservation still blocks opponents** for that roll.
- **Card 11 stays optional.** If another 11 is activated on the following turn, the golden die stays and is rolled again with the others on the next roll.
- **Card 9:** the golden die is a valid target **[UNCONFIRMED with publisher]**. **An owner who stopped before the next roll loses the power.** Owners act clockwise from the current Start token holder, the player who received it at the end of the previous turn (SPEC step 2).
- **Card 10:**
  - **Targets:** only opponents still in the round (`round_status = 'in'`).
  - **Fallback when no opponent is in:**
    - The player discards and draws, drawing what they can, and **only discards as many cards as they can draw**, so the hand size never changes.
    - If the draw pile runs short, the discard pile (without the cards being discarded now) is reshuffled into it.
    - With 0 cards to draw, the power is skipped.
  - **Short target hand:** if the target has fewer than 2 cards, the owner swaps what they can after a confirm dialog that explains it. If 0 cards would move, it counts as not used.
  - The swap uses the cards left in hand after the reveal.
  - **The victim is passive.**
  - **Logs:** everyone gets exactly one swap row. The owner and victim see the real cards. Everyone else, spectators included, sees card backs, one per card moved. No private card ever reaches anyone else.
- **Order:** each player has at most one non-1 power per turn, because a chain only continues on 1s. Powers resolve player by player, clockwise from the Start token holder.
- **Effect lifetime:** a card-2 reservation and the golden die apply only to the turn after the power is used. They are cleared after that turn's reveal, unless a new 11 is activated.
- **State approach:** active-player states, with the "next owner" lookup shared by the GAME state that starts the walk and by the action that ends each owner's turn. Fugu does the same: `changeActivePlayer()` and then a transition.
- **Activating a power is optional** except card 2. Cards 9, 10 and 11 each have a "Skip" button.

- **Card 1 chain:** after a 1, if no card is playable any more, the chain finishes on its own (no "Finish" click).
- **Card 11:** a second 11 in the same turn, when the golden die is already set for the next roll, is skipped silently.
- **Skipping a power** gets its own log row.
- **Play button:** it reads "Confirm" (capitalized). The current `_('confirm')` is fixed in `PlayCard.ts`.

**Changes since revision 1:**
- BonusPlay (25) is removed and the card-1 chain now lives in `PlayCard`.
- Card 2 is automatic.
- Card 10's targets, fallback, short-hand and log rules are settled.
- Effect lifetime is settled.
- One build instead of three.
- Log class names follow the `*-log` convention.
- All 14 open questions are answered.

---

## State flow

```text
RoundSetup(5) → RollDice(10) ─┬→ ModifyDie(15, active) ⟲ next card-9 owner still in → … → PlayCard
                              └→ PlayCard(20, multi; card-1 chain inside the player's choice)
PlayCard → RevealCards(22) ─┬→ EndScore(98)                       Grand Slam (no power resolves)
                            └→ expire last turn's POWER2/POWER11 effects, mark this turn's powers,
                               then walk owners clockwise from the Start token holder:
                                 card 2  → reserved on the spot, walk continues
                                 card 9  → stays pending for ModifyDie after the next roll
                                 card 11 → ResolvePowers(30, active) ⟲
                                 card 10 → SwapCards(35, active) ⟲
                                 none left → PassStartToken(40) → StopOrMore(50) → RevealStopOrMore(55) → RollDice | EndRound(60)
```
- **The walk** lives in `RIVPowerManager::goToNextPreRollPower()`.
  1. It starts at the Start token holder and finds the first player with a pending 2, 10 or 11.
  2. Card 2 is applied inline and the loop continues.
  3. For card 10 or 11 it calls `gamestate->changeActivePlayer($id)` and returns that state's class.
  4. When nobody is left, it returns `PassStartToken::class`.

  `RevealCards` calls it at the end of `onEnteringState`, and every `ResolvePowers` / `SwapCards` action calls it as its return value. The `_ide_helper.php` note on `changeActivePlayer` says "you must transition to a state in the action triggering this call", and this does exactly that.
- **`goToNextPOWER9Owner()`** works the same way, from `RollDice` and from the `ModifyDie` actions. It clears the pending card 9 of owners who are no longer `in`.
- **State id 25 is freed** (BonusPlay is gone).

## File-by-file

Legend: **NEW** = no Riviera equivalent · **EDIT** = existing Riviera file changed · **KEEP** = unchanged.

### PHP

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `dbmodel.sql` | EDIT | Fugu `dbmodel.sql` | Schema below. |
| `modules/php/material.inc.php` | EDIT | Fugu | `POWER_CARD_VALUES = [2, 9, 10, 11]` (non-1 powers that leave a pending marker), `CARDS_SWAPPED_BY_POWER10 = 2`. |
| `modules/php/RIVPowerManager.php` | NEW | `FUGUTableManager.php` / `RIVChangeMindManager.php` shape, owned by `Game` like `$changeMindManager` | Below. |
| `modules/php/RIVChangeMindManager.php` | EDIT | itself | `recordChoice()` is split. A new `savePendingChoice($playerID, $choiceValues, $notifName, $notifArgs)` does the extra time on the first choice, the UPDATE and the private notify. `recordChoice()` now calls it and then `setPlayerNonMultiactive`. The card-1 chain uses `savePendingChoice()` to save a step without deactivating the player. `changeMind()` is unchanged. Calling it from a player who is still active (mid-chain) is harmless, because `setPlayersMultiactive([$id], '', false)` on an active player changes nothing. |
| `modules/php/RIVTableManager.php` | EDIT | `FUGUTableManager.php` | `getChainCardIDsPOWER1($playerID)` returns the extras in order. `clearChainPOWER1(?int $playerID = null)`. `shuffleAndDealCards()` also NULLs `chain_position_POWER1`. `getRandomHandCards($playerID, $count)` uses `bga_rand`. `getDrawableCountPOWER10()` = deck + discard. `drawCardsPOWER10($playerID, $count)`: if the deck is short, `moveAllCardsInLocation('discard', 'deck')` + `shuffle('deck')`, then `pickCards`. `getModifiableDicePOWER9()` = rolled dice (gold included) with `modified_by_POWER9 = 'no'`. `getPlayableCardIDs()` is reused unchanged. |
| `modules/php/Game.php` | EDIT | Fugu `Game.php` | `public RIVPowerManager $powerManager`. The debug functions below. `#[Debug]` added to `debug_passStartToken`. `getAllDatas` gains nothing private: pending markers stay server-side. |
| `States/RoundSetup.php` | EDIT | `NextPlayer.php` | Also resets `pending_POWER2/9/10/11 = 'no'`. `resetDice()` already clears the dice effects. |
| `States/RollDice.php` | EDIT | `NextPlayer.php` | `return $this->game->powerManager->goToNextPOWER9Owner();` instead of `PlayCard::class`. The roll is unchanged: it already rolls gold when `in_use_by_POWER11` and resets `modified_by_POWER9`. |
| `States/ModifyDie.php` | NEW | Fugu `PlayerTurn.php` | ACTIVE_PLAYER 15. Below. |
| `States/PlayCard.php` | EDIT | Fugu `PlayerTurn.php`, M2 | The card-1 chain. Below. |
| `States/RevealCards.php` | EDIT | `NextPlayer.php`, M2 | Reveals the chains, then hands over to the powers. Below. |
| `States/ResolvePowers.php` | NEW | Fugu `PlayerTurn.php` | ACTIVE_PLAYER 30: the card-11 prompt (card 2 needs no state). Below. |
| `States/SwapCards.php` | NEW | Fugu `PlayerTurn.php` (`actSwapCards` validation, `getRandomFaceDownCard` randomness) | ACTIVE_PLAYER 35: card 10. Below. |
| `States/PassStartToken.php`, `StopOrMore.php`, `RevealStopOrMore.php`, `EndRound.php`, `EndScore.php` | KEEP | — | A stopped owner's reservation simply lives until the next reveal, and card 9 is filtered in `goToNextPOWER9Owner()`. |

#### dbmodel.sql
```sql
-- inside CREATE TABLE `cards`, after location_in_column:
--   chain_position_POWER1: order of a hand card added to a card-1 chain (1 = first extra), pending until RevealCards like play_choice_card_id
  `chain_position_POWER1` TINYINT UNSIGNED NULL,

-- a non-1 power revealed this turn, waiting to resolve: 2, 10, 11 before the next roll, 9 after it
ALTER TABLE `player` ADD `pending_POWER2` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `made_choice_this_state`;
ALTER TABLE `player` ADD `pending_POWER9` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER2`;
ALTER TABLE `player` ADD `pending_POWER10` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER9`;
ALTER TABLE `player` ADD `pending_POWER11` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER10`;
```
- Comments go on their own lines (CLAUDE.md rule).
- The first card of a chain stays in M2's `play_choice_card_id`. The extras are marked on the cards, so Change my mind is two UPDATEs and F5 needs nothing new.
- **"Mid-chain"** is derived, not stored: the player has `play_choice = 'card'` and is still in `gamestate->getActivePlayerList()`.
- The existing dice columns `reserved_by_POWER2`, `modified_by_POWER9` and `in_use_by_POWER11` are reused as they are.

#### RIVPowerManager
```php
class RIVPowerManager{
    function markPendingPowers(array $lastCardValueByPlayer): void   // RevealCards: pending_POWERn = 'yes' when the player's last revealed card (a chain's last card) is 2, 9, 10 or 11
    function expireDiceEffects(): void                               // RevealCards, after the Grand Slam check: reserved_by_POWER2 = NULL; gold in_use_by_POWER11 = 'no', die_value = NULL;
                                                                     //   notify->all('diceUpdated', '', ['dice' => ...]) only if something changed (no log row)
    function goToNextPreRollPower(): string                          // the walk above
    function goToNextPOWER9Owner(): string                           // same for card 9; clears pending_POWER9 of players not 'in'; ModifyDie::class or PlayCard::class
    function skipPower(int $playerID, int $value, string $logReason = ''): void  // pending_POWERn = 'no' + notify->all('powerSkipped', '${POWER_SKIPPED_LOG_STR}', ...)
    private function applyReservationPOWER2(int $playerID): void     // UPDATE dice SET reserved_by_POWER2 = id WHERE die_color = <the 2's color> AND reserved_by_POWER2 IS NULL;
                                                                     //   DbAffectedRow() == 0 → guard, nothing; else notify->all('dieReserved_POWER2', ...)
}
```
- Card 2's color is the color of that player's last `played` card, which is the 2 just revealed.
- Card 11 is skipped without asking when `in_use_by_POWER11 = 'yes'` already.
- Card 10 goes straight to `skipPower` (with a "nothing to draw" reason) when no opponent is in and `getDrawableCountPOWER10() == 0`.

#### PlayCard (20): the card-1 chain
- **`onEnteringState`:** M2, plus `clearChainPOWER1()`.
- **`getArgs()` `_private`:**
  - M2 fields, plus `chainCardIDs_POWER1: int[]`.
  - Mid-chain, `playableCardIDs` leaves out the first card and the chain cards, so it lists only the possible next card.
- **`actPlayCard($cardID)`** (M2 validation):
  - Not a 1: `recordChoice(...)` as in M2.
  - A 1: `savePendingChoice($id, ['play_choice' => 'card', 'play_choice_card_id' => $cardID], 'playChoiceConfirmed', [... 'playableCardIDs' => next options])`. If there are no next options, the player is deactivated at once (auto-finish).
- **`#[PossibleAction] actAddChainCard_POWER1(int $cardID, int $currentPlayerId)`:**
  - Requires mid-chain, with the last chosen card a 1.
  - The card must be in `getPlayableCardIDs()` minus the cards already chosen.
  - Sets `chain_position_POWER1` = next.
  - Sends a private `playChainUpdated_POWER1` with `chainCardIDs_POWER1` and the next `playableCardIDs`.
  - If the card is a 1 and options remain, the player stays active. Otherwise `setPlayerNonMultiactive($id, RevealCards::class)`.
- **`#[PossibleAction] actFinishChain_POWER1(int $currentPlayerId)`:** requires mid-chain, then `setPlayerNonMultiactive`.
- **`actChangeMindPlayCard`:** M2 `changeMind(...)`, then `clearChainPOWER1($id)`.
  - It works both while inactive (M2) and mid-chain.
  - `playChoiceReverted` now carries the full `playableCardIDs`, because the client gets no args refresh while it stays active.
- **`zombie()`:** M2, and if that leaves the zombie mid-chain, `actFinishChain_POWER1`.

The client gets no new args while it stays active, so every private notif in this state carries the `playableCardIDs` for the player's next step. F5 recomputes them through `getArgs()`.

#### RevealCards (22)
1. A `card` choice moves the first card, then the chain cards in `chain_position_POWER1` order. Each gets the next `location_in_column` and the same "still in this hand" WHERE check.
2. Each reveal entry gains `extra_cards_POWER1: PlayedCard[]` (empty without a chain). The fallback text lists them too.
3. NULL the chain and play columns (M2 + `clearChainPOWER1()`). The `cardsRevealed` and `playerCrashed` notifs are otherwise as in M2.
4. **Grand Slam check: unchanged and in the same place.** It counts every card played this turn, chains included, and returns `EndScore::class` before any power.
5. `powerManager->expireDiceEffects()`, then `markPendingPowers(<last revealed card value per player>)`, then `return powerManager->goToNextPreRollPower()`.

Card 10 never changes a hand size, so no later Grand Slam check is needed.

#### ModifyDie (15, ACTIVE_PLAYER): card 9
- `getArgs()`: `['modifiableDice' => [['color', 'value'], ...]]`. These are public: everyone sees the dice.
- `#[PossibleAction] actModifyDie_POWER9(#[StringParam(enum: ['red','green','purple','blue','orange','gold'])] string $dieColor, #[IntParam(min: -1, max: 1)] int $delta, int $activePlayerId)`:
  - Checks: `pending_POWER9 = 'yes'`, `$delta !== 0`, and the die is in `modifiableDice`.
  - The new value wraps: 6 + 1 → 1, 1 − 1 → 6.
  - Sets `modified_by_POWER9 = 'yes'` and clears the pending marker.
  - `notify->all('dieModified_POWER9', '${DIE_MODIFIED_POWER9_LOG_STR}', [player_id, die_color, old_value, new_value, dice])`.
  - `return powerManager->goToNextPOWER9Owner()`.
- `#[PossibleAction] actSkip_POWER9(int $activePlayerId)`: `skipPower`, then the next owner.
- If no die is modifiable any more (every one already modified), `goToNextPOWER9Owner()` skips the owner silently.
- `zombie()`: skip.

#### ResolvePowers (30, ACTIVE_PLAYER): card 11
- `#[PossibleAction] actAddGoldenDie_POWER11(int $activePlayerId)`:
  - Requires `pending_POWER11`.
  - Gold gets `in_use_by_POWER11 = 'yes'` and `die_value = NULL` (blank until the roll). The marker is cleared.
  - `notify->all('goldenDieAdded_POWER11', '${GOLDEN_DIE_POWER11_LOG_STR}', [player_id, dice])`.
  - `return goToNextPreRollPower()`.
- `actSkip_POWER11`, and `zombie()` → skip.

#### SwapCards (35, ACTIVE_PLAYER): card 10
- **`getArgs()`** (public, nothing private needed):
  - `mode: 'swap' | 'redraw'`.
  - `targets: [{player_id, hand_count}]` lists opponents with `round_status = 'in'` and at least 1 card.
  - `maxCards` = min(2, my hand, best target hand) for swap, or min(2, my hand, drawable) for redraw.
  - `drawableCount`.
- **`#[PossibleAction] actSwapCards_POWER10(#[IntArrayParam] array $cardIDs, int $targetPlayerId, int $activePlayerId)`:**
  - Validates `pending_POWER10`, a valid target, and distinct cards in my hand. The count must be exactly min(2, my hand, target hand).
  - Takes the same number of random target cards (`bga_rand`) and swaps `card_location_arg` both ways.
  - Sends `notify->player($owner, 'cardsSwapped_POWER10', '${CARDS_SWAPPED_POWER10_LOG_STR}', [owner_id, target_id, owner_gives, target_gives])`. The target gets the same notif with the same payload, since both of them know both sets.
  - Sends `notify->all('cardsSwappedPublic_POWER10', '${CARDS_SWAPPED_POWER10_LOG_STR}', [owner_id, target_id, count])`, with ids only and no cards.
  - Then `goToNextPreRollPower()`.
- **`#[PossibleAction] actRedrawCards_POWER10(#[IntArrayParam] array $cardIDs, int $activePlayerId)`:**
  - Only allowed when no target exists. The count must equal min(2, my hand, drawable).
  - **Draws first** (with the reshuffle, so the cards discarded now can't come back), then moves the chosen cards to `discard`.
  - Sends a private `cardsRedrawn_POWER10` (discarded + drawn) and a public `cardsRedrawnPublic_POWER10` (count only), both with `${CARDS_REDRAWN_POWER10_LOG_STR}`.
- `actSkip_POWER10`, and `zombie()` → skip.
- **One row per viewer:**
  - The owner and target get their private row with the real cards.
  - The public row's `createLog*` method, when the viewer is the owner or the target, adds a second tag, `duplicate-log`, which `Game.scss` hides (`display: none`), and the public notif handler does nothing for them.
  - This works live, after F5, in replay and in the chatbar, because the same `bgaFormatText` / `LogMutationObserver` path runs for every row. No undeclared API like `notifqueue.setIgnoreNotificationCheck` is needed: it exists in `bga-framework.d.ts` only on `GameNotifQueue`, which `bga` doesn't expose.

#### Game.php debug functions (all `#[Debug(reload: true)]`)
A shared private helper, `debugGiveCards(int $playerID, array $colorValues)`, moves the named cards into my hand.
- It takes them from the deck, the discard or another hand. Each card taken from a hand is swapped with a random card of mine, so every count stays the same.
- It never takes from `played` or `returned_to_box`, and it only uses colors in use.
- It then sets the matching dice so those cards are playable (the die alone if the value is 6 or less, otherwise the color die 6 plus a second die) and jumps to PlayCard (20).

| Function | Sets up |
|---|---|
| `debug_POWER1()` | Two 1s of different colors + a 2 of a third color, all playable on the same roll: tests the chain 1 → 1 → 2 (+ automatic reservation). |
| `debug_POWER2()` | A playable 2. |
| `debug_POWER9(bool $resolveNow = false)` | A playable 9. With `true`, it instead sets my `pending_POWER9` and jumps to RollDice (10), so ModifyDie starts at once. |
| `debug_POWER10(bool $othersStopped = false)` | A playable 10. With `true`, every other player becomes `stopped`, to test the redraw fallback. |
| `debug_POWER11()` | A playable 11. |
| `debug_setDrawPile(int $deckCount = 0, int $discardCount = 0)` | Moves cards between `deck` and `discard` to reach those counts, for the reshuffle / draw-short / nothing-to-draw cases. Extra cards go to `returned_to_box` **for the rest of that table**, so use a throwaway table. |

The M2 debug functions (`debug_setDice`, `debug_trimHands`, ...) are kept.

### TypeScript (`src/ts/`)

| File | Kind | Mirrors | Content |
|---|---|---|---|
| `Game.ts` | EDIT | Fugu `Game.ts` | Registers `ModifyDie`, `ResolvePowers` and `SwapCards`. Adds the `bgaFormatText` keys `DIE_RESERVED_POWER2_LOG_STR`, `GOLDEN_DIE_POWER11_LOG_STR`, `DIE_MODIFIED_POWER9_LOG_STR`, `CARDS_SWAPPED_POWER10_LOG_STR`, `CARDS_REDRAWN_POWER10_LOG_STR` and `POWER_SKIPPED_LOG_STR`, each mapped to one `createLog*`. `animateReveal` slides `extra_cards_POWER1` into the column after the first card (short stagger). New notif handlers in the table below. |
| `States/PlayCard.ts` | EDIT | M2 | Below. Also the M2 button label: `_('confirm')` becomes `_('Confirm')`. |
| `States/ModifyDie.ts` | NEW | Fugu `States/PlayerTurn.ts` | Below. |
| `States/ResolvePowers.ts` | NEW | Fugu `States/PlayerTurn.ts` | Active player: "${you} may add the golden die to the next roll", with "Add the golden die" and "Skip". Others: "${actplayer} may add the golden die". |
| `States/SwapCards.ts` | NEW | Fugu `States/PlayerTurn.ts` (hidden-until-ready button, `destination` slot) | Below. |
| `HandHandler.ts` | EDIT | Fugu `HandHandler.ts` | Selection becomes generic. `setSelectableCards(ids, maxSelected)` replaces the PlayCard-only gating; clicks are allowed in `PlayCard` and `SwapCards`. Multi-select up to `maxSelected` (1 in PlayCard). `getSelectedCardIDs()`. The click calls `game.handSelectionChanged()`, which dispatches to the current state class. `setChosenCards(ids[])` (first card + chain, set aside, in order) replaces `setChosenCard`. `async removeCards(ids, toElement)` / `async addCards(cards, fromElement)` use `animateSlide` for swaps and redraws. M2 behaviour is kept. |
| `DiceHandler.ts` | EDIT | Fugu `CenterHandler.ts` | `setSelectableDice(colors)` (glow, click to select one), `clearSelectableDice()`, `getSelectedDieColor()`. `updateDice` is reused for every dice notif. The gold die keeps showing whenever `in_use_by_POWER11` (existing SCSS). |
| `LogMutationObserver.ts` | EDIT | Fugu `createLogSwapCards` | `createLogCardsRevealed` shows the chain: the first card, then "+" and each extra mini card. Six new `createLog*` methods (Logs table). |
| `types.d.ts` | EDIT | Fugu | `PlayCardArgs._private.chainCardIDs_POWER1`. `CardReveal.extra_cards_POWER1`. `PendingPlayChoice` notifs get `playableCardIDs`. `ModifyDieArgs`, `SwapCardsArgs`, and one args interface per new notif. |
| `ChangeMindHandler.ts`, `PlayerHandler.ts`, `PlayedColumnHandler.ts`, `StartTokenHandler.ts` | KEEP | — | — |

**Client `PlayCard`** keeps a local model: `pendingChoice`, `chainCardIDs`, `playableCardIDs`. It comes from the args on entry and F5, and then from the private notifs. Every change re-renders the status bar:
- **Active, no pending choice:** as in M2.
- **Active, mid-chain:**
  - Title: "${you} may add a card to your 1".
  - The chosen cards are set aside and the next options glow.
  - Select a card, then "Add card" (hidden until a card is selected).
  - "Finish", and "Change my mind".
- **Inactive with a pending choice:** "${you} chose [card icons]. Waiting for other players" + Change my mind.
- **Otherwise:** M2.

**Client `ModifyDie`:**
- **Active:** the dice in `modifiableDice` glow. Clicking one shows "−1 → n" and "+1 → n" buttons (with the wrap shown), plus "Skip" at all times.
- **Others:** "${actplayer} may change a die (card 9)".

**Client `SwapCards`:**
- **Active, swap mode:**
  - Select `maxCards` hand cards; then one button per target appears: "Swap with <name>".
  - If `maxCards < 2`, or the chosen target has fewer than 2 cards, the click first opens `bga.dialogs.confirmation()`, which explains that only N cards will be swapped.
  - "Skip".
- **Active, redraw mode:** "No opponent is still in the round: discard and draw". Select cards, then "Discard N and draw N", with the same confirmation when N < 2. "Skip".
- **Others:** "${actplayer} may swap cards (card 10)".

**Notification handlers (new)**

| Server notif | To | Log | Client |
|---|---|---|---|
| `playChoiceConfirmed` / `playChoiceReverted` (extended) | player | none | `playCard.updateChoice(...)`. |
| `playChainUpdated_POWER1` | player | none | Same. |
| `diceUpdated` | all | none | `diceHandler.updateDice` (expired reservation and gold). |
| `dieReserved_POWER2` | all | `die-reserved-power2-log` | `updateDice` (outline in the owner's color). |
| `goldenDieAdded_POWER11` | all | `golden-die-power11-log` | `updateDice` (the gold die appears, blank). |
| `dieModified_POWER9` | all | `die-modified-power9-log` | `updateDice` (fade/scale + "±" badge). |
| `cardsSwapped_POWER10` | owner, target | `cards-swapped-power10-log` (real cards) | My hand: `removeCards` toward the other board, `addCards` from it. |
| `cardsSwappedPublic_POWER10` | all | same class, backs; `duplicate-log` for owner/target | Others only: N backs slide each way between the two boards. |
| `cardsRedrawn_POWER10` | owner | `cards-redrawn-power10-log` (real cards) | `removeCards` / `addCards`. |
| `cardsRedrawnPublic_POWER10` | all | same class, backs; `duplicate-log` for the owner | none |
| `powerSkipped` | all | `power-skipped-log` | none |

### SCSS (`src/scss/Game.scss`)
- `.a-die.selectable-die` glow (Fugu's pulse) and `.selected-die`, only under `body.current_player_is_active:not(.lockedInterface)`.
- Several `.chosen-card` cards may be set aside at once (chain).
- Selection classes are cleared on state exit and reload.
- Reveal-row chain layout (`.reveal-chain-plus`).
- `.log.duplicate-log, .gamelogreview.duplicate-log { display: none; }`.
- Six new `$log-types` entries + `:root` variables (Logs below).
- Unplayable cards keep their normal look, as in M2.

### Logs

Fugu's mechanism, as in M2: a `${X_LOG_STR}` placeholder whose plain fallback text is built on the server, plus `preserve`; one `createLog*()`; one `*-log` class; one `--bg-log-*` variable listed in `$log-types`.

| Notif(s) | `createLog*` | Log class | Row | `:root` variable (pale gradient, dark text stays ≥ 4.5:1) |
|---|---|---|---|---|
| `dieReserved_POWER2` | `createLogDieReservedPOWER2(player_id, die)` | `die-reserved-power2-log` | "<name> reserves [mini die] for the next roll" | `--bg-log-die-reserved-power2`: pale indigo `#e9ebf8 → #c9cfee` |
| `goldenDieAdded_POWER11` | `createLogGoldenDiePOWER11(player_id)` | `golden-die-power11-log` | "<name> adds [mini gold die] to the next roll" | `--bg-log-golden-die-power11`: champagne `#fbf6e6 → #eedfb0` (paler than Grand Slam) |
| `dieModified_POWER9` | `createLogDieModifiedPOWER9(player_id, color, old, new)` | `die-modified-power9-log` | "<name> turns [die old] → [die new]" | `--bg-log-die-modified-power9`: pale teal `#e2f4f3 → #b9e0dd` |
| `cardsSwapped_POWER10` + `...Public_POWER10` | `createLogCardsSwappedPOWER10(owner, target, ownerGives \| null, targetGives \| null, count)` | `cards-swapped-power10-log` | "<owner> [cards or N backs] ⇄ <target> [cards or N backs]" | `--bg-log-cards-swapped-power10`: pale rose `#fae8f0 → #eec4d6` |
| `cardsRedrawn_POWER10` + `...Public_POWER10` | `createLogCardsRedrawnPOWER10(player_id, discarded \| null, drawn \| null, count)` | `cards-redrawn-power10-log` | "<name> discards [cards or backs] and draws [cards or backs]" | `--bg-log-cards-redrawn-power10`: pale lime `#f1f6e1 → #d6e6b0` |
| `powerSkipped` | `createLogPowerSkipped(player_id, card)` | `power-skipped-log` | "<name> does not use [mini card]" (+ "nothing to draw" when given) | `--bg-log-power-skipped`: pale slate `#eef1f4 → #d3d9e1` |

The card-1 chain adds no log type: it shows inside the existing `cards-revealed-log` row.

## Verification

1. `npm run build` is clean, and `php -l` passes on every PHP file touched.
2. Start a **new** table, because the schema changed.
3. Studio checks (these become the M3 section of `.claude/TESTING.md`):

**Card 1 / Grand Slam test cases**
1. I play a 1 and add a 5: both are revealed together with everyone else's cards, in that order in my column.
2. I play a 1, add a second 1, and am asked again; I add a third card: all three are revealed.
3. I play a 1 and press "Finish": only the 1 is revealed.
4. I play a 1 when no other card is playable: I'm not asked anything and my choice is final at once.
5. After a chain of three, I press "Change my mind": all three cards go back to my hand and I choose a first card again.
6. I press "Change my mind" in the middle of a chain (still choosing): the same thing happens.
7. I press F5 in the middle of a chain: the chosen cards are still set aside and the "add a card or finish" prompt is back.
8. The other player only sees that I'm still choosing or done, and their network traffic shows no card id.
9. My chain ends on a 2, 10 or 11: that card's power resolves after the reveal. A chain that ends on a 1 triggers no other power.
10. I play my last cards through a chain (`debug_trimHands(3)` with two 1s and a playable card): Grand Slam, the game ends, and the last card's power does not resolve.
11. Two players empty their hands on the same reveal, one with a chain and one with a single card: both get the Grand Slam score and share the win.
12. One player makes a Grand Slam while another just played a 10: the game ends with no swap prompt.

**Card 2**
- After the reveal the die is outlined in the owner's color, with no button, and a log row appears.
- On the next turn only the owner gets cards valid with it, alone or in a sum.
- After that turn's reveal the outline is gone.
- If the owner chose Stop, opponents still can't use the die on that roll.

**Card 11**
- "Add the golden die" makes a blank gold die appear. It is rolled next turn and works only in a sum, never for its own color.
- It is gone after that turn's reveal, unless a new 11 is added, in which case it stays and is rolled again.
- "Skip" logs a skip row.
- A second 11 in the same turn is not asked.

**Card 9**
- After the next roll, owners are asked clockwise from the Start token holder.
- 1 − 1 → 6 and 6 + 1 → 1.
- A modified die can't be picked by a later owner.
- The gold die can be picked.
- "Skip" works.
- An owner who stopped is not asked.
- Playable cards reflect the new value.

**Card 10**
- **Swap:** the owner picks 2 cards and a target still in the round. The owner and target see the real cards in their single log row. A third player and a spectator see a single row with 2 backs. Hand counts don't change.
- **Short hand:** with a target holding 1 card, the confirmation explains it and 1 card moves.
- **Redraw fallback** (`debug_POWER10(true)`):
  - The owner discards and draws.
  - With `debug_setDrawPile(1, 0)` only 1 card is swapped (after the confirmation).
  - With `debug_setDrawPile(0, 3)` the discard pile is reshuffled in, and the cards just discarded never come back.
  - With `debug_setDrawPile(0, 0)` the power is skipped with a log row.
- "Skip" works. The victim never has to click.

**Every power**
- F5 in ModifyDie, ResolvePowers and SwapCards restores the prompt.
- An invalid or stale action is rejected by the server.
- Each new log type has its own background, in the live log, in replay and in the mobile chatbar.
- A zombie in each new state skips, and a zombie mid-chain finishes its chain.
- A new round clears every pending power and dice effect.

## Questions / conflicts

None open. Two items stay marked **[UNCONFIRMED with publisher]** in SPEC.md: whether the simultaneous reveal stays (card 1), and whether the gold die is a valid card-9 target.

One thing I can't verify locally: re-entering the same active state (`ResolvePowers` → `ResolvePowers`) with a new active player, after `changeActivePlayer()` inside an action. If Studio doesn't refresh the active player, the fallback is a small GAME dispatcher state, as in Fugu's `NextPlayer`, on a free id such as 32.
