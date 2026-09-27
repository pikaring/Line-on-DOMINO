/*
 * game.js - ドミノ（4 人・ダブルシックス）のゲームエンジン
 *
 * ルール:
 *   - 28 枚を 4 人に 7 枚ずつ配る（山は残らない）
 *   - 最初の局は 6-6 を持っている人が 6-6 から始める。2 局目からは前局の勝者が好きな牌で始める
 *   - 手番では、場の両端（左端・右端）のどちらかに同じ目でつなぐ。出せる牌があれば必ず出す
 *   - 出せなければパス。4 人続けてパスしたら「ブロック（行き詰まり）」
 *   - 手牌を出し切った人が「ドミノ」で局の勝者
 *
 * 得点（2 方式）:
 *   block ... 勝者が他の 3 人の残り目の合計を得る。行き詰まりは残り目が最少の人が勝者
 *             （最少が同点なら得点なし）
 *   fives ... 上に加えて、つないだ直後に両端の目の合計が 5 の倍数ならその点を得る
 *             （端がダブルなら両方の目を数える）。局の精算は 5 点単位に丸める
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var SEAT_NAMES = ['あなた', '下家CPU', '対面CPU', '上家CPU'];
  var SEAT_LABELS = ['', '下家', '対面', '上家'];
  var TARGETS = { block: 100, fives: 200 };

  function Game(opts) {
    opts = opts || {};
    this.onEvent = opts.onEvent || function () {};
    this.speed = opts.speed == null ? 650 : opts.speed;
    this.seed = opts.seed;
    this.mode = opts.mode === 'fives' ? 'fives' : 'block';
    this.target = opts.target || TARGETS[this.mode];
    // CPU の強さ 0=やさしい / 1=ふつう / 2=つよい
    this.difficulty = opts.difficulty == null ? 1 : opts.difficulty;
    this.players = [0, 1, 2, 3].map(function (i) {
      return {
        seat: i,
        name: SEAT_NAMES[i],
        seatLabel: SEAT_LABELS[i],
        isAI: i !== 0,
        character: null,
        difficulty: null,
        score: 0,
        hand: [],
        count: 0,          // 手牌の枚数（公開情報。CPU はこちらだけを見る）
        voids: [],         // パスしたことで「持っていない」と分かった目（公開情報）
        passed: false
      };
    });
    this.line = [];
    this.timer = null;
  }

  /* --- 進行制御 -------------------------------------------------------- */

  Game.prototype.emit = function (type, data) { this.onEvent(type, data || {}); };
  Game.prototype.log = function (msg) { this.emit('log', { message: msg }); };

  Game.prototype.schedule = function (fn) {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { fn.call(self); }, this.speed);
  };

  Game.prototype.stop = function () { clearTimeout(this.timer); };

  /* --- 開始 ------------------------------------------------------------ */

  Game.prototype.startGame = function () {
    this.rng = this.seed != null ? DM.mulberry32(this.seed) : Math.random;
    this.players.forEach(function (p) { p.score = 0; });
    this.assignCharacters();
    this.handNo = 0;
    this.nextLeader = null;
    this.finished = false;
    this.gameOver = false;
    this.startHand();
  };

  /** CPU の打ち筋（登場人物）を 6 人から 3 人、重複なく抽選する */
  Game.prototype.assignCharacters = function () {
    var pool = DM.ai.CHARACTERS.map(function (_, i) { return i; });
    DM.shuffle(pool, this.rng);
    var k = 0;
    this.players.forEach(function (p) {
      if (!p.isAI) { p.character = null; return; }
      p.character = pool[k++];
      p.name = DM.ai.CHARACTERS[p.character].name;
    });
    this.log('対戦相手: ' + this.players.filter(function (p) { return p.isAI; })
      .map(function (p) { return p.seatLabel + ' ' + p.name; }).join(' / '));
  };

  Game.prototype.startHand = function () {
    var self = this;
    var deck = DM.shuffle(DM.TILES.slice(), this.rng);
    this.handNo++;
    this.line = [];
    this.passesInRow = 0;
    this.awaiting = null;
    this.result = null;
    this.turns = 0;
    this.players.forEach(function (p, i) {
      p.hand = DM.sortHand(deck.slice(i * 7, i * 7 + 7));
      p.count = 7;
      p.voids = [false, false, false, false, false, false, false];
      p.passed = false;
    });

    // 最初の局は 6-6 を持つ人から。2 局目以降は前局の勝者から
    this.openingDouble = this.handNo === 1;
    if (this.openingDouble) {
      this.leader = this.players.filter(function (p) {
        return p.hand.some(function (t) { return t.a === 6 && t.b === 6; });
      })[0].seat;
    } else {
      this.leader = this.nextLeader;
    }

    this.log('=== 第' + this.handNo + '局 / 親: ' + this.players[this.leader].name +
      (this.openingDouble ? '（6-6 から）' : '') + ' ===');
    this.emit('handStart', {});
    this.emit('update', {});
    this.schedule(function () { self.beginTurn(self.leader); });
  };

  /* --- 場 -------------------------------------------------------------- */

  Game.prototype.leftEnd = function () { return this.line.length ? this.line[0].l : null; };
  Game.prototype.rightEnd = function () { return this.line.length ? this.line[this.line.length - 1].r : null; };

  /** 両端の目の合計（オールファイブの得点判定）。端がダブルなら両方の目を数える */
  Game.prototype.endSum = function (line) {
    line = line || this.line;
    if (!line.length) return 0;
    if (line.length === 1) return DM.pips(line[0].tile);
    var L = line[0], R = line[line.length - 1];
    return (DM.isDouble(L.tile) ? L.l * 2 : L.l) + (DM.isDouble(R.tile) ? R.r * 2 : R.r);
  };

  /** 手牌 hand で出せる手の一覧 [{ index, side: 'L'|'R' }] */
  Game.prototype.legalMoves = function (hand) {
    var moves = [];
    if (!this.line.length) {
      hand.forEach(function (t, i) {
        if (this.openingDouble && !(t.a === 6 && t.b === 6)) return;
        moves.push({ index: i, side: 'R' });
      }, this);
      return moves;
    }
    var L = this.leftEnd(), R = this.rightEnd();
    hand.forEach(function (t, i) {
      // 両端が同じ目なら、どちらに置いても局面は同じなので右だけにする
      if (DM.has(t, L) && L !== R) moves.push({ index: i, side: 'L' });
      if (DM.has(t, R)) moves.push({ index: i, side: 'R' });
    });
    return moves;
  };

  /**
   * 牌を置いたあとの場を返す（this.line は変えない）。CPU の読みとヒントでも使う。
   */
  Game.prototype.placed = function (tile, side, line) {
    line = (line || this.line).slice();
    if (!line.length) {
      line.push({ tile: tile, l: tile.b, r: tile.a });
    } else if (side === 'L') {
      var e = line[0].l;
      line.unshift({ tile: tile, l: DM.other(tile, e), r: e });
    } else {
      var f = line[line.length - 1].r;
      line.push({ tile: tile, l: f, r: DM.other(tile, f) });
    }
    return line;
  };

  /** その手で得られるオールファイブの点（block では常に 0） */
  Game.prototype.scoreOf = function (tile, side) {
    if (this.mode !== 'fives') return 0;
    var s = this.endSum(this.placed(tile, side));
    return s > 0 && s % 5 === 0 ? s : 0;
  };

  /* --- 手番 ------------------------------------------------------------ */

  Game.prototype.beginTurn = function (seat) {
    if (this.result || this.gameOver) return;
    var p = this.players[seat];
    this.current = seat;
    var moves = this.legalMoves(p.hand);

    if (!moves.length) {
      if (p.isAI) {
        this.awaiting = null;
        this.emit('update', {});
        this.schedule(function () { this.pass(p); });
      } else {
        this.awaiting = { type: 'pass', seat: seat };
        this.emit('await', this.awaiting);
        this.emit('update', {});
      }
      return;
    }

    if (p.isAI) {
      this.awaiting = null;
      this.emit('update', {});
      this.schedule(function () {
        var m = DM.ai.chooseMove(this, p, moves);
        this.play(p, m);
      });
    } else {
      this.awaiting = { type: 'turn', seat: seat, moves: moves };
      this.emit('await', this.awaiting);
      this.emit('update', {});
    }
  };

  Game.prototype.play = function (p, move) {
    var tile = p.hand.splice(move.index, 1)[0];
    var first = !this.line.length;
    var pts = this.scoreOf(tile, move.side);
    this.line = this.placed(tile, move.side);
    this.line[move.side === 'L' ? 0 : this.line.length - 1].by = p.seat;
    p.count = p.hand.length;
    p.passed = false;
    this.passesInRow = 0;
    this.openingDouble = false;
    this.awaiting = null;
    this.turns++;

    var where = first ? '' : (move.side === 'L' ? ' → 左端' : ' → 右端');
    this.log(p.name + ' ' + DM.label(tile) + where + (pts ? '　' + pts + '点！' : ''));
    if (pts) p.score += pts;
    this.emit('play', { seat: p.seat, tile: tile, side: move.side, points: pts });
    this.emit('update', {});

    if (p.count === 0) { this.endHand('domino', p.seat); return; }
    this.schedule(function () { this.beginTurn((p.seat + 1) % 4); });
  };

  Game.prototype.pass = function (p) {
    var L = this.leftEnd(), R = this.rightEnd();
    p.voids[L] = true;
    p.voids[R] = true;
    p.passed = true;
    this.passesInRow++;
    this.awaiting = null;
    this.log(p.name + ' パス（' + (L === R ? L : L + '・' + R) + ' がない）');
    this.emit('pass', { seat: p.seat });
    this.emit('update', {});
    if (this.passesInRow >= 4) { this.endHand('blocked', null); return; }
    this.schedule(function () { this.beginTurn((p.seat + 1) % 4); });
  };

  /* --- プレイヤー操作 -------------------------------------------------- */

  Game.prototype.playerPlay = function (index, side) {
    var a = this.awaiting;
    if (!a || a.type !== 'turn' || a.seat !== 0) return false;
    var ok = a.moves.some(function (m) { return m.index === index && m.side === side; });
    if (!ok) return false;
    this.play(this.players[0], { index: index, side: side });
    return true;
  };

  Game.prototype.playerPass = function () {
    var a = this.awaiting;
    if (!a || a.type !== 'pass' || a.seat !== 0) return false;
    this.pass(this.players[0]);
    return true;
  };

  /* --- 局の精算 -------------------------------------------------------- */

  function round5(n) { return Math.round(n / 5) * 5; }

  Game.prototype.endHand = function (type, winner) {
    var self = this;
    this.stop();
    var pips = this.players.map(function (p) { return DM.handPips(p.hand); });

    if (type === 'blocked') {
      var min = Math.min.apply(null, pips);
      var lows = pips.filter(function (x) { return x === min; }).length;
      winner = lows === 1 ? pips.indexOf(min) : null;
    }

    var gain = 0;
    if (winner != null) {
      pips.forEach(function (x, i) { if (i !== winner) gain += x; });
      if (this.mode === 'fives') gain = round5(gain);
      this.players[winner].score += gain;
    }

    var detail = [];
    if (type === 'domino') {
      detail.push(this.players[winner].name + ' が出し切り（ドミノ）');
    } else {
      detail.push('4 人続けてパス（ブロック）。残り目の少ない人が勝者');
      if (winner == null) detail.push('残り目が最少の人が同点のため、得点なし');
    }
    if (winner != null) {
      detail.push(this.players[winner].name + ' +' + gain + '点（他の 3 人の残り目' +
        (this.mode === 'fives' ? '、5 点単位に丸め' : '') + '）');
    }

    this.nextLeader = winner != null ? winner : (this.leader + 1) % 4;
    this.finished = this.players.some(function (p) { return p.score >= self.target; });
    this.awaiting = null;
    this.result = {
      type: type,
      winner: winner,
      gain: gain,
      pips: pips,
      hands: this.players.map(function (p) { return p.hand.slice(); }),
      detail: detail,
      final: this.finished
    };
    this.log(type === 'domino' ? '--- ' + this.players[winner].name + ' ドミノ！ +' + gain + '点 ---'
      : '--- ブロック' + (winner != null ? '　' + this.players[winner].name + ' +' + gain + '点' : '（得点なし）') + ' ---');
    this.emit('update', {});
    this.emit('result', this.result);
  };

  Game.prototype.standings = function () {
    return this.players.map(function (p) { return { seat: p.seat, name: p.name, score: p.score }; })
      .sort(function (a, b) { return b.score - a.score || a.seat - b.seat; });
  };

  Game.prototype.nextHand = function () {
    if (this.gameOver) return;
    if (this.finished) {
      this.gameOver = true;
      this.emit('gameOver', { standings: this.standings(), hands: this.handNo });
      return;
    }
    this.startHand();
  };

  Game.TARGETS = TARGETS;
  DM.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
