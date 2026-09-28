/*
 * characters.js - キャラクターごとの打ち筋を実測する
 *
 * 席0 に各キャラ、席1・2 に基準のナオを置いて局を重ね、
 * 局の勝率・ドミノ率・序盤に出す牌の重さ・場で取った点・山から引いた枚数・
 * 下家を止めた割合・負けたときの残り目などを比べる。
 *
 *   node tests/characters.js [1キャラあたりの局数] [キャラ番号,...]
 */
const path = require('path');
const base = path.join(__dirname, '..', 'js');
['tiles', 'board', 'ai', 'game'].forEach(f => require(path.join(base, f + '.js')));
const DM = globalThis.DM;

function measure(charIdx, targetHands) {
  const r = { hands: 0, wins: 0, dominos: 0, turns: 0, draws: 0, nextTurns: 0, nextStuck: 0,
    lostPips: 0, losses: 0, playPts: 0, gained: 0, earlyPips: 0, early: 0 };
  let seed = 700 + charIdx * 4111;
  let myPlays = 0, nextDrew = false;
  while (r.hands < targetHands) {
    const queue = [];
    const g = new DM.Game({ speed: 0, seed: seed++, difficulty: 2, onEvent: (type, data) => {
      if (type === 'handStart') myPlays = 0;
      if (type === 'draw' && data.seat === 0) r.draws++;
      if (type === 'draw' && data.seat === 1) nextDrew = true;
      if (type === 'play' || type === 'pass') {
        if (data.seat === 0) r.turns++;
        if (data.seat === 1) {
          // 下家が「出せずに引いた・パスした」手番の割合
          r.nextTurns++;
          if (nextDrew || type === 'pass') r.nextStuck++;
          nextDrew = false;
        }
      }
      if (type === 'play' && data.seat === 0) {
        r.playPts += data.points;
        // 序盤 3 手に出した牌の重さ（局の 1 枚目は数えない）
        if (myPlays++ < 3 && DM.board.count(g.board) > 1) { r.earlyPips += data.tile.a + data.tile.b; r.early++; }
      }
      if (type === 'result') {
        r.hands++;
        if (data.winner === 0) { r.wins++; r.gained += data.gain; if (data.type === 'domino') r.dominos++; }
        else { r.losses++; r.lostPips += data.pips[0]; }
        if (r.hands < targetHands) queue.push(() => g.nextHand());
      }
    } });
    g.players.forEach(p => { p.isAI = true; });
    g.assignCharacters = function () {
      this.players.forEach((p, i) => {
        p.character = i === 0 ? charIdx : 0;
        p.name = DM.ai.CHARACTERS[p.character].name;
      });
    };
    g.schedule = fn => queue.push(() => fn.call(g));
    g.stop = () => { queue.length = 0; };
    g.startGame();
    while (queue.length && !g.gameOver) queue.shift()();
  }
  return r;
}

const HANDS = parseInt(process.argv[2] || '600', 10);
const ONLY = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log('席0 に各キャラ、席1・2 にナオを置いた結果（各' + HANDS + '局・難易度つよい）\n');
console.log(pad('キャラ', 10) + pad('局の勝率', 10) + pad('ドミノ率', 10) + pad('序盤の牌の目', 14) +
  pad('場の得点/局', 12) + pad('1局あたり得点', 14) + pad('引いた枚数/局', 14) + pad('下家が止まる', 14) + '負け時の残り目');
DM.ai.CHARACTERS.forEach((c, i) => {
  if (ONLY && ONLY.indexOf(i) < 0) return;
  const r = measure(i, HANDS);
  console.log(
    pad(c.name, 10) +
    pad(pct(r.wins, r.hands), 10) +
    pad(pct(r.dominos, r.hands), 10) +
    pad((r.earlyPips / r.early).toFixed(1), 14) +
    pad((r.playPts / r.hands).toFixed(1), 12) +
    pad(((r.gained + r.playPts) / r.hands).toFixed(1), 14) +
    pad((r.draws / r.hands).toFixed(2), 14) +
    pad(pct(r.nextStuck, r.nextTurns), 14) +
    (r.lostPips / r.losses).toFixed(1));
});
