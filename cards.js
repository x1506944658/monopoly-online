/* cards.js — 卡片效果，数据驱动
 * 每个 effect 签名：function(engine, ctx)
 *   ctx = { playerIdx, targetPlayerIdx?, targetTileId?, choice? }
 * 目标由 UI / AI 在 engine.applyCard(target) 时填入。 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  function firstOwned(e, player) {
    for (var i = 0; i < e.tiles.length; i++) {
      if (e.tiles[i].owner === player.idx) return e.tiles[i];
    }
    return null;
  }

  function consumeCard(e, ctx) {
    var p = e.players[ctx.playerIdx];
    if (e.pending && e.pending.card) {
      var id = e.pending.card.id;
      var idx = p.cards.indexOf(id);
      if (idx >= 0) p.cards.splice(idx, 1);
    }
  }

  var CARD_EFFECTS = {
    junfu: function (e, ctx) {
      var total = 0, n = 0;
      e.players.forEach(function (p) { if (!p.out) { total += p.cash; n++; } });
      if (n === 0) return;
      var each = Math.floor(total / n);
      e.players.forEach(function (p) { if (!p.out) p.cash = each; });
      e.log("均富卡：全体现金平分为 " + each);
    },

    goudika: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var tid = (ctx.targetTileId != null) ? ctx.targetTileId : p.pos;
      var t = e.tiles[tid];
      if (t.type !== "LAND" || t.owner !== null) { e.log("购地卡：目标非可购空地，失效"); return; }
      if (p.cash < t.price) { e.log("购地卡：现金不足，失效"); return; }
      p.cash -= t.price; t.owner = p.idx;
      e.log(p.name + " 用购地卡强购 " + t.name);
    },

    mianfei: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var tid = (ctx.targetTileId != null) ? ctx.targetTileId : p.pos;
      var t = e.tiles[tid];
      if (t.type !== "LAND" || t.owner !== null) { e.log("免费卡：目标非可购空地，失效"); return; }
      t.owner = p.idx;
      e.log(p.name + " 用免费卡免费获得 " + t.name);
    },

    gaikaka: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var t = e.tiles[(ctx.targetTileId != null) ? ctx.targetTileId : p.pos];
      if (t.type !== "LAND" || t.owner === null) { e.log("改建卡：目标非已购地，失效"); return; }
      if (t.level >= e.config.maxLevel) { e.log("改建卡：已达最高等级"); return; }
      t.level++;
      e.log(p.name + " 用改建卡将 " + t.name + " 升至 " + t.level + " 层");
    },

    chaichuka: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      if (tgt && tgt.immunity) { tgt.immunity = false; e.log(tgt.name + " 免罪卡抵消了拆除卡"); return; }
      var tile = firstOwned(e, tgt);
      if (!tile) { e.log("拆除卡：" + tgt.name + " 无地块可拆"); return; }
      if (tile.level > 0) tile.level--;
      e.log(src.name + " 用拆除卡令 " + tgt.name + " 的 " + tile.name + " 降一级");
    },

    tingliuka: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      if (tgt && tgt.immunity) { tgt.immunity = false; e.log(tgt.name + " 免罪卡抵消了停留卡"); return; }
      tgt.skip += 1;
      e.log(src.name + " 用停留卡令 " + tgt.name + " 停留 1 回合");
    },

    wuguika: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      if (tgt && tgt.immunity) { tgt.immunity = false; e.log(tgt.name + " 免罪卡抵消了乌龟卡"); return; }
      tgt.turtle = 3;
      e.log(src.name + " 用乌龟卡令 " + tgt.name + " 每回合只走 1 步（3 回合）");
    },

    qiangduanka: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      var amt = Math.min(500, Math.max(0, tgt.cash));
      tgt.cash -= amt; src.cash += amt;
      e.log(src.name + " 用抢夺卡抢走 " + tgt.name + " " + amt + " 现金");
    },

    mianzui: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      p.immunity = true;
      e.log(p.name + " 获得免罪保护");
    },

    zhangjia: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var t = e.tiles[(ctx.targetTileId != null) ? ctx.targetTileId : p.pos];
      if (t.type !== "LAND") { e.log("涨价卡：目标非地块，失效"); return; }
      e.tilefx[t.id] = e.tilefx[t.id] || {};
      e.tilefx[t.id].double = 5;
      e.log(p.name + " 用涨价卡令 " + t.name + " 过路费加倍（5 回合）");
    },

    fengcha: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var t = e.tiles[(ctx.targetTileId != null) ? ctx.targetTileId : p.pos];
      if (t.type !== "LAND") { e.log("查封卡：目标非地块，失效"); return; }
      e.tilefx[t.id] = e.tilefx[t.id] || {};
      e.tilefx[t.id].sealed = 5;
      e.log(p.name + " 用查封卡查封 " + t.name + "（5 回合）");
    },

    zhuanxiang: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      p.dir *= -1;
      e.log(p.name + " 用转向卡，行进方向反转");
    },

    tianshi: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var t = e.tiles[(ctx.targetTileId != null) ? ctx.targetTileId : p.pos];
      if (t.type !== "LAND" || t.owner === null) { e.log("天使卡：目标非已购地，失效"); return; }
      if (t.level >= e.config.maxLevel) { e.log("天使卡：已满级"); return; }
      t.level++;
      e.log(p.name + " 用天使卡令 " + t.name + " 升一级");
    },

    emo: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var t = e.tiles[(ctx.targetTileId != null) ? ctx.targetTileId : p.pos];
      if (t.type !== "LAND" || t.owner === null) { e.log("恶魔卡：目标非已购地，失效"); return; }
      t.level = 0;
      e.log(p.name + " 用恶魔卡夷平 " + t.name);
    },

    jiahuo: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      if (tgt && tgt.immunity) { tgt.immunity = false; e.log(tgt.name + " 免罪卡抵消了嫁祸卡"); return; }
      src.scapegoat = tgt.idx;
      e.log(src.name + " 对 " + tgt.name + " 使用嫁祸卡，下次费用由 " + tgt.name + " 承担");
    },

    paimai: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var tid = (ctx.targetTileId != null) ? ctx.targetTileId : p.pos;
      var t = e.tiles[tid];
      if (t.type !== "LAND") { e.log("拍卖卡：目标非地块，失效"); return; }
      // 拍卖卡：该地块进入一轮快速拍卖，当前玩家优先以起拍价获得
      var startPrice = Math.round(t.price * 0.6);
      var bestBidder = p.idx, bestPrice = startPrice;
      e.players.forEach(function (o) {
        if (o.out || o.idx === p.idx) return;
        var bid = Math.min(o.cash, startPrice + Math.floor(Math.random() * (t.price - startPrice + 1)));
        if (bid > bestPrice) { bestPrice = bid; bestBidder = o.idx; }
      });
      var winner = e.players[bestBidder];
      if (t.owner !== null && t.owner !== winner.idx) {
        e.players[t.owner].cash += Math.round(t.price * 0.5);
        e.log(t.name + " 原主人 " + e.players[t.owner].name + " 获得补偿 " + Math.round(t.price * 0.5));
      }
      winner.cash -= bestPrice; t.owner = winner.idx; t.level = 0;
      e.log(winner.name + " 在拍卖卡引发的拍卖中以 " + bestPrice + " 拍得 " + t.name);
    },

    huhuan: function (e, ctx) {
      var src = e.players[ctx.playerIdx], tgt = e.players[ctx.targetPlayerIdx];
      var tmp = src.pos; src.pos = tgt.pos; tgt.pos = tmp;
      e.log(src.name + " 与 " + tgt.name + " 互换位置");
    },

    xuandian: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      var choice = ctx.choice || 3;
      p.chooseDice = choice;
      e.log(p.name + " 使用选点卡，下次掷骰将走 " + choice + " 步");
    },

    jianmian: function (e, ctx) {
      var p = e.players[ctx.playerIdx];
      p.discount = 3;
      e.log(p.name + " 使用减免卡，3 回合内过路费减半");
    }
  };

  root.CARD_EFFECTS = CARD_EFFECTS;
})();
