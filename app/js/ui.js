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
  var settings = { difficulty: 1, speed: 650, mode: 'block', hint: false, me: null, opps: [] };
  var OPP_SEATS = ['下家', '対面', '上家'];
  var pickMe = null, pickOpps = [];   // 顔ぶれ選びの途中の状態
  var selected = -1;       // 両端に出せる牌を選んで、左右を選んでいる途中
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
   * 場の並びを箱に収める。牌の寸法 u を大きい方から試し、
   * 折り返した段数が箱の高さに収まる最大の u を使う。
   * 偶数段は左から右、奇数段は右から左に並べる（蛇行）。
   */
  function layoutLine(box, line) {
    var PAD = 6, GAP = 3;
    var W = box.clientWidth - PAD * 2, H = box.clientHeight - PAD * 2;
    var u, rows;
    for (u = 30; u >= 7; u--) {
      var cap = Math.floor((H + GAP) / (u * 2 + GAP));
      rows = [[]];
      var cur = 0;
      for (var i = 0; i < line.length; i++) {
        var w = DM.isDouble(line[i].tile) ? u : u * 2;
        if (cur > 0 && cur + w > W) { rows.push([]); cur = 0; }
        rows[rows.length - 1].push(i);
        cur += w + GAP;
      }
      if (rows.length <= cap) break;
    }

    var rowH = u * 2;
    var blockH = rows.length * rowH + (rows.length - 1) * GAP;
    var offY = PAD + Math.max(0, (H - blockH) / 2);
    var out = [];
    rows.forEach(function (row, r) {
      var rev = r % 2 === 1;
      var widthOf = function (i) { return DM.isDouble(line[i].tile) ? u : u * 2; };
      var total = row.reduce(function (s, i) { return s + widthOf(i) + GAP; }, -GAP);
      // 1 段だけのときは中央に置く
      var x = rows.length === 1 ? PAD + (W - total) / 2 : (rev ? PAD + W : PAD);
      row.forEach(function (i) {
        var p = line[i], w = widthOf(i), dbl = DM.isDouble(p.tile);
        var left = rev ? x - w : x;
        x = rev ? x - w - GAP : x + w + GAP;
        var top = offY + r * (rowH + GAP) + (dbl ? 0 : u / 2);
        var cls = [];
        if (line.length > 1 && i === 0) cls.push('end-l');
        if (line.length > 1 && i === line.length - 1) cls.push('end-r');
        if (p.tile.id === lastId) cls.push('last');
        var style = ' style="--u:' + u + 'px;left:' + left + 'px;top:' + top + 'px"';
        out.push(dbl ? domHTML(p.l, p.r, 'v', cls.join(' '), style)
          : rev ? domHTML(p.r, p.l, 'h', cls.join(' '), style)
          : domHTML(p.l, p.r, 'h', cls.join(' '), style));
      });
    });
    return out.join('');
  }

  function renderLine() {
    var box = $('#line');
    if (!game.line.length) {
      var leader = game.players[game.leader];
      box.innerHTML = '<div class="empty">' + (game.openingDouble
        ? esc(leader.name) + ' の 6-6 から始まります'
        : esc(leader.name) + ' から、好きな牌で始まります') + '</div>';
      return;
    }
    box.innerHTML = layoutLine(box, game.line);
  }

  /* --- 局情報 ---------------------------------------------------------- */
  function infobarHTML() {
    var out = '<span class="round">第' + game.handNo + '局</span>' +
      '<span class="stat"><b>' + game.target + '</b>点先取</span>' +
      '<span class="stat">' + (game.mode === 'fives' ? 'オール5' : 'ブロック') + '</span>';
    if (game.line.length) {
      out += '<span class="ends">左<span class="end-num">' + game.leftEnd() + '</span>' +
        '右<span class="end-num">' + game.rightEnd() + '</span>';
      if (game.mode === 'fives') {
        var s = game.endSum();
        out += '<span class="sum' + (s % 5 === 0 ? ' hit' : '') + '">計' + s + '</span>';
      }
      out += '</span>';
    }
    return out;
  }

  /* --- 他の 3 人 ------------------------------------------------------- */
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
      '<div class="self-hand" id="myhand">' + tiles + '</div>' +
      '</div>';
  }

  /* --- ヒント ---------------------------------------------------------- */
  function coachHTML() {
    var counts = DM.coach.unseenByNumber(game);
    var countLine = '<div class="count">見えていない牌の数 ' + counts.map(function (c, n) {
      return n + ':' + c;
    }).join('　') + '</div>';
    if (!advice) {
      return (game.awaiting && game.awaiting.type === 'pass' && game.awaiting.seat === 0
        ? '<div><b>出せる牌がありません。</b>パスすると、他の人にも「' +
          (game.leftEnd() === game.rightEnd() ? game.leftEnd() : game.leftEnd() + '・' + game.rightEnd()) +
          ' を持っていない」ことが伝わります。</div>'
        : '<div>自分の番になると、おすすめの手と理由をここに出します。</div>') + countLine;
    }
    var b = advice.best;
    var where = game.line.length ? (b.move.side === 'L' ? 'を左端へ' : 'を右端へ') : 'から始める';
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
  function actionsHTML() {
    var a = game.awaiting;
    if (game.result || game.gameOver) return '<span class="hint">&nbsp;</span>';
    if (!a) {
      var p = game.players[game.current];
      return '<span class="hint">' + (p ? esc(p.name) + ' 思考中…' : '') + '</span>';
    }
    if (a.type === 'pass') {
      return '<span class="hint">出せる牌がありません</span>' +
        '<button class="btn primary" data-act="pass">パス</button>';
    }
    if (selected >= 0) {
      var t = game.players[0].hand[selected];
      var recSide = settings.hint && advice && advice.best.move.index === selected ? advice.best.move.side : null;
      return '<span class="hint">' + DM.label(t) + ' を</span>' +
        '<button class="btn' + (recSide === 'L' ? ' rec' : '') + '" data-act="side-L">◀ 左端 ' + game.leftEnd() + ' へ</button>' +
        '<button class="btn' + (recSide === 'R' ? ' rec' : '') + '" data-act="side-R">右端 ' + game.rightEnd() + ' へ ▶</button>' +
        '<button class="btn" data-act="unselect">やめる</button>';
    }
    return '<span class="hint">' + (game.line.length ? '牌を押して場につなぐ' : '牌を押して最初の 1 枚を出す') + '</span>';
  }

  /* --- 描画 ------------------------------------------------------------ */
  function render() {
    if (!game) return;
    updateAdvice();
    $('#infobar').innerHTML = infobarHTML();
    // 手番は 自分 → 下家 → 対面 → 上家 → 自分 と回るので、上から 下家 / 対面 / 上家 の順に並べる
    $('#board').innerHTML = [1, 2, 3].map(function (i) { return seatHTML(game.players[i]); }).join('');
    renderLine();
    var coach = $('#coach');
    coach.hidden = !settings.hint;
    if (settings.hint) coach.innerHTML = coachHTML();
    $('#self').innerHTML = selfHTML();
    $('#actions').innerHTML = actionsHTML();
  }

  function renderLog() {
    var el = $('#log');
    el.innerHTML = logLines.slice(-60).map(function (l) {
      return '<div class="' + (l.hl ? 'hl' : '') + '">' + esc(l.text) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
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
      game.playerPlay(index, mine[0].side);
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
    $('[data-act="mode"]').textContent = settings.mode === 'fives' ? 'オール5' : 'ブロック';
    $('[data-act="hint"]').classList.toggle('on', settings.hint);
  }

  function handleAction(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.getAttribute('data-act')) {
      case 'title': handleTitleTap(); break;
      case 'pass': game.playerPass(); break;
      case 'side-L':
      case 'side-R':
        var i = selected;
        selected = -1;
        game.playerPlay(i, btn.getAttribute('data-act') === 'side-L' ? 'L' : 'R');
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
        else if (pickOpps.length < 3) pickOpps.push(oi);
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
        saveSettings(); labelButtons();
        break;
      case 'speed':
        var k = (SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length;
        settings.speed = SPEEDS[k];
        game.speed = settings.speed;
        saveSettings(); labelButtons();
        break;
      case 'mode':
        var next = settings.mode === 'fives' ? 'block' : 'fives';
        var started = game && (game.handNo > 1 || game.line.length > 0);
        if (started && !global.confirm('得点方式を「' + (next === 'fives' ? 'オールファイブ' : 'ブロック') +
          '」に変えて、最初からやり直しますか？')) break;
        settings.mode = next;
        saveSettings(); labelButtons();
        startGame();
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
    var rest = 3 - pickOpps.length;
    return '<h2>顔ぶれを選ぶ</h2>' +
      '<div class="sub">あなたのキャラ（勝ったときに顔とひとことが出ます）</div>' +
      '<div class="pick-grid">' + meCells + '</div>' +
      '<div class="sub">対戦相手（選んだ順に 下家・対面・上家。' +
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
      mode: settings.mode,
      me: settings.me,
      opps: settings.opps
    });
    logLines.push({ text: '--- 新しい対戦（' + (settings.mode === 'fives' ? 'オールファイブ' : 'ブロック') +
      '・' + game.target + '点先取）---', hl: true });
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
    global.addEventListener('resize', function () { if (game) renderLine(); });
    if (/#open\b/.test(location.hash)) setOpenMode(true);
    startGame();
  }

  DM.ui = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
