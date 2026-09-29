/* opponent3d.js — 🐾 動物對手坐進**同一個** 3D 場景(2026-09-29 真 3D 升級;animals.js / voice.js 與 skill animal-opponent-kit 同一份,不在這裡改)
 *
 * 真 3D 模式用這支;2D 平面模式(與 WebGL 失敗退路)仍用 js/opponent.js 的透明小窗版 —— 兩支對 app.js 的介面一樣
 * (seat / setMode / react / think / cancel / noteInput / waiting / endedFor / on / emoji / name / probe)。
 * 座位與讓位照 gomoku3d/src/opponent.js(board3d-kit 第二跑沉澱):
 * ★ 座位永遠在「相機的對面」:水平角變了(換邊 / 拖曳轉盤)就重新擺位,不會擋在你和棋盤之間。
 * ★ 相機讓位:board.fitExtra 多收一個「頭頂」取景點,縮盤上限由 board3d.js 的 FIT_EXTRA_MAX 管(1.28 倍);
 *   俯角 ≥ 76°(正俯視 88°)不收 —— 那個角度本來就看不到牠的臉,不為看不到的東西縮棋盤(規格第 1 節)。
 * ★ 純觀感:不進 pickCell(命中只打棋盤平面)、不進 Worker、不影響棋力。
 * ★ 可見性只認 boolean:figs.setVisible(this.on) —— this.on 一定是 true/false(3d-game-kit:visible 只認嚴格 false)。
 */
import * as THREE from "three";
import { AnimalFigures, ANIMALS, HEAD_TOP_LOCAL_Y } from "./animals.js";
import { loadPetMode, savePetMode, PET_MODES } from "./opponent.js";

export { ANIMALS };

const SEAT = "ai";
/* 動物多大:照「相機讓得出多少位子」算(gomoku3d 0927 實測),不是照真實比例。西洋棋盤半寬 ≈1.2 ⇒ 約 0.22 倍 */
const SCALE_PER_HALF = 0.24 / 1.3;
const PITCH_HIDE = 76;

export class Opponent3D {
  constructor(board, voice) {
    this.board = board;
    this.voice = voice || null;
    this.figs = new AnimalFigures(board.scene);
    this.kind = null;
    this.mode = loadPetMode();
    this._yaw = null;
    this.thinkCount = 0;
    this.waiting = false;
    this.endedFor = null;
    this.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.chat = { idleMs: 0, said: 0, first: 15000, every: 30000, max: 2, log: [] };
    board.fitExtra = () => this.fitPoints();
    this._untick = board.addTick((dt) => this.update(dt));
  }
  get on() { return this.mode !== "off" && !!this.kind; }
  get voiceOn() { return this.mode === "voice"; }
  get emoji() { return this.kind ? ANIMALS[this.kind].emoji : ""; }
  get name() { return this.kind ? ANIMALS[this.kind].name : ""; }
  get figure() { return this.figs.bySeat(SEAT); }

  setMode(m) {
    if (!PET_MODES.includes(m)) return false;
    this.mode = m; savePetMode(m);
    this.figs.setVisible(this.on === true);
    this.board.fitCamera();
    return true;
  }

  /** 每局 / 難度變了叫一次:換人就換動物 */
  seat(kind) {
    const changed = kind !== this.kind;
    if (changed) {
      this.kind = kind;
      if (!kind) this.figs.remove(SEAT);
      else this.figs.setKind(SEAT, kind, this._placement());
      this._yaw = this.board.yaw;
      this.thinkCount = 0;
      this.figs.cancel(SEAT);
      this.chat.idleMs = 0; this.chat.said = 0;
    }
    this.figs.setVisible(this.on === true);
    if (changed) this.board.fitCamera();
  }

