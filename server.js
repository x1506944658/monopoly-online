/* server.js — 大富翁联机中继服务器
 * 同一端口：
 *   1) 静态文件服务（把本目录当作网页根目录）
 *   2) WebSocket 中继 + 房间管理（房主权威：游戏逻辑全部在房主浏览器里跑，服务器只转发消息）
 *
 * 协议（JSON 文本）：
 *   客户端 -> 服务器
 *     {type:'create', count, name, charId}            创建房间（创建者即房主，占 seat0）
 *     {type:'join',   room, name, charId}            加入房间（按顺序分配 seat）
 *     {type:'start',  room, state}                   房主开始：把初始局面广播给所有客机
 *     {type:'action', room, action}                 客机动作意图（只转发给房主）
 *     {type:'state',  room, state}                   房主局面快照（广播给所有客机）
 *     {type:'chat',   room, name, text}              聊天（广播）
 *   服务器 -> 客户端
 *     {type:'created', room, you, count}
 *     {type:'joined',  room, you, count}
 *     {type:'lobby',   count, started, players:[{seat,name,charId,ready,isHost}]}
 *     {type:'start',   state}                         仅客机收到
 *     {type:'state',   state}                         仅客机收到
 *     {type:'action',  action}                        仅房主收到
 *     {type:'player_left', seat}                      客机掉线（房主可转为 AI）
 *     {type:'host_left'}                              房主掉线
 *     {type:'error',   msg}
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ws = require("ws");

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.normalize(path.join(DIR, urlPath));
    if (!filePath.startsWith(DIR)) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end("error");
  }
});

const wss = new ws.Server({ server });
const rooms = Object.create(null);

function genCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms[c]);
  return c;
}

function lobbyMsg(room) {
  return {
    type: "lobby",
    count: room.count,
    started: room.started,
    players: room.players.map((p) => ({
      seat: p.seat, name: p.name, charId: p.charId, ready: !!p.ready, isHost: !!p.isHost
    }))
  };
}

function send(sock, obj) {
  if (sock && sock.readyState === ws.OPEN) sock.send(JSON.stringify(obj));
}
function broadcast(room, obj, exceptSock) {
  room.players.forEach((p) => { if (p.ws !== exceptSock) send(p.ws, obj); });
}

wss.on("connection", (sock) => {
  sock.room = null;

  sock.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.type !== "string") return;

    if (m.type === "create") {
      const code = genCode();
      const room = { code, count: Math.min(4, Math.max(2, parseInt(m.count, 10) || 2)), players: [], started: false };
      room.players.push({ seat: 0, isHost: true, name: m.name || "房主", charId: m.charId || null, ready: true, ws: sock });
      rooms[code] = room;
      sock.room = code;
      send(sock, { type: "created", room: code, you: 0, count: room.count });
      send(sock, lobbyMsg(room));
    }

    else if (m.type === "join") {
      const room = rooms[m.room];
      if (!room) { send(sock, { type: "error", msg: "房间不存在，请确认链接或房间号" }); return; }
      if (room.started) { send(sock, { type: "error", msg: "对局已开始，无法加入" }); return; }
      if (room.players.length >= room.count) { send(sock, { type: "error", msg: "房间已满" }); return; }
      const seat = room.players.length;
      room.players.push({ seat, isHost: false, name: m.name || ("玩家" + seat), charId: m.charId || null, ready: true, ws: sock });
      sock.room = m.room;
      send(sock, { type: "joined", room: m.room, you: seat, count: room.count });
      broadcast(room, lobbyMsg(room));
    }

    else if (m.type === "start") {
      const room = rooms[m.room];
      if (!room || sock !== room.players[0].ws) return; // 仅房主可开始
      room.started = true;
      broadcast(room, { type: "start", state: m.state }, room.players[0].ws);
    }

    else if (m.type === "action") {
      const room = rooms[m.room];
      if (!room) return;
      send(room.players[0].ws, { type: "action", action: m.action }); // 只转发给房主
    }

    else if (m.type === "state") {
      const room = rooms[m.room];
      if (!room) return;
      broadcast(room, { type: "state", state: m.state }, room.players[0].ws); // 广播给客机
    }

    else if (m.type === "chat") {
      const room = rooms[m.room];
      if (!room) return;
      broadcast(room, { type: "chat", from: m.name || "", text: m.text || "" });
    }
  });

  sock.on("close", () => {
    const room = sock.room && rooms[sock.room];
    if (!room) return;
    const idx = room.players.findIndex((p) => p.ws === sock);
    if (idx < 0) return;
    if (idx === 0) {
      // 房主掉线：通知客机并销毁房间
      broadcast(room, { type: "host_left" }, room.players[0].ws);
      delete rooms[room.code];
      return;
    }
    room.players.splice(idx, 1);
    if (room.started) {
      send(room.players[0].ws, { type: "player_left", seat: idx }); // 房主把该座转为 AI
    } else {
      broadcast(room, lobbyMsg(room));
    }
  });
});

server.listen(PORT, () => {
  console.log("🎲 大富翁联机服务器已启动： http://localhost:" + PORT);
  console.log("   局域网/公网分享：用本机 IP 或隧道地址替换 localhost 即可");
});
