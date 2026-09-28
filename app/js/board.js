/*
 * board.js - 場（スピナー付き）の表現と、端・得点の計算
 *
 * 場は「中心の牌」と、そこから 4 方向（W 左・E 右・N 上・S 下）にのびる腕で表す。
 *   { center: tile, spin: 中心がダブルか, arms: { W: [piece], E: [...], N: [...], S: [...] } }
 *   piece = { tile, inner: 中心側の目, outer: 外側の目 }
 *
 * 中心がダブル（スピナー）なら 4 方向に、そうでなければ左右の 2 方向にだけのびる。
 * 上下は、左右の両方に 1 枚ずつつながってから開く。
 *
 * どの関数も場を書き換えず、新しい場を返す（CPU の読みやヒントでも使うため）。
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var DIRS = ['W', 'E', 'N', 'S'];
  var DIR_JA = { W: '左', E: '右', N: '上', S: '下' };

  function create(tile) {
    return { center: tile, spin: DM.isDouble(tile), arms: { W: [], E: [], N: [], S: [] } };
  }

  /** 中心の牌の、その方向の目（左は大きい方、右は小さい方） */
  function centerValue(b, dir) {
    return dir === 'E' ? b.center.a : b.center.b;
  }

  /** 開いている端 [{ dir, value }] */
  function openEnds(b) {
    if (!b) return [];
    var out = [];
    var dirs = b.spin && b.arms.W.length && b.arms.E.length ? DIRS : ['W', 'E'];
    dirs.forEach(function (d) {
      var arm = b.arms[d];
      out.push({ dir: d, value: arm.length ? arm[arm.length - 1].outer : centerValue(b, d) });
    });
    return out;
  }

  /**
   * 置ける端。見た目は違っても局面が同じになる端は 1 つにまとめる
   * （スピナーだけのときの左右、どちらも空の上下）。
   */
  function playableEnds(b) {
    var ends = openEnds(b);
    return ends.filter(function (e) {
      if (!b.spin) return true;
      if (e.dir === 'W' && !b.arms.W.length && !b.arms.E.length) return false;
      if (e.dir === 'S' && !b.arms.S.length && !b.arms.N.length) return false;
      return true;
    });
  }

  function place(b, tile, dir) {
    if (!b) return create(tile);
    var arms = { W: b.arms.W.slice(), E: b.arms.E.slice(), N: b.arms.N.slice(), S: b.arms.S.slice() };
    var arm = arms[dir];
    var v = arm.length ? arm[arm.length - 1].outer : centerValue(b, dir);
    arm.push({ tile: tile, inner: v, outer: DM.other(tile, v) });
    return { center: b.center, spin: b.spin, arms: arms };
  }

  /**
   * 両端（最大 4 つ）の目の合計。オールファイブの得点判定に使う。
   *   - 中心だけのときは牌の目の合計
   *   - 腕の先がダブルならその端は 2 倍
   *   - 左右がまだ空なら中心の目を数える（スピナーなら 2 倍）。上下は 1 枚つながるまで数えない
   */
  function endSum(b) {
    if (!b) return 0;
    var a = b.arms;
    if (!a.W.length && !a.E.length) return DM.pips(b.center);
    var sum = 0;
    DIRS.forEach(function (d) {
      var arm = a[d];
      if (arm.length) {
        var last = arm[arm.length - 1];
        sum += DM.isDouble(last.tile) ? last.outer * 2 : last.outer;
      } else if (d === 'W' || d === 'E') {
        sum += centerValue(b, d) * (b.spin ? 2 : 1);
      }
    });
    return sum;
  }

  function tiles(b) {
    if (!b) return [];
    var out = [b.center];
    DIRS.forEach(function (d) { b.arms[d].forEach(function (p) { out.push(p.tile); }); });
    return out;
  }

  function count(b) { return tiles(b).length; }

  DM.board = {
    DIRS: DIRS,
    DIR_JA: DIR_JA,
    create: create,
    openEnds: openEnds,
    playableEnds: playableEnds,
    place: place,
    endSum: endSum,
    tiles: tiles,
    count: count
  };
})(typeof window !== 'undefined' ? window : globalThis);
