<?php
/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * Game.php
 *
 * This is the main file for your game logic.
 *
 * In this PHP file, you are going to defines the rules of the game.
 */
declare(strict_types=1);

namespace Bga\Games\Riviera;

use Bga\Games\Riviera\States\RoundSetup;
use Bga\GameFramework\Components\Deck;
use Bga\Games\Riviera\RIVTableManager;
use Bga\Games\Riviera\RIVUndoManager;
use Bga\Games\Riviera\RIVPowerManager;
use Bga\GameFramework\Actions\Debug;

class Game extends \Bga\GameFramework\Table
{
    public Deck $cardsDeck;
    public RIVTableManager $tableManager;
    public RIVUndoManager $undoManager;
    public RIVPowerManager $powerManager;
    public array $userPrefs = array(
        'one_click_play' => 101,
    );

    /**
     * Your global variables labels:
     *
     * Riviera stores its globals with $this->bga->globals:
     * - startPlayerId: player holding the Start token
     * - roundNumber: current round, starting at 1
     */
    public function __construct()
    {
        parent::__construct();

        require_once 'material.inc.php';

        // automatically complete notification args when needed
        $this->bga->notify->addDecorator(function(string $message, array $args) {
            if (isset($args['player_id']) && !isset($args['player_name']) && str_contains($message, '${player_name}')) {
                $args['player_name'] = $this->getPlayerNameById($args['player_id']);
            }

            return $args;
        });

        $this->cardsDeck = $this->deckFactory->createDeck("cards");
        $this->tableManager = new RIVTableManager($this);
        $this->undoManager = new RIVUndoManager($this);
        $this->powerManager = new RIVPowerManager($this);
    }

    /**
     * The highest banked score plus the stars in front of a player still in the round, out of WINNING_SCORE. A stopped
     * player's column is already in their score (banked at the Stop reveal), so it is not counted twice.
     * Capped at 99: the game only reaches 100 when it really ends. Recomputed by RoundSetup and RevealCards; banking at a
     * Stop doesn't change it (the stars only move from the column to the score).
     */
    public function getGameProgression()
    {
        $roundStatuses = $this->getCollectionFromDB("SELECT `player_id`, `round_status` FROM `player`", true);
        $scores = $this->bga->playerScore->getAll();
        $starsInColumns = $this->tableManager->getStarsInColumnByPlayer();

        $bestScore = 0;
        foreach($roundStatuses as $playerID => $roundStatus){
            $columnStars = ($roundStatus === 'in') ? ($starsInColumns[(int) $playerID] ?? 0) : 0;
            $bestScore = max($bestScore, ($scores[(int) $playerID] ?? 0) + $columnStars);
        }

        $progress = (int) floor(100 * $bestScore / WINNING_SCORE);

        return min(99, max(0, $progress));
    }

    /**
     * Migrate database.
     *
     * You don't have to care about this until your game has been published on BGA. Once your game is on BGA, this
     * method is called everytime the system detects a game running with your old database scheme. In this case, if you
     * change your database scheme, you just have to apply the needed changes in order to update the game database and
     * allow the game to continue to run with your new version.
     *
     * @param int $from_version
     * @return void
     */
    public function upgradeTableDb($from_version)
    {
//       if ($from_version <= 1404301345)
//       {
//            // ! important ! Use `DBPREFIX_<table_name>` for all tables
//
//            $sql = "ALTER TABLE `DBPREFIX_xxxxxxx` ....";
//            $this->applyDbUpgradeToAllDB( $sql );
//       }
//
//       if ($from_version <= 1405061421)
//       {
//            // ! important ! Use `DBPREFIX_<table_name>` for all tables
//
//            $sql = "CREATE TABLE `DBPREFIX_xxxxxxx` ....";
//            $this->applyDbUpgradeToAllDB( $sql );
//       }
    }

