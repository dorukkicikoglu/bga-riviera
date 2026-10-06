<?php

namespace Bga\Games\Riviera;

use Bga\Games\Riviera\Game;

class RIVTableManager{
    public Game $game;

    function __construct(Game $game) {
        $this->game = $game;
    }

    /**
     * Gathers every card in use, shuffles and deals CARDS_PER_HAND to each player. Any hand holding more than
     * MAX_CARDS_OF_ONE_COLOR_IN_HAND cards of one color gets the whole deal redone, silently: no log line,
     * no notification, so players never see such a hand. Cards 'returned_to_box' are never touched.
     */
    function shuffleAndDealCards(){
        $this->game->cardsDeck->moveAllCardsInLocation('hand', 'deck');
        $this->game->cardsDeck->moveAllCardsInLocation('played', 'deck');
        $this->game->cardsDeck->moveAllCardsInLocation('discard', 'deck');
        $this->game->DbQuery("UPDATE `cards` SET `location_in_column` = NULL");

        $playerIDs = $this->game->getObjectListFromDB("SELECT `player_id` FROM `player`", true);

        for($attempt = 1; $attempt <= MAX_REDEAL_ATTEMPTS; $attempt++){
            $this->game->cardsDeck->shuffle('deck');
            foreach($playerIDs as $playerID)
                $this->game->cardsDeck->pickCards(CARDS_PER_HAND, 'deck', (int) $playerID);

            if(!$this->hasHandWithTooManyOfOneColor())
                return;

            $this->game->cardsDeck->moveAllCardsInLocation('hand', 'deck');
        }

        throw new \Bga\GameFramework\SystemException('Could not deal hands with at most '.MAX_CARDS_OF_ONE_COLOR_IN_HAND.' cards of one color');
    }

    private function hasHandWithTooManyOfOneColor(): bool{
        $overfullHands = $this->game->getObjectListFromDB(
            "SELECT `card_location_arg`, `color` FROM `cards`
             WHERE `card_location` = 'hand'
             GROUP BY `card_location_arg`, `color`
             HAVING COUNT(*) > ".MAX_CARDS_OF_ONE_COLOR_IN_HAND."
             LIMIT 1"
        );

        return count($overfullHands) > 0;
    }

    /**
     * Cards visible to $currentPlayerId: their own hand, every played column, and hand counts for everyone.
     * Ids of cards in other players' hands are never returned, since a card_id reveals its color and value.
     */
    function getCardsOnTable(int $currentPlayerId){
        $allCardsDB = $this->game->getCollectionFromDb("SELECT * FROM `cards` WHERE `card_location` IN ('hand', 'played') ORDER BY `color` ASC, `value` ASC");
        $cardsData = [
            'myHand' => [],
            'played' => [],
            'handCounts' => [],
        ];

        $playerIDs = $this->game->getObjectListFromDB("SELECT `player_id` FROM `player`", true);
        foreach($playerIDs as $playerID){
            $cardsData['played'][(int) $playerID] = [];
            $cardsData['handCounts'][(int) $playerID] = 0;
        }

        foreach($allCardsDB as $cardDB){
            $player_id = (int) $cardDB['card_location_arg'];

            if($cardDB['card_location'] === 'hand'){
                $cardsData['handCounts'][$player_id]++;

                if($player_id === $currentPlayerId)
                    $cardsData['myHand'][] = $this->formatCard($cardDB);
            } else if($cardDB['card_location'] === 'played'){
                $card = $this->formatCard($cardDB);
                $card['location_in_column'] = (int) $cardDB['location_in_column'];
                $cardsData['played'][$player_id][] = $card;
            }
        }

        foreach($cardsData['played'] as $player_id => $playedCards){
            usort($playedCards, fn(array $a, array $b) => $a['location_in_column'] <=> $b['location_in_column']);
            $cardsData['played'][$player_id] = $playedCards;
        }

        return $cardsData;
    }

