/* main.js — 主控：本地/联机双模式
 * 本地模式：与旧版一致（房主即本机）。
 * 联机模式（房主权威）：房主浏览器跑游戏逻辑，客机只收局面快照 + 发意图。
 *   - 房主：本地执行动作并广播 state
 *   - 客机：按钮 -> 发送 action 意图，由房主代为执行后广播新 state
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  var SAVE_KEY = "monopoly_save_v2";
  var engine = null;

  // 模式状态
  var mode = "local";      // 'local' | 'online'
  var isHost = true;
  var mySeat = 0;
  var roomCode = "";
  var roomCount = 2;
  var lobbyPlayers = null; // 从服务器 lobby 同步的玩家列表（按 seat 排序）
  var pendingConnect = false; // 正在尝试连接联机服务器（用于连接失败提示）

  function charColor(id) { var c = (root.CHARACTERS || []).filter(function (x) { return x.id === id; })[0]; return c ? c.color : "#888"; }
  function charAvatar(id) { var c = (root.CHARACTERS || []).filter(function (x) { return x.id === id; })[0]; return c ? c.avatar : ""; }
  function onlineGuest() { return mode === "online" && !isHost; }

  // —— 事件音效/配音 ——
  function playLastEvent() {
    var ev = engine ? engine.lastEvent : null;
    if (!ev || !window.Audio) return;
    var p = engine.players[ev.player];
    switch (ev.type) {
      case "salary": Audio.playSfx("good"); if (p) Audio.speak(p, "good"); break;
      case "start": Audio.playSfx("turn"); if (p) Audio.speak(p, "start"); break;
      case "buy": Audio.playSfx("buy"); if (p) Audio.speak(p, "buy"); break;
      case "build": Audio.playSfx("build"); if (p) Audio.speak(p, "build"); break;
      case "rent":
        if (p) { Audio.playSfx("payRent"); Audio.speak(p, "payRent"); }
        var owner = engine.players[ev.owner];
        if (owner) { Audio.playSfx("getRent"); Audio.speak(owner, "getRent"); }
        break;
      case "card": Audio.playSfx("card"); if (p) Audio.speak(p, "card"); break;
      case "event":
        Audio.playSfx(ev.result === "good" ? "good" : "bad");
        if (p) Audio.speak(p, ev.result === "good" ? "good" : "bad");
        if (ev.subtype === "hospital" && p) { Audio.playSfx("hospital"); Audio.speak(p, "hospital"); }
        if (ev.subtype === "jail" && p) { Audio.playSfx("jail"); Audio.speak(p, "jail"); }
        break;
      case "game":
        Audio.playSfx(ev.result === "win" ? "good" : "bad");
        if (p) Audio.speak(p, ev.result === "win" ? "good" : "bad");
        break;
      case "hospital": Audio.playSfx("hospital"); if (p) Audio.speak(p, "hospital"); break;
      case "jail": Audio.playSfx("jail"); if (p) Audio.speak(p, "jail"); break;
      case "shop": Audio.playSfx("shop"); if (p) Audio.speak(p, "shop"); break;
      case "bankrupt": Audio.playSfx("lose"); if (p) Audio.speak(p, "lose"); break;
      case "win":
        Audio.playSfx("win");
        var w = engine.players[ev.winner];
        if (w) Audio.speak(w, "win");
        engine.players.forEach(function (pl) { if (pl.idx !== ev.winner && !pl.out) Audio.speak(pl, "lose"); });
        break;
    }
  }

  // —— 动作执行后：渲染 + （联机房主）广播 + 推进 ——
  function postAction() {
    UI.renderAll();
    if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
    if (engine.phase === "idle") {
      advance();
    } else {
      if (engine.current === mySeat) UI.showPhaseModal();
    }
  }

  function doRoll(steps) {
    var p = engine.players[engine.current];
    if (window.Audio) { Audio.playSfx("dice"); Audio.speak(p, "roll", steps); }
    UI.animateMove(p.idx, steps, function () {
      engine.moveAndLand(steps);
      UI.renderAll();
      if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
      if (engine.phase === "idle") advance();
      else { if (engine.current === mySeat) UI.showPhaseModal(); }
    });
  }

  function humanRoll() {
    if (!engine || engine.gameOver) return;
    // 联机客机：仅发送意图
    if (mode === "online" && !isHost) {
      if (engine.current !== mySeat) return;
      Net.send({ type: "action", room: roomCode, action: { kind: "roll" } });
      UI.setRollEnabled(false);
      return;
    }
    var p = engine.players[engine.current];
    if (p.isAI) return;
    if (p.out) { advance(); return; }
    UI.setRollEnabled(false);
    if (window.Audio) window.Audio.init();

    if (p.chooseDice) {
      UI.showChooseDice(function (n) {
        var res = engine.rollDice(n);
        if (!res) return;
        if (res.skipped) { UI.renderAll(); if (engine.phase === "idle") advance(); else { if (engine.current === mySeat) UI.showPhaseModal(); } return; }
        doRoll(res.steps);
      });
      return;
    }
    var res = engine.rollDice();
    if (!res) return;
    if (res.skipped) { UI.renderAll(); if (engine.phase === "idle") advance(); else { if (engine.current === mySeat) UI.showPhaseModal(); } return; }
    doRoll(res.steps);
  }

  // —— 统一动作入口（弹窗按钮都走这里）——
  var Game = {
    roll: function () { humanRoll(); },
    buy: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "buy" } }); return; } engine.buyCurrentLand(); postAction(); },
    passBuy: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "passBuy" } }); return; } engine.passBuy(); postAction(); },
    build: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "build" } }); return; } engine.buildCurrent(); postAction(); },
    passBuild: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "passBuild" } }); return; } engine.passBuild(); postAction(); },
    buyShop: function (id) { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "buyShop", id: id } }); return; } engine.buyFromShop(id); postAction(); },
    passShop: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "passShop" } }); return; } engine.passShop(); postAction(); },
    chooseTarget: function (target) { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "chooseTarget", target: target } }); return; } engine.applyCard(target || {}); postAction(); },
    cancelCard: function () { UI.closeModal(); if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "cancelCard" } }); return; } engine.cancelPending(); postAction(); },
    chooseDice: function (n) {
      UI.closeModal();
      if (onlineGuest()) { Net.send({ type: "action", room: roomCode, action: { kind: "chooseDice", n: n } }); return; }
      var res = engine.rollDice(n);
      if (!res) return;
      if (res.skipped) { UI.renderAll(); if (engine.phase === "idle") advance(); else { if (engine.current === mySeat) UI.showPhaseModal(); } return; }
      doRoll(res.steps);
    }
  };
  root.Game = Game;

  function advance() {
    if (!engine) return;
    playLastEvent();
    if (engine.gameOver) { finishGame(); return; }
    engine.endTurn();
    UI.renderAll();
    playLastEvent();
    if (engine.gameOver) { finishGame(); return; }
    if (engine.players[engine.current].isAI) { runAITurn(); return; }
    if (mode === "online" && engine.current !== mySeat) {
      if (isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
      UI.setRollEnabled(false);
    } else {
      UI.setRollEnabled(true);
    }
  }

  function runAITurn() {
    var guard = 0;
    while (!engine.gameOver && engine.players[engine.current].isAI && guard++ < 60) {
      var p = engine.players[engine.current];
      var res = engine.rollDice();
      if (res && !res.skipped) {
        if (window.Audio) { Audio.playSfx("dice"); Audio.speak(p, "roll", res.steps); }
        engine.moveAndLand(res.steps);
      }
      AI.resolve(engine);
      playLastEvent();
      UI.renderAll();
      if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
      if (engine.gameOver) { finishGame(); return; }
      engine.endTurn();
      UI.renderAll();
      playLastEvent();
      if (engine.gameOver) { finishGame(); return; }
    }
    if (engine.gameOver) { finishGame(); return; }
    if (engine.players[engine.current].isAI) { runAITurn(); return; }
    if (mode === "online" && engine.current !== mySeat) {
      if (isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
      UI.setRollEnabled(false);
    } else {
      UI.setRollEnabled(true);
    }
  }

  function finishGame() {
    UI.setRollEnabled(false);
    UI.showWin();
    if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
  }

  // —— 开局 ——
  function startGame(defs, online) {
    mode = online ? "online" : "local";
    isHost = true; mySeat = 0;
    if (window.Audio) window.Audio.init();
    engine = new Engine();
    engine.init(defs);
    UI.setEngine(engine);
    UI.setNet(0, mode === "online");
    UI.showGame();
    UI.renderAll();
    if (mode === "online") {
      UI.setRollEnabled(true); // 房主先手
    } else {
      if (engine.players[engine.current].isAI) setTimeout(advance, 50);
      else UI.setRollEnabled(true);
    }
  }

  // —— 联机：客机收到局面 ——
  function onState(state) {
    if (mode !== "online") return;
    var lm = state.lastMove;
    engine = Engine.fromJSON(state);
    UI.setEngine(engine);
    UI.setNet(mySeat, true);
    playLastEvent();
    if (lm) {
      UI.animateMoveFrom(lm.idx, lm.fromPos, lm.steps, function () { UI.renderAll(); });
    } else {
      UI.renderAll();
    }
    var myTurn = engine.current === mySeat && !engine.gameOver;
    UI.setRollEnabled(myTurn && engine.phase === "idle");
    if (myTurn && engine.phase !== "idle") UI.showPhaseModal();
    if (engine.gameOver) UI.showWin();
  }

  // —— 联机：房主收到客机意图 ——
  function onAction(action) {
    if (!isHost || mode !== "online" || !action) return;
    var k = action.kind;
    if (k === "roll") {
      var p = engine.players[engine.current];
      if (!p || p.isAI) return;
      var res = engine.rollDice();
      if (!res) return;
      if (res.skipped) {
        UI.renderAll();
        if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() });
        advance(); return;
      }
      doRoll(res.steps); return;
    }
    if (k === "buy") { engine.buyCurrentLand(); postAction(); return; }
    if (k === "passBuy") { engine.passBuy(); postAction(); return; }
    if (k === "build") { engine.buildCurrent(); postAction(); return; }
    if (k === "passBuild") { engine.passBuild(); postAction(); return; }
    if (k === "buyShop") { engine.buyFromShop(action.id); postAction(); return; }
    if (k === "passShop") { engine.passShop(); postAction(); return; }
    if (k === "chooseTarget") { engine.applyCard(action.target || {}); postAction(); return; }
    if (k === "cancelCard") { engine.cancelPending(); postAction(); return; }
    if (k === "chooseDice") {
      var r = engine.rollDice(action.n);
      if (!r) return;
      if (r.skipped) { UI.renderAll(); if (mode === "online" && isHost) Net.send({ type: "state", room: roomCode, state: engine.toJSON() }); advance(); return; }
      doRoll(r.steps); return;
    }
  }

  // —— 存档读档（本地模式）——
  function saveGame() {
    if (!engine || mode !== "local") { UI.showToast("联机模式不支持本地存档"); return; }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(engine.toJSON()));
      UI.showToast("存档成功");
    } catch (e) { UI.showToast("存档失败：" + e.message); }
  }
  function loadGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { UI.showToast("没有存档"); return; }
      var data = JSON.parse(raw);
      engine = Engine.fromJSON(data);
      mode = "local"; isHost = true; mySeat = 0;
      UI.setEngine(engine); UI.setNet(0, false);
      UI.closeModal(); UI.showGame(); UI.renderAll();
      if (engine.gameOver) { UI.setRollEnabled(false); UI.showWin(); }
      else {
        UI.setRollEnabled(!engine.players[engine.current].isAI);
        if (engine.players[engine.current].isAI) setTimeout(advance, 50);
      }
      UI.showToast("读档成功");
    } catch (e) { UI.showToast("读档失败：" + e.message); }
  }

  function showMenu() {
    UI.showSetup();
    UI.renderSetup(startGame);
  }
  root.__newGame = function () { showMenu(); };

  // —— 联机大厅回调（由 ui.js 的按钮触发）——
  root.__lobbyCreate = function (count, name, charId) {
    roomCount = count; pendingConnect = true;
    Net.connect(function () { Net.send({ type: "create", count: count, name: name, charId: charId }); });
  };
  root.__lobbyJoin = function (room, name, charId) {
    pendingConnect = true;
    Net.connect(function () { Net.send({ type: "join", room: room, name: name, charId: charId }); });
  };
  root.__lobbyStart = function () {
    if (!lobbyPlayers || lobbyPlayers.length < 2) { UI.showToast("至少需要 2 名玩家"); return; }
    var defs = [];
    for (var s = 0; s < roomCount; s++) {
      var pl = null;
      for (var i = 0; i < lobbyPlayers.length; i++) if (lobbyPlayers[i].seat === s) pl = lobbyPlayers[i];
      if (pl) {
        defs.push({ name: pl.name, isAI: false, color: charColor(pl.charId), avatar: charAvatar(pl.charId), charId: pl.charId });
      } else {
        var ch = root.CHARACTERS[s % root.CHARACTERS.length];
        defs.push({ name: "电脑" + (s + 1), isAI: true, color: ch.color, avatar: ch.avatar, charId: ch.id });
      }
    }
    startGame(defs, true);
    Net.send({ type: "start", room: roomCode, state: engine.toJSON() });
  };
  root.__lobbyBack = function () {
    mode = "local"; isHost = true; mySeat = 0; lobbyPlayers = null;
    UI.setNet(0, false);
    UI.renderSetup(startGame);
  };

  // —— 网络消息分发 ——
  function handleNet(m) {
    if (!m || !m.type) return;
    if (m.type === "created") {
      mode = "online"; isHost = true; mySeat = 0; roomCode = m.room; roomCount = m.count; lobbyPlayers = [];
      pendingConnect = false;
      UI.setNet(0, true);
      UI.showLobbyWaiting({ room: m.room, isHost: true, players: [], canStart: false });
    } else if (m.type === "joined") {
      mode = "online"; isHost = false; mySeat = m.you; roomCode = m.room; roomCount = m.count; lobbyPlayers = [];
      pendingConnect = false;
      UI.setNet(m.you, true);
      UI.showLobbyWaiting({ room: m.room, isHost: false, players: [], canStart: false });
    } else if (m.type === "lobby") {
      lobbyPlayers = (m.players || []).slice().sort(function (a, b) { return a.seat - b.seat; });
      var ready = lobbyPlayers.filter(function (p) { return p.charId; }).length;
      var canStart = isHost && ready >= 2;
      UI.updateLobbyWaiting(lobbyPlayers, canStart);
    } else if (m.type === "start") {
      mode = "online"; isHost = false;
      engine = Engine.fromJSON(m.state);
      UI.setEngine(engine);
      UI.setNet(mySeat, true);
      UI.showGame();
      UI.renderAll();
      UI.setRollEnabled(false);
    } else if (m.type === "state") {
      onState(m.state);
    } else if (m.type === "action") {
      onAction(m.action);
    } else if (m.type === "player_left") {
      if (isHost && engine && engine.players[m.seat]) {
        engine.players[m.seat].isAI = true;
        engine.log(engine.players[m.seat].name + " 掉线，交由电脑接管", "sys");
        UI.renderAll();
        if (engine.current === m.seat && !engine.gameOver) runAITurn();
      }
    } else if (m.type === "host_left") {
      UI.showToast("房主已离开，对局结束");
      setTimeout(showMenu, 1600);
    } else if (m.type === "error") {
      UI.showToast(m.msg || "出错了");
    } else if (m.type === "net_close") {
      if (pendingConnect) {
        pendingConnect = false;
        UI.showToast("联机服务器连接失败：请先运行 node server.js 启动服务器");
      }
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    if (window.Net) Net.on(handleNet);
    UI.init({
      engine: null,
      afterResolve: advance,
      callbacks: { onSave: saveGame, onLoad: loadGame, onMenu: showMenu }
    });
    document.getElementById("btn-roll").addEventListener("click", humanRoll);
    document.getElementById("btn-new").addEventListener("click", showMenu);
    UI.renderSetup(startGame);
  });
})();
