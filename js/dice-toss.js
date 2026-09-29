/* dice-toss.js — 🎲 擲骰 / 🪙 擲硬幣「決定先後」共用浮層(skill dice-coin-toss 的正本)
 *
 * ★ 各站 src/ 裡那份與 skill assets 同一份,**不要在站內改**;要改就改 skill 再 cp 回去。
 * 零相依、純 DOM + CSS 3D,2D / 3D 遊戲都能掛(浮在畫布上面,z-index 60)。
 *
 *   import { tossForOrder } from "./dice-toss.js";
 *   const r = await tossForOrder({ players: ["你", "🐱 橘貓"], mode: "dice" });
 *   r.order  // [1, 0] ⇒ 第 1 位(橘貓)先
 *
 * 兩種模式:
 *   dice — 每人擲一顆,點數大的先;同點的那幾位自動重擲(只重擲打平的,其他人名次不動)。N 人都行(跳棋 2~6 人)。
 *   coin — 只給兩人:正面 = players[0] 先,反面 = players[1] 先。
 *
 * 判定=畫面:點數先由 rng 決定,再把骰子轉到那一面;
 *   topFace(el) 從 getComputedStyle 的 matrix3d 反推「現在朝向鏡頭的是哪一面」,冒煙測試用它對賬,不看記錄的值。
 * 減少動態(prefers-reduced-motion)或 opts.instant ⇒ 不轉,直接擺好。點一下浮層 = 跳過動畫。
 */

/** 純邏輯(不碰 DOM,node 可測):回傳 { rounds:[[{p,v}]], order:[玩家索引,由先到後] } */
export function resolveOrder(n, rng = Math.random) {
  const roll = () => 1 + Math.floor(rng() * 6);
  const rounds = [];
  const rank = (group) => {
    const round = group.map((p) => ({ p, v: roll() }));
    rounds.push(round);
    const byV = new Map();
    for (const r of round) byV.set(r.v, [...(byV.get(r.v) || []), r.p]);
    const out = [];
    for (const v of [...byV.keys()].sort((a, b) => b - a)) {
      const tied = byV.get(v);
      out.push(...(tied.length > 1 ? rank(tied) : tied));   // 打平的那幾位再擲一輪
    }
    return out;
  };
  const order = rank([...Array(n).keys()]);
  return { rounds, order };
}

/** 硬幣:回 { heads, order } —— heads ⇒ players[0] 先 */
export function resolveCoin(rng = Math.random) {
  const heads = rng() < 0.5;
  return { heads, order: heads ? [0, 1] : [1, 0] };
}

/* ── 畫面 ── */
const FACE_ROT = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] }; // [rotX, rotY] 把該面轉到正前方
const FACE_POS = { 1: "rotateY(0deg)", 6: "rotateY(180deg)", 3: "rotateY(90deg)", 4: "rotateY(-90deg)", 2: "rotateX(90deg)", 5: "rotateX(-90deg)" };
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }; // 3×3 格位
const NORMALS = { 1: [0, 0, 1], 6: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, -1, 0], 5: [0, 1, 0] };

/** 從畫面反推朝上(朝鏡頭)的面:骰子回 1~6;硬幣回 "heads" / "tails" */
export function topFace(el) {
  const t = getComputedStyle(el).transform;
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const g = t && t !== "none" ? t.match(/matrix(3d)?\(([^)]+)\)/) : null;
  if (g) {
    const a = g[2].split(",").map(Number);
    m = g[1] ? a : [a[0], a[1], 0, 0, a[2], a[3], 0, 0, 0, 0, 1, 0];
  }
  const zOf = ([x, y, z]) => m[2] * x + m[6] * y + m[10] * z;   // 法向量經旋轉後的 z(朝鏡頭 = +z)
  if (el.dataset.kind === "coin") return zOf([0, 0, 1]) >= 0 ? "heads" : "tails";
  let best = 1, bz = -Infinity;
  for (const f in NORMALS) { const z = zOf(NORMALS[f]); if (z > bz) { bz = z; best = +f; } }
  return best;
}