    /*
     * Gather all information about current game situation (visible by the current player).
     *
     * The method is called each time the game interface is displayed to a player, i.e.:
     *
     * - when the game starts
     * - when a player refreshes the game page (F5)
     */
    protected function getAllDatas(int $currentPlayerId): array
    {   
        $result = [];
        // WARNING: We must only return information visible by the current player (using $currentPlayerId).

        $cardsOnTable = $this->tableManager->getCardsOnTable($currentPlayerId);

        // Get information about players.
        // NOTE: you can retrieve some extra field you added for "player" table in `dbmodel.sql` if you need it.
        $result["players"] = $this->getCollectionFromDb("SELECT `player_id`, `player_no`, `round_status`, `last_chance_used` FROM `player`");
        $scores = $this->bga->playerScore->getAll();
        foreach($result["players"] as $player_id => $row){
            $result["players"][$player_id]['score'] = $scores[(int) $player_id] ?? 0;
            $result["players"][$player_id]['last_chance_used'] = ($row['last_chance_used'] == 'yes') ? true : false;
            $result["players"][$player_id]['hand_count'] = $cardsOnTable['handCounts'][$player_id] ?? 0; //hand counts are public, spectators get them too
        }

        $result['cardsInMyHand'] = $cardsOnTable['myHand'];
        $result['cardsPlayed'] = $cardsOnTable['played'];
        $result['dice'] = $this->tableManager->getDice();
        $result['startPlayerId'] = (int) $this->bga->globals->get('startPlayerId');
        $result['roundNumber'] = (int) $this->bga->globals->get('roundNumber');
        $result['cardColors'] = CARD_COLORS;
        $result['starsByValue'] = STARS_BY_VALUE;
        $result['pref_names'] = $this->userPrefs;
        $result['grandSlamPlayerIds'] = $this->tableManager->getGrandSlamPlayerIDs();

        $state = $this->gamestate->getCurrentMainState();
        if($state->name == 'gameEnd')
            $result['endGameScoring'] = $this->getEndGameScoring();

        return $result;
    }

    /**
     * This method is called only once, when a new game is launched. In this method, you must setup the game
     *  according to the game rules, so that the game is ready to be played.
     */
    protected function setupNewGame($players, $options = [])
    {
        // Set the colors of the players with HTML color code. The default below is red/green/blue/orange/brown. The
        // number of colors defined here must correspond to the maximum number of players allowed for the gams.
        $gameinfos = $this->getGameinfos();
        $default_colors = $gameinfos['player_colors'];

        foreach ($players as $player_id => $player) {
            // Now you can access both $player_id and $player array
            $query_values[] = vsprintf("(%s, '%s', '%s')", [
                $player_id,
                array_shift($default_colors),
                addslashes($player["player_name"]),
            ]);
        }

        // Create players based on generic information.
        //
        // NOTE: You can add extra field on player table in the database (see dbmodel.sql) and initialize
        // additional fields directly here.
        static::DbQuery(
            sprintf(
                "INSERT INTO `player` (`player_id`, `player_color`, `player_name`) VALUES %s",
                implode(",", $query_values)
            )
        );

        $this->reattributeColorsBasedOnPreferences($players, $gameinfos["player_colors"]);
        $this->reloadPlayersBasicInfos();

        //Setup the initial game situation
        //all 60 cards are created; a removed color stays in the DB as 'returned_to_box'
        $cardRows = array();
        $cardID = 1;
        foreach(CARD_COLORS as $color){
            for($value = 1; $value <= VALUES_PER_COLOR; $value++){
                $cardRows[] = "('$cardID', 'number', '0', 'deck', '$cardID', '$color', '$value')";
                $cardID++;
            }
        }
        self::DbQuery("INSERT INTO `cards` (`card_id`, `card_type`, `card_type_arg`, `card_location`, `card_location_arg`, `color`, `value`) VALUES ".implode(',', $cardRows));

        $diceRows = array();
        foreach([...CARD_COLORS, 'gold'] as $dieColor)
            $diceRows[] = "('$dieColor')";
        self::DbQuery("INSERT INTO `dice` (`die_color`) VALUES ".implode(',', $diceRows));

        if(count($players) <= MAX_PLAYERS_WITH_ONE_COLOR_REMOVED){
            $removedColor = CARD_COLORS[bga_rand(1, count(CARD_COLORS))];
            self::DbQuery("UPDATE `cards` SET `card_location` = 'returned_to_box', `card_location_arg` = 0 WHERE `color` = '$removedColor'");
            self::DbQuery("UPDATE `dice` SET `die_location` = 'returned_to_box' WHERE `die_color` = '$removedColor'");
        }

        // Init game statistics. lastChanceRound is left out on purpose: it is only set when a Last Chance is used,
        // so games without one don't drag its average down
        $this->bga->tableStats->init(['rounds', 'turns'], 0);
        $this->bga->playerStats->init(['roundsPlayed', 'roundsStopped', 'crashes', 'starsBanked', 'bestRound', 'cardsPlayed',
            'powerUsed_POWER1', 'powerUsed_POWER2', 'powerUsed_POWER9', 'powerUsed_POWER10', 'powerUsed_POWER11'], 0);
        $this->bga->playerStats->init(['lastChanceUsed', 'grandSlam'], false);

        // Init global values with their initial values.
        $playerIDs = array_keys($players);
        $this->bga->globals->set('startPlayerId', (int) $playerIDs[bga_rand(0, count($playerIDs) - 1)]);
        $this->bga->globals->set('roundNumber', 0); //RoundSetup increments it to 1

        return RoundSetup::class;
    }

