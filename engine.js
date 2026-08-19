/* engine.js — 核心引擎：状态 / 掷骰移动 / 落地处理 / 买卖建造 / 破产与胜负 / 存档
 * 纯逻辑，不碰 DOM。UI 与 AI 都通过这里的公开方法驱动。 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;

  function Engine(opts) {
    this.config = Object.assign({}, root.CONFIG, opts || {});
    this.tiles = root.buildTiles();
    this.players = [];
    this.current = 0;
    this.round = 1;
    this.dice = [];
    this.logLines = [];
    this.gameOver = false;
    this.winner = null;
    this.phase = "idle"; // idle | awaitBuy | awaitBuild | awaitTarget | awaitShop | awaitAuction
    this.pending = null; // { card, targetType } | { auction }
    this.tilefx = {};     // tileId -> { double, sealed }
    this.deck = this.buildDeck();
    this.lastEvent = null; // 供 UI/音频层读取最近一次事件摘要
    this._lastMove = null; // { idx, fromPos, steps } 供联机客机复现走动动画
  }

  Engine.prototype.init = function (defs) {
    this.players = defs.map(function (d, i) {
      return {
        idx: i, name: d.name, isAI: !!d.isAI, color: d.color, avatar: d.avatar || "", walk: d.walk || d.avatar || "", charId: d.charId || "",
        cash: this.config.startCash, pos: 0, dir: 1,
        cards: [], immunity: false, out: false,
        skip: 0, turtle: 0, hospital: 0, jail: 0,
        chooseDice: false, discount: 0, scapegoat: null
      };
    }, this);
    this.current = 0; this.round = 1; this.gameOver = false; this.winner = null;
    this.phase = "idle"; this.pending = null; this.tilefx = {};
    this.deck = this.buildDeck();
    this.logLines = [];
    this.log("新游戏开始，共 " + this.players.length + " 名玩家", "sys");
  };

  Engine.prototype.log = function (msg, kind) {
    this.logLines.push({ t: this.round, who: this.current, msg: msg, kind: kind || "" });
    if (this.logLines.length > 200) this.logLines.shift();
  };

  Engine.prototype.shuffle = function (a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  };

  Engine.prototype.buildDeck = function () {
    var ids = root.CARD_DEFS.map(function (c) { return c.id; });
    return this.shuffle(ids.slice());
  };

  Engine.prototype.drawCard = function () {
    if (this.deck.length === 0) this.deck = this.buildDeck();
    var id = this.deck.pop();
    return root.CARD_DEFS.filter(function (c) { return c.id === id; })[0];
  };

  Engine.prototype.cardById = function (id) {
    return root.CARD_DEFS.filter(function (c) { return c.id === id; })[0];
  };

  Engine.prototype.diceRange = function () {
    return { min: 1, max: 6 };
  };

  // —— 掷骰 + 移动 + 落地 ——
  Engine.prototype.rollDice = function (forcedSteps) {
    if (this.phase !== "idle" || this.gameOver) return null;
    var p = this.players[this.current];
    if (p.skip > 0) { p.skip--; this.log(p.name + " 处于停留状态，本回合跳过"); this.phase = "idle"; return { skipped: true }; }
    if (p.hospital > 0) { p.hospital--; this.log(p.name + " 正在医院治疗，本回合跳过"); this.phase = "idle"; return { skipped: true }; }
    if (p.jail > 0) { p.jail--; this.log(p.name + " 正在监狱服刑，本回合跳过"); this.phase = "idle"; return { skipped: true }; }

    var steps;
    if (p.chooseDice) {
      steps = forcedSteps != null ? forcedSteps : 3; p.chooseDice = false;
    } else if (p.turtle > 0) { steps = 1; p.turtle--; }
    else { steps = 1 + Math.floor(Math.random() * 6); }

    this.dice = [steps];
    this.log(p.name + " 掷出 " + steps + " 点", "turn");
    return { steps: steps };
  };

  Engine.prototype.moveAndLand = function (steps) {
    if (this.phase !== "idle" || this.gameOver) return;
    var p = this.players[this.current];
    var fromPos = p.pos;
    this._move(p, steps);
    this._lastMove = { idx: p.idx, fromPos: fromPos, steps: steps };
    this._land(p);
  };

  Engine.prototype.posAfter = function (fromPos, dir, n) {
    var len = this.tiles.length;
    if (dir > 0) return (fromPos + n) % len;
    return ((fromPos - n) % len + len) % len;
  };

  Engine.prototype._move = function (p, steps) {
    var len = this.tiles.length;
    if (p.dir > 0) {
      var total = p.pos + steps;
      if (total >= len) { p.cash += this.config.goSalary; this.log(p.name + " 经过起点，发薪 " + this.config.goSalary); this.lastEvent = { type: "salary", player: p.idx, amount: this.config.goSalary }; }
      p.pos = total % len;
    } else {
      var t2 = p.pos - steps;
      if (t2 < 0) { p.cash += this.config.goSalary; this.log(p.name + " 经过起点，发薪 " + this.config.goSalary); this.lastEvent = { type: "salary", player: p.idx, amount: this.config.goSalary }; }
      p.pos = ((t2 % len) + len) % len;
    }
  };

  Engine.prototype._land = function (p) {
    var t = this.tiles[p.pos];
    if (t.type === "START") { this.lastEvent = { type: "start", player: p.idx }; this.phase = "idle"; return; }
    if (t.type === "LAND") {
      if (t.owner === null) { this.lastEvent = { type: "land_empty", player: p.idx, tileId: t.id }; this.phase = "awaitBuy"; return; }
      if (t.owner === p.idx) { this.lastEvent = { type: "land_own", player: p.idx, tileId: t.id }; this.phase = "awaitBuild"; return; }
      this._payRent(p, t); this._checkElim(p); this.phase = "idle"; return;
    }
    if (t.type === "CARD") { this.lastEvent = { type: "card", player: p.idx }; this._drawAndHandle(p); return; }
    if (t.type === "EVENT") { this._randomEvent(p); this.phase = "idle"; return; }
    if (t.type === "GAME") { this._miniGame(p); this.phase = "idle"; return; }
    if (t.type === "HOSPITAL") { this.lastEvent = { type: "hospital", player: p.idx }; this.log(p.name + " 路过医院，住院 3 回合"); p.hospital = 3; this.phase = "idle"; return; }
    if (t.type === "JAIL") { this.lastEvent = { type: "jail", player: p.idx }; this.log(p.name + " 路过监狱，入狱 3 回合"); p.jail = 3; this.phase = "idle"; return; }
    if (t.type === "SHOP") { this.lastEvent = { type: "shop", player: p.idx }; this.phase = "awaitShop"; return; }
  };

  Engine.prototype._hasValidTarget = function (card) {
    var p = this.players[this.current];
    if (card.target === "none") return true;
    if (card.target === "opponent") return this.players.some(function (o) { return o.idx !== p.idx && !o.out; });
    if (card.target === "self") return true;
    if (card.target !== "tile") return true;
    var eff = card.effect;
    if (eff === "goudika" || eff === "mianfei") return this.tiles.some(function (t) { return t.type === "LAND" && t.owner === null; });
    if (eff === "gaikaka" || eff === "tianshi") return this.tiles.some(function (t) { return t.owner === p.idx && t.level < this.config.maxLevel; }, this);
    // 拍卖卡 / 拆除卡 / 涨价卡 / 查封卡 / 恶魔卡：需要别人已购地
    return this.tiles.some(function (t) { return t.type === "LAND" && t.owner !== null && t.owner !== p.idx; });
  };

  Engine.prototype.cancelPending = function () {
    if (this.phase !== "awaitTarget" || !this.pending || !this.pending.card) return false;
    var p = this.players[this.current];
    var id = this.pending.card.id;
    var idx = p.cards.indexOf(id);
    if (idx >= 0) p.cards.splice(idx, 1);
    this.log(p.name + " 放弃使用【" + this.pending.card.name + "】");
    this.pending = null;
    this.phase = "idle";
    return true;
  };

  Engine.prototype._drawAndHandle = function (p) {
    var card = this.drawCard();
    if (!card) { this.phase = "idle"; return; }
    p.cards.push(card.id);
    this.log(p.name + " 抽到【" + card.name + "】" + (card.target === "none" ? "" : "（需指定目标）"));
    if (card.target === "none") {
      var idx2 = p.cards.indexOf(card.id); if (idx2 >= 0) p.cards.splice(idx2, 1);
      this._applyCardEffect(card, { playerIdx: p.idx }); this.phase = "idle";
    } else if (!this._hasValidTarget(card)) {
      var idx3 = p.cards.indexOf(card.id); if (idx3 >= 0) p.cards.splice(idx3, 1);
      this.log("【" + card.name + "】没有可指定的目标，失效");
      this.lastEvent = { type: "card", player: p.idx, cardId: card.id, fizzle: true };
      this.phase = "idle";
    } else {
      this.pending = { card: card, targetType: card.target }; this.phase = "awaitTarget";
    }
  };

  // 小游戏格：随机触发一个乐园小游戏结果
  Engine.prototype._miniGame = function (p) {
    var games = [
      { name: "套圈比赛", win: true, min: 200, max: 400 },
      { name: "气球射击", win: true, min: 250, max: 500 },
      { name: "旋转木马竞速", win: true, min: 150, max: 350 },
      { name: "过山车挑战", win: false, min: 150, max: 300 },
      { name: "鬼屋探险", win: false, min: 200, max: 400 }
    ];
    var g = games[Math.floor(Math.random() * games.length)];
    var amt = g.min + Math.floor(Math.random() * (g.max - g.min));
    if (g.win) { p.cash += amt; this.lastEvent = { type: "game", result: "win", player: p.idx, amount: amt, name: g.name }; this.log(p.name + " 参加【" + g.name + "】赢得奖金 " + amt); }
    else { p.cash -= amt; this.lastEvent = { type: "game", result: "lose", player: p.idx, amount: amt, name: g.name }; this.log(p.name + " 在【" + g.name + "】受挫损失 " + amt); this._checkElim(p); }
  };

  Engine.prototype.rentOf = function (t) {
    var fx = this.tilefx[t.id];
    if (fx && fx.sealed > 0) return 0;
    var r = t.baseRent * (t.level + 1);
    if (fx && fx.double > 0) r *= 2;
    return r;
  };

  // 过路费：支持减免卡、嫁祸卡、破产保护（先卖地）
  Engine.prototype._payRent = function (p, t) {
    var amount = this.rentOf(t);
    if (amount <= 0) return;

    // 减免卡
    if (p.discount > 0) { amount = Math.round(amount * 0.5); }

    // 嫁祸卡：把费用转嫁给替罪羊
    if (p.scapegoat != null) {
      var goat = this.players[p.scapegoat];
      if (goat && !goat.out) {
        this._forcePay(goat, amount, p.name + " 用嫁祸卡把过路费转嫁给 " + goat.name);
        this.log(p.name + " 使用嫁祸卡，" + goat.name + " 代为支付过路费 " + amount);
      }
      p.scapegoat = null;
      return;
    }

    // 现金不足：自动卖地抵债
    if (p.cash < amount) this._mortgageToPay(p, amount);

    if (p.cash >= amount) {
      p.cash -= amount; this.players[t.owner].cash += amount;
      this.lastEvent = { type: "rent", player: p.idx, owner: t.owner, amount: amount, tileId: t.id, discount: p.discount > 0 };
      this.log(p.name + " 在 " + t.name + " 付给 " + this.players[t.owner].name + " 过路费 " + amount + (p.discount > 0 ? "（减免卡生效）" : ""));
    } else {
      // 还是不够，触发破产
      var actual = p.cash; p.cash = 0; this.players[t.owner].cash += actual;
      this.lastEvent = { type: "rent", player: p.idx, owner: t.owner, amount: actual, bankrupt: true };
      this.log(p.name + " 现金不足以支付过路费，全部 " + actual + " 归 " + this.players[t.owner].name);
      this._eliminate(p);
    }
  };

  // 强制某人支付一笔费用（用于嫁祸卡、事件罚款等）
  Engine.prototype._forcePay = function (p, amount, msg) {
    if (p.cash < amount) this._mortgageToPay(p, amount);
    if (p.cash >= amount) { p.cash -= amount; if (msg) this.log(msg + "，支付 " + amount); }
    else { var actual = p.cash; p.cash = 0; if (msg) this.log(msg + "，但现金不足，仅能支付 " + actual); this._eliminate(p); }
  };

  // 自动卖地筹集资金：先卖等级最低、地价最低的地
  Engine.prototype._mortgageToPay = function (p, need) {
    var self = this;
    var owned = this.tiles.filter(function (t) { return t.owner === p.idx && !t.sealed; })
      .sort(function (a, b) { return (a.level - b.level) || (a.price - b.price); });
    while (p.cash < need && owned.length > 0) {
      var t = owned.shift();
      var refund = Math.round(t.price * 0.5) + t.level * Math.round(t.buildCost * 0.5);
      t.owner = null; t.level = 0;
      p.cash += refund;
      this.log(p.name + " 紧急出售 " + t.name + " 回笼资金 " + refund);
    }
  };

  Engine.prototype._randomEvent = function (p) {
    var events = [
      { w: 0.20, fn: function () { var bonus = 500; p.cash += bonus; self.lastEvent = { type: "event", result: "good", player: p.idx, amount: bonus }; self.log(p.name + " 捡到奖金 " + bonus); } },
      { w: 0.12, fn: function () { var bonus = 1000; p.cash += bonus; self.lastEvent = { type: "event", result: "good", player: p.idx, amount: bonus }; self.log(p.name + " 幸运大奖 " + bonus); } },
      { w: 0.18, fn: function () { var loss = 200; p.cash -= loss; self.lastEvent = { type: "event", result: "bad", player: p.idx, amount: loss }; self.log(p.name + " 丢失现金 " + loss); self._checkElim(p); } },
      { w: 0.12, fn: function () { var loss = 500; p.cash -= loss; self.lastEvent = { type: "event", result: "bad", player: p.idx, amount: loss }; self.log(p.name + " 被偷窃损失 " + loss); self._checkElim(p); } },
      { w: 0.15, fn: function () { p.hospital = 3; self.lastEvent = { type: "event", result: "bad", player: p.idx, subtype: "hospital" }; self.log(p.name + " 掉进水坑，住院 3 回合"); } },
      { w: 0.13, fn: function () { p.jail = 3; self.lastEvent = { type: "event", result: "bad", player: p.idx, subtype: "jail" }; self.log(p.name + " 卷入偷盗事件，入狱 3 回合"); } },
      { w: 0.10, fn: function () { self.lastEvent = { type: "event", result: "neutral", player: p.idx }; self.log(p.name + " 在乐园悠闲散步"); } }
    ];
    var self = this;
    var r = Math.random(), acc = 0, chosen = events[events.length - 1];
    for (var i = 0; i < events.length; i++) { acc += events[i].w; if (r < acc) { chosen = events[i]; break; } }
    chosen.fn();
  };

  // —— 买地 / 建造 / 商店 ——
  Engine.prototype.buyCurrentLand = function () {
    var p = this.players[this.current], t = this.tiles[p.pos];
    if (t.type !== "LAND" || t.owner !== null || p.cash < t.price) return false;
    p.cash -= t.price; t.owner = p.idx;
    this.lastEvent = { type: "buy", player: p.idx, tileId: t.id, price: t.price };
    this.log(p.name + " 买下 " + t.name + "（" + t.price + "）");
    this.phase = "idle"; return true;
  };

  Engine.prototype.passBuy = function () { if (this.phase === "awaitBuy") this.phase = "idle"; };

  Engine.prototype.buildCurrent = function () {
    var p = this.players[this.current], t = this.tiles[p.pos];
    if (t.type !== "LAND" || t.owner !== p.idx || t.level >= this.config.maxLevel) return false;
    if (p.cash < t.buildCost) return false;
    p.cash -= t.buildCost; t.level++;
    this.lastEvent = { type: "build", player: p.idx, tileId: t.id, cost: t.buildCost, level: t.level };
    this.log(p.name + " 在 " + t.name + " 盖房子，升至 " + t.level + " 层");
    this.phase = "idle"; return true;
  };

  Engine.prototype.passBuild = function () { if (this.phase === "awaitBuild") this.phase = "idle"; };

  Engine.prototype.shopCards = function () {
    return [
      { id: "mianfei", price: 600 },
      { id: "xuandian", price: 500 },
      { id: "jianmian", price: 450 },
      { id: "jiahuo", price: 550 },
      { id: "qiangduanka", price: 400 }
    ];
  };

  Engine.prototype.buyFromShop = function (cardId) {
    var p = this.players[this.current];
    var item = this.shopCards().filter(function (c) { return c.id === cardId; })[0];
    if (!item || p.cash < item.price) return false;
    p.cash -= item.price; p.cards.push(cardId);
    var card = this.cardById(cardId);
    this.lastEvent = { type: "shop", player: p.idx, cardId: cardId, price: item.price };
    this.log(p.name + " 在卡片商店购买【" + (card ? card.name : cardId) + "】花费 " + item.price);
    this.phase = "idle"; return true;
  };

  Engine.prototype.passShop = function () { if (this.phase === "awaitShop") this.phase = "idle"; };

  // —— 拍卖 ——
  Engine.prototype.startAuction = function (tileId) {
    var t = this.tiles[tileId];
    if (!t || t.type !== "LAND") return null;
    this.phase = "awaitAuction";
    this.pending = { auction: { tileId: tileId, bids: [], price: Math.round(t.price * 0.6) } };
    return this.pending.auction;
  };

  Engine.prototype.placeBid = function (playerIdx, amount) {
    if (this.phase !== "awaitAuction" || !this.pending || !this.pending.auction) return false;
    var a = this.pending.auction;
    var p = this.players[playerIdx];
    if (p.out || amount <= a.price || amount > p.cash) return false;
    a.price = amount; a.bids = [playerIdx];
    return true;
  };

  Engine.prototype.endAuction = function () {
    if (this.phase !== "awaitAuction" || !this.pending || !this.pending.auction) return;
    var a = this.pending.auction;
    var t = this.tiles[a.tileId];
    if (a.bids.length > 0) {
      var winner = a.bids[a.bids.length - 1];
      var p = this.players[winner];
      p.cash -= a.price; t.owner = winner; t.level = 0;
      this.log(p.name + " 以 " + a.price + " 拍得 " + t.name);
    } else {
      this.log(t.name + " 流拍");
    }
    this.pending = null; this.phase = "idle";
  };

  // —— 卡片 ——
  Engine.prototype._applyCardEffect = function (card, ctx) {
    var fx = root.CARD_EFFECTS;
    if (fx && fx[card.effect]) fx[card.effect](this, ctx);
  };

  Engine.prototype.applyCard = function (target) {
    if (!this.pending) return;
    var card = this.pending.card;
    var p = this.players[this.current];
    var idx = p.cards.indexOf(card.id);
    if (idx >= 0) p.cards.splice(idx, 1);
    var ctx = { playerIdx: this.current };
    if (target && target.playerIdx != null) ctx.targetPlayerIdx = target.playerIdx;
    if (target && target.tileId != null) ctx.targetTileId = target.tileId;
    if (target && target.choice != null) ctx.choice = target.choice;
    this._applyCardEffect(card, ctx);
    this.pending = null;
    this.phase = "idle";
  };

  // —— 回合推进 / 胜负 ——
  Engine.prototype._nextActive = function () {
    var n = this.players.length, i = this.current;
    for (var s = 1; s <= n; s++) {
      var idx = (i + s) % n;
      if (!this.players[idx].out) return idx;
    }
    return this.current;
  };

  Engine.prototype.endTurn = function () {
    if (this.phase !== "idle" || this.gameOver) return;
    var self = this;
    Object.keys(this.tilefx).forEach(function (k) {
      var fx = self.tilefx[k];
      if (fx.double > 0) fx.double--;
      if (fx.sealed > 0) fx.sealed--;
      if (fx.double <= 0 && fx.sealed <= 0) delete self.tilefx[k];
    });
    this.players.forEach(function (p) {
      if (p.discount > 0) p.discount--;
    });
    this.current = this._nextActive();
    if (this.current === 0) { this.round++; this.log("—— 第 " + this.round + " 回合 ——", "sys"); }
    this._checkEnd();
  };

  Engine.prototype._checkElim = function (p) {
    if (p.cash < 0) this._eliminate(p);
  };

  Engine.prototype._eliminate = function (p) {
    p.out = true; p.cash = 0;
    var self = this;
    this.tiles.forEach(function (t) { if (t.owner === p.idx) { t.owner = null; t.level = 0; } });
    this.lastEvent = { type: "bankrupt", player: p.idx };
    this.log(p.name + " 破产出局！", "sys");
  };

  Engine.prototype.netWorth = function (p) {
    var w = p.cash;
    this.tiles.forEach(function (t) {
      if (t.owner === p.idx) w += Math.round(t.price * 0.5) + t.buildCost * t.level;
    });
    return w;
  };

  Engine.prototype._checkEnd = function () {
    if (this.gameOver) return;
    var actives = this.players.filter(function (x) { return !x.out; });
    if (actives.length <= 1) {
      this.gameOver = true; this.winner = actives[0] ? actives[0].idx : null;
      this.lastEvent = { type: "win", winner: this.winner };
      this.log("游戏结束", "sys"); return;
    }
    if (this.round > this.config.maxRounds) {
      this.gameOver = true;
      var best = null, bestV = -1, self = this;
      this.players.forEach(function (pl) {
        if (pl.out) return;
        var v = self.netWorth(pl);
        if (v > bestV) { bestV = v; best = pl.idx; }
      });
      this.winner = best;
      this.lastEvent = { type: "win", winner: this.winner };
      this.log("达到最大回合数，按净资产结算", "sys");
    }
  };

  // —— 序列化 / 反序列化（存档读档） ——
  Engine.prototype.toJSON = function () {
    var pending = null;
    if (this.pending) {
      if (this.pending.auction) {
        pending = { auction: this.pending.auction };
      } else if (this.pending.card) {
        pending = { cardId: this.pending.card.id, targetType: this.pending.targetType };
      }
    }
    return {
      version: 2,
      config: this.config,
      tiles: this.tiles.map(function (t) {
        return {
          id: t.id, col: t.col, row: t.row, type: t.type,
          group: t.group, name: t.name, price: t.price,
          baseRent: t.baseRent, buildCost: t.buildCost,
          owner: t.owner, level: t.level
        };
      }),
      players: this.players.map(function (p) {
        return {
          idx: p.idx, name: p.name, isAI: p.isAI, color: p.color, avatar: p.avatar, walk: p.walk, charId: p.charId,
          cash: p.cash, pos: p.pos, dir: p.dir, cards: p.cards.slice(),
          immunity: p.immunity, out: p.out, skip: p.skip, turtle: p.turtle,
          hospital: p.hospital, jail: p.jail, chooseDice: p.chooseDice,
          discount: p.discount, scapegoat: p.scapegoat
        };
      }),
      current: this.current,
      round: this.round,
      dice: this.dice.slice(),
      logLines: this.logLines.slice(),
      gameOver: this.gameOver,
      winner: this.winner,
      phase: this.phase,
      pending: pending,
      tilefx: Object.assign({}, this.tilefx),
      deck: this.deck.slice(),
      lastMove: this._lastMove
    };
  };

  Engine.fromJSON = function (data) {
    var e = new Engine(data.config);
    e.tiles = data.tiles.map(function (t) { return Object.assign({}, t); });
    e.players = data.players.map(function (p) {
      return Object.assign({}, p, {
        cards: p.cards.slice(), walk: p.walk || p.avatar || "", charId: p.charId || "",
        hospital: p.hospital || 0, jail: p.jail || 0,
        chooseDice: p.chooseDice || false, discount: p.discount || 0,
        scapegoat: p.scapegoat != null ? p.scapegoat : null
      });
    });
    e.current = data.current;
    e.round = data.round;
    e.dice = (data.dice || []).slice();
    e.logLines = (data.logLines || []).slice();
    e.gameOver = data.gameOver;
    e.winner = data.winner;
    e.phase = data.phase || "idle";
    e.tilefx = Object.assign({}, data.tilefx);
    e.deck = (data.deck || []).slice();
    if (data.pending) {
      if (data.pending.auction) {
        e.pending = { auction: data.pending.auction };
      } else {
        var card = e.cardById(data.pending.cardId);
        if (card) e.pending = { card: card, targetType: data.pending.targetType };
      }
    }
    return e;
  };

  root.Engine = Engine;
})();