const CSS = `
.dt-ov{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,14,24,.72);font-family:inherit;padding:16px}
.dt-card{background:#fffdf6;color:#222;border-radius:18px;padding:18px 16px 14px;max-width:560px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.45);text-align:center}
.dt-title{font-size:22px;font-weight:700;margin:0 0 12px}
.dt-row{display:flex;flex-wrap:wrap;gap:14px;justify-content:center}
.dt-seat{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:96px}
.dt-name{font-size:18px;font-weight:700}
.dt-stage{width:84px;height:84px;perspective:420px}
.dt-die,.dt-coin{position:relative;width:64px;height:64px;margin:10px;transform-style:preserve-3d;transition:transform 1.4s cubic-bezier(.2,.7,.25,1)}
.dt-face{position:absolute;inset:0;background:#fff;border:2px solid #333;border-radius:12px;display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:7px;backface-visibility:hidden}
.dt-pip{width:12px;height:12px;border-radius:50%;background:#1b1b1b;place-self:center}
.dt-face.f1 .dt-pip,.dt-face.f4 .dt-pip{background:#c8232c}
.dt-face.f1 .dt-pip{width:18px;height:18px}
.dt-coin .dt-face{border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;padding:4px;background:radial-gradient(circle at 35% 30%,#ffe9a0,#d9a520);border-color:#8a6510;color:#4a3500}
.dt-coin .dt-face.back{transform:rotateY(180deg)}
.dt-val{font-size:20px;font-weight:700;min-height:26px}
.dt-seat.first .dt-name::after{content:" 👑"}
.dt-msg{margin:14px 0 4px;font-size:20px;font-weight:700;min-height:28px}
.dt-sub{font-size:14px;color:#666;min-height:18px}
.dt-go{margin-top:10px;min-height:48px;padding:0 28px;font-size:18px;font-weight:700;border:0;border-radius:12px;background:#2f7d4f;color:#fff;cursor:pointer}
.dt-go[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.dt-die,.dt-coin{transition:none}}
`;

function ensureCss() {
  if (document.getElementById("dt-css")) return;
  const s = document.createElement("style");
  s.id = "dt-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function makeDie() {
  const d = document.createElement("div");
  d.className = "dt-die";
  d.dataset.kind = "die";
  for (let f = 1; f <= 6; f++) {
    const face = document.createElement("div");
    face.className = `dt-face f${f}`;
    face.style.transform = `${FACE_POS[f]} translateZ(32px)`;
    for (let c = 1; c <= 9; c++) {
      const cell = document.createElement("span");
      if (PIPS[f].includes(c)) cell.className = "dt-pip";
      face.appendChild(cell);
    }
    d.appendChild(face);
  }
  return d;
}

