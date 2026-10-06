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
use Bga\Games\Riviera\RIVChangeMindManager;
use Bga\GameFramework\Actions\Debug;

class Game extends \Bga\GameFramework\Table
{
    public Deck $cardsDeck;
    public RIVTableManager $tableManager;
    public RIVChangeMindManager $changeMindManager;

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
        $this->changeMindManager = new RIVChangeMindManager($this);
    }

    public function getGameProgression()
    {
        $maxScore = (int) $this->getUniqueValueFromDB("SELECT MAX(`player_score`) FROM `player`");
        $progress = (int) floor(100 * $maxScore / WINNING_SCORE);

        return min(100, max(0, $progress));
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
        $result["players"] = $this->getCollectionFromDb("SELECT `player_id`, `player_no`, `player_score` score, `round_status`, `last_chance_used` FROM `player`");
        foreach($result["players"] as $player_id => $row){
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
        $playerIDList = implode(',', array_map('intval', $playerIDs));
        $highestOtherScore = (int) $this->getUniqueValueFromDB("SELECT COALESCE(MAX(`player_score`), 0) FROM `player` WHERE `player_id` NOT IN ($playerIDList)");
        $grandSlamScore = max(GRAND_SLAM_MIN_SCORE, $highestOtherScore + 1);

        foreach($playerIDs as $playerID){
            $this->bga->playerScore->set((int) $playerID, $grandSlamScore, null); //null: no framework notif, grandSlam updates the counter

            $this->bga->notify->all('grandSlam', '${GRAND_SLAM_LOG_STR}', [
                'preserve' => ['player_id', 'score'],
                'player_id' => (int) $playerID,
                'score' => $grandSlamScore,
                'GRAND_SLAM_LOG_STR' => $this->getPlayerNameById((int) $playerID).' plays all 10 cards: Grand Slam!',
            ]);
        }
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
        self::DbQuery("UPDATE `player` SET `player_score` = $score");
    }

    // each player keeps $count random hand cards, the rest are discarded (to test Grand Slam)
    #[Debug(reload: true)]
    public function debug_trimHands(int $count = 1) {
        $playerIDs = $this->getObjectListFromDB("SELECT `player_id` FROM `player`", true);

        foreach($playerIDs as $playerID){
            $keptCardIDs = $this->getObjectListFromDB("SELECT `card_id` FROM `cards` WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID ORDER BY RAND() LIMIT $count", true);
            $keptCardsCondition = empty($keptCardIDs) ? "" : " AND `card_id` NOT IN (".implode(',', $keptCardIDs).")";
            self::DbQuery("UPDATE `cards` SET `card_location` = 'discard' WHERE `card_location` = 'hand' AND `card_location_arg` = $playerID".$keptCardsCondition);
        }

        $this->gamestate->jumpToState(20); //PlayCard, so the playable cards are recomputed
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