    public function formatCard(array $cardDB): array{
        return [
            'card_id' => (int) $cardDB['card_id'],
            'color' => $cardDB['color'],
            'value' => (int) $cardDB['value'],
        ];
    }

    /**
     * Dice in play (the removed color's die is left out), gold included with its in_use_by_POWER11 flag.
     */
    function getDice(): array{
        $diceDB = $this->game->getObjectListFromDB("SELECT * FROM `dice` WHERE `die_location` = 'in_play' ORDER BY `die_color` ASC");

        $dice = [];
        foreach($diceDB as $dieDB){
            $dice[] = [
                'color' => $dieDB['die_color'],
                'value' => ($dieDB['die_value'] === null) ? null : (int) $dieDB['die_value'],
                'reserved_by_POWER2' => ($dieDB['reserved_by_POWER2'] === null) ? null : (int) $dieDB['reserved_by_POWER2'],
                'modified_by_POWER9' => $dieDB['modified_by_POWER9'] === 'yes',
                'in_use_by_POWER11' => $dieDB['in_use_by_POWER11'] === 'yes',
            ];
        }
        return $dice;
    }

    function resetDice(){
        $this->game->DbQuery("UPDATE `dice` SET `die_value` = NULL, `reserved_by_POWER2` = NULL, `modified_by_POWER9` = 'no', `in_use_by_POWER11` = 'no'");
    }

    function getColorsInUse(): array{
        return $this->game->getObjectListFromDB("SELECT `die_color` FROM `dice` WHERE `die_location` = 'in_play' AND `die_color` <> 'gold' ORDER BY `die_color` ASC", true);
    }

    /**
     * Passes the Start token to the next player in turn order, regardless of their round status.
     */
    function passStartToken(): int{
        $currentStartPlayerID = (int) $this->game->bga->globals->get('startPlayerId');
        $nextStartPlayerID = $this->game->getPlayerAfter($currentStartPlayerID);
        $this->game->bga->globals->set('startPlayerId', $nextStartPlayerID);

        $startTokenLogStr = $this->game->getPlayerNameById($nextStartPlayerID).' receives the Start token';
        $this->game->bga->notify->all('startTokenPassed', '${START_TOKEN_LOG_STR}', [
            'preserve' => ['player_id'],
            'player_id' => $nextStartPlayerID,
            'START_TOKEN_LOG_STR' => $startTokenLogStr,
        ]);

        return $nextStartPlayerID;
    }

    /**
     * Rolls every colored die in play, plus the golden die when a card 11 put it in use.
     */
    function rollDice(): void{
        $diceDB = $this->game->getObjectListFromDB("SELECT `die_color`, `in_use_by_POWER11` FROM `dice` WHERE `die_location` = 'in_play'");

        foreach($diceDB as $dieDB){
            $isRolled = ($dieDB['die_color'] !== 'gold') || ($dieDB['in_use_by_POWER11'] === 'yes');
            $dieValue = $isRolled ? bga_rand(1, DIE_FACES) : 'NULL';
            $this->game->DbQuery("UPDATE `dice` SET `die_value` = $dieValue, `modified_by_POWER9` = 'no' WHERE `die_color` = '".$dieDB['die_color']."'");
        }
    }

    /**
     * Rolled dice $playerID may use: gold only while in use, and never a die another player reserved with a card 2.
     */
    function getAvailableDice(int $playerID): array{
        $diceDB = $this->game->getObjectListFromDB(
            "SELECT `die_color`, `die_value` FROM `dice`
             WHERE `die_location` = 'in_play' AND `die_value` IS NOT NULL
             AND (`die_color` <> 'gold' OR `in_use_by_POWER11` = 'yes')
             AND (`reserved_by_POWER2` IS NULL OR `reserved_by_POWER2` = $playerID)
             ORDER BY `die_color` ASC"
        );

        $availableDice = [];
        foreach($diceDB as $dieDB)
            $availableDice[] = ['color' => $dieDB['die_color'], 'value' => (int) $dieDB['die_value']];

        return $availableDice;
    }

