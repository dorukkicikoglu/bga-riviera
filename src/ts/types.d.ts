/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * types.d.ts
 */
declare function bga_format(translated: string, replacements: Record<string, string | ((t: string) => string)>): string;

interface RivieraPlayer extends Player {
    player_no: number;
    round_status: RoundStatus;
    last_chance_used: boolean;
    hand_count: number;
}

interface RivieraGamedatas extends Gamedatas<RivieraPlayer> {
    // Add here variables you set up in getAllDatas
    cardsInMyHand: RivieraCard[];
    cardsPlayed: Record<number, PlayedCard[]>;
    dice: RivieraDie[];
    startPlayerId: number;
    roundNumber: number;
    cardColors: Record<number, CardColor>;
    starsByValue: Record<number, number>;
    pref_names: GamePrefs;
    grandSlamPlayerIds: number[];
    endGameScoring?: EndGameScoreData;
}

interface GamePrefs{
    one_click_play: number;
}

type RoundResult = 'stopped' | 'crashed' | 'grand_slam' | 'unfinished';

interface RoundScoreEntry {
    result: RoundResult;
    stars: number;
}

interface EndGameScoreData {
    winner_ids: number[];
    winning_score: number;
    rounds: Record<number, Record<number, RoundScoreEntry>>; //round_number => player_id => entry
    scores: Record<number, number>;
}

interface LogRowData { //this is used to return strings containing log-class-tag divs
    log_html: string;
    log_class: string;
}

type CardColor = 'red' | 'green' | 'purple' | 'blue' | 'orange';
type DieColor = CardColor | 'gold';
type RoundStatus = 'in' | 'stopped' | 'crashed';

interface RivieraCard {
    card_id: number;
    color: CardColor;
    value: number;
}

interface PlayedCard extends RivieraCard {
    location_in_column: number;
}

interface RivieraDie {
    color: DieColor;
    value: number | null;
    reserved_by_POWER2: number | null;
    pending_reserved_by_POWER2: number | null; //a revealed card 2 not applied yet: its owner
    modified_by_POWER9: boolean;
    in_use_by_POWER11: boolean;
}

type PlayChoice = 'card' | 'last_chance' | 'crash';
type StopOrMoreChoice = 'stop' | 'more';

interface PendingPlayChoice {
    choice: PlayChoice;
    card_id: number | null;
}

/*
 * Describe here the types for your state args
 */
interface PlayCardArgs {
    _private?: {
        playableCardIDs: number[];
        canUseLastChance: boolean;
        pendingPlayChoice: PendingPlayChoice | null;
        chainCardIDs_POWER1: number[];
        chainOpen_POWER1: boolean;
        canUndoDieChange_POWER9: boolean;
    };
}

interface ModifyDieArgs {
    modifiableDice: { color: DieColor; value: number; }[];
    powerCard: RivieraCard | null;
}

interface ResolvePowersArgs {
    powerCard: RivieraCard | null;
}

interface SwapTargetPOWER10 {
    player_id: number;
    hand_count: number;
}

interface SwapCardsArgs {
    mode: 'swap' | 'redraw';
    targets: SwapTargetPOWER10[];
    myHandCount: number;
    drawableCount: number;
    maxCards: number;
    powerCard: RivieraCard | null;
}

interface StopOrMoreArgs {
    _private?: {
        pendingStopOrMoreChoice: StopOrMoreChoice | null;
    };
}

/*
 * Describe here the types for your notif args
 */
interface StartTokenPassedArgs {
    player_id: number;
}

interface CardReveal {
    player_id: number;
    choice: 'card' | 'last_chance';
    card: PlayedCard | null;
    extra_cards_POWER1: PlayedCard[];
}

//private: playChoiceConfirmed, playChainUpdated_POWER1 and playChoiceReverted carry what the player sees next
interface PlayChoiceConfirmedArgs extends PendingPlayChoice {
    chainCardIDs_POWER1: number[];
    playableCardIDs: number[];
    chainOpen_POWER1: boolean;
}

interface PlayChainUpdatedPOWER1Args {
    chainCardIDs_POWER1: number[];
    playableCardIDs: number[];
    chainOpen_POWER1: boolean;
}

interface PlayChoiceRevertedArgs {
    playableCardIDs: number[];
}

interface DiceUpdatedArgs {
    dice: RivieraDie[];
}

interface DieReservedPOWER2Args {
    player_id: number;
    die: RivieraDie;
    dice: RivieraDie[];
}

interface GoldenDieAddedPOWER11Args {
    player_id: number;
}

interface DieModifiedPOWER9Args {
    player_id: number;
    die_color: DieColor;
    old_value: number;
    new_value: number;
    move_id: number;
    dice: RivieraDie[];
}

interface DieChangeUndonePOWER9Args {
    player_id: number;
    move_id: number;
    dice: RivieraDie[];
}

//_private (the cards) only reaches the owner and the victim
interface CardsSwappedPOWER10Args {
    owner_id: number;
    target_id: number;
    count: number;
    _private?: {
        owner_gives: RivieraCard[];
        target_gives: RivieraCard[];
    };
}

//_private (the cards) only reaches the owner
interface CardsRedrawnPOWER10Args {
    player_id: number;
    count: number;
    _private?: {
        discarded: RivieraCard[];
        drawn: RivieraCard[];
    };
}

interface PowerSkippedArgs {
    player_id: number;
    value: number;
    card: RivieraCard | null;
    reason: '' | 'nothing_to_draw' | 'not_enough_cards';
}

interface CardsRevealedArgs {
    reveals: CardReveal[];
    hand_counts: Record<number, number>;
}

interface PlayerCrashedArgs {
    player_id: number;
}

interface LastChanceUsedArgs {
    player_id: number;
}

interface DiceRolledArgs {
    dice: RivieraDie[];
}

interface StopOrMoreChoiceArgs {
    choice: StopOrMoreChoice;
}

interface StopOrMoreRevealedArgs {
    choices: Record<number, StopOrMoreChoice>;
}

interface NewRoundArgs {
    round_number: number;
    hand_counts: Record<number, number>;
    dice: RivieraDie[];
}

interface NewHandArgs {
    cards: RivieraCard[];
}

interface ScoreChangedArgs {
    player_id: number;
    stars?: number;
    score: number;
}

interface DisplayEndGameScoringArgs {
    winner_ids: number[];
    winning_score: number;
    endGameScoring: EndGameScoreData;
}
