/* audio.js — 音效 + 角色台词配音
 * 使用 Web Audio API 合成音效，使用 Web Speech API 做角色配音。
 * 静音状态保存在 localStorage；首次用户交互时初始化 AudioContext。 */
(function () {
  "use strict";

  var KEY = "monopoly_audio_muted";
  var ctx = null;
  var muted = false;
  var ttsMuted = false;
  var synth = null;
  var voices = [];

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function resume() {
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function init() {
    if (localStorage.getItem(KEY) === "1") muted = true;
    if (localStorage.getItem(KEY + "_tts") === "1") ttsMuted = true;
    ensureCtx();
    resume();
    if (window.speechSynthesis) {
      synth = window.speechSynthesis;
      voices = synth.getVoices() || [];
      if (voices.length === 0) {
        synth.onvoiceschanged = function () { voices = synth.getVoices() || []; };
      }
    }
  }

  function setMuted(m) { muted = !!m; localStorage.setItem(KEY, muted ? "1" : "0"); }
  function setTTSMuted(m) { ttsMuted = !!m; localStorage.setItem(KEY + "_tts", ttsMuted ? "1" : "0"); }
  function isMuted() { return muted; }
  function isTTSMuted() { return ttsMuted; }

  // —— 基础合成器 ——
  function now() { return ctx ? ctx.currentTime : 0; }

  function tone(freq, duration, type, when, vol, slideTo) {
    if (muted || !ctx) return;
    var t = when == null ? now() : when;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + duration + 0.05);
  }

  function chord(freqs, duration, type, when, vol) {
    freqs.forEach(function (f, i) { tone(f, duration, type, when, (vol || 0.1) * (1 - i * 0.05)); });
  }

  function noise(duration, when, vol) {
    if (muted || !ctx) return;
    var t = when == null ? now() : when;
    var b = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(); s.buffer = b;
    var g = ctx.createGain();
    var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 800;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || 0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(t); s.stop(t + duration + 0.05);
  }

  // —— 音效库 ——
  var SFX = {
    dice: function () {
      if (muted || !ctx) return;
      var t = now();
      noise(0.12, t, 0.10);
      noise(0.10, t + 0.10, 0.08);
      noise(0.10, t + 0.22, 0.06);
      tone(420, 0.08, "triangle", t + 0.08, 0.05, 180);
    },
    step: function () {
      if (muted || !ctx) return;
      var t = now();
      noise(0.04, t, 0.045);
      tone(300, 0.04, "sine", t, 0.025, 200);
    },
    buy: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(880, 0.12, "sine", t, 0.11, 1100);
      tone(1100, 0.18, "sine", t + 0.08, 0.09, 1320);
    },
    build: function () {
      if (muted || !ctx) return;
      var t = now();
      noise(0.08, t, 0.14);
      tone(520, 0.14, "square", t + 0.06, 0.06, 520);
      tone(1040, 0.12, "sine", t + 0.08, 0.08);
    },
    payRent: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(880, 0.08, "sine", t, 0.08, 660);
      tone(660, 0.10, "sine", t + 0.08, 0.06, 440);
      noise(0.05, t + 0.05, 0.05);
    },
    getRent: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(660, 0.08, "sine", t, 0.08, 880);
      tone(880, 0.10, "sine", t + 0.08, 0.08, 1100);
      tone(1100, 0.12, "sine", t + 0.16, 0.06, 1320);
    },
    good: function () {
      if (muted || !ctx) return;
      var t = now();
      chord([523, 659, 784], 0.22, "sine", t, 0.08);
      chord([659, 784, 1047], 0.28, "sine", t + 0.18, 0.08);
    },
    bad: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(300, 0.18, "sawtooth", t, 0.07, 150);
      tone(150, 0.28, "sawtooth", t + 0.18, 0.07, 80);
    },
    hospital: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(880, 0.18, "square", t, 0.07);
      tone(660, 0.18, "square", t + 0.22, 0.07);
    },
    jail: function () {
      if (muted || !ctx) return;
      var t = now();
      noise(0.18, t, 0.16);
      tone(150, 0.30, "sawtooth", t + 0.08, 0.10, 100);
    },
    card: function () {
      if (muted || !ctx) return;
      var t = now();
      chord([523, 784], 0.12, "sine", t, 0.07);
      chord([659, 988], 0.18, "sine", t + 0.12, 0.07);
    },
    shop: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(880, 0.08, "sine", t, 0.08);
      tone(1320, 0.14, "sine", t + 0.10, 0.08);
      tone(880, 0.10, "sine", t + 0.24, 0.06);
    },
    win: function () {
      if (muted || !ctx) return;
      var t = now();
      var seq = [523, 659, 784, 1047, 1319];
      seq.forEach(function (f, i) { tone(f, 0.18, "sine", t + i * 0.12, 0.10); });
      chord([1047, 1319, 1568], 0.55, "sine", t + 0.60, 0.10);
    },
    lose: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(330, 0.22, "sine", t, 0.09, 262);
      tone(262, 0.30, "sine", t + 0.24, 0.08, 196);
      tone(196, 0.45, "sine", t + 0.50, 0.07, 130);
    },
    turn: function () {
      if (muted || !ctx) return;
      var t = now();
      tone(440, 0.08, "sine", t, 0.05, 554);
    }
  };

  function playSfx(name) {
    init(); resume();
    if (SFX[name]) SFX[name]();
  }

  // —— 角色台词库（每个事件多套变体，随机抽取更有趣）——
  // 糖心喵=少女音 / 暗影丸=冷峻男声 / 蔷薇公主=优雅淑女 / 沙漠大亨=豪迈大叔 / 麦田君=朴实大叔 / 紫晶女王=御姐音
  var LINES = {
    sailor: {
      start: ["喵呜~出发啦！", "糖心出动，看我的！", "走咯走咯，快乐冒险开始！"],
      roll: ["冲呀，{n}点！", "嘿嘿，{n}步走起~", "喵，{n}点！lucky lucky！"],
      buy: ["这块地归本喵啦~", "买它买它，我的地盘！", "嘻嘻，这块地有猫味儿~"],
      build: ["盖房子咯，越来越豪华~", "再盖一层，喵呜！", "本喵的城堡又升级啦！"],
      payRent: ["呜…要交钱了…", "好贵呀，肉痛痛…", "钱包又要瘦一圈…"],
      getRent: ["谢谢惠顾喵~", "进账啦，超开心！", "嘿嘿，有人给我送钱~"],
      hospital: ["要住院休养了，呜…", "水坑太讨厌啦，养伤中…", "本喵生病了，要好好休息~"],
      jail: ["怎么会被抓啦…", "冤枉喵，我没偷东西！", "关三天，好无聊…"],
      good: ["lucky！今天运气爆棚！", "哇塞，捡到钱啦！", "好运喵喵叫~"],
      bad: ["倒霉…今天不宜出门", "呜，运气掉线了…", "坏运气，哼！"],
      win: ["我赢啦！本喵最棒！", "冠军是本喵的，耶！", "喵呜胜利~大家都输给我啦！"],
      lose: ["下次再努力，喵…", "唔，这次输啦…", "不服，再来一局！"],
      shop: ["买点什么好呢~", "卡片商店，挑花眼啦~", "给本喵来张厉害的卡！"],
      card: ["抽卡抽卡，心跳加速~", "命运卡片来咯！", "看看抽到啥好东西~"]
    },
    ninja: {
      start: ["忍者，出动。", "任务，开始。", "（隐于暗影）"],
      roll: ["{n}。", "{n}步，无声逼近。", "移动，{n}。"],
      buy: ["此地将入我手。", "据点+1。", "纳。"],
      build: ["强化据点。", "扩建，完毕。", "工事，就绪。"],
      payRent: ["…破费。", "些许损失。", "（冷）代价。"],
      getRent: ["金货，纳受。", "入账。", "（淡）收益。"],
      hospital: ["疗养，三日。", "伤愈再战。", "（闭目）休整。"],
      jail: ["中计…", "牢笼，困不住影。", "（冷笑）三日便出。"],
      good: ["天运。", "时机，恰好。", "（颔首）可。"],
      bad: ["厄运。", "时机未到。", "（静）无妨。"],
      win: ["胜，理所当然。", "任务，完成。", "（收刀）胜。"],
      lose: ["败北。", "此局，落败。", "（隐去）再会。"],
      shop: ["购入。", "物资，补充。", "（点）要这张。"],
      card: ["命运…", "翻牌。", "（凝）看。"]
    },
    princess: {
      start: ["启程吧，本公主。", "优雅地出发咯~", "今日也要玩得尽兴。"],
      roll: ["{n}点，优雅前行。", "{n}步，裙摆轻摇。", "轻轻一掷，{n}点~"],
      buy: ["这片领地，归本公主了。", "买下，作为我的花园~", "此地块，入册。"],
      build: ["再添一座城堡。", "本公主的宫殿更美了~", "加盖，金碧辉煌。"],
      payRent: ["这可不太淑女…", "罢了，付便是。", "唉，又要破费。"],
      getRent: ["感谢馈赠，亲爱的。", "进账，甚好。", "我的产业生息啦~"],
      hospital: ["需要静养三日。", "（轻叹）医院三日游。", "本公主要休息啦。"],
      jail: ["竟敢囚禁本公主？！", "（跺脚）放我出去！", "关三天？太无礼了！"],
      good: ["幸运，如约降临。", "运气，站在我这边~", "好运绵绵~"],
      bad: ["运气，稍有不佳。", "（耸肩）小挫折。", "哼，今日手气一般。"],
      win: ["本公主赢啦，优雅获胜~", "胜负已分，我胜。", "王子都要为我鼓掌~"],
      lose: ["（捂脸）这次输啦…", "王子会来救我的…", "哼，不服气！"],
      shop: ["挑选卡片吧，亲爱的。", "本公主要买最好的卡。", "这些都好精致~"],
      card: ["神秘的卡片，翻开。", "命运，交给纸牌。", "看看是什么惊喜~"]
    },
    arab: {
      start: ["走，去赚个盆满钵满！", "大亨出街，闪开闪开。", "今日，财运亨通。"],
      roll: ["{n}，好数字！", "{n}步，黄金大道。", "掷出{n}，妙哉。"],
      buy: ["买下这块地，小事。", "纳入我的石油版图！", "地皮，到手。"],
      build: ["继续投资，盖！", "我的高楼又长高啦！", "扩建，钱不是问题。"],
      payRent: ["这点钱，算什么。", "（掏钱）拿去。", "过路费？小意思。"],
      getRent: ["金币，入账！", "（大笑）又收租啦！", "我的钱生钱~"],
      hospital: ["（摆手）医疗设施不错。", "休养三日，权当度假。", "本大亨要躺平啦。"],
      jail: ["谁敢算计我？！", "（瞪眼）三日便出。", "牢饭？我吃不起这个亏！"],
      good: ["财神眷顾，哈哈！", "运气？那是我的常态！", "今日宜发财~"],
      bad: ["市场波动罢了。", "（咂嘴）小亏。", "哼，风水轮流转。"],
      win: ["大亨的胜利，毫无悬念！", "金币堆成山，我赢了！", "财富与荣耀，归我！"],
      lose: ["（捂胸）破产？不可能…", "这一局，算你狠。", "哼，下次连本带利讨回！"],
      shop: ["卡片也是资产，买！", "国库充裕，随意挑。", "给本大亨来张狠的。"],
      card: ["命运的牌，我接了。", "翻牌，看老天赏什么。", "来吧，惊喜或惊吓。"]
    },
    farmer: {
      start: ["下地干活咯，嘿咻！", "乡亲们，开整！", "新的一天，加油干！"],
      roll: ["走{n}步，踏实。", "{n}点，稳当。", "掷出{n}，迈开腿。"],
      buy: ["这块地能种庄稼，买！", "添块田，心里踏实。", "地皮到手，欢喜。"],
      build: ["搭个棚子，遮风挡雨。", "再盖一层，仓也满了。", "咱家院子又大了。"],
      payRent: ["又是一笔开销，唉。", "（摸口袋）肉疼。", "过路费，逃不掉哦。"],
      getRent: ["收成不错，嘿嘿。", "进账啦，够买种子。", "地没白养~"],
      hospital: ["（龇牙）摔伤了，歇歇。", "养伤三日，闲不住。", "农家汉也要躺两天。"],
      jail: ["冤枉啊，我没偷！", "（拍栏）放我回去种地！", "蹲三天，急死个人。"],
      good: ["老天爷赏饭吃！", "（咧嘴）走运咯！", "今年风调雨顺~"],
      bad: ["遭了灾，认了。", "（叹气）手气背。", "晦气，明年再来。"],
      win: ["丰收啦，我赢咯！", "（擦汗）总算熬出头！", "咱庄稼人也能夺冠！"],
      lose: ["颗粒无收…明年再战。", "（憨笑）输啦，不碍事。", "输了就输了，重头再来。"],
      shop: ["买张卡备着，防身。", "挑张实惠的，省钱。", "卡片摊，逛逛。"],
      card: ["抽张卡看看，啥运道。", "命运纸牌，翻翻。", "看看老天给啥。"]
    },
    queen: {
      start: ["寡人，出巡。", "本王驾到，都让开。", "哦？新的游戏，有趣。"],
      roll: ["{n}步，本王亲自走。", "{n}点，恰到好处。", "随本王前行 {n} 步。"],
      buy: ["这片疆土，纳入版图。", "此地块，归我了。", "（轻抬下巴）收下。"],
      build: ["再起一座行宫。", "本王的领土，愈发繁华。", "加盖，彰显王威。"],
      payRent: ["哼，这点过路费。", "小钱而已，拿去。", "本王，付得起。"],
      getRent: ["进贡来了，乖。", "识相，交上来。", "本王的收益，源源不断~"],
      hospital: ["传御医，本王要休养。", "（慵懒）暂停三日便好。", "小小水坑，困不住本王。"],
      jail: ["大胆！谁敢囚禁本王？", "哼，三日便三日。", "区区牢笼，困不住本王。"],
      good: ["天佑本王，理所当然。", "运气？本王本就无敌。", "（轻笑）好运缠身。"],
      bad: ["时运不济？无妨。", "小小挫折，不足挂齿。", "哼，本王记下了。"],
      win: ["朕即天下，无人能敌。", "本王的胜利，毫无悬念。", "跪下吧，输家们~"],
      lose: ["王权，暂且旁落。", "这一局，本王记下了。", "哼，下次必赢。"],
      shop: ["国库充裕，随意挑选。", "卡片？本王都要了。", "给本王来张厉害的。"],
      card: ["命运之牌，翻开吧。", "本王倒要看看。", "抽，无妨。"],
      getRent2: []
    }
  };

  // 每个角色的声线设定：pitch 高低 + rate 快慢 + 性别（用于挑选系统音色）
  // 少女音(高亮快) / 冷峻男声(低沉慢) / 优雅淑女(中高慢) / 豪迈大叔(低沉中) / 朴实大叔(中) / 御姐音(中低柔)
  var CHAR_VOICE = {
    sailor:   { pitch: 1.60, rate: 1.12, gender: "female" },
    ninja:    { pitch: 0.60, rate: 0.90, gender: "male"   },
    princess: { pitch: 1.25, rate: 0.95, gender: "female" },
    arab:     { pitch: 0.75, rate: 1.00, gender: "male"   },
    farmer:   { pitch: 0.95, rate: 1.02, gender: "male"   },
    queen:    { pitch: 0.85, rate: 0.95, gender: "female" }
  };

  // tone() 以下的音效库保持不变……

  function pickVoice(gender) {
    if (!voices.length) return null;
    var zh = voices.filter(function (x) { return x.lang.indexOf("zh") >= 0; });
    if (!zh.length) zh = voices;
    if (gender === "female") {
      var f = zh.filter(function (x) { return /female|女|xiao|yaoyao|hui|ya|ting|mei|yan|kangkang/i.test(x.name); });
      return f[0] || zh[0];
    }
    if (gender === "male") {
      var m = zh.filter(function (x) { return /male|男|yun|dasheng|kang|hui|ge|hao/i.test(x.name); });
      return m[0] || zh[0];
    }
    return zh[0];
  }

  function speak(player, event, detail) {
    init(); resume();
    if (ttsMuted || !synth) return;
    var lines = LINES[player.charId] || LINES.sailor;
    var arr = lines[event];
    if (!arr || !arr.length) return;
    var tpl = Array.isArray(arr) ? arr[Math.floor(Math.random() * arr.length)] : arr;
    var text = tpl.replace("{n}", detail == null ? "" : detail);
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    var v = CHAR_VOICE[player.charId] || {};
    u.pitch = v.pitch || 1;
    u.rate = v.rate || 1;
    u.volume = 0.95;
    var voice = pickVoice(v.gender || "neutral");
    if (voice) u.voice = voice;
    try { synth.speak(u); } catch (e) {}
  }

  function stop() {
    if (synth) try { synth.cancel(); } catch (e) {}
  }

  window.Audio = { init: init, setMuted: setMuted, setTTSMuted: setTTSMuted, isMuted: isMuted, isTTSMuted: isTTSMuted, playSfx: playSfx, speak: speak, stop: stop };
})();
