/* pieces3d.js — 六種立體西洋棋子(程序幾何,零外部模型;2026-09-29 真 3D 升級)
 *
 * ★ 每一顆都是真的有體積的幾何(LatheGeometry 車床轉出本體 + 少數 Box / Sphere / Extrude 零件),
 *   不是把 SVG 立在平面上當立牌 —— 轉到側面照樣看得到厚度(規格驗收第一條)。
 * ★ 造型辨識(Staunton):兵=球頭、城堡=城垛、騎士=馬頭、主教=斜槽冠、皇后=珠冠、國王=十字。
 *   高度分級沿用 2D SVG 版的順序:兵 < 城堡 < 騎士 < 主教 < 皇后 < 國王(一眼分得出誰大誰小)。
 * ★ 顏色沿用本站:白=象牙、黑=深藍黑(2D 版漸層的中間色)。
 * ★ 共用:同一型的幾何只建一次(12 顆黑白同型共用),材質黑白各一 ⇒ 32 顆棋子只有十幾份 GPU 資源。
 *   選取 / 最後一手的「亮一下」用 emissive,改的是**每顆自己複製的材質** —— 不然點一顆全隊一起亮。
 * ★ 單位:1 = 一格的寬(pitch)。呼叫端用 group.scale 乘上 pitch。
 * 純幾何,不認得規則;不進 raycast(命中只打棋盤平面,見 board3d.js 坑 6)。
 */
import * as THREE from "three";

export const PIECE_NAMES = { p: "兵", n: "騎士", b: "主教", r: "城堡", q: "皇后", k: "國王" };


const COLORS = {
  w: { color: 0xf1e6cf, emissive: 0x000000, roughness: 0.42, metalness: 0.04 },
  b: { color: 0x2c3e5c, emissive: 0x000000, roughness: 0.36, metalness: 0.10 },
};

const SEG = 28;   // 車床分段:28 段在手機上已經很圓,再多只是吃 GPU

/* 車床剖面:[半徑, 高度] 由下往上;頂端半徑給 0 讓頂面封起來 */
function lathe(points) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), SEG);
}

/* 所有棋子共用同一個底座(兩層圓盤 + 收腰),本體從 BASE_TOP 往上長 */
const BASE = [[0, 0], [0.36, 0], [0.37, 0.03], [0.36, 0.06], [0.31, 0.075], [0.30, 0.10], [0.25, 0.12]];
const BASE_TOP = 0.12;

function profile(type) {
  switch (type) {
    case "p": return [...BASE, [0.20, 0.16], [0.15, 0.28], [0.12, 0.36], [0.19, 0.38], [0.19, 0.40], [0.08, 0.42], [0, 0.42]];
    case "r": return [...BASE, [0.23, 0.16], [0.20, 0.30], [0.19, 0.50], [0.25, 0.52], [0.25, 0.60], [0, 0.60]];
    case "n": return [...BASE, [0.24, 0.16], [0.22, 0.24], [0.25, 0.26], [0, 0.26]];
    case "b": return [...BASE, [0.20, 0.16], [0.14, 0.38], [0.12, 0.50], [0.19, 0.52], [0.19, 0.54], [0.11, 0.56],
      [0.16, 0.63], [0.17, 0.69], [0.14, 0.77], [0.07, 0.83], [0.03, 0.85], [0, 0.85]];
    case "q": return [...BASE, [0.22, 0.16], [0.15, 0.40], [0.12, 0.56], [0.20, 0.58], [0.20, 0.60], [0.12, 0.62],
      [0.15, 0.70], [0.21, 0.80], [0.20, 0.82], [0.10, 0.84], [0, 0.85]];
    case "k": return [...BASE, [0.22, 0.16], [0.15, 0.42], [0.12, 0.58], [0.20, 0.60], [0.20, 0.62], [0.12, 0.64],
      [0.16, 0.72], [0.20, 0.82], [0.19, 0.84], [0.08, 0.86], [0, 0.86]];
    default: return BASE;
  }
}