    //utility functions

    public function getPlayerIDsInRound(): array {
        return array_map('intval', $this->getObjectListFromDB("SELECT `player_id` FROM `player` WHERE `round_status` = 'in'", true));
    }

    //plain text for a card in the server-side fallback of a log string; the client always replaces it with a card icon
    public function getCardLogHTML(array $cardData){
        $color = $cardData['color'];
        $value = $cardData['value'];
        return "<span><span>{$color}</span> <span>{$value}</span></span>";
    }

    /**
     * [BGA] Grand Slam: these players emptied their hand and win at once. Their score becomes
     * max(GRAND_SLAM_MIN_SCORE, highest other score + 1) so BGA ranks them first; several of them share the win.
     */
    public function applyGrandSlam(array $playerIDs): void {
        $playerIDs = array_map('intval', $playerIDs);
        $scores = $this->bga->playerScore->getAll();
        $otherScores = array_diff_key($scores, array_flip($playerIDs));
        $highestOtherScore = empty($otherScores) ? 0 : max($otherScores);
        $grandSlamScore = max(GRAND_SLAM_MIN_SCORE, $highestOtherScore + 1);

        $roundNumber = (int) $this->bga->globals->get('roundNumber');
        $roundStatuses = $this->getCollectionFromDB("SELECT `player_id`, `round_status` FROM `player`", true);

        //the end-game table: the Grand Slam players get the jump to their new score; players still in had their round cut
        //short. Players who stopped (banked at their Stop) or crashed earlier this round already have their row
        foreach($roundStatuses as $playerID => $roundStatus){
            $playerID = (int) $playerID;
            if(in_array($playerID, $playerIDs, true))
                $this->tableManager->saveRoundScore($roundNumber, $playerID, 'grand_slam', max(0, $grandSlamScore - ($scores[$playerID] ?? 0)));
            else if($roundStatus === 'in')
                $this->tableManager->saveRoundScore($roundNumber, $playerID, 'unfinished', 0);
        }

        foreach($playerIDs as $playerID){
            $this->bga->playerScore->set($playerID, $grandSlamScore, null); //null: no framework notif, grandSlam updates the counter
            $this->bga->playerStats->set('grandSlam', true, $playerID);

            $this->bga->notify->all('grandSlam', '${GRAND_SLAM_LOG_STR}', [
                'preserve' => ['player_id', 'score'],
                'player_id' => $playerID,
                'score' => $grandSlamScore,
                'GRAND_SLAM_LOG_STR' => $this->getPlayerNameById($playerID).' plays all 10 cards: Grand Slam!',
            ]);
        }
    }

    /**
     * Everything the end-game scoring table needs. Everyone at the top score wins (Grand Slam players and tied
     * scores share the win). The Total row shows each player's BGA score itself, so it always matches BGA's ranking.
     */
    public function getEndGameScoring(): array {
        $scores = [];
        foreach($this->bga->playerScore->getAll() as $playerID => $score)
            $scores[(int) $playerID] = (int) $score;

        $winningScore = max($scores);
        $winnerIDs = array_keys(array_filter($scores, fn(int $score) => $score === $winningScore));

        return [
            'winner_ids' => $winnerIDs,
            'winning_score' => $winningScore,
            'rounds' => $this->tableManager->getRoundScores(),
            'scores' => $scores,
        ];
    }

    //end utility functions

    /**
     * Example of debug function.
     * Here, jump to a state you want to test (by default, jump to next player state)
     * You can trigger it on Studio using the Debug button on the right of the top bar.
     */
    #[Debug(reload: true)]
    public function debug_goToState(int $state = 5) {
        $this->gamestate->jumpToState($state);
    }

    // starts a new round: new hands, cleared columns, a new roll
    #[Debug(reload: true)]
    public function debug_redeal() {
        $this->gamestate->jumpToState(5); //RoundSetup
    }

