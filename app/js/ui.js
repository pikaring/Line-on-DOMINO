/*
 * ui.js - 画面描画とプレイヤー操作
 *
 * レイアウトは iPhone Air（CSS 420x912）を基準にした固定配置。
 * 段ごとの高さは CSS 側で決めてあり、場の並びだけは箱の大きさに収まるように
 * ここで牌の寸法を計算して配置する（左上から右へ、次の段は右から左へ折り返す）。
 */
(function (global) {
  'use strict';

  var DM = global.DM;
  var STORE_KEY = 'line-on-domino';

  // 3×3 の格子のどこに目を打つか
  var PIPS = [[], [4], [2, 6], [2, 4, 6], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

  var game = null;
  var settings = { difficulty: 1, speed: 650, hint: false, me: null, opps: [] };
  var OPP_SEATS = ['下家', '上家'];
  var pickMe = null, pickOpps = [];   // 顔ぶれ選びの途中の状態
  var selected = -1;       // 複数の端に出せる牌を選んで、どの端にするか選んでいる途中
  var lastId = null;       // 直前に場に出た牌
  var advice = null;       // ヒントの結果（手番ごとに 1 回だけ計算する）
  var adviceFor = null;
  var logLines = [];

  /* 裏技: 相手の手牌を公開する表示モード。
     見えるようになるのは画面だけで、CPU の思考には一切影響しない。 */
  var openMode = false;
  var titleTaps = [];

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      Object.keys(settings).forEach(function (k) { if (s[k] != null) settings[k] = s[k]; });
    } catch (e) { /* 保存できない環境でも既定値で動く */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* 無視 */ }
  }

  /* --- 牌 -------------------------------------------------------------- */
  function halfHTML(n) {
    var cells = '';
    for (var i = 0; i < 9; i++) cells += PIPS[n].indexOf(i) >= 0 ? '<span class="pip"></span>' : '<span></span>';
    return '<span class="half n' + n + '">' + cells + '</span>';
  }

  /** x が左（縦なら上）、y が右（縦なら下）の目 */
  function domHTML(x, y, orient, extra, attrs) {
    return '<span class="dom ' + orient + (extra ? ' ' + extra : '') + '"' + (attrs || '') + '>' +
      halfHTML(x) + '<span class="bar"></span>' + halfHTML(y) + '</span>';
  }

  /* --- 顔とひとこと -------------------------------------------------- */
  function charOfSeat(p) { return p && p.character != null ? DM.ai.CHARACTERS[p.character] : null; }

  function faceHTML(ch, kind, cls) {
    var f = ch && DM.FACES && DM.FACES[ch.id];
    return f ? '<img class="face ' + (cls || '') + '" src="' + f[kind || 'normal'] + '" alt="">' : '';
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /**
   * 吹き出し付きの顔。who が勝った CPU ならその勝ちゼリフ、
   * あなたが勝ったときは、負けた CPU のうち 1 人の負けゼリフを出す。
   */
  function speechHTML(winnerSeat, key) {
    var p = winnerSeat != null ? game.players[winnerSeat] : null;
    var ch = charOfSeat(p), kind = 'win', line;
    if (ch) {
      line = pick(ch.talk[key]);
    } else {
      var losers = game.players.filter(function (q) { return q.seat !== winnerSeat && charOfSeat(q); });
      if (!losers.length) return '';
      p = pick(losers); ch = charOfSeat(p); kind = 'lose';
      line = pick(ch.talk.lose);
    }
    return '<div class="speech' + (kind === 'lose' ? ' lose' : '') + '">' + faceHTML(ch, kind, 'big') +
      '<div class="bubble"><b>' + esc(ch.name) + '</b>' + esc(line) + '</div></div>';
  }

  function backHTML(extra) {
    return '<span class="dom v back ' + (extra || '') + '"></span>';
  }

  /* --- 場 -------------------------------------------------------------- */

  /**
   * 場（中心の牌と 4 方向の腕）を箱に収めて描く。
   * 腕が箱からはみ出すときは、中心側の牌を「+3」のように畳み、端に近い牌を残す。
   * 開いていてまだ空の端には、点線の枠を出す。
   */
  /**
   * 場の配置を計算する。腕ごとに「区間」を用意し、牌を中心から順に置いていく。
   *   左右の腕: 箱の端まで行ったら、1 段ずらして（右は下、左は上へ）折り返す
   *   上下の腕: 箱の端まで行ったら、上は右へ、下は左へ曲がる
   * それでも入りきらない腕は、中心側の牌を「+n」に畳む。
   * 返り値: { u, items: [{ kind: 'dom'|'more'|'slot', ... }], folded }
   */
  function planBoard(b, u, W, H) {
    var PAD = 6, GAP = 2, CHIP = 22;
    var cx = PAD + W / 2, cy = PAD + H / 2;
    var cw = b.spin ? u : u * 2, ch = b.spin ? u * 2 : u;
    var c = { left: cx - cw / 2, top: cy - ch / 2, right: cx + cw / 2, bottom: cy + ch / 2 };
    var items = [], folded = false;
    var ends = DM.board.openEnds(b);
    var playable = DM.board.playableEnds(b).map(function (e) { return e.dir; });
    var step = u * 2 + 8;              // 折り返した段のずれ
    var inner = u + 8;                 // 折り返した段が中心の列に近づきすぎないように

    items.push({ kind: 'dom', tile: b.center, x: c.left, y: c.top,
      top: b.spin ? b.center.a : b.center.b, bottom: b.center.a, orient: b.spin ? 'v' : 'h', center: true });

    function segmentsFor(d) {
      if (d === 'E') return [
        { axis: 'x', from: c.right + GAP, dir: 1, to: PAD + W, at: cy },
        { axis: 'x', from: PAD + W, dir: -1, to: cx + inner, at: cy + step }];
      if (d === 'W') return [
        { axis: 'x', from: c.left - GAP, dir: -1, to: PAD, at: cy },
        { axis: 'x', from: PAD, dir: 1, to: cx - inner, at: cy - step }];
      // 上の腕は箱の上端で右へ、下の腕は下端で左へ曲がる（左右の折り返しとぶつからない側）
      if (d === 'N') return [
        { axis: 'y', from: c.top - GAP, dir: -1, to: PAD, at: cx },
        { axis: 'x', from: cx + inner, dir: 1, to: PAD + W, at: PAD + u }];
      return [
        { axis: 'y', from: c.bottom + GAP, dir: 1, to: PAD + H, at: cx },
        { axis: 'x', from: cx - inner, dir: -1, to: PAD, at: PAD + H - u }];
    }

    /** pieces を区間に順に置く。入りきらなければ null */
    function layout(d, pieces, chip) {
      var segs = segmentsFor(d), k = 0, pos = segs[0].from, out = [];
      if (chip) {
        var s0 = segs[0];
        var cp = s0.dir < 0 ? pos - CHIP : pos;
        out.push({ kind: 'more', axis: s0.axis, p: cp, at: s0.at });
        pos += s0.dir * (CHIP + GAP);
      }
      for (var i = 0; i < pieces.length; i++) {
        var pc = pieces[i], L = DM.isDouble(pc.tile) ? u : u * 2;
        while (k < segs.length) {
          var sg = segs[k];
          var end = pos + sg.dir * L;
          if (sg.dir > 0 ? end <= sg.to : end >= sg.to) break;
          k++;
          if (k < segs.length) pos = segs[k].from;
        }
        if (k >= segs.length) return null;
        var sgm = segs[k];
        out.push({ kind: 'piece', pc: pc, axis: sgm.axis, p: sgm.dir < 0 ? pos - L : pos, at: sgm.at, dir: sgm.dir, len: L });
        pos += sgm.dir * (L + GAP);
      }
      return out;
    }

    DM.board.DIRS.forEach(function (d) {
      var arm = b.arms[d];
      var open = ends.some(function (e) { return e.dir === d; });
      if (!arm.length) {
        if (open && playable.indexOf(d) >= 0) {
          var sg = segmentsFor(d)[0];
          var sw = sg.axis === 'x' ? u * 2 : u, sh = sg.axis === 'x' ? u : u * 2;
          var sx = sg.axis === 'x' ? (sg.dir < 0 ? sg.from - sw : sg.from) : cx - sw / 2;
          var sy = sg.axis === 'x' ? cy - sh / 2 : (sg.dir < 0 ? sg.from - sh : sg.from);
          items.push({ kind: 'slot', x: sx, y: sy, w: sw, h: sh, label: DM.board.DIR_JA[d] });
        }
        return;
      }
      var from = 0, placed = layout(d, arm, false);
      while (!placed && from < arm.length - 1) { from++; placed = layout(d, arm.slice(from), true); }
      if (from > 0) folded = true;
      if (!placed) { folded = true; placed = layout(d, arm.slice(arm.length - 1), true) || []; from = arm.length - 1; }
      placed.forEach(function (it, j) {
        if (it.kind === 'more') {
          items.push({ kind: 'more', n: from, x: it.axis === 'x' ? it.p : it.at - CHIP / 2, y: it.axis === 'x' ? it.at - 9 : it.p });
          return;
        }
        var pc = it.pc, dbl = DM.isDouble(pc.tile), last = pc === arm[arm.length - 1];
        var fwd = it.dir > 0;   // 牌の外側の目を、進む向きの側に置く
        if (it.axis === 'x') {
          items.push(dbl
            ? { kind: 'dom', tile: pc.tile, x: it.p, y: it.at - u, top: pc.outer, bottom: pc.outer, orient: 'v' }
            : { kind: 'dom', tile: pc.tile, x: it.p, y: it.at - u / 2, top: fwd ? pc.inner : pc.outer, bottom: fwd ? pc.outer : pc.inner, orient: 'h' });
        } else {
          items.push(dbl
            ? { kind: 'dom', tile: pc.tile, x: it.at - u, y: it.p, top: pc.outer, bottom: pc.outer, orient: 'h' }
            : { kind: 'dom', tile: pc.tile, x: it.at - u / 2, y: it.p, top: fwd ? pc.inner : pc.outer, bottom: fwd ? pc.outer : pc.inner, orient: 'v' });
        }
        if (last && open) { items[items.length - 1].end = true; items[items.length - 1].label = DM.board.DIR_JA[d]; }
      });
    });
    return { u: u, items: items, folded: folded };
  }

  function boardHTML(box, b) {
    var PAD = 6;
    var W = box.clientWidth - PAD * 2, H = box.clientHeight - PAD * 2;
    // 畳まずに収まる一番大きい牌にする。どうしても収まらなければ小さめにして畳む
    var plan;
    for (var u = 24; u >= 14; u--) {
      plan = planBoard(b, u, W, H);
      if (!plan.folded) break;
    }
    var U = plan.u;
    return plan.items.map(function (it) {
      if (it.kind === 'slot') {
        return '<span class="slot" data-label="' + it.label + '" style="left:' + Math.round(it.x) + 'px;top:' +
          Math.round(it.y) + 'px;width:' + it.w + 'px;height:' + it.h + 'px"></span>';
      }
      if (it.kind === 'more') {
        return '<span class="more" style="left:' + Math.round(it.x) + 'px;top:' + Math.round(it.y) + 'px">+' + it.n + '</span>';
      }
      var cls = [];
      if (it.tile.id === lastId) cls.push('last');
      if (it.center && b.spin) cls.push('spinner');
      if (it.end) cls.push('end');
      return domHTML(it.top, it.bottom, it.orient, cls.join(' '),
        (it.label ? ' data-label="' + it.label + '"' : '') +
        ' style="--u:' + U + 'px;left:' + Math.round(it.x) + 'px;top:' + Math.round(it.y) + 'px"');
    }).join('');
  }

  function renderBoard() {
    var box = $('#line');
    if (!game.board) {
      var leader = game.players[game.leader];
      box.innerHTML = '<div class="empty">' + (game.openingTile
        ? esc(leader.name) + ' の ' + DM.label(game.openingTile) + ' から始まります'
        : esc(leader.name) + ' から、好きな牌で始まります') + '</div>';
      return;
    }
    box.innerHTML = boardHTML(box, game.board);
  }

  /* --- 局情報 ---------------------------------------------------------- */
  function infobarHTML() {
    var out = '<span class="round">第' + game.handNo + '局</span>' +
      '<span class="stat"><b>' + game.target + '</b>点先取</span>' +
      '<span class="stat">山 <b>' + game.boneCount() + '</b></span>';
    if (game.board) {
      var s = game.endSum();
      out += '<span class="ends">端' + game.ends().map(function (e) {
        return '<span class="end-num">' + e.value + '</span>';
      }).join('') + '<span class="sum' + (s > 0 && s % 5 === 0 ? ' hit' : '') + '">計' + s + '</span></span>';
    }
    return out;
  }

  /* --- 他の 2 人 ------------------------------------------------------- */
  function voidChip(p) {
    if (!settings.hint) return '';
    var v = DM.coach.voidText(p);
    return v.length ? '<span class="void">なし ' + v.join('・') + '</span>' : '';
  }

  function headHTML(p) {
    var ch = charOfSeat(p);
    return '<div class="seat-head">' + faceHTML(ch, 'normal') +
      (p.seatLabel ? '<span class="seat-label">' + p.seatLabel + '</span>' : '') +
      '<span class="nm">' + esc(p.name) + '</span>' +
      (ch ? '<span class="tag">' + (p.seat === 0 ? 'あなた' : ch.tag) + '</span>' : '') +
      '<span class="pt">' + p.score + '</span>' +
      (p.seat === game.leader ? '<span class="lead">親</span>' : '') +
      (p.passed ? '<span class="pass-mark">パス</span>' : '') +
      (p.drew && game.current === p.seat ? '<span class="drew">山+' + p.drew + '</span>' : '') +
      voidChip(p) +
      '</div>';
  }

  function seatHTML(p) {
    var backs = '';
    if (openMode) {
      backs = p.hand.map(function (t) { return domHTML(t.b, t.a, 'v', 'opp'); }).join('');
    } else {
      for (var i = 0; i < p.count; i++) backs += backHTML('opp');
    }
    var active = game.current === p.seat && !game.result;
    return '<div class="seat' + (active ? ' active' : '') + '">' +
      headHTML(p) + '<div class="backs">' + backs + '</div></div>';
  }

  /* --- 自分 ------------------------------------------------------------ */
  function myMoves() {
    var a = game.awaiting;
    return a && a.type === 'turn' && a.seat === 0 ? a.moves : null;
  }

  /** 手牌は山から引いて増えるので、枚数に合わせて牌の大きさと間隔を決める */
  function handSizing(n) {
    var W = Math.min(global.innerWidth || 420, 430) - 16 - 14;
    var gap = n > 9 ? 3 : n > 7 ? 5 : 8;
    var u = Math.min(34, Math.floor((W - (n - 1) * gap) / Math.max(1, n)));
    return '--hand-u:' + u + 'px;gap:' + gap + 'px';
  }

  function selfHTML() {
    var p = game.players[0];
    var moves = myMoves();
    var rec = settings.hint && advice ? advice.best.move.index : -1;
    var tiles = p.hand.map(function (t, i) {
      var cls = [];
      if (moves) {
        var ok = moves.some(function (m) { return m.index === i; });
        cls.push(ok ? 'playable' : 'dim');
        if (i === selected) cls.push('selected');
        if (i === rec) cls.push('rec');
      }
      return domHTML(t.b, t.a, 'v', cls.join(' '), ' data-index="' + i + '"');
    }).join('');
    var myTurn = game.current === 0 && game.awaiting && game.awaiting.seat === 0;
    return '<div class="self' + (myTurn ? ' active' : '') + '">' +
      headHTML(p) +
      '<div class="self-hand" id="myhand" style="' + handSizing(p.hand.length) + '">' + tiles + '</div>' +
      '</div>';
  }

  /* --- ヒント ---------------------------------------------------------- */
  function endsText() {
    var vals = [];
    game.ends().forEach(function (e) { if (vals.indexOf(e.value) < 0) vals.push(e.value); });
    return vals.join('・');
  }

  function coachHTML() {
    var counts = DM.coach.unseenByNumber(game);
    var countLine = '<div class="count">見えていない牌の数 ' + counts.map(function (c, n) {
      return n + ':' + c;
    }).join('　') + '</div>';
    if (!advice) {
      var a = game.awaiting, mine = a && a.seat === 0;
      var msg = mine && a.type === 'draw'
        ? '<div><b>出せる牌がありません。</b>山から引くと、他の人にも「' + endsText() + ' を持っていない」ことが伝わります。</div>'
        : mine && a.type === 'pass'
          ? '<div><b>出せる牌がなく、山もありません。</b>パスすると「' + endsText() + ' を持っていない」ことが伝わります。</div>'
          : '<div>自分の番になると、おすすめの手と理由をここに出します。</div>';
      return msg + countLine;
    }
    var b = advice.best;
    var where = b.move.dir === 'C' ? 'から始める' : 'を' + DM.board.DIR_JA[b.move.dir] + 'へ';
    return '<div><b>おすすめ</b> ' + DM.label(b.tile) + ' ' + where + '</div>' +
      advice.reasons.map(function (r) { return '<div class="reason">' + esc(r) + '</div>'; }).join('') +
      countLine;
  }

  function updateAdvice() {
    var a = game.awaiting;
    if (!settings.hint || !a || a.seat !== 0 || a.type !== 'turn') { advice = null; adviceFor = null; return; }
    if (adviceFor === a) return;
    adviceFor = a;
    advice = DM.coach.advise(game);
  }

  /* --- コマンド -------------------------------------------------------- */
  var DIR_ARROW = { W: '◀', E: '▶', N: '▲', S: '▼' };

  function actionsHTML() {
    var a = game.awaiting;
    if (game.result || game.gameOver) return '<span class="hint">&nbsp;</span>';
    if (!a) {
      var p = game.players[game.current];
      return '<span class="hint">' + (p ? esc(p.name) + (p.drew ? ' 山から引いています…' : ' 思考中…') : '') + '</span>';
    }
    if (a.type === 'draw') {
      return '<span class="hint">出せる牌がありません</span>' +
        '<button class="btn primary" data-act="draw">山から引く（残り ' + game.boneCount() + '）</button>';
    }
    if (a.type === 'pass') {
      return '<span class="hint">出せる牌がなく、山もありません</span>' +
        '<button class="btn primary" data-act="pass">パス</button>';
    }
    if (selected >= 0) {
      var t = game.players[0].hand[selected];
      var recDir = settings.hint && advice && advice.best.move.index === selected ? advice.best.move.dir : null;
      var ends = DM.board.openEnds(game.board);
      var btns = a.moves.filter(function (m) { return m.index === selected; }).map(function (m) {
        var v = ends.filter(function (e) { return e.dir === m.dir; })[0].value;
        var pts = game.scoreOf(t, m.dir);
        return '<button class="btn' + (recDir === m.dir ? ' rec' : '') + '" data-act="end" data-dir="' + m.dir + '">' +
          DIR_ARROW[m.dir] + ' ' + DM.board.DIR_JA[m.dir] + ' ' + v + (pts ? '（' + pts + '点）' : '') + '</button>';
      }).join('');
      return '<span class="hint">' + DM.label(t) + ' を</span>' + btns +
        '<button class="btn" data-act="unselect">やめる</button>';
    }
    return '<span class="hint">' + (game.board ? '牌を押して場につなぐ' : '牌を押して最初の 1 枚を出す') + '</span>';
  }

  /* --- 描画 ------------------------------------------------------------ */
  function render() {
    if (!game) return;
    updateAdvice();
    $('#infobar').innerHTML = infobarHTML();
    // 手番は 自分 → 下家 → 上家 → 自分 と回るので、上から 下家 / 上家 の順に並べる
    $('#board').innerHTML = [1, 2].map(function (i) { return seatHTML(game.players[i]); }).join('');
    renderBoard();
    var coach = $('#coach');
    coach.hidden = !settings.hint;
    if (settings.hint) coach.innerHTML = coachHTML();
    $('#self').innerHTML = selfHTML();
    $('#actions').innerHTML = actionsHTML();
  }

  function renderLog() {
    var el = $('#log');
    // 新しい行を上に出す（最下段に置いているので、古い行ほど画面の下に隠れていく）
    el.innerHTML = logLines.slice(-60).reverse().map(function (l) {
      return '<div class="' + (l.hl ? 'hl' : '') + '">' + esc(l.text) + '</div>';
    }).join('');
    el.scrollTop = 0;
  }

  /* --- 結果 ------------------------------------------------------------ */
  function restListHTML(info) {
    return '<div class="rest-list">' + game.players.map(function (p, i) {
      var win = info.winner === i;
      var tiles = info.hands[i].map(function (t) { return domHTML(t.b, t.a, 'h', 'mini'); }).join('');
      return '<div class="who' + (win ? ' win' : '') + '">' + faceHTML(charOfSeat(p), win ? 'win' : 'lose') + esc(p.name) + '</div>' +
        '<div class="tiles">' + (tiles || '<span style="opacity:.6">なし</span>') + '</div>' +
        '<div class="pp">' + info.pips[i] + '目</div>';
    }).join('') + '</div>';
  }

  function scoresHTML() {
    return '<div class="standings">' + game.players.map(function (p) {
      return '<div class="' + (p.seat === 0 ? 'me' : '') + '">' + esc(p.name) + '　' + p.score + '点</div>';
    }).join('') + '</div>';
  }

  function showResult(info) {
    var title = info.type === 'domino'
      ? esc(game.players[info.winner].name) + ' ドミノ！'
      : 'ブロック';
    $('#sheet').innerHTML =
      '<h2>' + title + '</h2>' +
      '<div class="sub">第' + game.handNo + '局の結果（' + game.target + '点先取）</div>' +
      (info.winner != null ? speechHTML(info.winner, info.type === 'domino' ? 'domino' : 'blocked') : '') +
      restListHTML(info) +
      (info.winner != null ? '<div class="score">' + esc(game.players[info.winner].name) + ' +' + info.gain + '点</div>' : '') +
      '<div class="detail">' + info.detail.map(esc).join('<br>') + '</div>' +
      '<div class="divider"></div>' + scoresHTML() +
      '<div style="margin-top:12px;text-align:right">' +
      '<button class="btn primary" data-act="next">' + (info.final ? '最終結果へ' : '次の局へ') + '</button></div>';
    $('#overlay').hidden = false;
  }

  function showGameOver(data) {
    var rank = 0, prev = null;
    $('#sheet').innerHTML =
      '<h2>' + (data.standings[0].seat === 0 ? 'あなたの勝ち！' : '対戦終了') + '</h2>' +
      '<div class="sub">' + game.target + '点に到達（全' + data.hands + '局）</div>' +
      speechHTML(data.standings[0].seat, 'game') +
      '<div class="standings">' + data.standings.map(function (s, i) {
        if (s.score !== prev) { rank = i + 1; prev = s.score; }
        return '<div class="' + (s.seat === 0 ? 'me' : '') + '">' +
          rank + '位　' + esc(s.name) + '　' + s.score + '点</div>';
      }).join('') + '</div>' +
      '<div style="margin-top:12px;text-align:right">' +
      '<button class="btn primary" data-act="restart">もう一度</button></div>';
    $('#overlay').hidden = false;
  }

  /* --- イベント -------------------------------------------------------- */
  function onEvent(type, data) {
    if (type === 'log') {
      logLines.push({ text: data.message, hl: /===|ドミノ|ブロック|点！/.test(data.message) });
      renderLog();
      return;
    }
    if (type === 'play') { lastId = data.tile.id; return; }
    if (type === 'handStart') { selected = -1; lastId = null; return; }
    if (type === 'update' || type === 'await') { render(); return; }
    if (type === 'result') { render(); showResult(data); return; }
    if (type === 'gameOver') { showGameOver(data); return; }
  }

  function handleHandClick(e) {
    var el = e.target.closest('[data-index]');
    if (!el) return;
    var moves = myMoves();
    if (!moves) return;
    var index = parseInt(el.getAttribute('data-index'), 10);
    var mine = moves.filter(function (m) { return m.index === index; });
    if (!mine.length) return;
    if (mine.length === 1) {
      selected = -1;
      game.playerPlay(index, mine[0].dir);
      return;
    }
    selected = selected === index ? -1 : index;
    render();
  }

  /** タイトルを 3 秒以内に 5 回叩くと、相手の手牌の公開を切り替える */
  function handleTitleTap() {
    var now = Date.now();
    titleTaps = titleTaps.filter(function (t) { return now - t < 3000; });
    titleTaps.push(now);
    if (titleTaps.length < 5) return;
    titleTaps = [];
    setOpenMode(!openMode);
  }

  function setOpenMode(on) {
    openMode = on;
    var title = $('.title');
    if (title) title.classList.toggle('open-mode', openMode);
    logLines.push({
      text: openMode ? '裏技: 相手の手牌を公開しました（CPU の打ち方は変わりません）'
        : '裏技: 相手の手牌を伏せました',
      hl: true
    });
    renderLog();
    render();
  }

  var SPEEDS = [1100, 650, 300, 60];
  var SPEED_LABELS = ['遅', '普', '速', '瞬'];

  function labelButtons() {
    $('[data-act="difficulty"]').textContent = '敵:' + DM.ai.LEVELS[settings.difficulty].name;
    $('[data-act="speed"]').textContent = '速度:' + SPEED_LABELS[Math.max(0, SPEEDS.indexOf(settings.speed))];
    $('[data-act="hint"]').classList.toggle('on', settings.hint);
  }

  function handleAction(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.getAttribute('data-act')) {
      case 'title': handleTitleTap(); break;
      case 'pass': game.playerPass(); break;
      case 'draw': game.playerDraw(); break;
      case 'end':
        var i = selected;
        selected = -1;
        game.playerPlay(i, btn.getAttribute('data-dir'));
        break;
      case 'unselect': selected = -1; render(); break;
      case 'next': $('#overlay').hidden = true; game.nextHand(); break;
      case 'restart': $('#overlay').hidden = true; startGame(); break;
      case 'new-game': openPicker(); break;
      case 'pick-me':
        var mi = parseInt(btn.getAttribute('data-i'), 10);
        pickMe = mi < 0 ? null : mi;
        pickOpps = pickOpps.filter(function (c) { return c !== pickMe; });
        renderPicker();
        break;
      case 'pick-opp':
        var oi = parseInt(btn.getAttribute('data-i'), 10);
        var at = pickOpps.indexOf(oi);
        if (at >= 0) pickOpps.splice(at, 1);
        else if (pickOpps.length < OPP_SEATS.length) pickOpps.push(oi);
        renderPicker();
        break;
      case 'pick-random': pickOpps = []; renderPicker(); break;
      case 'pick-cancel': $('#overlay').hidden = true; break;
      case 'pick-start':
        settings.me = pickMe;
        settings.opps = pickOpps.slice();
        saveSettings();
        startGame();
        break;
      case 'hint':
        settings.hint = !settings.hint;
        saveSettings(); labelButtons(); render();
        break;
      case 'difficulty':
        settings.difficulty = (settings.difficulty + 1) % DM.ai.LEVELS.length;
        game.difficulty = settings.difficulty;
        // やさしいにしたらヒントも出す（あとから「ヒント」で消すこともできる）
        if (settings.difficulty === 0 && !settings.hint) {
          settings.hint = true;
          logLines.push({ text: 'やさしいでは、ヒント（おすすめの手と理由）を表示します', hl: true });
          renderLog();
          render();
        }
        saveSettings(); labelButtons();
        break;
      case 'speed':
        var k = (SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length;
        settings.speed = SPEEDS[k];
        game.speed = settings.speed;
        saveSettings(); labelButtons();
        break;
    }
  }

  /* --- 顔ぶれを選ぶ -------------------------------------------------- */
  function pickerHTML() {
    var C = DM.ai.CHARACTERS;
    var meCells = '<button class="pick' + (pickMe == null ? ' on' : '') + '" data-act="pick-me" data-i="-1">' +
      '<span class="noface">？</span><span class="pn">名なし</span></button>' +
      C.map(function (c, i) {
        return '<button class="pick' + (pickMe === i ? ' on' : '') + '" data-act="pick-me" data-i="' + i + '">' +
          faceHTML(c, 'normal', 'mid') + '<span class="pn">' + esc(c.name) + '</span></button>';
      }).join('');
    var oppCells = C.map(function (c, i) {
      var k = pickOpps.indexOf(i);
      var mine = pickMe === i;
      return '<button class="pick' + (k >= 0 ? ' on' : '') + (mine ? ' off' : '') + '" data-act="pick-opp" data-i="' + i + '"' +
        (mine ? ' disabled' : '') + '>' + faceHTML(c, 'normal', 'mid') +
        (k >= 0 ? '<span class="order">' + OPP_SEATS[k] + '</span>' : '') +
        '<span class="pn">' + esc(c.name) + '</span><span class="pt2">' + c.tag + '</span></button>';
    }).join('');
    var rest = OPP_SEATS.length - pickOpps.length;
    return '<h2>顔ぶれを選ぶ</h2>' +
      '<div class="sub">あなたのキャラ（勝ったときに顔とひとことが出ます）</div>' +
      '<div class="pick-grid">' + meCells + '</div>' +
      '<div class="sub">対戦相手（選んだ順に 下家・上家。' +
      (rest > 0 ? 'あと ' + rest + ' 人は' : '') + 'おまかせ）</div>' +
      '<div class="pick-grid">' + oppCells + '</div>' +
      '<div class="pick-actions">' +
      '<button class="btn" data-act="pick-random">相手をおまかせに戻す</button>' +
      (game ? '<button class="btn" data-act="pick-cancel">やめる</button>' : '') +
      '<button class="btn primary" data-act="pick-start">この顔ぶれで始める</button></div>';
  }

  function openPicker() {
    pickMe = settings.me;
    pickOpps = (settings.opps || []).filter(function (c) { return c != null && c !== pickMe; }).slice(0, 3);
    $('#sheet').innerHTML = pickerHTML();
    $('#overlay').hidden = false;
  }

  function renderPicker() { $('#sheet').innerHTML = pickerHTML(); }

  function startGame() {
    if (game) game.stop();
    selected = -1; lastId = null; advice = null; adviceFor = null;
    $('#overlay').hidden = true;
    game = new DM.Game({
      onEvent: onEvent,
      speed: settings.speed,
      difficulty: settings.difficulty,
      me: settings.me,
      opps: settings.opps
    });
    logLines.push({ text: '--- 新しい対戦（オールファイブ・' + game.target + '点先取）---', hl: true });
    renderLog();
    game.startGame();
  }

  function renderCharList() {
    var el = $('#char-list');
    if (!el) return;
    el.innerHTML = DM.ai.CHARACTERS.map(function (c) {
      return '<div class="char">' + faceHTML(c, 'normal', 'mid') + '<div><div class="char-top"><b>' + esc(c.name) +
        '</b><span class="tag">' + c.tag + '</span></div><div class="char-desc">' + esc(c.desc) + '</div></div></div>';
    }).join('');
  }

  function init() {
    loadSettings();
    if (SPEEDS.indexOf(settings.speed) < 0) settings.speed = 650;
    settings.difficulty = Math.max(0, Math.min(DM.ai.LEVELS.length - 1, settings.difficulty | 0));
    if (!Array.isArray(settings.opps)) settings.opps = [];
    labelButtons();
    renderCharList();
    document.addEventListener('click', handleAction);
    $('#self').addEventListener('click', handleHandClick);
    global.addEventListener('resize', function () { if (game) render(); });
    if (/#open\b/.test(location.hash)) setOpenMode(true);
    startGame();
  }

  DM.ui = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