  _geom() {
    const b = this.board;
    const half = Math.max(b.halfX, b.halfZ);
    const scale = half * SCALE_PER_HALF;
    const R = half + 1.25 * scale;          // 掌心(本地 z≈1.34)剛好搭到盤沿
    const dy = 0.02 - 0.4 * scale;          // 掌心(本地 y 0.4)落在盤面高度
    const floorY = Number.isFinite(b.floorY) ? b.floorY : -0.77;
    const legDrop = (dy - floorY) / scale;  // 凳底一定落地
    const y = THREE.MathUtils.degToRad(b.yaw);
    return { scale, R, dy, legDrop, sx: -Math.sin(y), sz: -Math.cos(y) };   // 相機在 +z 那邊(yaw 0)⇒ 對手坐 -z
  }
  _placement() {
    const g = this._geom();
    return { pos: { x: g.sx * g.R, y: 0, z: g.sz * g.R }, lookAt: { x: 0, z: 0 }, scale: g.scale, dy: g.dy, legDrop: g.legDrop };
  }
  /** 取景點:頭頂(照現在的 yaw 算,fitCamera 與重擺才不會互咬) */
  fitPoints() {
    if (!this.on) return [];
    if (this.board._pitchFor() >= PITCH_HIDE) return [];
    const g = this._geom();
    return [new THREE.Vector3(g.sx * g.R, g.dy + HEAD_TOP_LOCAL_Y * g.scale, g.sz * g.R)];
  }

  react(kind, voiceEvent, delayMs = 0) {
    if (!this.kind) return false;
    const ok = this.figs.react(SEAT, kind);
    if (voiceEvent && this.on && this.voiceOn && this.voice) this.voice.say(this.kind, voiceEvent, delayMs);
    return ok;
  }
  /** 🤔 AI 開始想:姿勢每次、人聲每三手一次(跟小窗版同一條規則) */
  think() { this.thinkCount++; return this.react("think", this.thinkCount % 3 === 1 ? "think" : null); }
  cancel() { this.figs.cancel(SEAT); }
  noteInput() { this.chat.idleMs = 0; this.chat.said = 0; }

  /** 每幀(board3d 的 tick;分頁背景時 rAF 本來就停):換邊就重擺、idle、閒聊計時 */
  update(dt) {
    if (this.kind && this._yaw !== this.board.yaw) { this._yaw = this.board.yaw; this.figs.place(SEAT, this._placement()); }
    this.figs.update(dt, { focus: null, turn: null, reduced: this.reduced });
    const c = this.chat;
    if (!this.waiting || !this.on || document.hidden) { c.idleMs = 0; c.said = 0; return; }
    c.idleMs += dt * 1000;
    if (c.said >= c.max || c.idleMs < c.first + c.said * c.every) return;
    c.said++;
    const ev = "chat" + (1 + Math.floor(Math.random() * 3));
    c.log.push(ev); if (c.log.length > 20) c.log.shift();
    this.react("chat", ev);
  }

  dispose() {
    this._untick?.();
    this.figs.remove(SEAT);
    this.board.fitExtra = null;
  }

  /** smoke 用:哪一隻、看不看得到、頭頂在不在畫面、頭框(頁面 px)、凳子落地 */
  probe() {
    const f = this.figure;
    if (!f) return { kind: this.kind, on: this.on, figure: false, mode: this.mode, placement: "scene" };
    const cam = this.board.camera;
    const top = this.figs.headTop(SEAT).project(cam);
    const ctr = this.figs.headCenter(SEAT).project(cam);
    const cr = this.board.canvas.getBoundingClientRect();
    const px = (v) => ({ x: cr.left + (v.x + 1) / 2 * cr.width, y: cr.top + (1 - v.y) / 2 * cr.height });
    const c = px(ctr), t = px(top), rad = Math.hypot(c.x - t.x, c.y - t.y);
    const stool = f.group.localToWorld(new THREE.Vector3(0, -f.pose.legDrop, 0));
    return {
      kind: this.kind, on: this.on, figure: true, visible: f.group.visible === true, mode: this.mode, placement: "scene",
      head: { x: +top.x.toFixed(3), y: +top.y.toFixed(3), inside: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 },
      headBox: { l: Math.round(c.x - rad), t: Math.round(c.y - rad), r: Math.round(c.x + rad), b: Math.round(c.y + rad) },
      canvas: { l: Math.round(cr.left), t: Math.round(cr.top), r: Math.round(cr.right), b: Math.round(cr.bottom), w: Math.round(cr.width), h: Math.round(cr.height) },
      stoolY: +stool.y.toFixed(3), floorY: this.board.floorY,
      pos: { x: +f.group.position.x.toFixed(2), z: +f.group.position.z.toFixed(2) },
      scale: +f.pose.scale.toFixed(3),
    };
  }
}
