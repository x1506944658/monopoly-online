/* config.js — 全局配置 / 角色 / 棋盘生成 / 卡片定义 / 地图主题
 * 纯数据 + 生成函数，不依赖 DOM，可被 node 沙箱直接加载做冒烟测试。 */
(function () {
  "use strict";

  var CONFIG = {
    boardSize: 8,          // 8x8 网格 -> 周长 28 格
    startCash: 3500,       // 初始资金（提升，避免太快破产）
    maxRounds: 40,         // 自定义规则：最大回合数
    goSalary: 400,         // 经过起点发薪
    diceCount: 1,          // MVP 单骰（交通道具后续扩展为多骰）
    maxLevel: 5,           // 地块最高 5 层
    rentRate: 0.10,        // 基础租金 = 地价 * rentRate
    buildRate: 0.45,       // 建造费 = 地价 * buildRate
    basePrice: 280,
    priceStep: 100,
    // 4 个颜色分组（乐园糖果色系）
    groups: [
      { id: 0, name: "草莓区", color: "#ff6b7a" },
      { id: 1, name: "薄荷区", color: "#4ecdc4" },
      { id: 2, name: "柠檬区", color: "#ffe066" },
      { id: 3, name: "蓝莓区", color: "#6c5ce7" }
    ]
  };

  // 可选角色（6 张 3D Q版头像）
  var CHARACTERS = [
    { id: "sailor",    name: "糖心喵",    color: "#ff8fa3", avatar: "assets/avatar-3d-sailor.png",    walk: "assets/avatar-3d-walk-sailor.png",    title: "水手服甜心" },
    { id: "ninja",     name: "暗影丸",    color: "#5d4e75", avatar: "assets/avatar-3d-ninja.png",     walk: "assets/avatar-3d-walk-ninja.png",     title: "忍者武士" },
    { id: "princess",  name: "蔷薇公主",  color: "#f2a2c5", avatar: "assets/avatar-3d-princess.png",  walk: "assets/avatar-3d-walk-princess.png",  title: "童话公主" },
    { id: "arab",      name: "沙漠大亨",  color: "#e4a23a", avatar: "assets/avatar-3d-arab.png",      walk: "assets/avatar-3d-walk-arab.png",      title: "石油贵族" },
    { id: "farmer",    name: "麦田君",    color: "#8c6f4a", avatar: "assets/avatar-3d-farmer.png",    walk: "assets/avatar-3d-walk-farmer.png",    title: "勤恳农夫" },
    { id: "queen",     name: "紫晶女王",  color: "#9a6fd6", avatar: "assets/avatar-3d-queen.png",     walk: "assets/avatar-3d-walk-queen.png",     title: "宝石女王" }
  ];

  // 地图主题分区：给 28 格环形路径按段命名，渲染时作为背景标签
  var MAP_THEME = {
    name: "童话乐园",
    background: "assets/map-paradise.png",
    regions: [
      { name: "旋转木马广场", start: 0,  end: 6,  tint: "rgba(255,200,210,0.18)" },
      { name: "糖果集市",     start: 7,  end: 13, tint: "rgba(150,240,230,0.18)" },
      { name: "森林过山车",   start: 14, end: 20, tint: "rgba(180,255,180,0.18)" },
      { name: "彩虹码头",     start: 21, end: 27, tint: "rgba(200,190,255,0.18)" }
    ]
  };

  // 卡片定义（扩展到大富翁4 常见趣味卡）
  // target: none | opponent | tile | self
  //   opponent -> 需要选一名对手
  //   tile     -> 需要选一块地
  //   self     -> 仅对自己生效，但需要用户确认/选择（如选骰子点数）
  var CARD_DEFS = [
    { id: "junfu",      name: "均富卡", effect: "junfu",      target: "none",     desc: "全体玩家现金平分" },
    { id: "goudika",    name: "购地卡", effect: "goudika",    target: "tile",     desc: "强制收购所在/指定空地" },
    { id: "mianfei",    name: "免费卡", effect: "mianfei",    target: "tile",     desc: "免费获得所在/指定空地" },
    { id: "gaikaka",    name: "改建卡", effect: "gaikaka",    target: "tile",     desc: "指定土地升一级" },
    { id: "chaichuka",  name: "拆除卡", effect: "chaichuka",  target: "opponent", desc: "对手某地块降一级" },
    { id: "tingliuka",  name: "停留卡", effect: "tingliuka",  target: "opponent", desc: "对手原地停留一回合" },
    { id: "wuguika",    name: "乌龟卡", effect: "wuguika",    target: "opponent", desc: "对手每回合只走1步(3回合)" },
    { id: "qiangduanka",name: "抢夺卡", effect: "qiangduanka",target: "opponent", desc: "抢夺对手 500 现金" },
    { id: "mianzui",    name: "免罪卡", effect: "mianzui",    target: "none",     desc: "抵消一次负面效果" },
    { id: "zhangjia",   name: "涨价卡", effect: "zhangjia",   target: "tile",     desc: "指定路段过路费加倍(5回合)" },
    { id: "fengcha",    name: "查封卡", effect: "fengcha",    target: "tile",     desc: "指定路段无法收租(5回合)" },
    { id: "zhuanxiang", name: "转向卡", effect: "zhuanxiang", target: "none",     desc: "反转自身行进方向" },
    { id: "tianshi",    name: "天使卡", effect: "tianshi",    target: "tile",     desc: "指定路段建筑升一级" },
    { id: "emo",        name: "恶魔卡", effect: "emo",        target: "tile",     desc: "指定路段建筑夷为平地" },
    { id: "jiahuo",     name: "嫁祸卡", effect: "jiahuo",     target: "opponent", desc: "让指定对手替你承担下一次费用" },
    { id: "paimai",     name: "拍卖卡", effect: "paimai",     target: "tile",     desc: "强制拍卖指定地块" },
    { id: "huhuan",     name: "互换卡", effect: "huhuan",     target: "opponent", desc: "与指定对手交换当前位置" },
    { id: "xuandian",   name: "选点卡", effect: "xuandian",   target: "self",     desc: "下次掷骰可自选点数" },
    { id: "jianmian",   name: "减免卡", effect: "jianmian",   target: "self",     desc: "3回合内踩到别人地减免50%过路费" }
  ];

  // 生成 8x8 网格的环形路径坐标 [col,row]
  function buildPath(N) {
    var path = [];
    for (var c = 0; c < N; c++) path.push([c, 0]);            // 上边 左->右
    for (var r = 1; r < N; r++) path.push([N - 1, r]);        // 右边 上->下
    for (var c2 = N - 2; c2 >= 0; c2--) path.push([c2, N - 1]); // 下边 右->左
    for (var r2 = N - 2; r2 >= 1; r2--) path.push([0, r2]);   // 左边 下->上
    return path;
  }

  // 由路径生成地块对象数组
  function buildTiles() {
    var N = CONFIG.boardSize;
    var path = buildPath(N);
    var landCounter = 0;
    var tiles = path.map(function (pos, i) {
      var t = { id: i, col: pos[0], row: pos[1], type: "LAND" };
      if (i === 0) { t.type = "START"; return t; }
      // 特殊格分布
      if (i === 9)  { t.type = "SHOP";    return t; }  // 卡片商店
      if (i === 14) { t.type = "HOSPITAL"; return t; } // 医院
      if (i === 23) { t.type = "JAIL";     return t; } // 监狱
      var m = i % 9;
      if (m === 3) t.type = "CARD";
      else if (m === 5) t.type = "EVENT";
      else if (m === 7) t.type = "GAME";
      if (t.type === "LAND") {
        var g = landCounter % CONFIG.groups.length;
        var price = CONFIG.basePrice + g * CONFIG.priceStep + (landCounter % 4) * 30;
        t.group = g;
        t.name = CONFIG.groups[g].name + "·" + (landCounter + 1);
        t.price = price;
        t.baseRent = Math.round(price * CONFIG.rentRate);
        t.buildCost = Math.round(price * CONFIG.buildRate);
        t.owner = null;
        t.level = 0;
        landCounter++;
      }
      return t;
    });
    return tiles;
  }

  var root = (typeof window !== "undefined") ? window : globalThis;
  root.CONFIG = CONFIG;
  root.CARD_DEFS = CARD_DEFS;
  root.CHARACTERS = CHARACTERS;
  root.MAP_THEME = MAP_THEME;
  root.buildTiles = buildTiles;
})();
