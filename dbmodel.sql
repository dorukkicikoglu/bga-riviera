
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
-- color ENUM is declared in sprite order (same as CARD_COLORS in material.inc.php), so ORDER BY `color` sorts like the sprite
CREATE TABLE IF NOT EXISTS `cards` (
  `card_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `card_type` varchar(16) NOT NULL,
  `card_type_arg` int(11) NOT NULL,
  `card_location` ENUM('deck', 'hand', 'played', 'discard', 'returned_to_box') NOT NULL,
  `card_location_arg` int(11) NOT NULL,
  `location_in_column` TINYINT UNSIGNED NULL,
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
