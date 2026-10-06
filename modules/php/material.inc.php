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
 * material.inc.php
 *
 * Riviera game material description
 *
 * Here, you can describe the material of your game with PHP variables.
 *
 * This file is loaded in your game logic class constructor, ie these variables
 * are available everywhere in your game logic code.
 *
 */

if (!defined('CARD_COLORS')) { // guard since this included multiple times
    define("CARD_COLORS", [1 => 'red', 2 => 'green', 3 => 'purple', 4 => 'blue', 5 => 'orange']); //key is the sprite/color index; same order as the color ENUM in dbmodel.sql and $card-colors in Game.scss
    define("VALUES_PER_COLOR", 12);
    define("STARS_BY_VALUE", [1 => 2, 2 => 2, 3 => 2, 4 => 1, 5 => 1, 6 => 1, 7 => 1, 8 => 2, 9 => 2, 10 => 2, 11 => 3, 12 => 5]); //stars printed on the top strip, same for every color

    define("CARDS_PER_HAND", 10);
    define("MAX_CARDS_OF_ONE_COLOR_IN_HAND", 6); //a dealt hand with more than this of one color is silently redealt
    define("MAX_REDEAL_ATTEMPTS", 1000); //safety cap for the silent redeal loop, never expected to be reached
    define("MAX_PLAYERS_WITH_ONE_COLOR_REMOVED", 4); //2 to 4 players play without one random color (its 12 cards and its die)
    define("WINNING_SCORE", 40);

    define("CARD_COLOR_NAMES", [
        'red' => clienttranslate('red'),
        'green' => clienttranslate('green'),
        'purple' => clienttranslate('purple'),
        'blue' => clienttranslate('blue'),
        'orange' => clienttranslate('orange'),
    ]);
}
