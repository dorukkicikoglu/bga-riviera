/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * TooltipHandler.ts
 */
import { Game } from "./Game";

//every card value with a power; Game.createCardDiv gives those cards the power-card-POWER<n> class (used by the log row tooltips)
export const POWER_CARD_VALUES = [1, 2, 9, 10, 11];

export class TooltipHandler{
    private static readonly TOOLTIP_DELAY = 1000;
    private static readonly GAME_AREA_CARDS_SELECTOR = '#my-hand-container .a-card[id], #played-columns-container .a-card[id]';

    private powerReferenceHTMLByValue: Record<number, string> = {}; //0: no entry highlighted

    constructor(private game: Game) {
        this.addTooltipsToCards();
        this.addTooltipsToBoards();

        //log rows written before this handler existed; later rows come through LogMutationObserver
        const logs = document.getElementById('logs');
        if(logs)
            this.addTooltipsToCardsIn(logs);

        for(let dieData of this.game.diceHandler.getDiceData())
            this.updateDieTooltip(dieData);
	}

    //every card in the game area (my hand, every played column) shows the power reference, with the hovered card's power
    //highlighted. Tooltips only reach the cards already on the page, so this runs again whenever cards are created
	public addTooltipsToCards(){
        if(this.isSafariMobile()) {
            this.addTooltipToBottomForSafari();
            return;
        }

        document.querySelectorAll(TooltipHandler.GAME_AREA_CARDS_SELECTOR).forEach((card: HTMLDivElement) => {
            const value = parseInt(card.getAttribute('data-value'));
            this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerReferenceHTML(POWER_CARD_VALUES.includes(value) ? value : 0), TooltipHandler.TOOLTIP_DELAY);
        });

        this.game.bga.gameui.addTooltipToClass('last-chance-card', this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
    }

    //a log row: its mini cards keep the single-power tooltip. Only that row is queried, so loading a long log stays cheap
    public addTooltipsToCardsIn(container: HTMLElement){
        if(this.isSafariMobile())
            return;

        container.querySelectorAll('.a-card[id]').forEach((card: HTMLDivElement) => {
            const value = parseInt(card.getAttribute('data-value'));
            if(card.classList.contains(TooltipHandler.getPowerCardClass(value)))
                this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerTooltipHTML(value), TooltipHandler.TOOLTIP_DELAY);
            else if(card.classList.contains('last-chance-card'))
                this.game.bga.gameui.addTooltip(card.id, this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
        });
    }