    // moves $count random hand cards per player to their played column; refresh (F5) to see them
    #[Debug(reload: true)]
    public function debug_playRandomCards(int $count = 3) {
        $playerIDs = $this->getObjectListFromDB("SELECT `player_id` FROM `player`", true);

        foreach($playerIDs as $playerID){
            $nextLocationInColumn = (int) $this->getUniqueValueFromDB("SELECT COALESCE(MAX(`location_in_column`), 0) FROM `cards` WHERE `card_location` = 'played' AND `card_location_arg` = $playerID") + 1;
            $cardIDs = $this->getObjectListFromDB("SELECT `card_id` FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID ORDER BY RAND() LIMIT $count", true);

            foreach($cardIDs as $cardID){
                self::DbQuery("UPDATE `cards` SET `card_location` = 'played', `location_in_column` = $nextLocationInColumn WHERE `card_id` = $cardID");
                $nextLocationInColumn++;
            }
        }
    }

    // passes the Start token to the next player with its animation and log line
    #[Debug]
    public function debug_passStartToken() {
        $this->tableManager->passStartToken();
    }

    // sets the dice in play (colored dice in color order, comma separated), then re-enters PlayCard so the playable cards are recomputed
    #[Debug(reload: true)]
    public function debug_setDice(string $values = '1,2,3,4,5') {
        $dieValues = array_map('intval', explode(',', $values));
        $colorsInUse = $this->tableManager->getColorsInUse();

        foreach($colorsInUse as $index => $color){
            if(!isset($dieValues[$index]))
                break;

            $dieValue = max(1, min(DIE_FACES, $dieValues[$index]));
            self::DbQuery("UPDATE `dice` SET `die_value` = $dieValue WHERE `die_color` = '$color'");
        }

        $this->gamestate->jumpToState(20); //PlayCard
    }

    // sets every player's score
    #[Debug(reload: true)]
    public function debug_setScores(int $score = 38) {
        $this->bga->playerScore->setAll($score, null); //null: no notif, the page reloads
    }

    // each player keeps $count random hand cards, the rest are discarded (to test Grand Slam)
    #[Debug(reload: true)]
    public function debug_trimHands(int $count = 1) {
        $this->debugTrimHands($count);
        $this->gamestate->jumpToState(20); //PlayCard, so the playable cards are recomputed
    }

    // each player keeps $count random hand cards, then the dice are rolled as a round's first roll, so the silent re-roll applies (if the option is on); each re-roll writes a "First roll re-rolled" line in the Studio server log
    #[Debug(reload: true)]
    public function debug_firstRoll(int $count = 2) {
        $this->debugTrimHands($count);
        $this->bga->globals->set('isFirstRollOfRound', true);
        $this->gamestate->jumpToState(10); //RollDice
    }

    private function debugTrimHands(int $count): void {
        $playerIDs = $this->getObjectListFromDB("SELECT `player_id` FROM `player`", true);

        foreach($playerIDs as $playerID){
            $keptCardIDs = $this->getObjectListFromDB("SELECT `card_id` FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID ORDER BY RAND() LIMIT $count", true);
            $keptCardsCondition = empty($keptCardIDs) ? "" : " AND `card_id` NOT IN (".implode(',', $keptCardIDs).")";
            self::DbQuery("UPDATE `cards` SET `card_location` = 'discard' WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID".$keptCardsCondition);
        }
    }

    // card 1: two 1s and a 2, all playable on the same roll, to chain 1 -> 1 -> 2 (the 2 then reserves its die)
    #[Debug(reload: true)]
    public function debug_POWER1() {
        $this->debugGiveCards((int) $this->getCurrentPlayerId(), [1, 1, 2]);
    }

    // card 2: a playable 2; its die is reserved for me after the reveal
    #[Debug(reload: true)]
    public function debug_POWER2() {
        $this->debugGiveCards((int) $this->getCurrentPlayerId(), [2]);
    }

    // card 9: a playable 9. With $resolveNow, my card 9 is pending at once and the dice are rerolled, so ModifyDie starts right away.
    // With $othersStopped, every other player is stopped, so I am the only player in (card 9's undo)
    #[Debug(reload: true)]
    public function debug_POWER9(bool $resolveNow = false, bool $othersStopped = false) {
        $currentPlayerID = (int) $this->getCurrentPlayerId();

        if($othersStopped)
            self::DbQuery("UPDATE `player` SET `round_status` = 'stopped' WHERE `player_id` <> $currentPlayerID AND `round_status` = 'in'");

        if($resolveNow){
            self::DbQuery("UPDATE `player` SET `pending_POWER9` = 'yes' WHERE `player_id` = $currentPlayerID");
            $this->gamestate->jumpToState(10); //RollDice
            return;
        }

        $this->debugGiveCards($currentPlayerID, [9]);
    }