function makeCoin(headsText, tailsText) {
  const c = document.createElement("div");
  c.className = "dt-coin";
  c.dataset.kind = "coin";
  c.innerHTML = `<div class="dt-face front"></div><div class="dt-face back"></div>`;
  c.children[0].textContent = headsText;
  c.children[1].textContent = tailsText;
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 開浮層擲一次,等玩家按「開始」(或 autoCloseMs 到)後關掉,resolve 結果。
 * @param {object} o
 * @param {string[]} o.players 顯示名字(可帶 emoji);coin 模式只取前兩位
 * @param {"dice"|"coin"} [o.mode="dice"]
 * @param {() => number} [o.rng=Math.random] 測試可注入
 * @param {boolean} [o.instant] 不轉直接擺好(減少動態也會自動走這條)
 * @param {(ev:"roll"|"land"|"done") => void} [o.onEvent] 接音效用
 * @param {string} [o.title] 標題(預設「🎲 擲骰決定誰先」)
 * @param {(firstName:string) => string} [o.firstText] 結果句(預設「○○ 先!」)
 * @param {string} [o.goText="開始"] 按鈕字
 * @param {number} [o.autoCloseMs=0] >0 ⇒ 不用按,時間到自動關
 * @returns {Promise<{order:number[], first:number, rounds?:any[], heads?:boolean}>}
 */
export async function tossForOrder(o) {
  ensureCss();
  const mode = o.mode === "coin" ? "coin" : "dice";
  const rng = o.rng || Math.random;
  const reduced = o.instant || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const players = mode === "coin" ? o.players.slice(0, 2) : o.players;
  const emit = (e) => { try { o.onEvent?.(e); } catch { /* 音效壞掉不影響擲骰 */ } };

  const ov = document.createElement("div");
  ov.className = "dt-ov";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-label", mode === "coin" ? "擲硬幣決定先後" : "擲骰決定先後");
  ov.innerHTML = `<div class="dt-card"><p class="dt-title"></p><div class="dt-row"></div><p class="dt-msg" aria-live="polite"></p><p class="dt-sub"></p><button class="dt-go" hidden></button></div>`;
  const card = ov.firstChild;
  card.querySelector(".dt-title").textContent = o.title || (mode === "coin" ? "🪙 擲硬幣決定誰先" : "🎲 擲骰決定誰先");
  const row = card.querySelector(".dt-row");
  const msg = card.querySelector(".dt-msg");
  const sub = card.querySelector(".dt-sub");
  const go = card.querySelector(".dt-go");
  go.textContent = o.goText || "開始";
  document.body.appendChild(ov);

  let skip = false;
  ov.addEventListener("pointerdown", (e) => { if (e.target !== go) skip = true; });

  const spinTo = async (els, finals) => {
    emit("roll");
    els.forEach((el) => { el.style.transition = "none"; el.style.transform = "rotateX(0deg) rotateY(0deg)"; });
    void ov.offsetWidth;                                   // 先把起點畫出來,transition 才會跑
    els.forEach((el, i) => {
      el.style.transition = reduced ? "none" : "";
      el.style.transform = finals[i];
    });
    if (!reduced) {
      for (let t = 0; t < 1450 && !skip; t += 50) await wait(50);
      if (skip) els.forEach((el) => { el.style.transition = "none"; el.style.transform = finals[el.dataset.i]; });
    }
    emit("land");
  };

  let result;
  if (mode === "dice") {
    const { rounds, order } = resolveOrder(players.length, rng);
    const seats = players.map((name, i) => {
      const s = document.createElement("div");
      s.className = "dt-seat";
      s.innerHTML = `<div class="dt-name"></div><div class="dt-stage"></div><div class="dt-val"></div>`;
      s.querySelector(".dt-name").textContent = name;
      const die = makeDie();
      die.dataset.i = i;
      s.querySelector(".dt-stage").appendChild(die);
      row.appendChild(s);
      return { s, die, val: s.querySelector(".dt-val") };
    });
    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r];
      if (r > 0) { sub.textContent = `同點!${round.map((x) => players[x.p]).join("、")} 再擲一次`; await wait(reduced ? 0 : 700); }
      const finals = [];
      const els = round.map(({ p, v }) => {
        const [rx, ry] = FACE_ROT[v];
        const spinX = reduced ? 0 : 720 + 360 * Math.floor(rng() * 2);
        const spinY = reduced ? 0 : 720 + 360 * Math.floor(rng() * 2);
        finals[p] = `rotateX(${rx + spinX}deg) rotateY(${ry + spinY}deg)`;
        seats[p].val.textContent = "";
        return seats[p].die;
      });
      const byIndex = [];
      els.forEach((el) => { byIndex[el.dataset.i] = finals[el.dataset.i]; });
      await spinTo(els, byIndex);
      round.forEach(({ p, v }) => { seats[p].val.textContent = `${v} 點`; seats[p].die.dataset.v = v; });
    }
    sub.textContent = order.length > 2 ? `順序:${order.map((i) => players[i]).join(" → ")}` : "";
    seats[order[0]].s.classList.add("first");
    result = { order, first: order[0], rounds };
  } else {
    const { heads, order } = resolveCoin(rng);
    const s = document.createElement("div");
    s.className = "dt-seat";
    s.innerHTML = `<div class="dt-stage"></div>`;
    const coin = makeCoin(`${players[0]} 先`, `${players[1]} 先`);
    coin.dataset.i = 0;
    s.firstChild.appendChild(coin);
    row.appendChild(s);
    const turns = reduced ? 0 : 1800 + 360 * Math.floor(rng() * 2);
    await spinTo([coin], [`rotateX(0deg) rotateY(${(heads ? 0 : 180) + turns}deg)`]);
    coin.dataset.v = heads ? "heads" : "tails";
    result = { order, first: order[0], heads };
  }

  const firstName = players[result.first];
  msg.textContent = o.firstText ? o.firstText(firstName) : `${firstName} 先!`;
  emit("done");

  await new Promise((resolve) => {
    if (o.autoCloseMs > 0) { setTimeout(resolve, o.autoCloseMs); return; }
    go.hidden = false;
    go.focus?.();
    go.addEventListener("click", resolve, { once: true });
  });
  ov.remove();
  return result;
}
