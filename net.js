/* net.js — 客户端联网层（WebSocket 封装）
 * 默认连接同源 ws/wss；支持 ?ws=wss://your-host 自定义服务器地址（便于自行部署到任何 Node 主机）。 */
(function () {
  "use strict";
  var ws = null;
  var handlers = [];
  var opened = false;
  var pendingOpen = null;

  function resolveUrl() {
    try {
      var p = new URLSearchParams(location.search).get("ws");
      if (p) return p;
    } catch (e) {}
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  }

  function connect(onOpen) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (onOpen && opened) onOpen(); else pendingOpen = onOpen;
      return;
    }
    ws = new WebSocket(resolveUrl());
    pendingOpen = onOpen;
    ws.onopen = function () {
      opened = true;
      if (pendingOpen) { var f = pendingOpen; pendingOpen = null; f(); }
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handlers.forEach(function (h) { try { h(m); } catch (e) {} });
    };
    ws.onclose = function () {
      opened = false;
      handlers.forEach(function (h) { try { h({ type: "net_close" }); } catch (e) {} });
    };
    ws.onerror = function () {};
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function on(fn) { handlers.push(fn); }

  window.Net = { connect: connect, send: send, on: on, isOpen: function () { return opened; } };
})();
