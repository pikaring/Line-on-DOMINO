/*
 * ai.js - CPU の思考ルーチン
 *
 * CPU は「キャラクター（打ち筋）」と「難易度（腕前）」の 2 つで性格が決まる。
 *
 *   キャラクター ... 7 つの評価項目への重み
 *   難易度       ... パスから相手の手をどこまで読むか、どれくらい最善手を外すか
 *
 * 1 手ごとに、出せる手（牌 × 左右）それぞれを次の式で評価する。
 *
 *   評価 = 重さ     * 出す牌の目の合計（重い牌を先に処理して、負けたときの失点を減らす）
 *        + ダブル   * ダブルかどうか（ダブルは出せる場面が少ないので早めに出す）
 *        + 温存     * 他の 3 人が 1 巡したあと、自分がまた出せる確率・手元の目の種類
 *        + 支配     * 両端の目を自分がどれだけ握っているか
 *        + 封鎖     * 相手が次に出せなくなる確率（パスの記録から読む）
 *        + 得点     * この手で取れる点（オールファイブ）
 *        - 献上     * 次の人に取られそうな点（オールファイブ）
 *
 * 「相手が出せなくなる確率」は、見えていない牌を相手に配り直すモンテカルロ法で見積もる。
 * 配り直すときに、パスで分かった「持っていない目」を条件に入れるかどうかが腕前の差になる。
 *
 * CPU が見るのは、自分の手牌と、場の並び・各席の手牌の枚数・パスの記録だけ。
 * 他の席の手牌（hand）には触らない（tests/audit.js で検証）。
 */
