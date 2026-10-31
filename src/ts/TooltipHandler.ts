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

    private powerReferenceHTMLByValue: Record<number, string> = {}; //0: the whole reference, no power on top

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
    //on top. Tooltips only reach the cards already on the page, so this runs again whenever cards are created
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

    //a log row (its mini cards) or the status bar title (its circular card icons and power icons): single-power tooltips. Only that container
    //is queried, so loading a long log stays cheap
    public addTooltipsToCardsIn(container: HTMLElement){
        if(this.isSafariMobile() || !container)
            return;

        //.power-icon[id]: the power icon next to a status bar card icon (Game.getStatusCardWithPowerHTML); the power reference's icons have no id.
        //Circular card icons also appear in log rows, where they keep the log mini cards' tooltip look
        container.querySelectorAll('.a-card[id], .status-card-icon[id], .power-icon[id]').forEach((card: HTMLElement) => {
            const value = parseInt(card.getAttribute('data-value') ?? card.getAttribute('data-power-value'));
            if(card.classList.contains(TooltipHandler.getPowerCardClass(value)))
                this.game.bga.gameui.addTooltipHtml(card.id, this.getPowerTooltipHTML(value, card.closest('#pagemaintitletext') ? 'status-bar-power-tooltip' : ''), TooltipHandler.TOOLTIP_DELAY);
            else if(card.classList.contains('last-chance-card'))
                this.game.bga.gameui.addTooltip(card.id, this.getLastChanceTooltipText(), '', TooltipHandler.TOOLTIP_DELAY);
        });
    }

    //player boards and played columns: the parts that aren't self-explanatory
    private addTooltipsToBoards(){
        this.game.bga.gameui.addTooltipHtml('start-token', this.getStartTokenTooltipHTML(), TooltipHandler.TOOLTIP_DELAY);

        for(let player_id in this.game.players){
            this.game.bga.gameui.addTooltip('hand-count-backs-' + player_id, _('Cards in hand'), '', TooltipHandler.TOOLTIP_DELAY);
            this.game.bga.gameui.addTooltip('score-target-' + player_id, _('First to ${points} ★ wins').replace('${points}', `${this.game.getWinningScore()}`), '', TooltipHandler.TOOLTIP_DELAY);
            this.updateColumnStarsTooltip(parseInt(player_id));
        }
    }

    //the column badge: the stars at stake while in, the banked amount once stopped (PlayedColumnHandler.setRoundStatus)
    public updateColumnStarsTooltip(player_id: number){
        const playedColumn = this.game.players[player_id]?.getPlayedColumn();
        if(!playedColumn)
            return;

        const tooltipText = playedColumn.isBanked()
            ? _('Banked ${points} ★').replace('${points}', `${playedColumn.getStarsTotal()}`)
            : _('Stars of the cards played this round. A player who stops banks them; a crash loses them.');
        this.game.bga.gameui.addTooltip('column-stars-' + player_id, tooltipText, '', TooltipHandler.TOOLTIP_DELAY);
    }

    //a die's tooltip follows its card 2 reservation, card 9 change and, for gold, card 11, on the card tooltips' background
    //(the power reference's single-entry look, like the Start token's). withRing false: the die is rolling in with no card 2
    //ring yet (DiceHandler.rollDice), so its tooltip leaves the reservation out until it lands
    public updateDieTooltip(dieData: RivieraDie, withRing: boolean = true){
        const dieID = 'die-' + dieData.color;
        if(!document.getElementById(dieID))
            return;

        //card 2: the same pending (dashed) / reserved (solid) split as the die's ring (DiceHandler.applyReservationRingPOWER2).
        //A die with a ring gets this one line instead of its default text, kept on one line
        const pendingReserverID = withRing ? (dieData.pending_reserved_by_POWER2 ?? null) : null;
        const reserverID = withRing ? dieData.reserved_by_POWER2 : null;
        if(pendingReserverID !== null || reserverID !== null){
            const reservationText = (pendingReserverID !== null) ? _('${player_name} may reserve ${die_color} die with ${card_icon}') : _('${player_name} reserved ${die_color} die with ${card_icon}');
            const reservationHTML = reservationText
                .replace('${player_name}', this.game.divColoredPlayer(pendingReserverID ?? reserverID, {class: 'playername tooltip-playername'}))
                .replace('${die_color}', this.getDieColorName(dieData.color))
                .replace('${card_icon}', this.game.getInlineCardIconHTML(dieData.color as CardColor, 2));
            this.game.bga.gameui.addTooltipHtml(dieID, this.getDieTooltipHTML(reservationHTML, 'die-reservation-tooltip-power2'), TooltipHandler.TOOLTIP_DELAY);
            return;
        }

        const lines = [dieData.color === 'gold'
            ? _('Golden die (card 11): it only counts in a sum with a colored die and never gives its color')
            : _('${die_color} die').replace('${die_color}', this.getDieColorName(dieData.color))];
        if(dieData.modified_by_POWER9)
            lines.push(_('Turned by a card 9 this roll: it cannot be turned again'));

        this.game.bga.gameui.addTooltipHtml(dieID, this.getDieTooltipHTML(lines.join('<br>')), TooltipHandler.TOOLTIP_DELAY);
    }

    //the colored dice's names in their tooltips (the golden die has its own text)
    private getDieColorName(color: DieColor): string {
        const dieColorNames: Record<CardColor, string> = { red: _('Red'), green: _('Green'), purple: _('Purple'), blue: _('Blue'), orange: _('Orange') };
        return dieColorNames[color as CardColor] ?? '';
    }

    private getDieTooltipHTML(contentHTML: string, modifierClass: string = ''): string {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference die-tooltip ${modifierClass}">
                <div>${contentHTML}</div>
            </div>
        `;
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
     * (img/power_icons_sprite.webp) floated left. Two columns on desktop, one on narrow screens.
     * focusedValue 0 (a card with no power): the whole reference, split in two (left: card 1, then card 10;
     * right: cards 2 and 11, then card 9). A power card: its own entry on top under its timing heading, as wide as the tooltip, then the other powers under
     * their timing headings (a group left empty loses its heading) in two columns the browser balances (CSS columns).
     * The text follows our BGA rules (SPEC.md), not the rulebook's wording.
     */
    private getPowerReferenceHTML(focusedValue: number): string {
        if(this.powerReferenceHTMLByValue[focusedValue])
            return this.powerReferenceHTMLByValue[focusedValue];

        const headingHTML = (heading: string) => `<div class="power-reference-heading">${heading}</div>`;
        const timingGroups = this.getPowerTimingGroups();
        const [immediateGroup, beforeStopOrMoreGroup, beforeRollGroup, afterRollGroup] = timingGroups;

        let referenceHTML: string;
        if(focusedValue === 0) {
            referenceHTML = `
                <div class="tooltip-wrapper power-reference">
                    <div class="power-reference-column">
                        ${headingHTML(immediateGroup.heading)}
                        ${this.getPowerEntryHTML(1)}
                        ${headingHTML(beforeStopOrMoreGroup.heading)}
                        ${this.getPowerEntryHTML(10)}
                    </div>
                    <div class="power-reference-column">
                        ${headingHTML(beforeRollGroup.heading)}
                        ${this.getPowerEntryHTML(2)}
                        ${this.getPowerEntryHTML(11)}
                        ${headingHTML(afterRollGroup.heading)}
                        ${this.getPowerEntryHTML(9)}
                    </div>
                </div>
            `;
        } else {
            //each heading is kept with its group's first entry, so a column never ends on a heading
            const otherPowersHTML = timingGroups.map(({heading, values}) => {
                const otherValues = values.filter((value) => value !== focusedValue);
                if(otherValues.length === 0)
                    return '';

                const [firstValue, ...nextValues] = otherValues;
                return `<div class="power-reference-heading-group">${headingHTML(heading)}${this.getPowerEntryHTML(firstValue)}</div>` + nextValues.map((value) => this.getPowerEntryHTML(value)).join('');
            }).join('');

            //the hovered power keeps its timing heading on top too (repeated below when its group has other powers)
            const focusedGroup = timingGroups.find(({values}) => values.includes(focusedValue));
            referenceHTML = `
                <div class="tooltip-wrapper power-reference focused-power-reference">
                    ${headingHTML(focusedGroup.heading)}
                    ${this.getPowerEntryHTML(focusedValue, 'focused-power-entry')}
                    <div class="power-reference-balanced-columns">${otherPowersHTML}</div>
                </div>
            `;
        }

        this.powerReferenceHTMLByValue[focusedValue] = referenceHTML;
        return referenceHTML;
    }

    //the powers by timing, in turn order: the only source of the reference's headings
    private getPowerTimingGroups(): {heading: string, values: number[]}[] {
        return [
            {heading: _('Power activated immediately after playing the card:'), values: [1]},
            {heading: _('Power activated before Stop or More:'), values: [10]},
            {heading: _('Powers activated before the next dice roll:'), values: [2, 11]},
            {heading: _('Power activated after the next dice roll and before playing a card:'), values: [9]},
        ];
    }

    //a single power: the power reference's entry for it, on the same background. For the mini cards in log rows and the
    //status bar's circular card icons and power icons. modifierClass: status-bar-power-tooltip for the status bar's icons
    private getPowerTooltipHTML(value: number, modifierClass: string = ''): string {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference ${modifierClass}">
                ${this.getPowerEntryHTML(value)}
            </div>
        `;
    }

    //one power's entry: its icon floated left, "Card N:" in bold, then its text. Shared by the power reference and the
    //single-power tooltip, so both look the same. extraClass: focused-power-entry for the hovered card's power on top of the reference
    private getPowerEntryHTML(value: number, extraClass: string = ''): string {
        return `
            <div class="power-reference-entry highlighted-power-entry ${extraClass}">
                <span class="power-icon" data-power-value="${value}"></span><b>${_('Card ${value}:').replace('${value}', value.toString())}</b> ${this.getPowerText(value)}
            </div>`;
    }

    //the only source of the power texts. They follow our BGA rules (SPEC.md), not the rulebook's wording
    private getPowerText(value: number): string {
        const powerTexts: Record<number, string> = {
            1: _('Play one more card from your hand on the same roll, revealed with it. It must be playable too, and another 1 lets you add again.'),
            2: _('Automatic: on the next roll, the die of this card\'s color is reserved for you. Opponents can\'t use it, alone or in a sum. Only if you choose More.'),
            10: _('Swap 2 cards of your choice for 2 random cards of an opponent still in the round with at least 2 cards. If there is none, discard up to 2 cards and draw as many instead.'),
            11: _('Add the golden die to the next roll, for everyone. It has no color and only counts in a sum with a colored die. Only if you choose More.'),
            9: _('Turn one die by 1 up or down (a 6 becomes a 1, and a 1 a 6), for everyone. The golden die and a reserved die can be turned. Each die only once per roll. Only if you are still in the round.'),
        };
        return powerTexts[value];
    }

    //on the card tooltips' background: the single-power tooltip's wrapper, with the text in place of a power entry
    private getStartTokenTooltipHTML(): string {
        return `
            <div class="tooltip-wrapper power-reference single-power-reference">
                <div>${_('<b>Start token:</b> Powers resolve clockwise from this player. Every turn it passes to the next player who is still in the round.')}</div>
            </div>
        `;
    }

    private getLastChanceTooltipText(): string {
        return _('Last Chance: once per game, when you can\'t play any card, play nothing this turn and stay in the round.');
    }

    private isSafariMobile(): boolean { return document.body.classList.contains('safari-browser') && this.game.isMobile(); }

    public static getPowerCardClass(value: number): string { return 'power-card-POWER' + value; }
}