    //player boards and played columns: the parts that aren't self-explanatory
    private addTooltipsToBoards(){
        this.game.bga.gameui.addTooltip('start-token', _('Start token: powers resolve clockwise from this player. Every turn it passes to the next player still in the round.'), '', TooltipHandler.TOOLTIP_DELAY);

        for(let player_id in this.game.players){
            this.game.bga.gameui.addTooltip('hand-count-backs-' + player_id, _('Cards in hand'), '', TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltipHtml('round-status-' + player_id, this.getRoundStatusTooltipHTML(), TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltip('column-stars-' + player_id, _('Stars of the cards played this round. A player who stops banks them; a crash loses them.'), '', TooltipHandler.TOOLTIP_DELAY);
        }
    }

    //a die's tooltip follows its card 2 reservation, card 9 change and, for gold, card 11
    public updateDieTooltip(dieData: RivieraDie){
        const dieID = 'die-' + dieData.color;
        if(!document.getElementById(dieID))
            return;

        const dieNames: Record<DieColor, string> = {
            red: _('Red die'),
            green: _('Green die'),
            purple: _('Purple die'),
            blue: _('Blue die'),
            orange: _('Orange die'),
            gold: _('Golden die (card 11): it only counts in a sum with a colored die and never gives its color'),
        };

        const lines = [dieNames[dieData.color]];
        if(dieData.reserved_by_POWER2 !== null)
            lines.push(_('Reserved by ${player_name} (card 2): only they can use it on this roll').replace('${player_name}', this.game.getPlayerName(dieData.reserved_by_POWER2)));
        if(dieData.modified_by_POWER9)
            lines.push(_('Turned by a card 9 this roll: it cannot be turned again'));

        this.game.bga.gameui.addTooltipHtml(dieID, `<div class="die-tooltip">${lines.join('<br>')}</div>`, TooltipHandler.TOOLTIP_DELAY);
    }

    private addTooltipToBottomForSafari(){
        if(document.querySelector('.safari-mobile-power-reference-container'))
            return;

        const safariMobilePowerReferenceContainer = document.createElement('div');
        safariMobilePowerReferenceContainer.className = 'safari-mobile-power-reference-container';
        safariMobilePowerReferenceContainer.innerHTML = this.getPowerReferenceHTML(0);
        document.getElementById('game_play_area').appendChild(safariMobilePowerReferenceContainer);
    }

    /**
     * The power reference, laid out like the rulebook's powers page: entries grouped by timing, each with its icon
     * (img/power_icons_sprite.webp) floated left. Two columns on desktop (left: card 1, then cards 2 and 10; right:
     * card 11, then card 9), one on narrow screens. $highlightedValue's entry is highlighted; 0 highlights none.
     * The text follows our BGA rules (SPEC.md), not the rulebook's wording.
     */
    private getPowerReferenceHTML(highlightedValue: number): string {
        if(this.powerReferenceHTMLByValue[highlightedValue])
            return this.powerReferenceHTMLByValue[highlightedValue];

        const powerTexts: Record<number, string> = {
            1: _('Play one more card from your hand on the same roll, revealed with it. It must be playable too, and another 1 lets you add again.'),
            2: _('Automatic: on the next roll, the die of this card\'s color is reserved for you. Opponents can\'t use it, alone or in a sum. Only if you choose More.'),
            10: _('Swap 2 cards of your choice for 2 random cards of an opponent who chose More and has at least 2 cards. If there is none, discard up to 2 cards and draw as many instead. Only if you choose More.'),
            11: _('Add the golden die to the next roll, for everyone. It has no color and only counts in a sum with a colored die. Only if you choose More.'),
            9: _('Turn one die by 1 up or down (a 6 becomes a 1, and a 1 a 6), for everyone. The golden die and a reserved die can be turned. Each die only once per roll. Only if you are still in the round.'),
        };

        const entryHTML = (value: number) => `
            <div class="power-reference-entry highlighted-power-entry">
                <span class="power-icon" data-power-value="${value}"></span><b>${_('Card ${value}:').replace('${value}', value.toString())}</b> ${powerTexts[value]}
            </div>`;
        const headingHTML = (heading: string) => `<div class="power-reference-heading">${heading}</div>`;

        const referenceHTML = `
            <div class="tooltip-wrapper power-reference">
                <div class="power-reference-column">
                    ${headingHTML(_('Power activated immediately after playing the card:'))}
                    ${entryHTML(1)}
                    ${headingHTML(_('Powers activated before the next dice roll:'))}
                    ${entryHTML(2)}
                    ${entryHTML(10)}
                </div>
                <div class="power-reference-column">
                    ${entryHTML(11)}
                    ${headingHTML(_('Power activated after the next dice roll and before playing a card:'))}
                    ${entryHTML(9)}
                </div>
            </div>
        `;

        this.powerReferenceHTMLByValue[highlightedValue] = referenceHTML;
        return referenceHTML;
    }

    //a single power, for the mini cards in log rows
    private getPowerTooltipHTML(value: number): string {
        const powerTexts: Record<number, {timing: string, effect: string}> = {
            1: {timing: _('Right away'), effect: _('Add one more playable card from your hand on the same dice. Another 1 lets you add again.')},
            2: {timing: _('After Stop or More, if you choose More'), effect: _('The die of this card\'s color is reserved for you on the next roll: opponents can\'t use it, alone or in a sum.')},
            9: {timing: _('After the next roll'), effect: _('You may turn one die by 1 up or down (6 becomes 1, 1 becomes 6), for everyone. Each die can be turned once per roll. Only if you are still in the round.')},
            10: {timing: _('After Stop or More, if you choose More'), effect: _('You may swap 2 cards of your choice for 2 random cards of an opponent who chose More. If none can be chosen, discard and draw instead.')},
            11: {timing: _('After Stop or More, if you choose More'), effect: _('You may add the golden die to the next roll, for everyone. It only counts in a sum with a colored die and never gives its color.')},
        };
        const {timing, effect} = powerTexts[value];
        const stars = '★'.repeat(this.game.getStarsForValue(value));

        const tooltipHTML = `
            <div class="tooltip-wrapper power-tooltip">
                <div class="power-tooltip-title">${_('Card ${value}').replace('${value}', value.toString())} <span class="power-tooltip-stars">${stars}</span></div>
                <div class="power-tooltip-timing">${timing}</div>
                <div class="power-tooltip-text">${effect}</div>
            </div>
        `;

        return tooltipHTML;
    }

    private getLastChanceTooltipText(): string {
        return _('Last Chance: once per game, when you can\'t play any card, play nothing this turn and stay in the round.');
    }

    private getRoundStatusTooltipHTML(): string {
        return `
            <div class="round-status-tooltip">
                <div><i class="fa6 fa-play"></i>&nbsp;${_('In: still playing this round')}</div>
                <div><i class="fa6 fa-flag-checkered"></i>&nbsp;${_('Stopped: banks their stars at the end of the round')}</div>
                <div><i class="fa6 fa-bomb"></i>&nbsp;${_('Crashed: scores nothing this round')}</div>
            </div>
        `;
    }

    private isSafariMobile(): boolean { return document.body.classList.contains('safari-browser') && this.game.isMobile(); }

    public static getPowerCardClass(value: number): string { return 'power-card-POWER' + value; }
}