/* 騎士的馬頭:側面剖面擠出成有厚度的板,再倒角 —— 從正面看是厚板、側面看是馬頭輪廓 */
function knightHeadGeometry() {
  const s = new THREE.Shape();
  // 座標:x 往馬鼻子方向(+x),y 往上;從脖子後下方開始順時針
  s.moveTo(-0.17, 0.22);
  s.bezierCurveTo(-0.22, 0.40, -0.18, 0.60, -0.06, 0.72);   // 後頸 → 鬃毛
  s.lineTo(-0.02, 0.80);                                      // 耳朵
  s.lineTo(0.04, 0.72);
  s.bezierCurveTo(0.14, 0.68, 0.24, 0.58, 0.29, 0.48);       // 額頭 → 鼻樑
  s.bezierCurveTo(0.31, 0.43, 0.28, 0.39, 0.22, 0.39);       // 鼻頭 → 嘴
  s.bezierCurveTo(0.14, 0.40, 0.08, 0.44, 0.05, 0.44);       // 下顎
  s.bezierCurveTo(0.06, 0.36, 0.14, 0.30, 0.16, 0.22);       // 喉嚨 → 胸
  s.lineTo(-0.17, 0.22);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, -0.22, -0.08);   // 厚度置中
  g.scale(1, 0.9, 1);              // 馬頭壓低一成:騎士要比主教矮(高度分級)
  g.translate(0, 0.22, 0);
  return g;
}

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

/* 每一型的零件表:[geometry, position, rotation?] —— 零件都用棋子自己的材質 */
function partsFor(type) {
  const parts = [[cached("body:" + type, () => lathe(profile(type))), [0, 0, 0]]];
  if (type === "p") {
    parts.push([cached("pawn:ball", () => new THREE.SphereGeometry(0.105, 20, 16)), [0, 0.50, 0]]);   // 球頭
  } else if (type === "r") {
    // 城垛:頂上一圈 6 塊齒
    const tooth = cached("rook:tooth", () => new THREE.BoxGeometry(0.09, 0.09, 0.075));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push([tooth, [Math.cos(a) * 0.205, 0.645, Math.sin(a) * 0.205], [0, -a, 0]]);
    }
  } else if (type === "n") {
    parts.push([cached("knight:head", knightHeadGeometry), [0, 0, 0]]);
    const eye = cached("knight:eye", () => new THREE.SphereGeometry(0.022, 10, 8));
    parts.push([eye, [0.12, 0.56, 0.105], null, "eye"], [eye, [0.12, 0.56, -0.105], null, "eye"]);
  } else if (type === "b") {
    // 斜槽:一片深色薄板斜插進冠(看起來是冠上刻了一道斜口)
    parts.push([cached("bishop:slit", () => new THREE.BoxGeometry(0.035, 0.16, 0.36)), [0.0, 0.71, 0], [0, 0, 0.62], "slit"]);
  } else if (type === "q") {
    // 珠冠:一圈 8 顆小珠 + 頂珠
    const bead = cached("queen:bead", () => new THREE.SphereGeometry(0.045, 12, 10));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push([bead, [Math.cos(a) * 0.19, 0.84, Math.sin(a) * 0.19]]);
    }
    parts.push([cached("queen:top", () => new THREE.SphereGeometry(0.06, 14, 12)), [0, 0.90, 0]]);
  } else if (type === "k") {
    // 十字:直 + 橫兩塊
    parts.push([cached("king:v", () => new THREE.BoxGeometry(0.07, 0.22, 0.07)), [0, 0.96, 0]]);
    parts.push([cached("king:h", () => new THREE.BoxGeometry(0.19, 0.065, 0.07)), [0, 0.99, 0]]);
  }
  return parts;
}

/* 本體總高(格寬的倍數)——**從幾何量**,不手填(手填那版跟實際差了三成,名牌懸空;test/chess3d-geo 抓到的)。名牌掛在這個高度上面一點 */
export const PIECE_HEIGHT = {};
for (const t of ["p", "n", "b", "r", "q", "k"]) {
  let top = 0;
  for (const [geo, pos] of partsFor(t)) { geo.computeBoundingBox(); top = Math.max(top, geo.boundingBox.max.y + pos[1]); }
  PIECE_HEIGHT[t] = +top.toFixed(3);
}

