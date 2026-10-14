
-- ------
-- BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
-- Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
--
-- This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
-- See http://en.boardgamearena.com/#!doc/Studio for more information.
-- -----

-- This is the file where you are describing the database schema of your game
-- Basically, you just have to export from PhpMyAdmin your table structure and copy/paste
-- this export here.
-- Note that the database itself and the standard tables ("global", "stats", "gamelog" and "player") are
-- already created and must not be created here

-- Note: The database schema is created from this file when the game starts. If you modify this file,
--       you have to restart a game to see your changes in database.

-- card_location_arg: shuffle order in 'deck', player_id in 'hand', 'played' and 'discard'
-- chain_position_POWER1: order of a hand card added to a card-1 chain (1 = first extra card), pending until RevealCards like play_choice_card_id
-- color ENUM is declared in sprite order (same as CARD_COLORS in material.inc.php), so ORDER BY `color` sorts like the sprite
CREATE TABLE IF NOT EXISTS `cards` (
  `card_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `card_type` varchar(16) NOT NULL,
  `card_type_arg` int(11) NOT NULL,
  `card_location` ENUM('deck', 'hand', 'played', 'discard', 'returned_to_box') NOT NULL,
  `card_location_arg` int(11) NOT NULL,
  `location_in_column` TINYINT UNSIGNED NULL,
  `chain_position_POWER1` TINYINT UNSIGNED NULL,
  `color` ENUM('red', 'green', 'purple', 'blue', 'orange') NOT NULL,
  `value` TINYINT NOT NULL,
  PRIMARY KEY (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 AUTO_INCREMENT=1;

-- in_use_by_POWER11 is only meaningful on the gold die
CREATE TABLE IF NOT EXISTS `dice` (
  `die_color` ENUM('red', 'green', 'purple', 'blue', 'orange', 'gold') NOT NULL,
  `die_location` ENUM('in_play', 'returned_to_box') NOT NULL DEFAULT 'in_play',
  `die_value` TINYINT UNSIGNED NULL,
  `reserved_by_POWER2` INT UNSIGNED NULL,
  `modified_by_POWER9` ENUM('yes', 'no') NOT NULL DEFAULT 'no',
  `in_use_by_POWER11` ENUM('yes', 'no') NOT NULL DEFAULT 'no',
  PRIMARY KEY (`die_color`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `player` ADD `round_status` ENUM('in', 'stopped', 'crashed') NOT NULL DEFAULT 'in' AFTER `player_state`;
ALTER TABLE `player` ADD `last_chance_used` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `round_status`;
-- pending choices of the multiactive states, cleared by Change my mind. The chosen card stays in 'hand' until RevealCards
-- made_choice_this_state: extra time only on the first choice of a state
-- keep comments on their own lines and without semicolons: BGA splits this file into statements itself
ALTER TABLE `player` ADD `play_choice` ENUM('card', 'last_chance', 'crash') NULL AFTER `last_chance_used`;
ALTER TABLE `player` ADD `play_choice_card_id` INT UNSIGNED NULL AFTER `play_choice`;
ALTER TABLE `player` ADD `stop_or_more_choice` ENUM('stop', 'more') NULL AFTER `play_choice_card_id`;
ALTER TABLE `player` ADD `made_choice_this_state` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `stop_or_more_choice`;
-- a non-1 power revealed this turn, waiting to resolve: 2, 10 and 11 before the next roll, 9 after it
ALTER TABLE `player` ADD `pending_POWER2` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `made_choice_this_state`;
ALTER TABLE `player` ADD `pending_POWER9` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER2`;
ALTER TABLE `player` ADD `pending_POWER10` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER9`;
ALTER TABLE `player` ADD `pending_POWER11` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER10`;
-- card 11: this player added the golden die to the next roll. It is dropped when every player who added it chose Stop
ALTER TABLE `player` ADD `added_golden_die_POWER11` ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER `pending_POWER11`;

-- one row per player per round, for the end-game scoring table
-- round_result: stopped banks stars, crashed scores 0, grand_slam ends the game, unfinished means a Grand Slam ended the round first
-- stars: points added to player_score that round (for grand_slam, the jump to the Grand Slam score)
CREATE TABLE IF NOT EXISTS `round_scores` (
  `round_number` TINYINT UNSIGNED NOT NULL,
  `player_id` INT UNSIGNED NOT NULL,
  `round_result` ENUM('stopped', 'crashed', 'grand_slam', 'unfinished') NOT NULL,
  `stars` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_number`, `player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
