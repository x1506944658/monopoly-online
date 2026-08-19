/* ai.js — 电脑 AI：买地 / 建造 / 商店 / 卡片目标选择 / 自动结算
 * 仅在“当前玩家是 AI”时由主控调用。 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  function max(a, b) { return a > b ? a : b; }

  var AI = {
    decideBuy: function (e, p) {
      var t = e.tiles[p.pos];
      return p.cash >= t.price + 500;
    },

    decideBuild: function (e, p) {
      var t = e.tiles[p.pos];
      return p.cash >= t.buildCost + 600 && t.level < e.config.maxLevel;
    },

    pickShop: function (e, p) {
      var items = e.shopCards().filter(function (it) { return p.cash >= it.price + 500; });
      if (items.length === 0) return null;
      // 优先买选点卡、减免卡
      var priority = ["xuandian", "jianmian", "mianfei", "jiahuo", "qiangduanka"];
      for (var i = 0; i < priority.length; i++) {
        var it = items.filter(function (x) { return x.id === priority[i]; })[0];
        if (it) return it.id;
      }
      return items[0].id;
    },

    pickTarget: function (e, p, pending) {
      var card = pending.card;
      if (pending.targetType === "self") {
        if (card.effect === "xuandian") {
          // 选点卡：倾向于走到空地或自己的地
          for (var n = 6; n >= 1; n--) {
            var tp = e.posAfter(p.pos, p.dir, n);
            var tt = e.tiles[tp];
            if (tt.type === "LAND" && (tt.owner === null || tt.owner === p.idx)) return { choice: n };
          }
          return { choice: 3 };
        }
        return {};
      }
      if (pending.targetType === "opponent") {
        // 嫁祸卡、互换卡、伤害卡：选最富的对手
        var best = null, bv = -1;
        e.players.forEach(function (o) {
          if (o.idx !== p.idx && !o.out) { var v = e.netWorth(o); if (v > bv) { bv = v; best = o; } }
        });
        return { playerIdx: best ? best.idx : p.idx };
      }
      if (pending.targetType === "tile") {
        var eff = card.effect;
        if (eff === "goudika" || eff === "mianfei") {
          var ct = e.tiles[p.pos];
          if (ct.type === "LAND" && ct.owner === null) return { tileId: ct.id };
          var u = e.tiles.filter(function (t) { return t.type === "LAND" && t.owner === null; })[0];
          return u ? { tileId: u.id } : { tileId: p.pos };
        }
        if (eff === "gaikaka" || eff === "tianshi") {
          var own = e.tiles.filter(function (t) { return t.owner === p.idx && t.level < e.config.maxLevel; });
          if (own.length) { own.sort(function (a, b) { return b.level - a.level; }); return { tileId: own[0].id }; }
          return { tileId: p.pos };
        }
        if (eff === "paimai") {
          // 拍卖卡：选对手价值最高的地
          var oppTile = null, pv = -1;
          e.players.forEach(function (o) {
            if (o.idx !== p.idx && !o.out) {
              e.tiles.forEach(function (t) { if (t.owner === o.idx && t.price > pv) { pv = t.price; oppTile = t; } });
            }
          });
          return oppTile ? { tileId: oppTile.id } : { tileId: p.pos };
        }
        // 伤害类：选对手租金最高的地块
        var opp = null, rv = -1;
        e.players.forEach(function (o) {
          if (o.idx !== p.idx && !o.out) {
            e.tiles.forEach(function (t) { if (t.owner === o.idx && e.rentOf(t) > rv) { rv = e.rentOf(t); opp = t; } });
          }
        });
        return opp ? { tileId: opp.id } : { tileId: p.pos };
      }
      return {};
    },

    // 掷骰后（phase != idle）由主控调用，自动清空决策阶段
    resolve: function (e) {
      var guard = 0;
      while (e.phase !== "idle" && !e.gameOver && guard++ < 20) {
        var p = e.players[e.current];
        if (e.phase === "awaitBuy") { if (this.decideBuy(e, p)) e.buyCurrentLand(); else e.passBuy(); }
        else if (e.phase === "awaitBuild") { if (this.decideBuild(e, p)) e.buildCurrent(); else e.passBuild(); }
        else if (e.phase === "awaitTarget") { e.applyCard(this.pickTarget(e, p, e.pending)); }
        else if (e.phase === "awaitShop") {
          var itemId = this.pickShop(e, p);
          if (itemId) e.buyFromShop(itemId); else e.passShop();
        }
      }
    }
  };

  root.AI = AI;
})();
