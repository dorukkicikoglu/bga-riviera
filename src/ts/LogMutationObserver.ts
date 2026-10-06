import { Game } from "./Game";

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
            const cardDiv = (reveal.choice === 'card' && reveal.card) ? this.game.createCardDiv(reveal.card) : this.game.createLastChanceDiv();
            return `
                <div class="reveal-entry">
                    ${this.game.divColoredPlayer(reveal.player_id, {class: 'playername'})}
                    <div class="minimised-card-icon">${cardDiv.outerHTML}</div>
                </div>`;
        }).join('');

        let logHTML = `
            <div class="cards-revealed-row">
                ${revealsHTML}
            </div>` + ' &nbsp;';

        return this.addLogClassTag(logHTML, 'cards-revealed-log');
    }

    public createLogPlayerCrashed(player_id: number): LogRowData {
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const crashText = player_id === this.game.getMyPlayerID()
            ? _('${you} crash').replace('${you}', playerNameHTML)
            : _('${playerName} crashes').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="player-crashed-row">
                <i class="fa6 fa-bomb"></i>&nbsp;${crashText}
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
        const playerNameHTML = this.game.divColoredPlayer(player_id, {class: 'playername'});
        const startTokenText = player_id === this.game.getMyPlayerID()
            ? _('${you} receive the Start token').replace('${you}', playerNameHTML)
            : _('${playerName} receives the Start token').replace('${playerName}', playerNameHTML);

        let logHTML = `
            <div class="start-token-row">
                <div class="start-token mini-start-token"></div>&nbsp;${startTokenText}
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
}
