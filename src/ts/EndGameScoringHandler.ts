/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Riviera implementation : © Doruk Kicikoglu <doruk.kicikoglu@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * EndGameScoringHandler.ts
 */
import { Game } from "./Game";

//Fugu's end-game table: one row per round (stars banked, a bomb for a crash, a gold cell for a Grand Slam,
//"-" for a round a Grand Slam cut short), then the total. Cells fade in one by one; a click fast-forwards
export class EndGameScoringHandler{
    private endGameScoring: EndGameScoreData;
    private scoreContainer: HTMLDivElement;
    private thead: HTMLTableSectionElement;
    private tbody: HTMLTableSectionElement;
    private showButton: HTMLDivElement;
    private hideButton: HTMLElement;
    private fastForwardButton: HTMLDivElement;
    private bodyClickHandler = null;
    private winner_ids: number[];
    private delayAfterFadeIns = 10000;

	constructor(private game: Game) { }

    public async displayEndGameScore(endGameScoring: EndGameScoreData) {
        this.endGameScoring = endGameScoring;

        if(this.scoreContainer){
            console.error('end-game-score-container already exists');
            return;
        }

        document.body.classList.add('displaying-end-game-score');

        this.winner_ids = endGameScoring.winner_ids;

        this.scoreContainer = document.createElement('div');
        this.scoreContainer.classList.add('end-game-score-container');
        this.scoreContainer.style.opacity = '0';
        this.scoreContainer.innerHTML = `
            <div class="show-table-button" style="display: none;" title="${_('Show Scoreboard')}">
                <i class="fa6 fa6-ranking-star"></i>
            </div>
            <div class="maximized-content">
                <i class="fa6 fa6-chevron-circle-left collapse-table-button" title="${_('Collapse Scoreboard')}"></i>
                <table>
                    <thead></thead>
                    <tbody></tbody>
                </table>
                <div class="fast-forward-text"></div>
            </div>
        `;

        document.querySelector('#game_play_area').appendChild(this.scoreContainer);

        this.thead = this.scoreContainer.querySelector('thead');
        this.tbody = this.scoreContainer.querySelector('tbody');
        this.showButton = this.scoreContainer.querySelector('.show-table-button');
        this.hideButton = this.scoreContainer.querySelector('.collapse-table-button');
        this.fastForwardButton = this.scoreContainer.querySelector('.fast-forward-text');

        this.fillTable();
        this.bindShowHideButtons();

        this.fastForwardButton.innerHTML = this.game.isDesktop() ? _('* Click anywhere to fast forward') : _('* Tap anywhere to fast forward');

        const instantFadeIn = this.isInstantFadeIn();
        const fadeInDuration = instantFadeIn ? 0 : 1000;
        const fadeInDelay = instantFadeIn ? 0 : 100;

        this.scoreContainer.style.transition = `opacity ${fadeInDuration}ms ease ${fadeInDelay}ms`;
        this.scoreContainer.style.opacity = '1';

        await this.game.bga.gameui.wait(fadeInDelay + fadeInDuration);
        this.scoreContainer.style.opacity = null;
        this.scoreContainer.style.transition = null;
        this.bindBodyScroll();

        await this.fadeInNextCell();

        document.body.classList.remove('displaying-end-game-score');
    }

    private fillTable() {
        const playerIDs = this.game.getPlayerOrder();

        // Create header row with player names
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th class="corner-no-border-cell"></th>'; // Empty corner cell
        for(let player_id of playerIDs) {
            const playerNameDiv = this.game.divColoredPlayer(player_id, {}, false);
            headerRow.innerHTML += `<th class="player-name-cell" player-id="${player_id}">${playerNameDiv}</th>`;
        }
        this.thead.appendChild(headerRow);

        // One row per round
        const roundNumbers = Object.keys(this.endGameScoring.rounds).map(roundNumber => parseInt(roundNumber)).sort((a, b) => a - b);
        for(let roundNumber of roundNumbers) {
            const row = document.createElement('tr');
            row.innerHTML = `<td class="row-label-cell">${_('Round ${roundNumber}').replace('${roundNumber}', roundNumber.toString())}</td>`;

            for(let player_id of playerIDs) {
                const roundScore = this.endGameScoring.rounds[roundNumber][player_id] ?? null;
                row.innerHTML += `<td>${this.getRoundCellHTML(roundScore, player_id)}</td>`;
            }

            this.tbody.appendChild(row);
        }

        // Total row: it builds up as the round cells appear, then shows the final score
        const totalRow = document.createElement('tr');
        totalRow.classList.add('total-row');
        totalRow.innerHTML = `<td class="row-label-cell">${_('Total')}</td>`;
        for(let player_id of playerIDs)
            totalRow.innerHTML += `<td><div class="cell-text cell-total" style="opacity: 0;" player-id="${player_id}">0</div></td>`;
        this.tbody.appendChild(totalRow);
    }