    /**
     * Hand cards of $playerID that match one available die (color and value), or the sum of two available dice
     * under the color of either of them. The golden die adds to a sum but never gives a color.
     */
    function getPlayableCardIDs(int $playerID): array{
        $availableDice = $this->getAvailableDice($playerID);

        $playableColorValues = []; //"color:value" => true
        foreach($availableDice as $die){
            if($die['color'] !== 'gold')
                $playableColorValues[$die['color'].':'.$die['value']] = true;
        }

        for($i = 0; $i < count($availableDice); $i++){
            for($j = $i + 1; $j < count($availableDice); $j++){
                $sum = $availableDice[$i]['value'] + $availableDice[$j]['value'];
                foreach([$availableDice[$i], $availableDice[$j]] as $die){
                    if($die['color'] !== 'gold')
                        $playableColorValues[$die['color'].':'.$sum] = true;
                }
            }
        }

        $handCardsDB = $this->game->getObjectListFromDB("SELECT `card_id`, `color`, `value` FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID ORDER BY `color` ASC, `value` ASC");

        $playableCardIDs = [];
        foreach($handCardsDB as $cardDB){
            if(isset($playableColorValues[$cardDB['color'].':'.$cardDB['value']]))
                $playableCardIDs[] = (int) $cardDB['card_id'];
        }

        return $playableCardIDs;
    }

    function getHandCards(int $playerID): array{
        $handCardsDB = $this->game->getObjectListFromDB("SELECT * FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID ORDER BY `color` ASC, `value` ASC");
        return array_map(fn(array $cardDB) => $this->formatCard($cardDB), $handCardsDB);
    }

    /**
     * Hand count of every player, 0 included. Public information.
     */
    function getHandCounts(): array{
        $handCountsDB = $this->game->getCollectionFromDB(
            "SELECT `player`.`player_id`, COUNT(`cards`.`card_id`) FROM `player`
             LEFT JOIN `cards` ON `cards`.`card_location` = 'hand' AND `cards`.`card_location_arg` = `player`.`player_id`
             GROUP BY `player`.`player_id`", true
        );

        $handCounts = [];
        foreach($handCountsDB as $playerID => $handCount)
            $handCounts[(int) $playerID] = (int) $handCount;

        return $handCounts;
    }

    function getStarsInColumn(int $playerID): int{
        $playedValues = $this->game->getObjectListFromDB("SELECT `value` FROM `cards` WHERE `card_location` = 'played' AND `card_location_arg` = $playerID", true);
        return array_sum(array_map(fn($value) => STARS_BY_VALUE[(int) $value], $playedValues));
    }

    function getNextLocationInColumn(int $playerID): int{
        return (int) $this->game->getUniqueValueFromDB("SELECT COALESCE(MAX(`location_in_column`), 0) FROM `cards` WHERE `card_location` = 'played' AND `card_location_arg` = $playerID") + 1;
    }

    /**
     * Every player id in turn order (clockwise), starting with $firstPlayerID.
     */
    function getPlayerIDsInTurnOrderFrom(int $firstPlayerID): array{
        $nextPlayerTable = $this->game->getNextPlayerTable();
        $playerIDs = [];
        $playerID = $firstPlayerID;

        do {
            $playerIDs[] = $playerID;
            $playerID = (int) $nextPlayerTable[$playerID];
        } while($playerID !== $firstPlayerID);

        return $playerIDs;
    }

    /**
     * A crash discards the player's hand and played column.
     */
    function discardPlayerCards(int $playerID): void{
        $this->game->DbQuery("UPDATE `cards` SET `card_location` = 'discard', `location_in_column` = NULL WHERE `card_location` IN ('hand', 'played') AND `card_location_arg` = $playerID");
    }
}

?>
