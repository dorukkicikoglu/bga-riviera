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

//every card value with a power; Game.createCardDiv gives those cards the power-card-POWER<n> class
export const POWER_CARD_VALUES = [1, 2, 9, 10, 11];

export class TooltipHandler{
    private static readonly TOOLTIP_DELAY = 400;

    constructor(private game: Game) {
        this.addTooltipsToCards();
        this.addTooltipsToBoards();

        for(let dieData of this.game.diceHandler.getDiceData())
            this.updateDieTooltip(dieData);
	}

    //class tooltips only reach the cards already on the page, so this runs again whenever cards are created
	public addTooltipsToCards(){
        if(this.isSafariMobile()) {
            this.addTooltipToBottomForSafari();
            return;
        }

        for(let value of POWER_CARD_VALUES)
            this.game.bga.gameui.addTooltipHtmlToClass(TooltipHandler.getPowerCardClass(value), this.getPowerTooltipHTML(value), TooltipHandler.TOOLTIP_DELAY);

        this.game.bga.gameui.addTooltipToClass('last-chance-card', this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
    }

    //a new log row: only its own cards, so loading a long log doesn't query the whole page once per row
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
        this.game.bga.gameui.addTooltip('start-token', _('Start token: powers resolve clockwise from this player. It passes to the next player every turn.'), '', TooltipHandler.TOOLTIP_DELAY);

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
        safariMobilePowerReferenceContainer.innerHTML = POWER_CARD_VALUES.map(value => this.getPowerTooltipHTML(value)).join('');
        document.getElementById('game_play_area').appendChild(safariMobilePowerReferenceContainer);
    }

    private getPowerTooltipHTML(value: number): string {
        const powerTexts: Record<number, {timing: string, effect: string}> = {
            1: {timing: _('Right away'), effect: _('Add one more playable card from your hand on the same dice. Another 1 lets you add again.')},
            2: {timing: _('Next roll'), effect: _('The die of this card\'s color is reserved for you: opponents can\'t use it, alone or in a sum. Cancelled if you stop.')},
            9: {timing: _('After the next roll'), effect: _('You may turn one die by 1 up or down (6 becomes 1, 1 becomes 6), for everyone. Each die can be turned once per roll. Lost if you stop.')},
            10: {timing: _('Before the next roll'), effect: _('You may swap 2 cards of your choice for 2 random cards of an opponent still in the round. If none can be chosen, discard and draw instead.')},
            11: {timing: _('Next roll'), effect: _('You may add the golden die for everyone. It only counts in a sum with a colored die and never gives its color. Cancelled if you stop.')},
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