    //the text of a round cell is its points (parsed by addColumnTotal); a crash or an unfinished round adds nothing
    private getRoundCellHTML(roundScore: RoundScoreEntry | null, player_id: number): string {
        const result = roundScore?.result ?? 'unfinished';
        let cellContent: string;

        if(result === 'stopped')
            cellContent = `${roundScore.stars} ★`;
        else if(result === 'crashed')
            cellContent = '<i class="fa6 fa-bomb"></i>';
        else if(result === 'grand_slam')
            cellContent = `+${roundScore.stars}`;
        else cellContent = '-';

        return `<div class="cell-text cell-${result}" style="opacity: 0;" player-id="${player_id}">${cellContent}</div>`;
    }

    private bindShowHideButtons() {
        this.hideButton.addEventListener('click', () => {
            this.hideButton.style.display = 'none';
            this.scoreContainer.querySelectorAll('.maximized-content').forEach((node: HTMLDivElement) => { node.style.display = 'none'; });
            this.showButton.style.display = null;
            this.scoreContainer.setAttribute('collapsed', 'true');
        });

        this.showButton.addEventListener('click', () => {
            this.hideButton.style.display = null;
            this.scoreContainer.querySelectorAll('.maximized-content').forEach((node: HTMLDivElement) => { node.style.display = null; });
            this.showButton.style.display = 'none';
            this.scoreContainer.removeAttribute('collapsed');
        });
    }

    private bindBodyScroll() {
        this.scoreContainer.style.transition = 'opacity 300ms ease';
        let fadeInGeneration = 0;

        // Bind scroll event listener to the body
        window.addEventListener('scroll', () => {
            const generation = ++fadeInGeneration;
            this.scoreContainer.style.opacity = '0.3';

            this.game.bga.gameui.wait(100).then(() => {
                if(generation === fadeInGeneration)
                    this.scoreContainer.style.opacity = '1';
            });
        });
    }

    private async fadeInNextCell() {
        const cells: HTMLDivElement[] = Array.from(this.tbody.querySelectorAll('.cell-text:not(.displayed)'));

        const overallContent: HTMLDivElement = document.getElementById('overall-content') as HTMLDivElement;
        overallContent.removeEventListener('click', this.bodyClickHandler);

        if(cells.length <= Object.keys(this.game.players).length * 2){
            this.fastForwardButton.style.transition = 'opacity 400ms ease';
            this.fastForwardButton.style.opacity = '0';
        }

        if(cells.length <= 0){ //end of score display
            const allCells = Array.from(this.tbody.querySelectorAll('.cell-text'));
            allCells.forEach((cell: HTMLDivElement) => { cell.style.opacity = ''; });
            this.makeWinnersJump();
            this.setEndGamePlayerScores();

            await this.game.bga.gameui.wait(this.delayAfterFadeIns);
            return;
        }

        let cell: HTMLDivElement = cells[0];
        const instantFadeIn = this.isInstantFadeIn();
        cell.classList.add('displayed');

        const fadeInDuration = instantFadeIn ? 0 : 500;
        const fadeInDelay = instantFadeIn ? 0 : 100;

        let fastForwardFadeIn: () => void;
        const fastForwarded = new Promise<void>(resolve => { fastForwardFadeIn = resolve; });

        this.bodyClickHandler = async (event: MouseEvent) => {
            cell.style.transition = null;
            cell.style.opacity = '1';
            fastForwardFadeIn();
        };

        overallContent.addEventListener('click', this.bodyClickHandler);

        this.addColumnTotal(cell.getAttribute('player-id'));

        cell.style.transition = `opacity ${fadeInDuration}ms ease ${fadeInDelay}ms`;
        cell.style.opacity = '1';

        await Promise.race([
            this.game.bga.gameui.wait(fadeInDelay + fadeInDuration),
            fastForwarded
        ]);
        await this.fadeInNextCell();
    }

    private addColumnTotal(playerID: string) {
        const cells = Array.from(this.tbody.querySelectorAll(`.cell-text.displayed[player-id="${playerID}"]:not(.cell-total)`)) as HTMLDivElement[];
        let total: number = 0;
        cells.forEach(cell => {
            const value: number = parseInt(cell.textContent || '0');
            if (!isNaN(value))
                total += value;
        });

        const totalCell = this.tbody.querySelector(`.cell-total[player-id="${playerID}"]`) as HTMLDivElement;
        if (totalCell){
            totalCell.textContent = total.toString();
            totalCell.classList.add('displayed');
            totalCell.style.opacity = '1';
        }
    }

    private makeWinnersJump() {
        let delay = 0;
        for(let winner_id of this.winner_ids){
            this.game.bga.gameui.wait(delay).then(() => {
                this.thead.querySelector(`.player-name-cell[player-id="${winner_id}"]`)?.classList.add('jumping-text');
            });
            delay += 100 + Math.random() * 50;
        }
    }

    //the totals end on the real scores, so they always match BGA's ranking
    private setEndGamePlayerScores() {
        for(let player_id in this.endGameScoring.scores){
            const score = this.endGameScoring.scores[player_id];
            const totalCell = this.tbody.querySelector(`.cell-total[player-id="${player_id}"]`) as HTMLDivElement;
            if(totalCell)
                totalCell.textContent = score.toString();

            this.game.bga.playerPanels.getScoreCounter(parseInt(player_id))?.toValue(score);
        }
    }

    private isInstantFadeIn(): boolean { return this.game.getGameStateName() === 'gameEnd'; }
}