(function (global) {
  'use strict';

  var DM = global.DM;

  /* --- キャラクター ----------------------------------------------------
   * 猫街三部作（猫街ろまん／猫が消えた街／街と、その白い壁）の 6 人。
   * id は顔アイコン（faces.js）の名前。talk は勝ったとき・負けたときのひとこと。 */
  var CHARACTERS = [
    {
      id: 'nao', name: 'ナオ', tag: '均',
      w: { heavy: 1.0, dbl: 1.0, keep: 1.0, ctl: 1.0, block: 1.0, score: 1.0, danger: 1.0 },
      desc: '小柄な黒髪メガネ。どの項目にも寄らず、状況ごとに素直に判断する基準の打ち手',
      talk: {
        domino: ['計算どおり、ね。', '最後の 1 枚まで、ちゃんと読めてたわ。', 'つなぐ順番さえ間違えなければ、こうなるの。'],
        blocked: ['止まったときに軽いほうが勝ち。ここまで見えてたわ。', '行き詰まりも、読みのうちよ。'],
        game: ['わたしの勝ち。…もう 1 回、つきあってくれる？', '落ち着いて打てば、ドミノは裏切らないわ。'],
        lose: ['あれ…どこで読み違えたのかしら。', 'つぎは、もっと先まで読むわ。']
      }
    },
    {
      id: 'fumi', name: 'フミ', tag: '攻',
      w: { heavy: 0.6, dbl: 0.8, keep: 0.6, ctl: 4.0, block: 0.8, score: 1.5, danger: 0.6 },
      desc: '大柄な茶髪のギャル。自分が多く持つ目で場を押さえ、ごり押しで出し切る力の打ち手',
      talk: {
        domino: ['よっしゃー！ 出し切り〜！', 'てかウチ、天才じゃね？', '場、ぜんぶウチの目にしといたし！'],
        blocked: ['止まっても勝つとか、最強じゃん！', 'え、みんな出せないの？ ウチの勝ち〜！'],
        game: ['優勝〜！ ピースピース！', 'ドミノ、ちょろくない？ …うそ、めっちゃ考えた！'],
        lose: ['え、ちょ、マジ！？', 'くやし〜！ もう 1 回やろ！']
      }
    },
    {
      id: 'maki', name: 'マキ', tag: '点',
      w: { heavy: 1.2, dbl: 2.0, keep: 0.8, ctl: 0.8, block: 0.8, score: 5.0, danger: 0.2 },
      desc: 'ソフトボール部のエース。オールファイブでは 5 の倍数を狙い打ち、取られる点は気にしない',
      talk: {
        domino: ['ナイスピッチ！ 投げ切った！', 'エースの決め球、見た？', '狙ったところに、ずばっと！'],
        blocked: ['守り勝ち！ 試合は最後までわかんないね。', 'ピンチをしのげば、勝ちは来る！'],
        game: ['ゲームセット！ エースの勝ち！', '朝練より疲れた〜。でも勝った！'],
        lose: ['うそ、打たれた！？', '次の回で取り返す！']
      }
    },
    {
      id: 'chika', name: 'チカ', tag: '柔',
      w: { heavy: 0.5, dbl: 0.6, keep: 5.0, ctl: 0.4, block: 0.5, score: 0.8, danger: 0.8 },
      desc: '商店街の魚屋の娘。手元の目を散らさず、どんな場でもうら道を見つけて出し続ける',
      talk: {
        domino: ['へへっ、うら道から抜けちゃった！', 'まいどあり〜！', '身軽なのが、あたしの取り柄！'],
        blocked: ['行き止まりでも、あたしは身軽だからね。', '手元が軽いと、止まっても強いんだ。'],
        game: ['やった！ 今日はお店、半額セール！ …うそうそ。', 'チーム魚屋の勝ち〜！'],
        lose: ['えっ、行き止まり！？', '父ちゃんに笑われちゃうな…。']
      }
    },
    {
      id: 'daiou', name: 'タコ大王', tag: '重',
      w: { heavy: 3.5, dbl: 1.2, keep: 0.8, ctl: 0.3, block: 0.4, score: 0.8, danger: 0.5 },
      desc: '魚屋を手伝う大王。8 本の足で、重い牌から先にどんどん運び出す。負けても傷は浅い',
      talk: {
        domino: ['8 本の足で、ぜんぶ並べたダコ！', '重い牌は、大王にまかせるダコ。', '市場の木箱より軽いダコ。'],
        blocked: ['止まっても、大王は動じないダコ。', '重いものから片づけておいて、正解だったダコ。'],
        game: ['わしが大王ダコ！ 魚屋の大王ダコ！', '勝ったら、みんなにタコ焼きをおごるダコ。'],
        lose: ['め、目が回るダコ〜。', 'わしの足が、からまったダコ…。']
      }
    },
    {
      id: 'queen', name: 'イカ女王', tag: '封',
      w: { heavy: 0.6, dbl: 0.8, keep: 0.6, ctl: 0.8, block: 6.0, score: 0.8, danger: 2.0 },
      desc: '海の向こうの女王。相手がパスした目を端に残し、白い壁のように道をふさぐ',
      talk: {
        domino: ['ごきげんよう。通れる道は、ございませんわ。', '壁を作るのは、わたくしの得意分野ですの。'],
        blocked: ['ほら、みなさま行き止まり。わたくしの勝ちですわ。', 'ふさいだのは、わたくし。勝ったのも、わたくし。'],
        game: ['ひれ伏しなさい。…なんて、ちょっと言ってみたかっただけですわ。', 'わたくしの城に、ようこそ。'],
        lose: ['な、なんですって！？', 'わたくしの壁が…くずれるなんて。']
      }
    }
  ];

  /* --- 難易度（腕前） -------------------------------------------------- */
  var LEVELS = [
    // readVoids : パスで分かった「持っていない目」を読みに使うか
    // samples   : 相手の手を配り直す回数
    // slip/slipTop: この確率で最善手ではなく 2〜slipTop 番手を選ぶ
    { name: 'やさしい', readVoids: false, samples: 40, slip: 0.45, slipTop: 3 },
    { name: 'ふつう', readVoids: true, samples: 120, slip: 0.20, slipTop: 2 },
    { name: 'つよい', readVoids: true, samples: 300, slip: 0, slipTop: 1 }
  ];

  var OPP_WEIGHT = [0, 0.6, 0.25, 0.15];   // 下家・対面・上家の順に、次の手番に近いほど重く見る

  function levelOf(game, me) {
    var d = me && me.difficulty != null ? me.difficulty : game.difficulty;
    return LEVELS[d == null ? 1 : Math.max(0, Math.min(LEVELS.length - 1, d))];
  }

  function charOf(me) {
    var c = me && me.character != null ? me.character : 0;
    return CHARACTERS[Math.max(0, Math.min(CHARACTERS.length - 1, c))];
  }

  function rand(game) { return (game.rng || Math.random)(); }

  /* --- 見えていない牌と、相手の手の配り直し ----------------------------- */

  /** 自分の手牌にも場にもない牌（＝他の 3 人のどこかにある牌） */
  function unseenTiles(game, me) {
    var seen = {};
    me.hand.forEach(function (t) { seen[t.id] = true; });
    game.line.forEach(function (x) { seen[x.tile.id] = true; });
    return DM.TILES.filter(function (t) { return !seen[t.id]; });
  }

  /**
   * 見えていない牌を、各席の枚数どおりに配り直した例を n 通り作る。
   * readVoids なら、パスで「持っていない」と分かった目の牌はその席に配らない。
   * 返り値: [{ seat: [tiles] }, ...]（自分の席は含まない）
   */
  function sampleDeals(game, me, n, readVoids, rng) {
    var pool = unseenTiles(game, me);
    var opps = game.players.filter(function (p) { return p.seat !== me.seat; })
      .map(function (p) { return { seat: p.seat, count: p.count, voids: p.voids.slice() }; });
    var out = [];

    function allowed(o, t) {
      return !readVoids || !(o.voids[t.a] || o.voids[t.b]);
    }

    function tryDeal(useVoids) {
      var tiles = DM.shuffle(pool.slice(), rng);
      // 置き場所の少ない牌から配ると行き詰まりにくい
      if (useVoids) {
        var places = {};
        tiles.forEach(function (t) {
          places[t.id] = opps.filter(function (o) { return allowed(o, t); }).length;
        });
        tiles.sort(function (x, y) { return places[x.id] - places[y.id]; });
      }
      var room = {}, deal = {};
      opps.forEach(function (o) { room[o.seat] = o.count; deal[o.seat] = []; });
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var cands = opps.filter(function (o) { return room[o.seat] > 0 && (!useVoids || allowed(o, t)); });
        if (!cands.length) return null;
        var total = cands.reduce(function (s, o) { return s + room[o.seat]; }, 0);
        var r = rng() * total, pick = cands[cands.length - 1];
        for (var k = 0; k < cands.length; k++) {
          r -= room[cands[k].seat];
          if (r < 0) { pick = cands[k]; break; }
        }
        room[pick.seat]--;
        deal[pick.seat].push(t);
      }
      return deal;
    }

    for (var i = 0; i < n; i++) {
      var d = null;
      for (var tries = 0; tries < 8 && !d; tries++) d = tryDeal(readVoids);
      if (!d) d = tryDeal(false);
      out.push(d);
    }
    return out;
  }

  /* --- 評価 ------------------------------------------------------------ */

  function canFollow(hand, L, R) {
    return hand.some(function (t) { return DM.has(t, L) || DM.has(t, R); });
  }

  /**
   * 配り直した相手の手 deal で、他の 3 人が 1 回ずつ（出せる牌を適当に）つないだあと、
   * 自分の番に rest から出せるかどうか。
   */
  function canFollowLater(seat, deal, L, R, rest, rng) {
    for (var k = 1; k <= 3; k++) {
      var hand = deal[(seat + k) % 4];
      var ok = hand.filter(function (t) { return DM.has(t, L) || DM.has(t, R); });
      if (!ok.length) continue;
      var t = ok[Math.floor(rng() * ok.length)];
      var toL = DM.has(t, L) && (!DM.has(t, R) || rng() < 0.5);
      if (toL) L = DM.other(t, L); else R = DM.other(t, R);
    }
    return canFollow(rest, L, R);
  }

  /** 1 手ぶんの点数（オールファイブ）を、仮の場 line に対して計算する */
  function bestScoreOn(game, line, hand) {
    var L = line[0].l, R = line[line.length - 1].r;
    var best = 0;
    hand.forEach(function (t) {
      ['L', 'R'].forEach(function (side) {
        var e = side === 'L' ? L : R;
        if (!DM.has(t, e)) return;
        var s = game.endSum(game.placed(t, side, line));
        if (s > 0 && s % 5 === 0 && s > best) best = s;
      });
    });
    return best;
  }

  /**
   * 出せる手それぞれの評価項目を計算する。
   * 返り値: [{ move, tile, rest, ends: [L, R], f: { heavy, dbl, keep, ctl, block, score, danger },
   *            oppBlock: { seat: 確率 }, points }]
   */
  function analyze(game, me, moves, level, rng) {
    var deals = sampleDeals(game, me, level.samples, level.readVoids, rng);
    var unseen = unseenTiles(game, me);

    return moves.map(function (m) {
      var tile = me.hand[m.index];
      var line = game.placed(tile, m.side);
      var L = line[0].l, R = line[line.length - 1].r;
      var rest = me.hand.filter(function (_, i) { return i !== m.index; });
      var points = game.scoreOf(tile, m.side);

      // 温存: 手元の目の種類（どこに何が来ても出せるように）
      var kinds = {};
      rest.forEach(function (t) { kinds[t.a] = 1; kinds[t.b] = 1; });

      // 支配: 端の目の残り牌を、自分がどれだけ握っているか
      function share(e) {
        var mine = rest.filter(function (t) { return DM.has(t, e); }).length;
        var other = unseen.filter(function (t) { return DM.has(t, e); }).length;
        return mine / (mine + other + 0.5);
      }
      var ctl = (share(L) + share(R)) / 2;

      // 封鎖・献上: 配り直した相手の手で、次に出せるか・何点取れるか
      var oppBlock = {}, danger = 0, follow = 0;
      var next = (me.seat + 1) % 4;
      game.players.forEach(function (p) { if (p.seat !== me.seat) oppBlock[p.seat] = 0; });
      deals.forEach(function (d) {
        Object.keys(d).forEach(function (seat) {
          if (!canFollow(d[seat], L, R)) oppBlock[seat]++;
        });
        if (game.mode === 'fives') danger += bestScoreOn(game, line, d[next]);
        if (rest.length && canFollowLater(me.seat, d, L, R, rest, rng)) follow++;
      });
      follow = rest.length ? follow / deals.length : 1;
      var keep = 0.7 * follow + 0.3 * Object.keys(kinds).length / 7;
      var block = 0;
      Object.keys(oppBlock).forEach(function (seat) {
        oppBlock[seat] /= deals.length;
        block += OPP_WEIGHT[(seat - me.seat + 4) % 4] * oppBlock[seat];
      });
      danger /= deals.length;

      return {
        move: m, tile: tile, rest: rest, ends: [L, R], points: points,
        oppBlock: oppBlock, dangerPts: danger, follow: follow,
        f: {
          heavy: DM.pips(tile) / 12,
          dbl: DM.isDouble(tile) ? 1 : 0,
          keep: keep,
          ctl: ctl,
          block: block,
          score: points / 20,
          danger: danger / 20
        }
      };
    });
  }

  function valueOf(a, w) {
    if (!a.rest.length) return 1000; // 出し切れるなら何よりも優先
    var f = a.f;
    return w.heavy * f.heavy + w.dbl * f.dbl + w.keep * f.keep + w.ctl * f.ctl +
      w.block * f.block + w.score * f.score - w.danger * f.danger;
  }

  /** 評価して高い順に並べる（ヒントからも使う） */
  function rank(game, me, moves, opts) {
    opts = opts || {};
    var level = opts.level || levelOf(game, me);
    var w = opts.weights || charOf(me).w;
    var rng = opts.rng || game.rng || Math.random;
    var list = analyze(game, me, moves, level, rng);
    list.forEach(function (a) { a.value = valueOf(a, w); });
    return list.sort(function (x, y) { return y.value - x.value; });
  }

  function chooseMove(game, me, moves) {
    if (moves.length === 1) return moves[0];
    var level = levelOf(game, me);
    var list = rank(game, me, moves, { level: level });
    var pick = 0;
    if (level.slip > 0 && list.length > 1 && list[0].rest.length && rand(game) < level.slip) {
      pick = 1 + Math.floor(rand(game) * Math.min(level.slipTop - 1, list.length - 1));
    }
    return list[pick].move;
  }

  DM.ai = {
    CHARACTERS: CHARACTERS,
    LEVELS: LEVELS,
    unseenTiles: unseenTiles,
    sampleDeals: sampleDeals,
    analyze: analyze,
    rank: rank,
    chooseMove: chooseMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
