/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * LogMutationObserver.ts
 */
import { Game } from "./Game";
import { StartTokenHandler } from "./StartTokenHandler";

interface LogRowData { //this is used to return strings containing log-class-tag divs
    log_html: string;
    log_class: string;
}

export class LogMutationObserver{
	private nextTimestampValue:string = '';

    constructor(private game: Game) {
		this.observeLogs();
    }

    private observeLogs(): void{
        let observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node: HTMLDivElement) => {
                        if (node.nodeType === 1 && node.tagName.toLowerCase() === 'div' && node.classList.contains('log')){
                            this.processLogDiv(node);
                        }
                    });
                }
            });
        });

        // Configure the MutationObserver to observe changes to the container's child nodes
        const config = {
            childList: true,
            subtree: true // Set to true if you want to observe all descendants of the container
        };

        // Start observing the container
        observer.observe($('logs'), config);
        observer.observe($('chatbar'), config); //mobile notifs

        if(g_archive_mode){ //to observe replayLogs that appears at the bottom of the page on replays
            let replayLogsObserverStarted = false;
            const replayLogsObserver = new MutationObserver((mutations, obs) => {
              for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach((node: HTMLDivElement) => {
                        if(!replayLogsObserverStarted && node instanceof HTMLElement && node.id.startsWith('replaylogs')) {
                            this.processLogDiv(node);
                        }
                    });
                }
              }
            });
            replayLogsObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    private processLogDiv(node: HTMLDivElement): void{
        const classTags: HTMLDivElement[] = Array.from(node.querySelectorAll('*[log-class-tag]'));

        for(const classTag of classTags){
            const logClassName: string = classTag.getAttribute('log-class-tag');

            let parentLog: HTMLDivElement = null;
            let current: HTMLDivElement = classTag;
            while (current) {
                if (current.classList.contains('gamelogreview') || current.classList.contains('log')) {
                    parentLog = current;
                    break;
                }
                current = current.parentElement as HTMLDivElement;
            }

            if(parentLog)
                parentLog.classList.add('a-game-log', logClassName);
        }

        classTags.forEach(classTag => classTag.remove());

        this.game.tooltipHandler?.addTooltipsToCardsIn(node); //power cards and Last Chance shown in this row
        
        node.querySelectorAll('.playername').forEach((playerName: HTMLElement) => {
            playerName.setAttribute('player-color', this.game.rgbToHex(window.getComputedStyle(playerName).color));
        });

        if(this.game.isDesktop() && node.classList.contains('a-game-log')){
            let timestamp: HTMLDivElement[] = Array.from(node.querySelectorAll('.timestamp'));
            if(timestamp.length > 0){
                this.nextTimestampValue = timestamp[0].innerText;
            } else if(this.observeLogs.hasOwnProperty('nextTimestampValue')){
                let newTimestamp: HTMLDivElement = document.createElement('div');
                newTimestamp.classList.add('timestamp');
                newTimestamp.innerHTML = this.nextTimestampValue;

                node.appendChild(newTimestamp);
            }
        }
    }

    private addLogClassTag(logHTML: string, logClass: string): LogRowData { return { log_html: logHTML + `<div log-class-tag="${logClass}"></div>`, log_class: logClass }; }

    //create specific log types
    public createLogNewRound(roundNumber: number): LogRowData {
        let logHTML = `
            <div class="new-round-row">
                ${_('Round ${roundNumber}').replace('${roundNumber}', roundNumber.toString())}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'new-round-log');
    }

    public createLogDiceRolled(dice: RivieraDie[]): LogRowData {
        const diceHTML = dice.filter(dieData => dieData.value !== null).map(dieData => this.game.diceHandler.createDieDiv(dieData).outerHTML).join('');

        let logHTML = `
            <div class="dice-rolled-row">
                ${diceHTML}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'dice-rolled-log');
    }

    public createLogCardsRevealed(reveals: CardReveal[]): LogRowData {
        const revealsHTML = reveals.map(reveal => {
            //a card as the status bar's circular card icon; Last Chance has no icon, so it stays a mini card
            const choiceHTML = (reveal.choice === 'card' && reveal.card) ? this.getCardIconsHTML([reveal.card]) : `<div class="minimised-card-icon">${this.game.createLastChanceDiv().outerHTML}</div>`;
            //a card-1 chain: the first card, then "+" and each card added to it
            const chainHTML = (reveal.extra_cards_POWER1 ?? []).map(extraCard => `<span class="reveal-chain-plus">+</span>${this.getCardIconsHTML([extraCard])}`).join('');
            //one table row: name, arrow, cards (the row's grid lays the entries out as columns)
            return `
                <div class="reveal-entry">
                    ${this.getCutPlayerNameHTML(reveal.player_id)}
                    <i class="fa6 fa-arrow-right reveal-arrow" aria-hidden="true"></i>
                    <span class="reveal-cards">${choiceHTML}${chainHTML}</span>
                </div>`;
        }).join('');

        let logHTML = `
            <div class="cards-revealed-row">
                ${revealsHTML}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'cards-revealed-log');
    }

    //icons only: "name → [Last Chance]", the reveal row's arrow and mini card (the server's LAST_CHANCE_LOG_STR is the
    //plain-text fallback)
    public createLogLastChanceUsed(player_id: number): LogRowData {
        let logHTML = `
            <div class="last-chance-row">
                ${this.getCutPlayerNameHTML(player_id)}
                <i class="fa6 fa-arrow-right last-chance-arrow" aria-hidden="true"></i>
                <div class="minimised-card-icon">${this.game.createLastChanceDiv().outerHTML}</div>
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'last-chance-log');
    }

    public createLogPlayerCrashed(player_id: number): LogRowData {
        //icons only: "[bomb] name [bomb]" (the server's CRASH_LOG_STR is the plain-text fallback)
        let logHTML = `
            <div class="player-crashed-row">
                <i class="fa6 fa-bomb" aria-hidden="true"></i>
                ${this.getCutPlayerNameHTML(player_id)}
                <i class="fa6 fa-bomb" aria-hidden="true"></i>
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'crash-log');
    }

    public createLogGrandSlam(player_id: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const grandSlamText = player_id === this.game.getMyPlayerID()
            ? _('${you} play all 10 cards: Grand Slam!').replace('${you}', playerNameHTML)
            : _('${playerName} plays all 10 cards: Grand Slam!').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="grand-slam-row">
                ${grandSlamText}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'grand-slam-log');
    }

    public createLogStartTokenPassed(player_id: number): LogRowData {
        //icons only: "name ⇐ [Start token]" (the server's START_TOKEN_LOG_STR is the plain-text fallback)
        let logHTML = `
            <div class="start-token-row">
                ${this.getCutPlayerNameHTML(player_id)}
                <span class="start-token-arrow" aria-hidden="true">⇐</span>
                <div class="start-token mini-start-token" style="--start-token-color: #${this.game.getPlayerColor(player_id) ?? '000000'}">${StartTokenHandler.LAYERS_HTML}</div>
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'start-token-log');
    }

    public createLogStopOrMoreRevealed(choices: Record<number, StopOrMoreChoice>): LogRowData {
        const namesByChoice: Record<StopOrMoreChoice, string[]> = { stop: [], more: [] };
        for(const player_id in choices)
            namesByChoice[choices[player_id]].push(this.game.divColoredPlayer(player_id, {class: 'playername'}));

        let choiceLinesHTML = '';
        if(namesByChoice.stop.length > 0)
            choiceLinesHTML += `<div class="stop-or-more-line"><i class="fa6 fa-flag-checkered"></i>&nbsp;${_('Stop:')} ${namesByChoice.stop.join(', ')}</div>`;
        if(namesByChoice.more.length > 0)
            choiceLinesHTML += `<div class="stop-or-more-line"><i class="fa6 fa-play"></i>&nbsp;${_('More:')} ${namesByChoice.more.join(', ')}</div>`;

        let logHTML = `
            <div class="stop-or-more-row">
                ${choiceLinesHTML}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'stop-or-more-log');
    }

    public createLogStarsBanked(player_id: number, stars: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const starsBankedText = player_id === this.game.getMyPlayerID()
            ? _('${you} bank ${stars} ★').replace('${you}', playerNameHTML)
            : _('${playerName} banks ${stars} ★').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="stars-banked-row">
                ${starsBankedText.replace('${stars}', `<b>${stars}</b>`)}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'stars-banked-log');
    }

    public createLogDieReservedPOWER2(player_id: number, die: RivieraDie): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const reservedText = player_id === this.game.getMyPlayerID()
            ? _('${you} reserve ${die} for the next roll').replace('${you}', playerNameHTML)
            : _('${playerName} reserves ${die} for the next roll').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="die-reserved-row">
                ${reservedText.replace('${die}', this.getMiniDieHTML(die))}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'die-reserved-power2-log');
    }

    public createLogGoldenDiePOWER11(player_id: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        //no die drawn: the golden die has no value until the next roll, and a die never shows without one
        const goldenDieText = player_id === this.game.getMyPlayerID()
            ? _('${you} add the golden die to the next roll').replace('${you}', playerNameHTML)
            : _('${playerName} adds the golden die to the next roll').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="golden-die-row">
                ${goldenDieText}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'golden-die-power11-log');
    }

    public createLogDieModifiedPOWER9(player_id: number, dieColor: DieColor, oldValue: number, newValue: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const modifiedText = player_id === this.game.getMyPlayerID()
            ? _('${you} turn ${oldDie} to ${newDie}').replace('${you}', playerNameHTML)
            : _('${playerName} turns ${oldDie} to ${newDie}').replace('${playerName}', playerNameHTML);

        const oldDie: RivieraDie = { color: dieColor, value: oldValue, reserved_by_POWER2: null, modified_by_POWER9: false, in_use_by_POWER11: true };
        const newDie: RivieraDie = { ...oldDie, value: newValue };
        let logHTML = `
            <div class="die-modified-row">
                ${modifiedText.replace('${oldDie}', this.getMiniDieHTML(oldDie)).replace('${newDie}', this.getMiniDieHTML(newDie))}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'die-modified-power9-log');
    }

    //card 10: one row for everyone. The owner and the victim got the cards (ownerGives / targetGives set, from the
    //notification's _private); everyone else sees card backs
    public createLogCardsSwappedPOWER10(owner_id: number, target_id: number, ownerGives: RivieraCard[] | null, targetGives: RivieraCard[] | null, count: number): LogRowData {
        //the backs go in the icons' container too, so both views space their cards the same way
        const ownerCardsHTML = ownerGives ? this.getCardIconsHTML(ownerGives) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;
        const targetCardsHTML = targetGives ? this.getCardIconsHTML(targetGives) : `<span class="log-card-icons">${this.getMiniCardBacksHTML(count)}</span>`;

        //"owner [cards] ⇄ [cards] target", on one line: each side's cards next to its player
        let logHTML = `
            <div class="cards-swapped-row">
                ${this.getCutPlayerNameHTML(owner_id)}${ownerCardsHTML}
                <span class="log-arrow">⇄</span>
                ${targetCardsHTML}${this.getCutPlayerNameHTML(target_id)}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'cards-swapped-power10-log');
    }

    //card 10 with no opponent left: one row for everyone. The owner sees the cards (from _private), everyone else card backs
    public createLogCardsRedrawnPOWER10(player_id: number, discarded: RivieraCard[] | null, drawn: RivieraCard[] | null, count: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const redrawnText = player_id === this.game.getMyPlayerID()
            ? _('${you} discard ${discarded} and draw ${drawn}').replace('${you}', playerNameHTML)
            : _('${playerName} discards ${discarded} and draws ${drawn}').replace('${playerName}', playerNameHTML);

        const discardedHTML = discarded ? this.getMiniCardsHTML(discarded) : this.getMiniCardBacksHTML(count);
        const drawnHTML = drawn ? this.getMiniCardsHTML(drawn) : this.getMiniCardBacksHTML(count);

        let logHTML = `
            <div class="cards-redrawn-row">
                ${redrawnText.replace('${discarded}', discardedHTML).replace('${drawn}', drawnHTML)}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'cards-redrawn-power10-log');
    }

    public createLogPowerSkipped(player_id: number, value: number, card: RivieraCard | null, reason: string): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const cardHTML = card ? this.getMiniCardsHTML([card]) : `<b>${value}</b>`;

        let skippedText = player_id === this.game.getMyPlayerID()
            ? _('${you} do not use ${card}').replace('${you}', playerNameHTML)
            : _('${playerName} does not use ${card}').replace('${playerName}', playerNameHTML);
        if(reason === 'nothing_to_draw')
            skippedText += ' ' + _('(no card left to draw)');
        else if(reason === 'not_enough_cards')
            skippedText += ' ' + _('(fewer than 2 cards in hand)');

        let logHTML = `
            <div class="power-skipped-row">
                ${skippedText.replace('${card}', cardHTML)}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'power-skipped-log');
    }

    //the game ends: everyone at the top score wins (a Grand Slam, or equal scores, share the win)
    public createLogGameEnd(winner_ids: number[], winningScore: number): LogRowData {
        const iWin = winner_ids.includes(this.game.getMyPlayerID());
        const otherWinnersHTML = winner_ids.filter(player_id => player_id !== this.game.getMyPlayerID()).map(player_id => this.game.divColoredPlayer(player_id, {class: 'playername'}));
        const winnersHTML = [...(iWin ? [this.game.divYou({class: 'playername'})] : []), ...otherWinnersHTML].join(', ');

        const gameEndText = (iWin || winner_ids.length > 1)
            ? _('${players} win with ${stars} ★')
            : _('${players} wins with ${stars} ★');

        let logHTML = `
            <div class="game-end-row">
                <i class="fa6 fa-trophy"></i>&nbsp;${gameEndText.replace('${players}', winnersHTML).replace('${stars}', `<b>${winningScore}</b>`)}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'game-end-log');
    }

    private getMiniCardsHTML(cards: RivieraCard[]): string {
        return cards.map(card => `<div class="minimised-card-icon">${this.game.createCardDiv(card).outerHTML}</div>`).join('');
    }

    //the status bar's circular card icons (Game.getStatusCardIconHTML), sized for the log by .log-card-icons
    private getCardIconsHTML(cards: RivieraCard[]): string {
        return `<span class="log-card-icons">${cards.map(card => this.game.getStatusCardIconHTML(card)).join('')}</span>`;
    }

    private getMiniCardBacksHTML(count: number): string {
        let backsHTML = '';
        for(let i = 0; i < count; i++)
            backsHTML += `<div class="minimised-card-icon">${this.game.createCardBackDiv().outerHTML}</div>`;
        return backsHTML;
    }

    //a player name the row's CSS cuts with an ellipsis (max-width), so its title shows it whole
    private getCutPlayerNameHTML(player_id: number): string {
        const nameText = (player_id === this.game.getMyPlayerID()) ? _('You') : this.game.getPlayerName(player_id);
        return this.game.divColoredPlayer(player_id, {class: 'playername', title: nameText.replace(/"/g, '&quot;')});
    }

    private getMiniDieHTML(die: RivieraDie): string {
        return this.game.diceHandler.createDieDiv(die).outerHTML;
    }
}
