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
    };
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
}

interface CardsRevealedArgs {
    reveals: CardReveal[];
    hand_counts: Record<number, number>;
}

interface PlayerCrashedArgs {
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
