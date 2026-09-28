/*
 * game.js - ドミノ（3 人・ダブルシックス・オールファイブ）のゲームエンジン
 *
 * ルール:
 *   - 28 枚から 3 人に 7 枚ずつ配り、残り 7 枚が山（ボーンヤード）
 *   - 最初の局は、一番大きいダブルを持っている人がそのダブルから始める。
 *     2 局目からは前局の勝者が好きな牌で始める
 *   - 最初の牌がダブルならスピナー。左右に 1 枚ずつつながると、上下にものばせる（端が最大 4 つ）
 *   - 手番では、どれかの端に同じ目でつなぐ。出せる牌があれば必ず出す。
 *     出せなければ、出せる牌が来るまで山から引く。山が空ならパス
 *   - 3 人続けてパスしたら行き詰まり（ブロック）
 *   - 手牌を出し切った人が「ドミノ」で局の勝者
 *
 * 得点（オールファイブ）:
 *   - つないだ直後に、端の目の合計が 5 の倍数ならその点を得る（board.js の endSum）
 *   - 局の勝者は、他の 2 人の残り目の合計を 5 点単位に丸めて得る。
 *     行き詰まりは残り目が最少の人が勝者（最少が同点なら精算なし）
 *   - 誰かが目標点に届いたら、その局の精算で対戦終了
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var B = DM.board;
  var SEAT_NAMES = ['あなた', '下家CPU', '上家CPU'];
  var SEAT_LABELS = ['', '下家', '上家'];
  var HAND = 7;
  var TARGET = 250;

  function Game(opts) {
    opts = opts || {};
    this.onEvent = opts.onEvent || function () {};
    this.speed = opts.speed == null ? 650 : opts.speed;
    this.seed = opts.seed;
    this.target = opts.target || TARGET;
    // CPU の強さ 0=やさしい / 1=ふつう / 2=つよい
    this.difficulty = opts.difficulty == null ? 1 : opts.difficulty;
    // 顔ぶれ: me = あなたのキャラ（null なら名なしの「あなた」）、
    // opps = 下家・上家に座らせるキャラ（null の席はおまかせ）
    this.cast = { me: opts.me == null ? null : opts.me, opps: opts.opps || [] };
    this.players = [0, 1, 2].map(function (i) {
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
        voids: [],         // パスや山引きで「持っていない」と分かった目（公開情報）
        passed: false,
        drew: 0            // この手番で山から引いた枚数（表示用）
      };
    });
    this.board = null;
    this.bone = [];
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

  /** 山の残り枚数（公開情報） */
  Game.prototype.boneCount = function () { return this.bone.length; };

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

  /**
   * 顔ぶれを決める。あなたのキャラと、席ごとに指定された対戦相手をまず座らせ、
   * 空いた席には残りの 6 人から重複なくランダムに座らせる。
   */
  Game.prototype.assignCharacters = function () {
    var N = DM.ai.CHARACTERS.length;
    var valid = function (c) { return c != null && c >= 0 && c < N; };
    var used = {};
    var me = this.players[0];
    me.character = !me.isAI && valid(this.cast.me) ? this.cast.me : null;
    if (!me.isAI) me.name = me.character != null ? DM.ai.CHARACTERS[me.character].name : SEAT_NAMES[0];
    if (me.character != null) used[me.character] = true;

    var fixed = {};
    this.players.forEach(function (p) {
      if (!p.isAI || p.seat === 0) return;
      var c = this.cast.opps[p.seat - 1];
      if (valid(c) && !used[c]) { fixed[p.seat] = c; used[c] = true; }
    }, this);

    var pool = [];
    for (var i = 0; i < N; i++) if (!used[i]) pool.push(i);
    DM.shuffle(pool, this.rng);
    this.players.forEach(function (p) {
      if (!p.isAI) return;
      p.character = fixed[p.seat] != null ? fixed[p.seat] : pool.shift();
      p.name = DM.ai.CHARACTERS[p.character].name;
    });
    this.log('対戦相手: ' + this.players.filter(function (p) { return p.isAI && p.seat !== 0; })
      .map(function (p) { return p.seatLabel + ' ' + p.name; }).join(' / ') +
      (me.character != null ? '（あなたは ' + me.name + '）' : ''));
  };

  Game.prototype.startHand = function () {
    var self = this;
    var deck = DM.shuffle(DM.TILES.slice(), this.rng);
    this.handNo++;
    this.board = null;
    this.lastTile = null;
    this.passesInRow = 0;
    this.awaiting = null;
    this.result = null;
    this.current = null;
    this.turns = 0;
    this.players.forEach(function (p, i) {
      p.hand = DM.sortHand(deck.slice(i * HAND, i * HAND + HAND));
      p.count = HAND;
      p.voids = [false, false, false, false, false, false, false];
      p.passed = false;
      p.drew = 0;
    });
    this.bone = deck.slice(3 * HAND);

    // 最初の局は、一番大きいダブル（なければ一番重い牌）を持つ人がその牌から始める
    this.openingTile = null;
    if (this.handNo === 1) {
      var best = null;
      this.players.forEach(function (p) {
        p.hand.forEach(function (t) {
          var key = (DM.isDouble(t) ? 100 : 0) + DM.pips(t) * 2 + t.b / 10;
          if (!best || key > best.key) best = { key: key, tile: t, seat: p.seat };
        });
      });
      this.openingTile = best.tile;
      this.leader = best.seat;
    } else {
      this.leader = this.nextLeader;
    }

    this.log('=== 第' + this.handNo + '局 / 親: ' + this.players[this.leader].name +
      (this.openingTile ? '（' + DM.label(this.openingTile) + ' から）' : '') + ' ===');
    this.emit('handStart', {});
    this.emit('update', {});
    this.schedule(function () { self.beginTurn(self.leader); });
  };

  /* --- 場 -------------------------------------------------------------- */

  Game.prototype.ends = function () { return B.openEnds(this.board); };
  Game.prototype.endSum = function (board) { return B.endSum(board === undefined ? this.board : board); };

  /** 手牌 hand で出せる手の一覧 [{ index, dir }]（最初の 1 枚は dir: 'C'） */
  Game.prototype.legalMoves = function (hand) {
    var moves = [];
    if (!this.board) {
      hand.forEach(function (t, i) {
        if (this.openingTile && t.id !== this.openingTile.id) return;
        moves.push({ index: i, dir: 'C' });
      }, this);
      return moves;
    }
    var ends = B.playableEnds(this.board);
    hand.forEach(function (t, i) {
      ends.forEach(function (e) {
        if (DM.has(t, e.value)) moves.push({ index: i, dir: e.dir });
      });
    });
    return moves;
  };

  /** 牌を置いたあとの場（this.board は変えない）。CPU の読みとヒントでも使う */
  Game.prototype.placed = function (tile, dir, board) {
    board = board === undefined ? this.board : board;
    return board ? B.place(board, tile, dir) : B.create(tile);
  };

  /** その手で得られる点 */
  Game.prototype.scoreOf = function (tile, dir) {
    var s = B.endSum(this.placed(tile, dir));
    return s > 0 && s % 5 === 0 ? s : 0;
  };

  /* --- 手番 ------------------------------------------------------------ */

  Game.prototype.beginTurn = function (seat) {
    if (this.result || this.gameOver) return;
    var p = this.players[seat];
    if (this.current !== seat) p.drew = 0;
    this.current = seat;
    var moves = this.legalMoves(p.hand);

    if (!moves.length) {
      var type = this.bone.length ? 'draw' : 'pass';
      if (p.isAI) {
        this.awaiting = null;
        this.emit('update', {});
        this.schedule(function () { if (type === 'draw') this.draw(p); else this.pass(p); });
      } else {
        this.awaiting = { type: type, seat: seat };
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

  /** 今の端の目を、その人は持っていないと分かる（パス・山引きのとき） */
  Game.prototype.markVoids = function (p, reset) {
    if (reset) p.voids = [false, false, false, false, false, false, false];
    this.ends().forEach(function (e) { p.voids[e.value] = true; });
  };

  Game.prototype.draw = function (p) {
    // 引く前に出せなかった＝今の端の目がない。前に分かっていた「ない目」は、
    // 引いた牌で変わりうるので消す
    this.markVoids(p, true);
    var tile = this.bone.pop();
    p.hand.push(tile);
    DM.sortHand(p.hand);
    p.count = p.hand.length;
    p.drew++;
    this.awaiting = null;
    this.emit('draw', { seat: p.seat });
    this.emit('update', {});
    this.schedule(function () { this.beginTurn(p.seat); });
  };

  Game.prototype.play = function (p, move) {
    var tile = p.hand.splice(move.index, 1)[0];
    var first = !this.board;
    var pts = this.scoreOf(tile, move.dir);
    this.board = this.placed(tile, move.dir);
    this.lastTile = tile;
    p.count = p.hand.length;
    p.passed = false;
    this.passesInRow = 0;
    this.openingTile = null;
    this.awaiting = null;
    this.turns++;

    var drew = p.drew ? '（' + p.drew + '枚引いて）' : '';
    var where = first ? '' : ' → ' + B.DIR_JA[move.dir];
    this.log(p.name + drew + ' ' + DM.label(tile) + where + (pts ? '　' + pts + '点！' : ''));
    if (pts) p.score += pts;
    this.emit('play', { seat: p.seat, tile: tile, dir: move.dir, points: pts });
    this.emit('update', {});

    if (p.count === 0) { this.endHand('domino', p.seat); return; }
    this.schedule(function () { this.beginTurn((p.seat + 1) % 3); });
  };

  Game.prototype.pass = function (p) {
    this.markVoids(p, false);
    p.passed = true;
    this.passesInRow++;
    this.awaiting = null;
    var vals = [];
    this.ends().forEach(function (e) { if (vals.indexOf(e.value) < 0) vals.push(e.value); });
    this.log(p.name + (p.drew ? '（' + p.drew + '枚引いて）' : '') + ' パス（' + vals.join('・') + ' がない）');
    this.emit('pass', { seat: p.seat });
    this.emit('update', {});
    if (this.passesInRow >= 3) { this.endHand('blocked', null); return; }
    this.schedule(function () { this.beginTurn((p.seat + 1) % 3); });
  };

  /* --- プレイヤー操作 -------------------------------------------------- */

  Game.prototype.playerPlay = function (index, dir) {
    var a = this.awaiting;
    if (!a || a.type !== 'turn' || a.seat !== 0) return false;
    var ok = a.moves.some(function (m) { return m.index === index && m.dir === dir; });
    if (!ok) return false;
    this.play(this.players[0], { index: index, dir: dir });
    return true;
  };

  Game.prototype.playerDraw = function () {
    var a = this.awaiting;
    if (!a || a.type !== 'draw' || a.seat !== 0) return false;
    this.draw(this.players[0]);
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
      gain = round5(gain);
      this.players[winner].score += gain;
    }

    var detail = [];
    if (type === 'domino') {
      detail.push(this.players[winner].name + ' が出し切り（ドミノ）');
    } else {
      detail.push('山が空で 3 人続けてパス（ブロック）。残り目の少ない人が勝者');
      if (winner == null) detail.push('残り目が最少の人が同点のため、精算なし');
    }
    if (winner != null) {
      detail.push(this.players[winner].name + ' +' + gain + '点（他の 2 人の残り目を 5 点単位に丸め）');
    }

    this.nextLeader = winner != null ? winner : (this.leader + 1) % 3;
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
      : '--- ブロック' + (winner != null ? '　' + this.players[winner].name + ' +' + gain + '点' : '（精算なし）') + ' ---');
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

  Game.TARGET = TARGET;
  DM.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
