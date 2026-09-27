/*
 * tests.js - 自己テスト（ブラウザの test.html と、node tests/run.js の両方で動く）
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var results = [];

  function test(name, fn) {
    try {
      var extra = fn();
      results.push({ name: name, pass: extra === undefined || extra === true, extra: extra === true ? '' : String(extra || '') });
    } catch (e) {
      results.push({ name: name, pass: false, extra: e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e) });
    }
  }
  function eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期待 ' + JSON.stringify(b) + ' / 実際 ' + JSON.stringify(a));
  }
  function ok(c, msg) { if (!c) throw new Error(msg || '条件が成り立たない'); }

  function T(b, a) { return DM.TILES.filter(function (t) { return t.a === Math.min(a, b) && t.b === Math.max(a, b); })[0]; }

  /** setTimeout を使わずに、その場で最後まで進めるゲーム */
  function syncGame(opts) {
    var events = [];
    opts = opts || {};
    var g = new DM.Game({
      speed: 0, seed: opts.seed || 1, mode: opts.mode, difficulty: opts.difficulty == null ? 2 : opts.difficulty,
      onEvent: function (type, data) { events.push({ type: type, data: data }); }
    });
    g.players.forEach(function (p) { p.isAI = true; });
    var queue = [];
    g.schedule = function (fn) { queue.push(fn); };
    g.stop = function () { queue.length = 0; };
    g.drain = function (limit) {
      for (var n = 0; queue.length && n < (limit || 100000); n++) queue.shift().call(g);
    };
    g.events = events;
    return g;
  }

  /* --- 牌 -------------------------------------------------------------- */
  test('牌は 28 枚で重複なし', function () {
    eq(DM.TILES.length, 28);
    var keys = {};
    DM.TILES.forEach(function (t) { keys[t.a + '-' + t.b] = 1; });
    eq(Object.keys(keys).length, 28);
  });
  test('目の合計は 168、各目は 8 回ずつ出てくる', function () {
    eq(DM.handPips(DM.TILES), 168);
    for (var n = 0; n <= 6; n++) {
      var c = 0;
      DM.TILES.forEach(function (t) { if (t.a === n) c++; if (t.b === n) c++; });
      eq(c, 8, '目 ' + n);
    }
  });

  /* --- 場のつなぎ方 ---------------------------------------------------- */
  test('最初の局は 6-6 しか出せない', function () {
    var g = syncGame();
    g.openingDouble = true; g.line = [];
    var hand = [T(6, 6), T(6, 5), T(1, 0)];
    eq(g.legalMoves(hand), [{ index: 0, side: 'R' }]);
    g.openingDouble = false;
    eq(g.legalMoves(hand).length, 3);
  });
  test('左端・右端に同じ目でつなぐ', function () {
    var g = syncGame();
    g.openingDouble = false;
    g.line = g.placed(T(6, 3), 'R', []);          // 6|3
    g.line = g.placed(T(3, 1), 'R');              // 6|3 3|1
    g.line = g.placed(T(6, 4), 'L');              // 4|6 6|3 3|1
    eq(g.line.map(function (x) { return [x.l, x.r]; }), [[4, 6], [6, 3], [3, 1]]);
    eq([g.leftEnd(), g.rightEnd()], [4, 1]);
    var hand = [T(4, 1), T(2, 2), T(1, 5)];
    eq(g.legalMoves(hand), [{ index: 0, side: 'L' }, { index: 0, side: 'R' }, { index: 2, side: 'R' }]);
  });
  test('両端が同じ目なら右だけを候補にする', function () {
    var g = syncGame();
    g.openingDouble = false;
    g.line = g.placed(T(5, 5), 'R', []);
    eq(g.legalMoves([T(5, 2)]), [{ index: 0, side: 'R' }]);
  });

  /* --- オールファイブの点 ---------------------------------------------- */
  test('両端の合計: 1 枚目は牌の目の合計', function () {
    var g = syncGame();
    eq(g.endSum(g.placed(T(5, 5), 'R', [])), 10);
    eq(g.endSum(g.placed(T(3, 2), 'R', [])), 5);
  });
  test('両端の合計: 端のダブルは両方の目を数える', function () {
    var g = syncGame();
    var line = g.placed(T(5, 5), 'R', []);
    line = g.placed(T(5, 0), 'R', line);          // 5|5 5|0 → 左端がダブル 5-5 で 10、右端 0
    eq(g.endSum(line), 10);
    line = g.placed(T(0, 0), 'R', line);          // 右端がダブル 0-0
    eq(g.endSum(line), 10);
    line = g.placed(T(5, 4), 'L', line);          // 4|5 5|5 ... 左端 4
    eq(g.endSum(line), 4);
  });
  test('得点はオールファイブのときだけ', function () {
    var g = syncGame({ mode: 'fives' });
    g.line = g.placed(T(6, 4), 'R', []);          // 6|4 → 10 点
    eq(g.scoreOf(T(4, 1), 'R'), 0);               // 6 + 1 = 7
    eq(g.scoreOf(T(4, 4), 'R'), 0);               // 6 + 8 = 14
    eq(g.scoreOf(T(6, 3), 'L'), 0);               // 3 + 4 = 7
    eq(g.scoreOf(T(6, 1), 'L'), 5);               // 1 + 4 = 5
    var b = syncGame({ mode: 'block' });
    b.line = b.placed(T(6, 4), 'R', []);
    eq(b.scoreOf(T(6, 1), 'L'), 0);
  });

  /* --- 局の精算 -------------------------------------------------------- */
  function setupEnd(mode, hands) {
    var g = syncGame({ mode: mode });
    g.startGame(); g.stop();
    g.players.forEach(function (p, i) { p.hand = hands[i]; p.count = hands[i].length; p.score = 0; });
    return g;
  }
  test('ドミノ: 勝者が他の 3 人の残り目を得る', function () {
    var g = setupEnd('block', [[], [T(6, 6)], [T(1, 0)], [T(3, 2), T(2, 0)]]);
    g.endHand('domino', 0);
    eq(g.players[0].score, 12 + 1 + 7);
  });
  test('ブロック: 残り目が最少の人が勝者', function () {
    var g = setupEnd('block', [[T(6, 6)], [T(1, 0)], [T(3, 2)], [T(5, 4)]]);
    g.endHand('blocked', null);
    eq(g.result.winner, 1);
    eq(g.players[1].score, 12 + 5 + 9);
  });
  test('ブロック: 最少が同点なら得点なし', function () {
    var g = setupEnd('block', [[T(6, 6)], [T(1, 0)], [T(1, 0)], [T(5, 4)]]);
    g.endHand('blocked', null);
    eq(g.result.winner, null);
    eq(g.players.map(function (p) { return p.score; }), [0, 0, 0, 0]);
  });
  test('オールファイブの精算は 5 点単位に丸める', function () {
    var g = setupEnd('fives', [[], [T(6, 6)], [T(6, 5)], [T(1, 1)]]);  // 12 + 11 + 2 = 25
    g.endHand('domino', 0);
    eq(g.players[0].score, 25);
    g = setupEnd('fives', [[], [T(6, 6)], [T(6, 4)], [T(1, 0)]]);      // 12 + 10 + 1 = 23 → 25
    g.endHand('domino', 0);
    eq(g.players[0].score, 25);
    g = setupEnd('fives', [[], [T(6, 6)], [T(6, 3)], [T(1, 0)]]);      // 22 → 20
    g.endHand('domino', 0);
    eq(g.players[0].score, 20);
  });

  /* --- CPU の読み ------------------------------------------------------ */
  test('配り直しは各席の枚数どおりで、パスした目を配らない', function () {
    var g = syncGame();
    g.startGame(); g.stop();
    g.line = g.placed(T(6, 6), 'R', []);
    var me = g.players[0];
    me.hand = me.hand.filter(function (t) { return !(t.a === 6 && t.b === 6); });
    me.count = me.hand.length;
    g.players[1].count = 7; g.players[2].count = 7; g.players[3].count = 7;
    // 6-6 を誰かが持っていた場合に備えて、枚数を見えていない牌の数に合わせる
    var unseen = DM.ai.unseenTiles(g, me).length;
    g.players[3].count = unseen - 14;
    g.players[1].voids = [false, false, false, false, false, false, true];
    var deals = DM.ai.sampleDeals(g, me, 50, true, DM.mulberry32(3));
    deals.forEach(function (d) {
      eq(d[1].length, 7); eq(d[2].length, 7); eq(d[3].length, unseen - 14);
      ok(d[1].every(function (t) { return !DM.has(t, 6); }), '下家に 6 が配られた');
    });
  });
  test('ヒントのおすすめは出せる手のどれか', function () {
    var g = syncGame();
    g.startGame();
    g.players[0].isAI = false;
    for (var n = 0; n < 2000 && !(g.awaiting && g.awaiting.seat === 0 && g.awaiting.type === 'turn'); n++) {
      if (g.result) { g.nextHand(); }
      g.drain(1);
    }
    var a = g.awaiting;
    ok(a && a.type === 'turn', '自分の手番が来ない');
    var adv = DM.coach.advise(g);
    ok(a.moves.some(function (m) { return m.index === adv.best.move.index && m.side === adv.best.move.side; }));
    ok(adv.reasons.length >= 1, '理由が空');
  });

  /* --- CPU 同士の対戦 -------------------------------------------------- */
  ['block', 'fives'].forEach(function (mode) {
    test('CPU 4 人で最後まで対戦できる（' + mode + '）', function () {
      for (var seed = 1; seed <= 6; seed++) {
        var g = syncGame({ seed: seed, mode: mode, difficulty: seed % 3 });
        var checks = 0;
        g.onEvent = function (type, data) {
          if (type === 'update' && !g.result) {
            // 手牌と場で 28 枚がそろっている
            var n = g.line.length;
            g.players.forEach(function (p) { n += p.hand.length; eq(p.count, p.hand.length); });
            eq(n, 28);
            // 隣り合う牌は同じ目でつながっている
            for (var i = 0; i + 1 < g.line.length; i++) eq(g.line[i].r, g.line[i + 1].l, 'つなぎ目');
            checks++;
          }
          if (type === 'pass') {
            eq(g.legalMoves(g.players[data.seat].hand).length, 0, 'パスしたのに出せる牌があった');
          }
          if (type === 'result') g.schedule(function () { g.nextHand(); });
        };
        g.startGame();
        g.drain();
        ok(g.gameOver, 'seed ' + seed + ' で終わらない');
        ok(g.players.some(function (p) { return p.score >= g.target; }), '目標点に届いていない');
        ok(checks > 20);
      }
    });
  });

  var passed = results.filter(function (r) { return r.pass; }).length;
  global.DM_TEST_RESULT = { results: results, passed: passed, total: results.length };

  if (typeof document !== 'undefined' && document.getElementById('summary')) {
    document.getElementById('summary').innerHTML = '<span class="' + (passed === results.length ? 'pass' : 'fail') + '">' +
      passed + ' / ' + results.length + ' passed</span>';
    document.getElementById('list').innerHTML = results.map(function (r) {
      return '<div class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✓ ' : '✗ ') + r.name +
        (r.extra ? ' <span class="ex">' + r.extra.replace(/</g, '&lt;') + '</span>' : '') + '</div>';
    }).join('');
  }
})(typeof window !== 'undefined' ? window : globalThis);
