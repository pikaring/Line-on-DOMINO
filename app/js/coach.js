/*
 * coach.js - ヒント（おすすめの手と、その理由）
 *
 * advise(game) で、自分（席0）の手番のおすすめを返す。
 *   { best, list, reasons[], voids, unseen }
 *
 * 評価は CPU と同じ ai.rank() を、定石の重み・つよいの読みで呼ぶ。
 * ヒントも CPU と同じく、自分の手牌と公開情報（場・枚数・パスの記録）しか見ない。
 * 乱数はゲーム本体の rng を使わない（ヒントを見たかどうかで CPU の手が変わらないように）。
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var SEAT_WORD = ['あなた', '下家', '対面', '上家'];

  function pct(x) { return Math.round(x * 100) + '%'; }

  function ends(a) { return a.ends[0] === a.ends[1] ? String(a.ends[0]) : a.ends[0] + '・' + a.ends[1]; }

  /** パスの記録から分かっている「持っていない目」 */
  function voidText(p) {
    var v = [];
    p.voids.forEach(function (x, n) { if (x) v.push(n); });
    return v;
  }

  function reasonsFor(game, a, second) {
    var out = [];
    if (!a.rest.length) return ['これで出し切り（ドミノ）です。'];

    if (a.points) out.push('両端の合計が ' + a.points + ' になり、' + a.points + '点入ります。');

    // 封鎖: 次に出せなくなりそうな相手
    var seats = Object.keys(a.oppBlock).map(Number).sort(function (x, y) { return a.oppBlock[y] - a.oppBlock[x]; });
    var top = seats[0];
    if (a.oppBlock[top] >= 0.5) {
      var p = game.players[top];
      var known = voidText(p).filter(function (n) { return n === a.ends[0] || n === a.ends[1]; });
      out.push(SEAT_WORD[top] + '（' + p.name + '）は次に出せない見込み ' + pct(a.oppBlock[top]) +
        (known.length ? '。前に ' + known.join('・') + ' でパスしています。' : '。'));
    }

    if (DM.isDouble(a.tile)) {
      out.push('ダブルはつなげる目が 1 種類しかないので、出せるうちに出しておきます。');
    } else if (DM.pips(a.tile) >= 8) {
      out.push('重い牌（' + DM.pips(a.tile) + '目）を先に処理。ブロックで負けたときの失点が減ります。');
    }

    if (a.follow >= 0.75) {
      out.push('出したあと両端は ' + ends(a) + '。他の 3 人が 1 巡しても、自分がまた出せる見込み ' + pct(a.follow) + '。');
    } else if (a.follow < 0.5) {
      out.push('出したあと両端は ' + ends(a) + '。次の自分の番はパスになる恐れがあります（出せる見込み ' + pct(a.follow) + '）。');
    }

    if (game.mode === 'fives' && a.dangerPts >= 4) {
      out.push('ただし下家に平均 ' + a.dangerPts.toFixed(1) + '点ほど取られる見込みがあります。');
    }

    if (second && out.length < 2) {
      out.push('次点は ' + DM.label(second.tile) + (game.line.length ? (second.move.side === 'L' ? '（左端）' : '（右端）') : '') + '。');
    }
    return out.slice(0, 3);
  }

  function advise(game) {
    var a = game.awaiting;
    if (!a || a.seat !== 0 || a.type !== 'turn') return null;
    var list = DM.ai.rank(game, game.players[0], a.moves, {
      level: DM.ai.LEVELS[2],
      weights: DM.ai.CHARACTERS[0].w,
      rng: Math.random
    });
    var best = list[0];
    return {
      best: best,
      list: list,
      reasons: reasonsFor(game, best, list[1])
    };
  }

  /** 目ごとの「まだ見えていない牌」の枚数（自分から見て） */
  function unseenByNumber(game) {
    var me = game.players[0];
    var c = [0, 0, 0, 0, 0, 0, 0];
    DM.ai.unseenTiles(game, me).forEach(function (t) {
      c[t.a]++;
      if (t.b !== t.a) c[t.b]++;
    });
    return c;
  }

  DM.coach = { advise: advise, voidText: voidText, unseenByNumber: unseenByNumber };
})(typeof window !== 'undefined' ? window : globalThis);
