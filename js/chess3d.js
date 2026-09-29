/* chess3d.js — 本站的真 3D 棋盤(2026-09-29;board3d-kit 第四跑:第一次是西洋棋 cell 模式 + 六種造型)
 *
 * 分層(board3d-kit 第一節):
 *   board3d.js  —— 桌子 / 燈 / 相機 / 取景 / 點到哪一格(逐字取自 gomoku3d,一行不改)
 *   pieces3d.js —— 六種棋子長相 + 名牌
 *   chess3d.js  —— 這支:64 格深淺磚、高亮、棋子「對帳」、動畫、指標手勢、動物座位的場景
 *   app.js      —— 唯一的棋局(state.game)與所有 UI;這支**不持有棋局**,只收 app 每次 render 給的快照
 * ★ 一份真相:sync() 每次都把 64 格逐格對到 app 給的 board 陣列 —— 動畫只是「過程」,結束位置永遠是引擎說的位置。
 *   王車易位只畫國王、吃過路兵留著被吃的兵、升變還是兵,這幾種錯在結構上不可能(對帳會把它修回來)。
 * ★ 座標:row 0 = 第 8 橫排(遠端)、col 0 = a 直線;相機 yaw 0 在 +z ⇒ 白方在近端。yaw = 本站的 cameraRotation(同方向,已驗)。
 * ★ 命中只打棋盤平面(board.pickCell),棋子 / 名牌 / 動物都不進 raycast(坑 6)。
 */
import * as THREE from "three";
import { Board3D } from "./board3d.js";
import { makePiece, disposePiece, makeNameTag, PIECE_HEIGHT } from "./pieces3d.js";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
export const PITCH = 0.3;              // 一格的世界寬
const TILE_Y = 0.002;                  // 磚面比盤面高一點點(不 z-fight)
const MARK_Y = 0.006;
const DRAG_PX = 8;                     // 超過這個距離 = 轉盤,不落子(規格)
const MOVE_SEC = 0.28;
const FADE_SEC = 0.24;

export function squareToRC(sq) {
  if (typeof sq !== "string" || !/^[a-h][1-8]$/.test(sq)) return null;
  return { row: 8 - Number(sq[1]), col: FILES.indexOf(sq[0]) };
}
export function rcToSquare(row, col) {
  if (!(row >= 0 && row < 8 && col >= 0 && col < 8)) return null;
  return `${FILES[col]}${8 - row}`;
}

/** 世界座標 → 格名(嚴格:只認 8×8 範圍內;純函式,node 測試直接驗) */
export function worldToSquare(board, x, z) {
  const hx = board.spanX / 2, hz = board.spanZ / 2;
  if (!(Math.abs(x) <= hx && Math.abs(z) <= hz)) return null;
  const cell = board.worldToCell(x, z);
  return cell ? rcToSquare(cell.row, cell.col) : null;
}

const MARK_COLORS = {
  selected: 0xf59e0b,
  last: 0x34d399,
  check: 0xf97373,
  hint: 0xa855f7,
  legal: 0x7dd3fc,
};

