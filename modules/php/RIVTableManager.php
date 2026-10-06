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

        $this->game->bga->notify->all('startTokenPassed', clienttranslate('${player_name} receives the Start token'), [
            'player_id' => $nextStartPlayerID,
        ]);

        return $nextStartPlayerID;
    }
}

?>
