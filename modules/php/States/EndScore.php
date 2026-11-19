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
 * EndScore.php
 */

declare(strict_types=1);

namespace Bga\Games\Riviera\States;

use Bga\GameFramework\StateType;
use Bga\Games\Riviera\Game;

const ST_END_GAME = 99;

class EndScore extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 98,
            type: StateType::GAME,
        );
    }

    /**
     * The game ends (40 points after a round, or a Grand Slam): everyone gets the end-game scoring table and one
     * log row naming the winner(s). Scores are already final, and statistics are kept up to date during the game.
     * [BGA] After a single Grand Slam, no winner row: its own row already says it, and the Grand Slam score is only there to
     * rank. After a simultaneous Grand Slam, the row says whether stars decided it or the winners share it (grand_slam_stars).
     */
    public function onEnteringState() {
        $endGameScoring = $this->game->getEndGameScoring();
        $isGrandSlam = !empty($this->game->tableManager->getGrandSlamPlayerIDs());
        $grandSlamStars = $endGameScoring['grand_slam_stars'];
        $hasLogRow = !$isGrandSlam || $grandSlamStars !== null;

        $winnerNames = array_map(fn(int $playerID) => $this->game->getPlayerNameById($playerID), $endGameScoring['winner_ids']);
        $logFallback = ($grandSlamStars === null)
            ? implode(', ', $winnerNames).' win with '.$endGameScoring['winning_score'].' stars'
            : implode(', ', $winnerNames).' win the Grand Slam with '.$grandSlamStars.' stars';
        $this->bga->notify->all('displayEndGameScoring', $hasLogRow ? '${GAME_END_LOG_STR}' : '', [
            'preserve' => ['winner_ids', 'winning_score', 'grand_slam_stars'],
            'winner_ids' => $endGameScoring['winner_ids'],
            'winning_score' => $endGameScoring['winning_score'],
            'grand_slam_stars' => $grandSlamStars,
            'endGameScoring' => $endGameScoring,
            'GAME_END_LOG_STR' => $logFallback,
        ]);

        return ST_END_GAME;
    }
}