    // card 10: a playable 10. With $othersStopped, every other player is stopped, so the 10 falls back to discard and draw
    #[Debug(reload: true)]
    public function debug_POWER10(bool $othersStopped = false) {
        $currentPlayerID = (int) $this->getCurrentPlayerId();

        if($othersStopped)
            self::DbQuery("UPDATE `player` SET `round_status` = 'stopped' WHERE `player_id` <> $currentPlayerID AND `round_status` = 'in'");

        $this->debugGiveCards($currentPlayerID, [10]);
    }

    // card 11: a playable 11
    #[Debug(reload: true)]
    public function debug_POWER11() {
        $this->debugGiveCards((int) $this->getCurrentPlayerId(), [11]);
    }

    // sets the draw pile and discard pile sizes for the card-10 fallback; cards left over go to the box FOR THE REST OF THIS TABLE
    #[Debug(reload: true)]
    public function debug_setDrawPile(int $deckCount = 0, int $discardCount = 0) {
        $pileCardIDs = $this->getObjectListFromDB("SELECT `card_id` FROM `cards` WHERE `card_location` IN ('deck', 'discard') ORDER BY RAND()", true);

        foreach($pileCardIDs as $index => $cardID){
            if($index < $deckCount)
                $location = 'deck';
            else if($index < $deckCount + $discardCount)
                $location = 'discard';
            else $location = 'returned_to_box';

            self::DbQuery("UPDATE `cards` SET `card_location` = '$location', `card_location_arg` = 0 WHERE `card_id` = $cardID");
        }

        $this->cardsDeck->shuffle('deck');
    }

    /**
     * Debug helper: puts one card of each value in $values into $playerID's hand, each in a different color in use
     * that nobody has played yet, sets the dice so every one of them is playable, then re-enters PlayCard.
     * A card taken from another hand or a pile is swapped with a random card of mine, so every count stays the same.
     */
    private function debugGiveCards(int $playerID, array $values): void {
        $colorsInUse = $this->tableManager->getColorsInUse();
        $usedColors = [];
        $dieValues = [];

        foreach($values as $value){
            $cardDB = null;
            foreach($colorsInUse as $color){
                if(in_array($color, $usedColors, true))
                    continue;

                $candidateDB = $this->getObjectFromDB("SELECT * FROM `cards` WHERE `color` = '$color' AND `value` = $value AND `card_location` IN ('deck', 'discard', 'hand')");
                if($candidateDB){
                    $cardDB = $candidateDB;
                    break;
                }
            }
            if(!$cardDB)
                continue;

            $usedColors[] = $cardDB['color'];
            $dieValues[$cardDB['color']] = min($value, DIE_FACES);

            $isAlreadyMine = $cardDB['card_location'] === 'hand' && (int) $cardDB['card_location_arg'] === $playerID;
            if(!$isAlreadyMine){
                $givenCardsCondition = empty($usedColors) ? "" : " AND NOT (`value` IN (".implode(',', $values).") AND `color` IN ('".implode("','", $usedColors)."'))";
                $myCardDB = $this->getObjectFromDB("SELECT * FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID".$givenCardsCondition." ORDER BY RAND() LIMIT 1");
                if($myCardDB)
                    self::DbQuery("UPDATE `cards` SET `card_location` = '".$cardDB['card_location']."', `card_location_arg` = ".$cardDB['card_location_arg']." WHERE `card_id` = ".$myCardDB['card_id']);

                self::DbQuery("UPDATE `cards` SET `card_location` = 'hand', `card_location_arg` = $playerID WHERE `card_id` = ".$cardDB['card_id']);
            }

            if($value > DIE_FACES){ //a sum: the card's die shows 6, a die of a color not used here shows the rest
                foreach($colorsInUse as $otherColor){
                    if(!in_array($otherColor, $usedColors, true) && !isset($dieValues[$otherColor])){
                        $dieValues[$otherColor] = $value - DIE_FACES;
                        break;
                    }
                }
            }
        }

        foreach($dieValues as $color => $dieValue)
            self::DbQuery("UPDATE `dice` SET `die_value` = $dieValue, `modified_by_POWER9` = 'no' WHERE `die_color` = '$color'");

        $this->gamestate->jumpToState(20); //PlayCard
    }

    public function message($txt, $desc = '', $color = 'blue') {
        if ($this->getBgaEnvironment() != "studio")
            return;

        if (is_array($txt))
            $txt = json_encode($txt);

        if($desc != '')
            $txt .= "   ".json_encode($desc);

        self::trace("Logging: <span style='color: $color;'>$txt</span>");
        self::notifyAllPlayers('plop',"<textarea style='height: 104px; width: 230px;color:$color'>$txt</textarea>",array());
    }
}