export class Chess3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onTap?(sq: string|null): void, onDragStart?(): void, onDragMove?(d: {dx:number, dy:number, angle:number|null}): void,
   *           onDragEnd?(moved: boolean): void, onContextLost?(): void, onInput?(): void }} hooks
   */
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.board = new Board3D(canvas, {
      cols: 8, mode: "cell", pitch: PITCH, margin: 0.5, labels: false,
      wood: "#6b4526", woodEdge: 0x4a2c16, woodSide: 0x7a5230, lineColor: "#3a2412",
      background: 0x07101d, storageKey: "3d-chess-co-view3d",
    });
    // r128:燈光用物理單位,board3d 的燈光數值(照 three 0.177 調的)才會一樣亮;見 three-site.js ②
    this.board.renderer.physicallyCorrectLights = true;
    this.scene = this.board.scene;
    this.camera = this.board.camera;
    this.pieces = new Map();           // square → Group
    this.tweens = [];
    this.namesOn = true;
    this.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this._marks = new THREE.Group();
    this.scene.add(this._marks);
    this._buildTiles();
    this._buildLabels();
    this.board.addTick((dt) => this._tick(dt));
    this._bindPointer();
    this._lost = false;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this._lost = true; this.hooks.onContextLost?.(); });
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }
  }

  get lost() { return this._lost; }

  /* ── 64 格深淺磚(共用 1 份幾何、2 份材質)── */
  _buildTiles() {
    const geo = new THREE.PlaneGeometry(PITCH, PITCH);
    geo.rotateX(-Math.PI / 2);
    const light = new THREE.MeshStandardMaterial({ color: 0xeedfc0, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.6 });
    this.tiles = new THREE.Group();
    this.tiles.name = "tiles";
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const rank = 8 - row;
      const isLight = (col + rank) % 2 === 1;      // a1 是深格
      const m = new THREE.Mesh(geo, isLight ? light : dark);
      const w = this.board.cellToWorld(row, col);
      m.position.set(w.x, TILE_Y, w.z);
      m.userData.square = rcToSquare(row, col);
      this.tiles.add(m);
    }
    this.scene.add(this.tiles);
    // 高亮用的共用幾何
    this._markGeo = new THREE.PlaneGeometry(PITCH * 0.96, PITCH * 0.96); this._markGeo.rotateX(-Math.PI / 2);
    this._ringGeo = new THREE.RingGeometry(PITCH * 0.36, PITCH * 0.46, 32); this._ringGeo.rotateX(-Math.PI / 2);
    this._dotGeo = new THREE.CircleGeometry(PITCH * 0.14, 24); this._dotGeo.rotateX(-Math.PI / 2);
    this._markMats = {};
    for (const [k, c] of Object.entries(MARK_COLORS)) {
      this._markMats[k] = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: k === "legal" ? 0.85 : 0.5, depthWrite: false });
    }
  }

  /* ── 盤緣座標(小寫 a–h / 1–8,跟訊息列的 e2 → e4 同一套寫法)── */
  _buildLabels() {
    const b = this.board;
    const W = b.halfX * 2, H = b.halfZ * 2;
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = Math.round(1024 * (H / W));
    const cx = cv.getContext("2d");
    const s = cv.width / W;
    const toPx = (x, z) => [(x + W / 2) * s, (z + H / 2) * s];
    cx.fillStyle = "rgba(255,236,200,0.85)";
    cx.font = `700 ${Math.round(PITCH * 0.3 * s)}px system-ui,sans-serif`;
    cx.textAlign = "center"; cx.textBaseline = "middle";
    const edge = b.halfZ - PITCH * 0.25;
    for (let c = 0; c < 8; c++) {
      const w = b.cellToWorld(0, c);
      cx.fillText(FILES[c], ...toPx(w.x, edge));
      cx.fillText(FILES[c], ...toPx(w.x, -edge));
    }
    for (let r = 0; r < 8; r++) {
      const w = b.cellToWorld(r, 0);
      cx.fillText(String(8 - r), ...toPx(-edge, w.z));
      cx.fillText(String(8 - r), ...toPx(edge, w.z));
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.position.y = TILE_Y / 2;
    mesh.name = "labels";
    this.scene.add(mesh);
  }

  /* ── 相機:app 的 cameraRotation / pitch 是唯一真相,這裡只照做 ── */
  setCamera(yawDeg, pitchDeg) {
    const y = Number.isFinite(yawDeg) ? yawDeg : 0;
    const p = Number.isFinite(pitchDeg) ? pitchDeg : 34;
    if (this.board.yaw === y && this.board.pitchOverride === Math.min(88, Math.max(5, p))) return;
    this.board.yaw = y;
    this.board.setPitch(p);           // setPitch 會 fitCamera(含動物頭頂的讓位)
  }
  /** 實際相機俯角(度)—— 驗收「88° 真的是 88°」用,不是讀滑桿 */
  measuredPitch() {
    const d = this.camera.position.clone().sub(this.board.target);
    return THREE.MathUtils.radToDeg(Math.asin(d.y / d.length()));
  }
  measuredYaw() {
    const d = this.camera.position.clone().sub(this.board.target);
    return (THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)) + 360) % 360;
  }

  resize() { if (!this._lost) this.board.resize(); }

  setNames(on) {
    this.namesOn = on === true;
    for (const g of this.pieces.values()) { const t = g.userData.tag; if (t) t.visible = this.namesOn; }
  }

  squareWorld(sq) {
    const rc = squareToRC(sq);
    return rc ? this.board.cellToWorld(rc.row, rc.col) : null;
  }
  /** 螢幕 → 格名;點在 8×8 以外(盤框留白 / 桌外)一律 null —— board3d 的 0.75 格容忍是給交叉點盤用的,
   *  cell 盤照用會讓「點盤框」被吸成 a1 / h8(規格:點桌外不會落在 a1) */
  pickSquare(clientX, clientY) {
    const pt = this.board.pickWorld(clientX, clientY);
    if (!pt) return null;
    return worldToSquare(this.board, pt.x, pt.z);
  }
  squareToScreen(sq) {
    const rc = squareToRC(sq);
    return rc ? this.board.cellToScreen(rc.row, rc.col) : null;
  }

  _newPiece(type, color, sq) {
    const g = makePiece(type, color);
    g.scale.setScalar(PITCH);
    if (type === "n") g.rotation.y = color === "w" ? Math.PI / 2 : -Math.PI / 2;   // 馬頭朝對方
    const tag = makeNameTag(type, color);
    tag.visible = this.namesOn;
    g.add(tag);
    g.userData.tag = tag;
    g.userData.square = sq;
    const w = this.squareWorld(sq);
    g.position.set(w.x, TILE_Y, w.z);
    this.board.pieceLayer.add(g);
    return g;
  }

  _tween(g, from, to, lift) {
    this.tweens = this.tweens.filter((t) => t.g !== g);
    if (this.reduced) { g.position.set(to.x, TILE_Y, to.z); return; }
    this.tweens.push({ kind: "move", g, from, to, lift, t: 0, dur: MOVE_SEC });
  }
  _fadeOut(g) {
    this.tweens = this.tweens.filter((t) => t.g !== g);
    g.userData.dying = true;
    if (this.reduced) { disposePiece(g); return; }
    this.tweens.push({ kind: "fade", g, t: 0, dur: FADE_SEC });
  }

  _tick(dt) {
    if (!this.tweens.length) return;
    const keep = [];
    for (const tw of this.tweens) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      if (tw.kind === "move") {
        tw.g.position.set(tw.from.x + (tw.to.x - tw.from.x) * e, TILE_Y + Math.sin(Math.PI * k) * tw.lift, tw.from.z + (tw.to.z - tw.from.z) * e);
      } else {
        tw.g.position.y = TILE_Y - 0.12 * e;
        tw.g.userData.mat.opacity = 1 - e;
        if (tw.g.userData.tag) tw.g.userData.tag.material.opacity = 1 - e;
      }
      if (k < 1) keep.push(tw);
      else if (tw.kind === "fade") disposePiece(tw.g);
    }
    this.tweens = keep;
  }

  /**
   * 對帳:把畫面改成 app 給的局面。
   * @param {{ board: Array<Array<{type,color}|null>>, animate?: object|null, selected?: string|null, legal?: string[],
   *           last?: {from,to}|null, check?: string|null, hint?: string|null }} view
   *   board = chess.js 的 game.board()(row 0 = 第 8 排);animate = 剛走的那一手(verbose move,要動畫才給)
   */
  sync(view) {
    const want = new Map();
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const p = view.board?.[row]?.[col];
      if (p) want.set(rcToSquare(row, col), p);
    }

    // ① 剛走的那一手:搬動既有的棋子(畫得出「過程」)
    const m = view.animate;
    if (m && m.from && m.to) {
      const g = this.pieces.get(m.from);
      if (g && g.userData.type === m.piece && g.userData.color === m.color) {
        const flags = m.flags || "";
        const capSq = flags.includes("e") ? `${m.to[0]}${m.from[1]}` : m.to;
        const victim = this.pieces.get(capSq);
        if (victim && victim !== g) { this.pieces.delete(capSq); this._fadeOut(victim); }
        this.pieces.delete(m.from);
        this.pieces.set(m.to, g);
        g.userData.square = m.to;
        this._tween(g, this.squareWorld(m.from), this.squareWorld(m.to), m.piece === "n" ? PITCH * 0.9 : PITCH * 0.35);
        if (flags.includes("k") || flags.includes("q")) {
          const rank = m.from[1];
          const [rf, rt] = flags.includes("k") ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
          const rook = this.pieces.get(rf);
          if (rook) {
            this.pieces.delete(rf); this.pieces.set(rt, rook); rook.userData.square = rt;
            this._tween(rook, this.squareWorld(rf), this.squareWorld(rt), PITCH * 0.6);
          }
        }
        if (m.promotion) g.userData.promoteTo = m.promotion;   // 兵先走到底,到了再換皇后(下面對帳會換)
      }
    }

    // ② 逐格對帳:引擎說什麼就是什麼
    for (const [sq, g] of [...this.pieces]) {
      const p = want.get(sq);
      if (!p || p.color !== g.userData.color || (p.type !== g.userData.type && p.type !== g.userData.promoteTo)) {
        this.pieces.delete(sq);
        this.tweens = this.tweens.filter((t) => t.g !== g);
        disposePiece(g);
      }
    }
    for (const [sq, p] of want) {
      let g = this.pieces.get(sq);
      if (g && g.userData.type !== p.type) {
        // 升變:兵到底了 ⇒ 換成新棋子,從原本動畫的位置接著走完
        const tw = this.tweens.find((t) => t.g === g);
        const ng = this._newPiece(p.type, p.color, sq);
        if (tw) { tw.g = ng; ng.position.copy(g.position); }
        disposePiece(g);
        this.pieces.set(sq, ng);
        continue;
      }
      if (!g) { g = this._newPiece(p.type, p.color, sq); this.pieces.set(sq, g); continue; }
      if (!this.tweens.some((t) => t.g === g)) {
        const w = this.squareWorld(sq);
        g.position.set(w.x, TILE_Y, w.z);
      }
    }

    // ③ 高亮
    this._paintMarks(view);
  }

  _paintMarks(view) {
    while (this._marks.children.length) this._marks.remove(this._marks.children[0]);   // 幾何 / 材質共用,不 dispose
    const add = (sq, geo, mat, y = MARK_Y) => {
      const w = this.squareWorld(sq); if (!w) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(w.x, y, w.z);
      mesh.userData = { square: sq, mark: mat === this._markMats.legal ? "legal" : Object.keys(this._markMats).find((k) => this._markMats[k] === mat) };
      mesh.renderOrder = 2;
      this._marks.add(mesh);
    };
    if (view.last) { add(view.last.from, this._markGeo, this._markMats.last); add(view.last.to, this._markGeo, this._markMats.last); }
    if (view.check) add(view.check, this._markGeo, this._markMats.check, MARK_Y + 0.001);
    if (view.selected) add(view.selected, this._markGeo, this._markMats.selected, MARK_Y + 0.002);
    for (const sq of view.legal || []) {
      const occupied = !!this.pieces.get(sq);
      add(sq, occupied ? this._ringGeo : this._dotGeo, this._markMats.legal, MARK_Y + 0.003);
    }
    if (view.hint) {
      add(view.hint, this._markGeo, this._markMats.hint, MARK_Y + 0.004);
      const w = this.squareWorld(view.hint);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: hintBadgeTexture(), depthTest: false, transparent: true }));
      badge.scale.set(PITCH * 0.55, PITCH * 0.55, 1);
      const top = this.pieces.get(view.hint) ? (PIECE_HEIGHT[this.pieces.get(view.hint).userData.type] || 0.8) * PITCH + PITCH * 0.3 : PITCH * 0.35;
      badge.position.set(w.x, top, w.z);
      badge.renderOrder = 11;
      badge.userData = { square: view.hint, mark: "hint-badge" };
      this._marks.add(badge);
    }
  }

  /* ── 指標:單一手指、pointer capture;超過 8px = 轉盤;第二指 / cancel 都不落子 ── */
  _bindPointer() {
    const c = this.canvas;
    let drag = null;
    const center = () => {
      const v = new THREE.Vector3(0, 0, 0).project(this.camera);
      const r = c.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    };
    c.addEventListener("pointerdown", (e) => {
      this.hooks.onInput?.();
      if (e.button !== undefined && e.button !== 0) return;
      if (drag) { drag.multi = true; return; }   // 第二指:這一整次手勢都不落子
      const ctr = center();
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: ctr.x, cy: ctr.y, moved: false, multi: false };
      try { c.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ }
      this.hooks.onDragStart?.();
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_PX) drag.moved = true;
      if (!drag.moved) return;
      const r0 = Math.hypot(drag.x0 - drag.cx, drag.y0 - drag.cy);
      let angle = null;
      if (r0 >= 48) {
        const a0 = Math.atan2(drag.y0 - drag.cy, drag.x0 - drag.cx);
        const a1 = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        angle = (a1 - a0) * 180 / Math.PI;
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
      }
      this.hooks.onDragMove?.({ dx, dy, angle });
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      try { c.releasePointerCapture(e.pointerId); } catch { /* 已放 */ }
      this.hooks.onDragEnd?.(d.moved);
      if (d.moved || d.multi || e.type === "pointercancel") return;
      this.hooks.onTap?.(this.pickSquare(e.clientX, e.clientY));
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("lostpointercapture", (e) => { if (drag && e.pointerId === drag.id) { drag = null; this.hooks.onDragEnd?.(false); } });
  }

  /** 驗收用:場景裡實際有什麼(不是讀 app 的 state) */
  summary() {
    const pieces = [];
    for (const [sq, g] of this.pieces) pieces.push({ square: sq, type: g.userData.type, color: g.userData.color, tag: g.userData.tag?.visible === true });
    let meshCount = 0;
    this.scene.traverse((o) => { if (o.isMesh) meshCount++; });
    const layerPieces = this.board.pieceLayer.children.filter((g) => g.userData.piece && !g.userData.dying).length;
    return {
      tiles: this.tiles.children.length,
      table: !!this.board._boardGroup && this.board._boardGroup.children.length > 0,
      pieces, layerPieces, meshCount,
      marks: this._marks.children.map((m) => ({ square: m.userData.square, mark: m.userData.mark })),
      tweens: this.tweens.length,
      yaw: +this.measuredYaw().toFixed(2), pitch: +this.measuredPitch().toFixed(2),
      sameRenderer: true,
    };
  }

  dispose() {
    this._ro?.disconnect();
    this.board.dispose();
  }
}

let _hintTex = null;
function hintBadgeTexture() {
  if (_hintTex) return _hintTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const cx = cv.getContext("2d");
  cx.fillStyle = "rgba(88,28,135,0.92)";
  cx.beginPath(); cx.arc(64, 64, 58, 0, Math.PI * 2); cx.fill();
  cx.strokeStyle = "#f5d0fe"; cx.lineWidth = 6; cx.stroke();
  cx.font = "72px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText("💡", 64, 70);
  _hintTex = new THREE.CanvasTexture(cv);
  _hintTex.colorSpace = THREE.SRGBColorSpace;
  return _hintTex;
}