const accentMat = {
  eye: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }),
  slit: { w: new THREE.MeshStandardMaterial({ color: 0x8a7552, roughness: 0.6 }), b: new THREE.MeshStandardMaterial({ color: 0x0c1422, roughness: 0.6 }) },
};

/**
 * 做一顆棋子。回傳 Group(本地:底座中心在原點、往 +y 長;1 = 一格寬)。
 * group.userData = { type, color, mat } —— mat 是這顆自己的材質(亮一下 / 淡出都改它)。
 * 騎士的馬鼻子朝本地 +x:呼叫端轉 rotation.y 讓牠面向對方(-z 或 +z)。
 */
export function makePiece(type, color) {
  const g = new THREE.Group();
  const c = COLORS[color] || COLORS.w;
  const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: c.roughness, metalness: c.metalness, transparent: true, opacity: 1 });
  for (const [geo, pos, rot, accent] of partsFor(type)) {
    let m = mat;
    if (accent === "eye") m = accentMat.eye;
    else if (accent === "slit") m = accentMat.slit[color] || accentMat.slit.w;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    g.add(mesh);
  }
  g.userData = { type, color, mat, piece: true };
  return g;
}

/** 釋放一顆棋子:幾何是共用的不丟,只丟它自己的材質 */
export function disposePiece(group) {
  group.userData?.mat?.dispose?.();
  group.parent?.remove(group);
}

/* ── 🏷️ 名牌:CanvasTexture 的 Sprite(永遠正面朝鏡頭;Sprite 不進 raycast,不攔點擊)── */
const tagTexCache = new Map();
function tagTexture(type, color) {
  const key = type + color;
  if (tagTexCache.has(key)) return tagTexCache.get(key);
  const label = PIECE_NAMES[type] || "";
  const cv = document.createElement("canvas");
  const W = 256, H = 112;
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d");
  const r = 26;
  cx.beginPath();
  cx.moveTo(r, 4); cx.lineTo(W - r, 4); cx.quadraticCurveTo(W - 4, 4, W - 4, r);
  cx.lineTo(W - 4, H - 22 - r); cx.quadraticCurveTo(W - 4, H - 22, W - r, H - 22);
  cx.lineTo(W / 2 + 14, H - 22); cx.lineTo(W / 2, H - 4); cx.lineTo(W / 2 - 14, H - 22);
  cx.lineTo(r, H - 22); cx.quadraticCurveTo(4, H - 22, 4, H - 22 - r);
  cx.lineTo(4, r); cx.quadraticCurveTo(4, 4, r, 4); cx.closePath();
  cx.fillStyle = color === "w" ? "rgba(255,250,238,0.95)" : "rgba(22,34,56,0.95)";
  cx.strokeStyle = color === "w" ? "rgba(120,95,55,0.9)" : "rgba(147,197,253,0.9)";
  cx.lineWidth = 5;
  cx.fill(); cx.stroke();
  cx.fillStyle = color === "w" ? "#3b2a12" : "#f1f5ff";
  cx.font = `800 ${label.length > 1 ? 58 : 64}px "Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif`;
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText(label, W / 2, (H - 22) / 2 + 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tagTexCache.set(key, tex);
  return tex;
}

/** 名牌 Sprite(1 = 一格寬;呼叫端掛在棋子 group 裡,跟棋子一起動) */
export function makeNameTag(type, color) {
  const mat = new THREE.SpriteMaterial({ map: tagTexture(type, color), depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const w = 0.62;
  s.scale.set(w, w * (112 / 256), 1);
  s.center.set(0.5, 0);   // 下緣的小尖角指著棋子頭頂
  s.position.y = (PIECE_HEIGHT[type] || 0.8) + 0.06;
  s.renderOrder = 10;
  s.userData.nameTag = true;
  return s;
}
