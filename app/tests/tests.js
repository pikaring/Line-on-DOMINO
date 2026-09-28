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

  /* --- 場（スピナー） -------------------------------------------------- */
  var BD = DM.board;
  function ends(b) { return BD.openEnds(b).map(function (e) { return e.dir + e.value; }); }

  test('スピナーは左右がつながってから上下が開く', function () {
    var b = BD.create(T(5, 5));
    eq(ends(b), ['W5', 'E5']);
    eq(BD.playableEnds(b).map(function (e) { return e.dir; }), ['E'], 'スピナーだけのときは右だけ');
    b = BD.place(b, T(5, 3), 'E');
    eq(ends(b), ['W5', 'E3']);
    b = BD.place(b, T(5, 1), 'W');
    eq(ends(b), ['W1', 'E3', 'N5', 'S5']);
    eq(BD.playableEnds(b).map(function (e) { return e.dir; }), ['W', 'E', 'N'], '上下がどちらも空なら上だけ');
    b = BD.place(b, T(5, 6), 'N');
    eq(ends(b), ['W1', 'E3', 'N6', 'S5']);
  });
  test('ダブル以外で始めたら左右だけ', function () {
    var b = BD.create(T(6, 2));
    eq(ends(b), ['W6', 'E2']);
    b = BD.place(b, T(2, 2), 'E');
    b = BD.place(b, T(6, 6), 'W');
    eq(ends(b), ['W6', 'E2']);
  });
  test('端の合計: 中心だけ・スピナー・ダブルの端・上下', function () {
    eq(BD.endSum(BD.create(T(5, 5))), 10);
    eq(BD.endSum(BD.create(T(3, 2))), 5);
    var b = BD.place(BD.create(T(5, 5)), T(5, 0), 'E');   // 左はスピナー 10 ＋ 右 0
    eq(BD.endSum(b), 10);
    b = BD.place(b, T(5, 3), 'W');                          // 左 3 ＋ 右 0（スピナーはもう数えない）
    eq(BD.endSum(b), 3);
    b = BD.place(b, T(5, 2), 'N');                          // 上 2 が加わる
    eq(BD.endSum(b), 5);
    b = BD.place(b, T(0, 0), 'E');                          // 右端がダブル 0-0
    eq(BD.endSum(b), 5);
    b = BD.place(b, T(3, 3), 'W');                          // 左端がダブル 3-3 → 6
    eq(BD.endSum(b), 8);
    var c = BD.place(BD.create(T(6, 4)), T(4, 4), 'E');     // 6 ＋ 4-4 の 8
    eq(BD.endSum(c), 14);
  });
  test('場は置くたびに新しく作られ、元の場は変わらない', function () {
    var b = BD.create(T(5, 5));
    var b2 = BD.place(b, T(5, 3), 'E');
    eq(b.arms.E.length, 0);
    eq(b2.arms.E.length, 1);
    eq(BD.count(b2), 2);
  });

  /* --- 進行 ------------------------------------------------------------ */
  test('最初の局は一番大きいダブルから', function () {
    var g = syncGame({ seed: 7 });
    g.startGame();
    var best = -1;
    g.players.forEach(function (p) { p.hand.forEach(function (t) { if (DM.isDouble(t)) best = Math.max(best, t.a); }); });
    ok(g.openingTile && DM.isDouble(g.openingTile) && g.openingTile.a === best, '最初の牌 ' + (g.openingTile && DM.label(g.openingTile)));
    var leader = g.players[g.leader];
    eq(g.legalMoves(leader.hand).length, 1);
  });
  test('山から引くと、今の端の目がないことが記録される', function () {
    var g = syncGame({ seed: 3 });
    g.startGame(); g.stop();
    g.board = BD.create(T(6, 6));
    g.openingTile = null;
    var p = g.players[1];
    p.hand = [T(1, 0)]; p.count = 1;
    p.voids = [false, true, false, false, false, false, false];
    var before = g.boneCount();
    g.draw(p);
    eq(g.boneCount(), before - 1);
    eq(p.count, 2);
    ok(p.voids[6], '6 がない');
    ok(!p.voids[1], '前に分かっていた「ない目」は消える');
  });
  test('オールファイブの点と局の精算', function () {
    var g = syncGame();
    g.startGame(); g.stop();
    g.board = BD.create(T(5, 5)); g.openingTile = null;
    eq(g.scoreOf(T(5, 0), 'E'), 10);
    eq(g.scoreOf(T(5, 3), 'E'), 0);
    g.players.forEach(function (p) { p.score = 0; });
    g.players[0].hand = []; g.players[1].hand = [T(6, 6)]; g.players[2].hand = [T(6, 5)];  // 12 + 11 = 23 → 25
    g.endHand('domino', 0);
    eq(g.players[0].score, 25);
  });
  test('ブロック: 残り目が最少の人が勝者、同点なら精算なし', function () {
    var g = syncGame();
    g.startGame(); g.stop();
    g.players.forEach(function (p) { p.score = 0; });
    g.players[0].hand = [T(6, 6)]; g.players[1].hand = [T(1, 0)]; g.players[2].hand = [T(3, 2)];
    g.endHand('blocked', null);
    eq(g.result.winner, 1);
    eq(g.players[1].score, 15);   // 12 + 5 = 17 → 15
    g.players.forEach(function (p) { p.score = 0; });
    g.players[0].hand = [T(6, 6)]; g.players[1].hand = [T(1, 0)]; g.players[2].hand = [T(1, 0)];
    g.endHand('blocked', null);
    eq(g.result.winner, null);
  });

  /* --- CPU の読み ------------------------------------------------------ */
  test('配り直しは各席と山の枚数どおりで、「ない目」を配らない', function () {
    var g = syncGame();
    g.startGame(); g.stop();
    g.board = BD.create(T(6, 6)); g.openingTile = null;
    var me = g.players[0];
    me.hand = me.hand.filter(function (t) { return !(t.a === 6 && t.b === 6); });
    me.count = me.hand.length;
    var unseen = DM.ai.unseenTiles(g, me).length;
    g.players[1].count = 7;
    g.players[2].count = unseen - 7 - g.boneCount();
    g.players[1].voids = [false, false, false, false, false, false, true];
    var deals = DM.ai.sampleDeals(g, me, 50, true, DM.mulberry32(3));
    deals.forEach(function (d) {
      eq(d[1].length, 7); eq(d[2].length, g.players[2].count); eq(d.bone.length, g.boneCount());
      ok(d[1].every(function (t) { return !DM.has(t, 6); }), '下家に 6 が配られた');
    });
  });
  test('ヒントのおすすめは出せる手のどれか', function () {
    var g = syncGame();
    g.startGame();
    g.players[0].isAI = false;
    for (var n = 0; n < 5000 && !(g.awaiting && g.awaiting.seat === 0 && g.awaiting.type === 'turn'); n++) {
      if (g.awaiting && g.awaiting.seat === 0 && g.awaiting.type === 'draw') g.playerDraw();
      else if (g.awaiting && g.awaiting.seat === 0 && g.awaiting.type === 'pass') g.playerPass();
      if (g.result) g.nextHand();
      g.drain(1);
    }
    var a = g.awaiting;
    ok(a && a.type === 'turn', '自分の手番が来ない');
    var adv = DM.coach.advise(g);
    ok(a.moves.some(function (m) { return m.index === adv.best.move.index && m.dir === adv.best.move.dir; }));
    ok(adv.reasons.length >= 1, '理由が空');
  });

  /* --- CPU 同士の対戦 -------------------------------------------------- */
  test('CPU 3 人で最後まで対戦できる', function () {
    for (var seed = 1; seed <= 6; seed++) {
      var g = syncGame({ seed: seed, difficulty: seed % 3 });
      var checks = 0;
      g.onEvent = function (type, data) {
        if (type === 'update' && !g.result) {
          // 手牌・場・山で 28 枚がそろっている
          var n = BD.count(g.board) + g.boneCount();
          g.players.forEach(function (p) { n += p.hand.length; eq(p.count, p.hand.length); });
          eq(n, 28);
          checks++;
        }
        if (type === 'draw' || type === 'pass') {
          // 引く・パスするのは、出せる牌がなかったときだけ（引いた直後の 1 枚は除く）
          var p = g.players[data.seat];
          var hand = type === 'draw' ? p.hand.slice(0, -1) : p.hand;
          if (type === 'pass') eq(g.legalMoves(hand).length, 0, 'パスしたのに出せる牌があった');
        }
        if (type === 'pass') eq(g.boneCount(), 0, '山があるのにパスした');
        if (type === 'result') g.schedule(function () { g.nextHand(); });
      };
      g.startGame();
      g.drain();
      ok(g.gameOver, 'seed ' + seed + ' で終わらない');
      ok(g.players.some(function (p) { return p.score >= g.target; }), '目標点に届いていない');
      ok(checks > 20);
    }
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
