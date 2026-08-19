/* net.js — 客户端联网层（WebSocket 封装 + 断线自动重连）
 * 默认连接同源 ws/wss；支持 ?ws=wss://your-host 自定义服务器地址。
 * 断线后自动按指数退避重连（1s → 2s → 4s → 最多 15s），连上后触发 net_reconnect 消息。
 */
(function () {
  "use strict";
  var ws = null;
  var handlers = [];
  var opened = false;
  var pendingOpen = null;
  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var manualClose = false;
  var RECONNECT_MAX = 15000; // 最大重连间隔 15s

  function resolveUrl() {
    try {
      var p = new URLSearchParams(location.search).get("ws");
      if (p) return p;
    } catch (e) {}
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  }

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function scheduleReconnect() {
    if (manualClose) return;
    clearReconnect();
    reconnectAttempts++;
    var delay = Math.min(RECONNECT_MAX, (1 << Math.min(reconnectAttempts - 1, 5)) * 1000 + Math.floor(Math.random() * 500));
    reconnectTimer = setTimeout(function () {
      handlers.forEach(function (h) { try { h({ type: "net_reconnecting", attempt: reconnectAttempts, delay: delay }); } catch (e) {} });
      connect(null, true);
    }, delay);
  }

  function connect(onOpen, _isReconnect) {
    manualClose = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (onOpen) {
        if (opened) onOpen();
        else pendingOpen = onOpen;
      }
      return;
    }
    ws = new WebSocket(resolveUrl());
    pendingOpen = onOpen;
    ws.onopen = function () {
      opened = true;
      reconnectAttempts = 0;
      clearReconnect();
      if (_isReconnect) {
        handlers.forEach(function (h) { try { h({ type: "net_reconnect" }); } catch (e) {} });
      }
      if (pendingOpen) { var f = pendingOpen; pendingOpen = null; f(); }
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handlers.forEach(function (h) { try { h(m); } catch (e) {} });
    };
    ws.onclose = function () {
      opened = false;
      handlers.forEach(function (h) { try { h({ type: "net_close" }); } catch (e) {} });
      scheduleReconnect();
    };
    ws.onerror = function () {
      // onerror 之后通常会紧跟着 onclose，我们在 onclose 里统一处理
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); return true; }
      catch (e) { return false; }
    }
    return false;
  }

  function on(fn) { handlers.push(fn); }

  function close() {
    manualClose = true;
    clearReconnect();
    if (ws) { try { ws.close(); } catch (e) {} }
    ws = null;
    opened = false;
  }

  window.Net = {
    connect: connect,
    send: send,
    on: on,
    close: close,
    isOpen: function () { return opened; }
  };
})();
