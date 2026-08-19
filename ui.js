/* ui.js — DOM 渲染与交互（设置菜单 / 棋盘 / 侧栏 / 弹窗 / 存档）
 * 纯展示 + 把玩家操作转交给 engine；回合推进由 main.js 的控制器负责。 */
(function () {
  "use strict";
  var boardEl, playersEl, logEl, modalRoot, rollBtn, roundInfo;
  var gameScreen, setupScreen, saveBtn, loadBtn, menuBtn;
  var engine = null, afterResolve = null, callbacks = {};
  var root = (typeof window !== "undefined") ? window : globalThis;
  var tokensLayer = null, tokenEls = [];
  var GRID = 66, STEP_MS = 260;
  var mySeat = 0, onlineMode = false; // 联机模式下用于限制「只有当前操作者才弹决策框」

  function qs(id) { return document.getElementById(id); }

  function init(opts) {
    boardEl = qs("board");
    playersEl = qs("players");
    logEl = qs("log");
    modalRoot = qs("modal-root");
    rollBtn = qs("btn-roll");
    roundInfo = qs("round-info");
    gameScreen = qs("game-screen");
    setupScreen = qs("setup-screen");
    saveBtn = qs("btn-save");
    loadBtn = qs("btn-load");
    menuBtn = qs("btn-menu");

    engine = opts.engine;
    afterResolve = opts.afterResolve;
    callbacks = opts.callbacks || {};

    if (saveBtn) saveBtn.onclick = function () { if (callbacks.onSave) callbacks.onSave(); };
    if (loadBtn) loadBtn.onclick = function () { if (callbacks.onLoad) callbacks.onLoad(); };
    if (menuBtn) menuBtn.onclick = function () { if (callbacks.onMenu) callbacks.onMenu(); };

    renderAudioControls();
  }

  function renderAudioControls() {
    var wrap = document.querySelector(".controls");
    if (!wrap || wrap.querySelector(".audio-group")) return;
    var grp = document.createElement("div");
    grp.className = "audio-group";
    var sfxBtn = document.createElement("button");
    sfxBtn.className = "btn audio-btn";
    sfxBtn.id = "btn-audio-sfx";
    sfxBtn.title = "开关音效";
    sfxBtn.textContent = "🔊";
    sfxBtn.onclick = function () {
      if (window.Audio) {
        window.Audio.setMuted(!window.Audio.isMuted());
        updateAudioButtons();
      }
    };
    var ttsBtn = document.createElement("button");
    ttsBtn.className = "btn audio-btn";
    ttsBtn.id = "btn-audio-tts";
    ttsBtn.title = "开关配音";
    ttsBtn.textContent = "🎙️";
    ttsBtn.onclick = function () {
      if (window.Audio) {
        window.Audio.init();
        window.Audio.setTTSMuted(!window.Audio.isTTSMuted());
        updateAudioButtons();
      }
    };
    grp.appendChild(sfxBtn);
    grp.appendChild(ttsBtn);
    wrap.appendChild(grp);
    updateAudioButtons();
  }

  function updateAudioButtons() {
    if (!window.Audio || typeof window.Audio.isMuted !== "function") return;
    var sfxBtn = document.getElementById("btn-audio-sfx");
    var ttsBtn = document.getElementById("btn-audio-tts");
    if (sfxBtn) sfxBtn.textContent = window.Audio.isMuted() ? "🔇" : "🔊";
    if (ttsBtn) ttsBtn.textContent = window.Audio.isTTSMuted() ? "🚫" : "🎙️";
  }

  function setEngine(e) {
    engine = e;
    buildTokens();
  }

  function setNet(seat, online) {
    mySeat = (seat == null ? 0 : seat);
    onlineMode = !!online;
  }

  // —— 棋子常驻图层（圆形头像模式：小尺寸，不遮挡地图）——
  function buildTokens() {
    tokensLayer = document.createElement("div");
    tokensLayer.className = "tokens-layer";
    tokenEls = [];
    if (!engine) return;
    engine.players.forEach(function (p) {
      var wrap = document.createElement("div");
      wrap.className = "token-wrap";
      wrap.title = p.name;
      var tk = document.createElement("img");
      tk.className = "token";
      tk.src = p.avatar || p.walk || "";
      tk.alt = p.name;
      tk.onerror = function () { wrap.classList.add("token-fallback"); wrap.textContent = p.name.slice(0, 1); };
      wrap.appendChild(tk);
      wrap.style.borderColor = p.color;
      tokensLayer.appendChild(wrap);
      tokenEls.push(wrap);
    });
  }

  function tileCenter(t) {
    return { x: t.col * GRID + 33, y: t.row * GRID + 33 };
  }

  // 同格多枚棋子做小偏移，避免完全重叠
  function positionToken(idx, offset) {
    var p = engine.players[idx];
    var tk = tokenEls[idx];
    if (!tk) return;
    if (p.out) { tk.style.display = "none"; return; }
    tk.style.display = "";
    var c = tileCenter(engine.tiles[p.pos]);
    var dx = offset ? offset.x : 0, dy = offset ? offset.y : 0;
    tk.style.left = (c.x + dx) + "px";
    tk.style.top = (c.y + dy) + "px";
  }

  function positionTokens() {
    if (!engine) return;
    var groups = {};
    engine.players.forEach(function (p, i) {
      if (p.out) return;
      var k = p.pos;
      (groups[k] = groups[k] || []).push(i);
    });
    Object.keys(groups).forEach(function (k) {
      var arr = groups[k];
      var n = arr.length;
      arr.forEach(function (idx, j) {
        var off = { x: 0, y: 0 };
        if (n > 1) {
          var step = 13;
          off.x = (j - (n - 1) / 2) * step;
          off.y = (j % 2 === 0 ? -1 : 1) * Math.abs((j - (n - 1) / 2)) * 4;
        }
        positionToken(idx, off);
      });
    });
  }

  function ensureTokensLayer() {
    if (tokensLayer && tokensLayer.parentNode !== boardEl) boardEl.appendChild(tokensLayer);
    else if (tokensLayer) boardEl.appendChild(tokensLayer);
  }

  function moveTokenTo(idx, posId) {
    var tk = tokenEls[idx];
    if (!tk) return;
    var c = tileCenter(engine.tiles[posId]);
    tk.style.left = c.x + "px";
    tk.style.top = c.y + "px";
  }

  function bounce(idx) {
    var tk = tokenEls[idx];
    if (!tk) return;
    tk.classList.add("bounce");
    setTimeout(function () { tk.classList.remove("bounce"); }, 420);
  }

  // 逐格走动动画（带音效）；fromPos 允许指定起点（联机客机用）
  function animateMoveFrom(idx, fromPos, steps, done) {
    var p = engine.players[idx];
    var dir = p.dir;
    var tk = tokenEls[idx];
    if (tk) tk.classList.add("walking");
    for (var n = 1; n <= steps; n++) {
      (function (nn) {
        setTimeout(function () {
          moveTokenTo(idx, engine.posAfter(fromPos, dir, nn));
          if (window.Audio && typeof window.Audio.playSfx === "function") window.Audio.playSfx("step");
          if (nn === steps) { bounce(idx); }
        }, nn * STEP_MS);
      })(n);
    }
    var total = steps * STEP_MS + 80;
    setTimeout(function () {
      if (tk) tk.classList.remove("walking");
      if (typeof done === "function") done();
    }, total);
  }

  function animateMove(idx, steps, done) {
    var fromPos = engine.players[idx].pos;
    animateMoveFrom(idx, fromPos, steps, done);
  }

  function setRollEnabled(b) { if (rollBtn) rollBtn.disabled = !b; }
  function showGame() { if (setupScreen) setupScreen.classList.add("hidden"); if (gameScreen) gameScreen.classList.remove("hidden"); }
  function showSetup() { if (gameScreen) gameScreen.classList.add("hidden"); if (setupScreen) setupScreen.classList.remove("hidden"); }

  function avatarImg(src, cls) {
    var img = document.createElement("img");
    img.className = cls || "avatar";
    img.src = src || "";
    img.alt = "";
    img.onerror = function () { img.style.display = "none"; };
    return img;
  }

  function btn(label, cls, fn) {
    var b = document.createElement("button");
    b.className = "btn " + (cls || "");
    b.textContent = label;
    b.onclick = fn;
    return b;
  }
  function openModal(node) {
    modalRoot.innerHTML = "";
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.appendChild(node);
    modalRoot.appendChild(mask);
  }
  function closeModal() { modalRoot.innerHTML = ""; }

  // 选骰子点数弹窗
  function showChooseDice(onChoose) {
    var m = document.createElement("div"); m.className = "modal";
    m.innerHTML = "<h3>选点卡</h3><p>请选择下次掷骰的步数（1-6）</p>";
    var opts = document.createElement("div"); opts.className = "dice-opts";
    for (var i = 1; i <= 6; i++) {
      (function (n) {
        var d = document.createElement("div");
        d.className = "dice-opt"; d.textContent = n;
        d.onclick = function () { closeModal(); window.Game.chooseDice(n); };
        opts.appendChild(d);
      })(i);
    }
    m.appendChild(opts); openModal(m);
  }

  // —— 设置菜单 ——
  function renderSetup(onStart) {
    if (!setupScreen) return;
    setupScreen.innerHTML = "";
    var box = document.createElement("div");
    box.className = "setup-box";

    var title = document.createElement("h2");
    title.textContent = "选择角色与模式";
    box.appendChild(title);

    var onlineBtn = document.createElement("button");
    onlineBtn.className = "btn btn-primary lobby-online-btn";
    onlineBtn.textContent = "🌐 在线对战（联机多人）";
    onlineBtn.onclick = function () { if (window.UI) window.UI.showLobby(); };
    box.appendChild(onlineBtn);

    var modeRow = document.createElement("div");
    modeRow.className = "setup-row";
    modeRow.innerHTML = '<label>玩家数</label>';
    var selCount = document.createElement("select");
    selCount.id = "setup-count";
    [2, 3, 4].forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n + " 人";
      if (n === 3) o.selected = true;
      selCount.appendChild(o);
    });
    modeRow.appendChild(selCount);
    box.appendChild(modeRow);

    var humanRow = document.createElement("div");
    humanRow.className = "setup-row";
    humanRow.innerHTML = '<label>人类玩家数</label>';
    var selHuman = document.createElement("select");
    selHuman.id = "setup-human";
    [1, 2, 3, 4].forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n + " 人";
      if (n === 1) o.selected = true;
      selHuman.appendChild(o);
    });
    humanRow.appendChild(selHuman);
    box.appendChild(humanRow);

    var slots = document.createElement("div");
    slots.id = "setup-slots";
    slots.className = "setup-slots";
    box.appendChild(slots);

    function refreshSlots() {
      var count = parseInt(selCount.value, 10);
      var human = parseInt(selHuman.value, 10);
      slots.innerHTML = "";
      for (var i = 0; i < count; i++) {
        var slot = document.createElement("div");
        slot.className = "setup-slot";
        var isHuman = i < human;
        var head = document.createElement("div");
        head.className = "slot-head";
        head.innerHTML = '<span>玩家 ' + (i + 1) + '</span><span class="slot-type">' + (isHuman ? "人类" : "电脑") + '</span>';
        slot.appendChild(head);

        var charSel = document.createElement("div");
        charSel.className = "char-list";
        root.CHARACTERS.forEach(function (ch, ci) {
          var card = document.createElement("div");
          card.className = "char-card" + (ci === i % root.CHARACTERS.length ? " selected" : "");
          card.dataset.idx = i;
          card.dataset.char = ch.id;
          card.appendChild(avatarImg(ch.avatar, "char-avatar"));
          var nm = document.createElement("div");
          nm.className = "char-name"; nm.textContent = ch.name;
          card.appendChild(nm);
          var tt = document.createElement("div");
          tt.className = "char-title"; tt.textContent = ch.title;
          card.appendChild(tt);
          card.onclick = function () {
            if (this.classList.contains("selected")) {
              this.classList.remove("selected");
            } else {
              var list = charSel.querySelectorAll(".char-card");
              list.forEach(function (c) { c.classList.remove("selected"); });
              this.classList.add("selected");
            }
          };
          charSel.appendChild(card);
        });
        slot.appendChild(charSel);

        var nameRow = document.createElement("div");
        nameRow.className = "name-row";
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "name-input";
        inp.value = isHuman ? (i === 0 ? "你" : "玩家" + (i + 1)) : "电脑·" + root.CHARACTERS[i % root.CHARACTERS.length].name;
        nameRow.appendChild(inp);
        slot.appendChild(nameRow);
        slots.appendChild(slot);
      }
    }
    refreshSlots();
    selCount.onchange = refreshSlots;
    selHuman.onchange = refreshSlots;

    var actions = document.createElement("div");
    actions.className = "setup-actions";
    actions.appendChild(btn("开始游戏", "btn-primary", function () {
      var defs = collectSetup();
      if (defs) onStart(defs);
    }));
    if (callbacks.onLoad) {
      actions.appendChild(btn("读取存档", "", function () { callbacks.onLoad(); }));
    }
    box.appendChild(actions);

    setupScreen.appendChild(box);
    showSetup();
  }

  function collectSetup() {
    var count = parseInt(qs("setup-count").value, 10);
    var human = parseInt(qs("setup-human").value, 10);
    var slots = document.querySelectorAll(".setup-slot");
    var usedChars = {};
    var picks = [];

    for (var i = 0; i < count; i++) {
      var slot = slots[i];
      var selected = slot.querySelector(".char-card.selected");
      var charId = selected ? selected.dataset.char : null;
      if (charId) {
        if (usedChars[charId]) { alert("每个角色只能被一名玩家选择"); return null; }
        usedChars[charId] = true;
      }
      picks.push({ slot: slot, charId: charId });
    }

    for (var j = 0; j < picks.length; j++) {
      if (picks[j].charId) continue;
      var fallback = null;
      for (var k = 0; k < root.CHARACTERS.length; k++) {
        var cid = root.CHARACTERS[k].id;
        if (!usedChars[cid]) { fallback = cid; break; }
      }
      if (!fallback) { alert("角色数量不足，请减少玩家数"); return null; }
      usedChars[fallback] = true;
      picks[j].charId = fallback;
      var card = picks[j].slot.querySelector('.char-card[data-char="' + fallback + '"]');
      if (card) card.classList.add("selected");
    }

    var defs = [];
    for (var idx = 0; idx < picks.length; idx++) {
      var ch = root.CHARACTERS.filter(function (c) { return c.id === picks[idx].charId; })[0];
      var name = picks[idx].slot.querySelector(".name-input").value.trim() || ch.name;
      defs.push({ name: name, isAI: idx >= human, color: ch.color, avatar: ch.avatar, charId: ch.id });
    }
    return defs;
  }

  // —— 联机大厅 ——
  var lobbyState = null; // 缓存等待视图引用

  function charPicker(defaultId, onPick) {
    var box = document.createElement("div");
    box.className = "char-list lobby-chars";
    var sel = defaultId || null;
    root.CHARACTERS.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "char-card" + (ch.id === sel ? " selected" : "");
      card.dataset.char = ch.id;
      card.appendChild(avatarImg(ch.avatar, "char-avatar"));
      var nm = document.createElement("div"); nm.className = "char-name"; nm.textContent = ch.name; card.appendChild(nm);
      var tt = document.createElement("div"); tt.className = "char-title"; tt.textContent = ch.title; card.appendChild(tt);
      card.onclick = function () {
        box.querySelectorAll(".char-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        sel = ch.id;
        if (onPick) onPick(ch.id);
      };
      box.appendChild(card);
    });
    box.getSelected = function () { return sel; };
    return box;
  }

  function buildCreateView() {
    var wrap = document.createElement("div"); wrap.className = "lobby-form";
    var row = document.createElement("div"); row.className = "setup-row";
    row.innerHTML = '<label>玩家数</label>';
    var sel = document.createElement("select");
    [2, 3, 4].forEach(function (n) {
      var o = document.createElement("option"); o.value = n; o.textContent = n + " 人"; if (n === 2) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel); wrap.appendChild(row);

    var nameRow = document.createElement("div"); nameRow.className = "name-row";
    var name = document.createElement("input"); name.type = "text"; name.className = "name-input"; name.value = "房主";
    nameRow.appendChild(name); wrap.appendChild(nameRow);

    var pick = charPicker(root.CHARACTERS[0].id);
    wrap.appendChild(pick);

    var act = document.createElement("div"); act.className = "setup-actions";
    act.appendChild(btn("创建房间", "btn-primary", function () {
      if (!window.__lobbyCreate) return;
      var cid = pick.getSelected();
      if (!cid) { showToast("请选择一个角色"); return; }
      showToast("正在创建房间…");
      window.__lobbyCreate(parseInt(sel.value, 10), name.value.trim() || "房主", cid);
    }));
    wrap.appendChild(act);
    return wrap;
  }

  function buildJoinView(presetRoom) {
    var wrap = document.createElement("div"); wrap.className = "lobby-form";
    var row = document.createElement("div"); row.className = "setup-row";
    row.innerHTML = '<label>房间号</label>';
    var inp = document.createElement("input"); inp.type = "text"; inp.className = "name-input"; inp.value = presetRoom || ""; inp.placeholder = "如 ABC12";
    inp.style.textTransform = "uppercase";
    row.appendChild(inp); wrap.appendChild(row);

    var nameRow = document.createElement("div"); nameRow.className = "name-row";
    var name = document.createElement("input"); name.type = "text"; name.className = "name-input"; name.value = "玩家";
    nameRow.appendChild(name); wrap.appendChild(nameRow);

    var pick = charPicker(root.CHARACTERS[1 % root.CHARACTERS.length].id);
    wrap.appendChild(pick);

    var act = document.createElement("div"); act.className = "setup-actions";
    act.appendChild(btn("加入房间", "btn-primary", function () {
      if (!window.__lobbyJoin) return;
      var code = (inp.value || "").trim().toUpperCase();
      var cid = pick.getSelected();
      if (!code) { showToast("请输入房间号"); return; }
      if (!cid) { showToast("请选择一个角色"); return; }
      showToast("正在加入房间…");
      window.__lobbyJoin(code, name.value.trim() || "玩家", cid);
    }));
    wrap.appendChild(act);
    return wrap;
  }

  function showLobby() {
    if (!setupScreen) return;
    setupScreen.innerHTML = "";
    var box = document.createElement("div"); box.className = "setup-box lobby-box";
    var title = document.createElement("h2"); title.textContent = "🌐 在线对战"; box.appendChild(title);
    var sub = document.createElement("p"); sub.className = "lobby-sub";
    sub.textContent = "创建房间后把链接发给好友，大家选好角色就能一起开局。";
    box.appendChild(sub);

    var urlRoom = "";
    try { urlRoom = new URLSearchParams(location.search).get("room"); } catch (e) {}

    if (urlRoom) {
      box.appendChild(buildJoinView(urlRoom));
    } else {
      var tabs = document.createElement("div"); tabs.className = "lobby-tabs";
      var tabCreate = document.createElement("button"); tabCreate.className = "btn tab active"; tabCreate.textContent = "创建房间";
      var tabJoin = document.createElement("button"); tabJoin.className = "btn tab"; tabJoin.textContent = "加入房间";
      tabs.appendChild(tabCreate); tabs.appendChild(tabJoin);
      box.appendChild(tabs);
      var panel = document.createElement("div"); panel.className = "lobby-panel"; box.appendChild(panel);
      function showCreate() { panel.innerHTML = ""; panel.appendChild(buildCreateView()); tabCreate.classList.add("active"); tabJoin.classList.remove("active"); }
      function showJoin() { panel.innerHTML = ""; panel.appendChild(buildJoinView("")); tabJoin.classList.add("active"); tabCreate.classList.remove("active"); }
      tabCreate.onclick = showCreate; tabJoin.onclick = showJoin;
      showCreate();
    }

    var back = btn("返回（本地单人/多人）", "", function () { if (window.__lobbyBack) window.__lobbyBack(); });
    back.className = "btn lobby-back";
    box.appendChild(back);
    setupScreen.appendChild(box);
    showSetup();
  }

  function showLobbyWaiting(opts) {
    if (!setupScreen) return;
    lobbyState = opts;
    setupScreen.innerHTML = "";
    var box = document.createElement("div"); box.className = "setup-box lobby-box";
    var title = document.createElement("h2");
    title.textContent = opts.isHost ? "房间已创建 · 等待好友加入" : "已加入房间 · 等待房主开始";
    box.appendChild(title);

    var linkRow = document.createElement("div"); linkRow.className = "lobby-link";
    var shareUrl = location.origin + location.pathname + "?room=" + opts.room;
    var linkInput = document.createElement("input"); linkInput.type = "text"; linkInput.readOnly = true; linkInput.value = shareUrl;
    linkInput.className = "name-input";
    var copyBtn = btn("复制邀请链接", "btn-primary", function () {
      try { linkInput.select(); document.execCommand("copy"); } catch (e) {}
      if (navigator.clipboard) navigator.clipboard.writeText(shareUrl).catch(function () {});
      showToast("链接已复制，去发给好友吧");
    });
    linkRow.appendChild(linkInput); linkRow.appendChild(copyBtn);
    box.appendChild(linkRow);

    var codeTip = document.createElement("p"); codeTip.className = "lobby-sub";
    codeTip.innerHTML = "房间号：<b>" + opts.room + "</b>　（好友也可在主页点「加入房间」输入此号）";
    box.appendChild(codeTip);

    var list = document.createElement("div"); list.className = "lobby-players"; list.id = "lobby-players";
    box.appendChild(list);

    var act = document.createElement("div"); act.className = "setup-actions";
    if (opts.isHost) {
      var startBtn = btn("开始游戏", "btn-primary", function () { if (window.__lobbyStart) window.__lobbyStart(); });
      startBtn.id = "lobby-start";
      act.appendChild(startBtn);
    } else {
      var wait = document.createElement("div"); wait.className = "lobby-waiting"; wait.textContent = "等待房主开始游戏…";
      act.appendChild(wait);
    }
    box.appendChild(act);

    var back = btn("离开房间", "", function () { if (window.__lobbyBack) window.__lobbyBack(); });
    back.className = "btn lobby-back";
    box.appendChild(back);

    setupScreen.appendChild(box);
    showSetup();
    updateLobbyWaiting(opts.players || [], false);
  }

  function updateLobbyWaiting(players, canStart) {
    var list = document.getElementById("lobby-players");
    if (list) {
      list.innerHTML = "";
      players.forEach(function (p) {
        var row = document.createElement("div"); row.className = "lobby-player" + (p.isHost ? " host" : "");
        row.innerHTML = '<img class="dot" src="' + (charAvatarSrc(p.charId)) + '"><span class="p-name">' +
          (p.name || "玩家") + (p.isHost ? "（房主）" : "") + "</span><span class='p-seat'>座位 " + (p.seat + 1) + "</span>";
        list.appendChild(row);
      });
    }
    var sb = document.getElementById("lobby-start");
    if (sb) sb.disabled = !canStart;
  }

  function charAvatarSrc(charId) {
    var ch = (root.CHARACTERS || []).filter(function (c) { return c.id === charId; })[0];
    return ch ? ch.avatar : "";
  }

  function showToast(msg) {
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 300); }, 1600);
  }

  function housesHTML(level) {
    if (level <= 0) return "";
    var h = "";
    for (var i = 0; i < level; i++) h += "🏠";
    return '<div class="t-houses">' + h + "</div>";
  }

  // —— 棋盘渲染 ——
  function renderBoard() {
    boardEl.innerHTML = "";
    var bg = document.createElement("div");
    bg.className = "board-bg";
    if (root.MAP_THEME.background) bg.style.backgroundImage = "url(" + root.MAP_THEME.background + ")";
    boardEl.appendChild(bg);

    root.MAP_THEME.regions.forEach(function (r) {
      var reg = document.createElement("div");
      reg.className = "board-region";
      var minC = 99, minR = 99, maxC = -1, maxR = -1;
      for (var i = r.start; i <= r.end; i++) {
        var t = engine.tiles[i];
        if (!t) continue;
        minC = Math.min(minC, t.col); maxC = Math.max(maxC, t.col);
        minR = Math.min(minR, t.row); maxR = Math.max(maxR, t.row);
      }
      reg.style.left = (minC * GRID - 6) + "px";
      reg.style.top = (minR * GRID - 6) + "px";
      reg.style.width = ((maxC - minC + 1) * GRID + 10) + "px";
      reg.style.height = ((maxR - minR + 1) * GRID + 10) + "px";
      reg.style.background = r.tint;
      var label = document.createElement("span");
      label.className = "region-label";
      label.textContent = r.name;
      reg.appendChild(label);
      boardEl.appendChild(reg);
    });

    engine.tiles.forEach(function (t) {
      var d = document.createElement("div");
      d.className = "tile t-" + (t.type === "LAND" ? "land" : t.type);
      d.style.left = (t.col * GRID + 3) + "px";
      d.style.top = (t.row * GRID + 3) + "px";
      if (t.type === "LAND") {
        var g = engine.config.groups[t.group];
        var owned = t.owner !== null;
        d.innerHTML =
          '<div class="t-bar" style="background:' + g.color + '"></div>' +
          '<div class="t-icon">🏝️</div>' +
          '<div class="t-name">' + t.name + "</div>" +
          (owned
            ? '<div class="t-owner"><img class="tiny-avatar" src="' + engine.players[t.owner].avatar + '">' + engine.players[t.owner].name + "</div>" +
              housesHTML(t.level)
            : '<div class="t-buy">★ 可买 ' + t.price + "</div>");
      } else if (t.type === "START") {
        d.innerHTML = '<div class="t-icon">🏁</div><div class="t-name">起点</div><div class="t-info">发薪+' + engine.config.goSalary + "</div>";
      } else if (t.type === "CARD") {
        d.innerHTML = '<div class="t-icon">📰</div><div class="t-name">新闻</div><div class="t-info">抽卡片</div>';
      } else if (t.type === "EVENT") {
        d.innerHTML = '<div class="t-icon">⚡</div><div class="t-name">命运</div><div class="t-info">随机事件</div>';
      } else if (t.type === "GAME") {
        d.innerHTML = '<div class="t-icon">🎮</div><div class="t-name">小游戏</div><div class="t-info">赢奖金</div>';
      } else if (t.type === "HOSPITAL") {
        d.innerHTML = '<div class="t-icon">🏥</div><div class="t-name">医院</div><div class="t-info">住院3回合</div>';
      } else if (t.type === "JAIL") {
        d.innerHTML = '<div class="t-icon">🚔</div><div class="t-name">监狱</div><div class="t-info">入狱3回合</div>';
      } else if (t.type === "SHOP") {
        d.innerHTML = '<div class="t-icon">🛒</div><div class="t-name">卡片店</div><div class="t-info">买卡片</div>';
      }
      if (!engine.players[engine.current].out && t.id === engine.players[engine.current].pos) d.classList.add("is-current");
      boardEl.appendChild(d);
    });

    ensureTokensLayer();
    positionTokens();
  }

  function renderPanel() {
    playersEl.innerHTML = "";
    var counts = {};
    engine.tiles.forEach(function (t) { if (t.owner !== null) counts[t.owner] = (counts[t.owner] || 0) + 1; });
    engine.players.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "player-row" + (p.idx === engine.current ? " active" : "") + (p.out ? " out" : "");
      var status = [];
      if (p.immunity) status.push("免罪");
      if (p.hospital > 0) status.push("住院" + p.hospital + "回合");
      if (p.jail > 0) status.push("入狱" + p.jail + "回合");
      if (p.discount > 0) status.push("减免" + p.discount + "回合");
      if (p.chooseDice) status.push("选点");
      var statusTxt = status.length ? " · " + status.join(" · ") : "";
      row.innerHTML =
        '<img class="dot" src="' + (p.avatar || "") + '">' +
        '<span class="p-name">' + p.name + "</span>" +
        '<span class="p-cash">¥' + p.cash + "</span>" +
        '<div style="width:100%"></div>' +
        '<span class="p-meta">地产' + (counts[p.idx] || 0) + " · 净资产" + engine.netWorth(p) + statusTxt + "</span>";
      playersEl.appendChild(row);
    });
  }

  function renderLog() {
    logEl.innerHTML = "";
    var lines = engine.logLines.slice(-40);
    lines.forEach(function (l) {
      var d = document.createElement("div");
      if (l.kind === "turn") d.className = "l-turn";
      else if (l.kind === "sys") d.className = "l-sys";
      d.textContent = "[" + l.t + "] " + l.msg;
      logEl.appendChild(d);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderRound() { roundInfo.textContent = "第 " + engine.round + " 回合"; }
  function renderAll() { renderBoard(); renderPanel(); renderLog(); renderRound(); }

  function candidateTiles(p, card) {
    var eff = card.effect;
    if (eff === "goudika" || eff === "mianfei") return engine.tiles.filter(function (t) { return t.type === "LAND" && t.owner === null; });
    if (eff === "gaikaka" || eff === "tianshi") return engine.tiles.filter(function (t) { return t.owner === p.idx && t.level < engine.config.maxLevel; });
    return engine.tiles.filter(function (t) { return t.type === "LAND" && t.owner !== null && t.owner !== p.idx; });
  }

  function showPhaseModal() {
    if (onlineMode && engine.current !== mySeat) return; // 联机：只有轮到的玩家才弹决策框
    var p = engine.players[engine.current];
    if (engine.phase === "awaitBuy") {
      var t = engine.tiles[p.pos];
      var m = document.createElement("div"); m.className = "modal";
      m.innerHTML = "<h3>买地</h3><p>" + t.name + " · 价格 " + t.price + " · 你当前现金 " + p.cash + "</p>";
      var act = document.createElement("div"); act.className = "actions";
      act.appendChild(btn("买下", "btn-primary", function () { window.Game.buy(); }));
      act.appendChild(btn("跳过", "btn", function () { window.Game.passBuy(); }));
      m.appendChild(act); openModal(m);
    } else if (engine.phase === "awaitBuild") {
      var t2 = engine.tiles[p.pos];
      var m2 = document.createElement("div"); m2.className = "modal";
      m2.innerHTML = "<h3>盖房子</h3><p>" + t2.name + " · 当前 " + t2.level + " 层 · 建造费 " + t2.buildCost + " · 你现金 " + p.cash + "</p>";
      var act2 = document.createElement("div"); act2.className = "actions";
      act2.appendChild(btn("盖房子", "btn-primary", function () { window.Game.build(); }));
      act2.appendChild(btn("跳过", "btn", function () { window.Game.passBuild(); }));
      m2.appendChild(act2); openModal(m2);
    } else if (engine.phase === "awaitShop") {
      var m3 = document.createElement("div"); m3.className = "modal";
      m3.innerHTML = "<h3>卡片商店</h3><p>选择一张卡片购买</p>";
      var opts = document.createElement("div"); opts.className = "opts";
      engine.shopCards().forEach(function (it) {
        var card = engine.cardById(it.id);
        var row = document.createElement("div"); row.className = "opt";
        row.innerHTML = '<span class="sw">🎫</span>' + (card ? card.name : it.id) + " · " + card.desc + " · 价格 " + it.price;
        row.onclick = function () {
          if (p.cash < it.price) { showToast("现金不足"); return; }
          window.Game.buyShop(it.id);
        };
        opts.appendChild(row);
      });
      var skipShop = document.createElement("div"); skipShop.className = "opt";
      skipShop.innerHTML = '<span class="sw" style="background:#eee"></span>离开商店';
      skipShop.onclick = function () { window.Game.passShop(); };
      opts.appendChild(skipShop);
      m3.appendChild(opts); openModal(m3);
    } else if (engine.phase === "awaitTarget") {
      var card = engine.pending.card;
      var m4 = document.createElement("div"); m4.className = "modal";
      m4.innerHTML = "<h3>" + card.name + "</h3><p>" + card.desc + " · 选择目标</p>";
      var opts4 = document.createElement("div"); opts4.className = "opts";
      if (card.target === "opponent") {
        engine.players.forEach(function (o) {
          if (o.idx !== p.idx && !o.out) {
            var row = document.createElement("div"); row.className = "opt";
            row.innerHTML = '<img class="sw" src="' + o.avatar + '">' + o.name + "（净资产 " + engine.netWorth(o) + "）";
            row.onclick = function () { window.Game.chooseTarget({ playerIdx: o.idx }); };
            opts4.appendChild(row);
          }
        });
      } else if (card.target === "self") {
        if (card.effect === "xuandian") {
          for (var n = 1; n <= 6; n++) {
            (function (nn) {
              var row = document.createElement("div"); row.className = "opt";
              row.innerHTML = '<span class="sw">🎲</span>走 ' + nn + " 步";
              row.onclick = function () { window.Game.chooseTarget({ choice: nn }); };
              opts4.appendChild(row);
            })(n);
          }
        } else {
          var row = document.createElement("div"); row.className = "opt";
          row.innerHTML = '<span class="sw">✓</span>对自己使用';
          row.onclick = function () { window.Game.chooseTarget({}); };
          opts4.appendChild(row);
        }
      } else {
        var tiles = candidateTiles(p, card);
        tiles.forEach(function (t) {
          var row = document.createElement("div"); row.className = "opt";
          var info = (t.owner !== null) ? ("业主 " + engine.players[t.owner].name + " · " + t.level + "层") : "未售";
          var col = (t.type === "LAND" && t.group != null) ? engine.config.groups[t.group].color : "#999";
          row.innerHTML = '<span class="sw" style="background:' + col + '"></span>' + t.name + " · " + info;
          row.onclick = function () { window.Game.chooseTarget({ tileId: t.id }); };
          opts4.appendChild(row);
        });
      }
      // 所有目标卡都允许取消，避免卡死
      var cancelOpt = document.createElement("div"); cancelOpt.className = "opt";
      cancelOpt.innerHTML = '<span class="sw" style="background:#ddd"></span>取消使用（卡片失效）';
      cancelOpt.onclick = function () { window.Game.cancelCard(); };
      opts4.appendChild(cancelOpt);
      m4.appendChild(opts4); openModal(m4);
    }
  }

  function showWin() {
    var sorted = engine.players.slice().sort(function (a, b) { return engine.netWorth(b) - engine.netWorth(a); });
    var m = document.createElement("div"); m.className = "modal";
    var winnerName = engine.winner != null ? engine.players[engine.winner].name : "无";
    m.innerHTML = "<h3>游戏结束</h3><p>冠军：" + winnerName + "</p><ol class='win-list'></ol>";
    var ol = m.querySelector(".win-list");
    sorted.forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = p.name + " · 净资产 " + engine.netWorth(p) + (p.out ? "（已破产）" : "");
      ol.appendChild(li);
    });
    var act = document.createElement("div"); act.className = "actions";
    act.appendChild(btn("再来一局", "btn-primary", function () { closeModal(); if (typeof window.__newGame === "function") window.__newGame(); }));
    act.appendChild(btn("返回菜单", "", function () { closeModal(); if (callbacks.onMenu) callbacks.onMenu(); }));
    m.appendChild(act); openModal(m);
  }

  window.UI = {
    init: init, setEngine: setEngine, setRollEnabled: setRollEnabled,
    renderAll: renderAll, showPhaseModal: showPhaseModal, showWin: showWin,
    renderSetup: renderSetup, showGame: showGame, showSetup: showSetup, showToast: showToast,
    collectSetup: collectSetup, closeModal: closeModal, animateMove: animateMove,
    animateMoveFrom: animateMoveFrom, showChooseDice: showChooseDice, setNet: setNet, showLobby: showLobby,
    showLobbyWaiting: showLobbyWaiting, updateLobbyWaiting: updateLobbyWaiting
  };
})();
