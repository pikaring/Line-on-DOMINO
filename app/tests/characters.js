/*
 * characters.js - キャラクターごとの打ち筋を実測する
 *
 * 席0 に各キャラ、席1〜3 に基準のナオを置いて局を重ね、
 * 局の勝率・ドミノ率・序盤に出す牌の重さとダブルの割合・自分のパス率・下家のパス率・
 * 負けたときの残り目などを比べる。
 *
 *   node tests/characters.js [1キャラあたりの局数] [block|fives] [キャラ番号,...]
 */
const path = require('path');
const base = path.join(__dirname, '..', 'js');
['tiles', 'ai', 'game'].forEach(f => require(path.join(base, f + '.js')));
const DM = globalThis.DM;

function measure(charIdx, targetHands, mode) {
  const r = { hands: 0, wins: 0, dominos: 0, turns: 0, passes: 0, nextTurns: 0, nextPasses: 0,
    lostPips: 0, losses: 0, playPts: 0, gained: 0, earlyPips: 0, earlyDbl: 0, early: 0 };
  let myPlays = 0;
  let seed = 700 + charIdx * 4111;
  return new Promise(resolve => {
    function runGame(done) {
      const g = new DM.Game({ speed: 0, seed: seed++, mode, difficulty: 2, onEvent: (type, data) => {
        if (type === 'play') {
          if (data.seat === 0) {
            r.turns++; r.playPts += data.points;
            // 序盤 3 手に出した牌の重さ（最初の 6-6 は選べないので数えない）
            if (myPlays++ < 3 && !(data.tile.a === 6 && data.tile.b === 6)) { r.earlyPips += data.tile.a + data.tile.b; r.early++; if (data.tile.a === data.tile.b) r.earlyDbl++; }
          }
          if (data.seat === 1) r.nextTurns++;
        }
        if (type === 'pass') {
          if (data.seat === 0) { r.turns++; r.passes++; }
          if (data.seat === 1) { r.nextTurns++; r.nextPasses++; }
        }
        if (type === 'handStart') myPlays = 0;
        if (type === 'result') {
          r.hands++;
          if (data.winner === 0) { r.wins++; r.gained += data.gain; if (data.type === 'domino') r.dominos++; }
          else {
            r.losses++; r.lostPips += data.pips[0];
          }
          if (r.hands >= targetHands) { done(true); return; }
          setImmediate(() => g.nextHand());
        }
        if (type === 'gameOver') done(false);
      } });
      g.players.forEach(p => p.isAI = true);
      g.assignCharacters = function () {
        this.players.forEach((p, i) => {
          p.character = i === 0 ? charIdx : 0;
          p.name = DM.ai.CHARACTERS[p.character].name;
        });
      };
      g.startGame();
    }
    (function loop() {
      runGame(finished => finished ? resolve(r) : setImmediate(loop));
    })();
  });
}

const HANDS = parseInt(process.argv[2] || '400', 10);
const MODE = process.argv[3] === 'fives' ? 'fives' : 'block';
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : null;

(async () => {
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
  console.log('席0 に各キャラ、席1〜3 にナオを置いた結果（各' + HANDS + '局・' +
    (MODE === 'fives' ? 'オールファイブ' : 'ブロック') + '・難易度つよい）\n');
  console.log(pad('キャラ', 10) + pad('局の勝率', 10) + pad('ドミノ率', 10) + pad('序盤の牌の目', 14) + pad('序盤のダブル', 14) + pad('自分のパス率', 14) +
    pad('下家のパス率', 14) + pad('負け時の残り目', 16) + (MODE === 'fives' ? pad('場の得点/局', 12) : '') + '1局あたり得点');
  for (let c = 0; c < DM.ai.CHARACTERS.length; c++) {
    if (ONLY && ONLY.indexOf(c) < 0) continue;
    const r = await measure(c, HANDS, MODE);
    console.log(
      pad(DM.ai.CHARACTERS[c].name, 10) +
      pad(pct(r.wins, r.hands), 10) +
      pad(pct(r.dominos, r.hands), 10) +
      pad((r.earlyPips / r.early).toFixed(1), 14) +
      pad(pct(r.earlyDbl, r.early), 14) +
      pad(pct(r.passes, r.turns), 14) +
      pad(pct(r.nextPasses, r.nextTurns), 14) +
      pad((r.lostPips / r.losses).toFixed(1), 16) +
      (MODE === 'fives' ? pad((r.playPts / r.hands).toFixed(1), 12) : '') +
      ((r.gained + r.playPts) / r.hands).toFixed(1));
  }
})();
