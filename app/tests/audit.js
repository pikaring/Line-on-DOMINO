/*
 * CPU がイカサマしていないかの監査。
 * CPU の思考（chooseMove）とヒント（coach.advise）を呼んでいる間だけ、
 * 他の席の手牌（hand）にアクセスしたら記録する状態で対戦を回す。
 * 1 度でも触っていれば violations に残る。
 *
 *   node tests/audit.js [局数]
 */
const path = require('path');
const base = path.join(__dirname, '..', 'js');
['tiles', 'ai', 'game', 'coach'].forEach(f => require(path.join(base, f + '.js')));
const DM = globalThis.DM;

const violations = [];
let calls = 0;

function guardPlayer(p) {
  return new Proxy(p, {
    get(t, k) {
      if (k === 'hand') violations.push('席' + t.seat + ' の手牌を覗いた');
      return t[k];
    }
  });
}

function guarded(fn, meOf) {
  return function (game) {
    calls++;
    const me = meOf.apply(null, arguments);
    const real = game.players;
    game.players = real.map(p => (p.seat === me.seat ? p : guardPlayer(p)));
    try { return fn.apply(this, arguments); }
    finally { game.players = real; }
  };
}

DM.ai.chooseMove = guarded(DM.ai.chooseMove, (game, me) => me);
DM.coach.advise = guarded(DM.coach.advise, game => game.players[0]);

const TARGET = parseInt(process.argv[2] || '300', 10);
const wins = [0, 0, 0, 0];
let hands = 0, games = 0, blocked = 0, hints = 0;

for (let seed = 1; hands < TARGET; seed++) {
  const queue = [];
  const g = new DM.Game({
    speed: 0, seed, mode: seed % 2 ? 'block' : 'fives', difficulty: seed % 3,
    onEvent: (type, data) => {
      if (type === 'await' && data.seat === 0 && data.type === 'turn') {
        // 人間の席はヒントのおすすめどおりに打つ（ヒントも覗き見していないかを同時に見る）
        const adv = DM.coach.advise(g);
        hints++;
        queue.push(() => g.playerPlay(adv.best.move.index, adv.best.move.side));
      }
      if (type === 'await' && data.seat === 0 && data.type === 'pass') queue.push(() => g.playerPass());
      if (type === 'result') {
        hands++;
        if (data.winner != null) wins[data.winner]++;
        if (data.type === 'blocked') blocked++;
        queue.push(() => g.nextHand());
      }
      if (type === 'gameOver') games++;
    }
  });
  g.schedule = fn => queue.push(() => fn.call(g));
  g.stop = () => { queue.length = 0; };
  g.startGame();
  while (queue.length && !g.gameOver && hands < TARGET) queue.shift()();
}

console.log('局数:', hands, '/ 対戦:', games, '/ 思考とヒントの呼び出し:', calls, '（うちヒント ' + hints + '）');
console.log('席別 局の勝ち数:', wins.map((w, i) => '席' + i + ' ' + w + ' (' + (100 * w / hands).toFixed(1) + '%)').join('  '));
console.log('ブロックで終わった局:', blocked, '(' + (100 * blocked / hands).toFixed(1) + '%)');
console.log('');
console.log(violations.length === 0
  ? '✅ 覗き見なし: CPU とヒントから他の席の手牌へのアクセスは 0 件'
  : '❌ 違反 ' + violations.length + ' 件: ' + [...new Set(violations)].slice(0, 5).join(', '));
process.exit(violations.length ? 1 : 0);
