/*
 * tiles.js - ドミノ牌の定義と、乱数・並べ替えなどの共通処理
 *
 * ダブルシックス（0〜6 の目）の 28 枚。牌は { id, a, b }（a <= b）で表す。
 * 場に置いた牌は向きがあるので { tile, l, r, by }（左の目・右の目・出した席）で持つ。
 */
(function (global) {
  'use strict';

  var DM = global.DM || (global.DM = {});

  var TILES = [];
  (function () {
    var id = 0;
    for (var a = 0; a <= 6; a++) {
      for (var b = a; b <= 6; b++) TILES.push({ id: id++, a: a, b: b });
    }
  })();

  function pips(t) { return t.a + t.b; }
  function isDouble(t) { return t.a === t.b; }
  function has(t, n) { return t.a === n || t.b === n; }
  /** n の目でつないだとき、反対側に出る目 */
  function other(t, n) { return t.a === n ? t.b : t.a; }
  function label(t) { return t.b + '-' + t.a; }

  function handPips(hand) {
    return hand.reduce(function (s, t) { return s + pips(t); }, 0);
  }

  /** 再現できる乱数（テスト・実測用） */
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var x = arr[i]; arr[i] = arr[j]; arr[j] = x;
    }
    return arr;
  }

  /** 手牌の並び: 大きい目を左に（ダブルは同じ目の中で先頭） */
  function sortHand(hand) {
    return hand.sort(function (x, y) {
      return (y.b - x.b) || (y.a - x.a);
    });
  }

  DM.TILES = TILES;
  DM.pips = pips;
  DM.isDouble = isDouble;
  DM.has = has;
  DM.other = other;
  DM.label = label;
  DM.handPips = handPips;
  DM.mulberry32 = mulberry32;
  DM.shuffle = shuffle;
  DM.sortHand = sortHand;
})(typeof window !== 'undefined' ? window : globalThis);
