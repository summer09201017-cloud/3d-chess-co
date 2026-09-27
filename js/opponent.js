/* opponent.js — 這一站的 🐾 動物對手接線(本站專屬;動物引擎 animals.js、人聲 voice.js、three-shim.js 三支與 skill animal-opponent-kit 同一份,不在這裡改)
 *
 * ★ 本站**不是 three.js**:棋盤是 CSS 斜視(perspective + rotateX 的 DOM)⇒ 動物住在一張**透明 WebGL 小窗**(#petCanvas)裡,
 *   小窗疊在棋盤遠端的正上方(z-index 在 .board-scene 底下:牠的下半身被棋盤自然遮住 = 坐在桌子後面),pointer-events:none 永遠不擋點擊。
 *   同一套引擎、同一套人聲、同一套反應 —— 只是「相機」是小窗自己的(fov 35、從前上方 15° 看牠的胸口,凳面到耳尖整隻入鏡)。
 * ★ 小窗放哪、多大:每次版面變(applyBoardView / resize / fitBoard)量一次棋盤的投影框(getBoundingClientRect 含 3D 透視,
 *   連棋子與棋名標籤一起聯集):上面有空位 ⇒ 放正上方置中;上面沒位、右邊有(手機橫向 fit-play)⇒ 放右上;都沒有(超小螢幕)⇒ 藏。
 *   拖曳棋盤中不量(pointermove 裡絕不量 layout —— 0915 v29 的 LAG 教訓)。
 * ★ 誰坐:輕鬆 🐰 / 標準 🐱 / 高手 🐻;📅 每日殘局 🦉 守黑方;本站永遠是「白方玩家 vs 黑方 AI」,沒有兩人同機 ⇒ 沒有「不坐」的模式,只有 off。
 * ★ 純觀感:不碰規則、不碰 AI、不進棋盤 DOM。三段 voice / mute / off 記 localStorage。
 */
import * as THREE from 'three';
import { AnimalFigures, ANIMALS, HEAD_TOP_LOCAL_Y } from './animals.js';

export { ANIMALS };
export const LEVEL_ANIMAL = { easy: 'rabbit', medium: 'cat', hard: 'bear' };
export const PET_KEY = '3d-chess-co-pet';
export const PET_MODES = ['voice', 'mute', 'off'];
export function loadPetMode() { try { const v = localStorage.getItem(PET_KEY); return PET_MODES.includes(v) ? v : 'voice'; } catch { return 'voice'; } }
export function savePetMode(m) { try { localStorage.setItem(PET_KEY, m); } catch { /* 私密模式:這場有效 */ } }
/** 這一局該坐哪一隻(daily ⇒ 🦉;其餘照難度) */
export function animalFor(difficulty, daily) {
  if (daily) return 'owl';
  return LEVEL_ANIMAL[difficulty] || 'cat';
}

const SEAT = 'ai';
const EAR_ROOM = 0.55;          // 取景點比頭頂再高一點(貓 / 熊耳尖)
const SEAT_Y = -0.2;            // 凳面(本地)—— 小窗下緣切在這裡以下都可以(被棋盤遮住)
const CAM_PITCH = 15 * Math.PI / 180;
const MIN_PX = 64;              // 小窗比這個小就藏(放不下)
const OVERLAP = 0.22;           // 放正上方時,小窗下緣可以壓進棋盤投影框多少(牠的下半身被棋盤遮住 = 坐在桌後)
const MEASURE_EVERY = 500;      // 沒被標 dirty 也每 0.5 秒量一次(fitBoard 的 setTimeout 會在 applyBoardView 之後才改棋盤大小)

export class Opponent {
  /**
   * @param {{ canvas: HTMLCanvasElement, wrap: HTMLElement, board: HTMLElement, voice?: object }} o
   *   canvas = 透明小窗(放在 wrap 裡、絕對定位);wrap = .scene-wrap;board = #board(量投影框用)
   */
  constructor({ canvas, wrap, board, voice = null }) {
    this.canvas = canvas; this.wrap = wrap; this.board = board; this.voice = voice;
    this.kind = null;
    this.mode = loadPetMode();
    this.dragging = false;
    this.dirty = true;
    this.thinkCount = 0;
    this.chat = { idleMs: 0, said: 0, first: 15000, every: 30000, max: 2, log: [] };
    this.waiting = false;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.placement = 'hidden';       // 'top' | 'right' | 'hidden'
    this.box = null;                 // 小窗相對 wrap 的 { l, t, w, h }
    this._raf = 0; this._lastT = 0; this._lastMeasure = 0;
    this.endedFor = null;            // 一局只反應一次(app 用 state.game 身分記)

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1.1, 0.1, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(2.5, 5, 4); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffffff, 0.25); rim.position.set(-3, 2, -2); this.scene.add(rim);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.figs = new AnimalFigures(this.scene);
    this._onVis = () => { if (document.hidden) this._stop(); else this._start(); };
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('resize', () => { this.dirty = true; });
  }
  get on() { return this.mode !== 'off' && !!this.kind; }
  get voiceOn() { return this.mode === 'voice'; }
  get emoji() { return this.kind ? ANIMALS[this.kind].emoji : ''; }
  get name() { return this.kind ? ANIMALS[this.kind].name : ''; }
  get figure() { return this.figs.bySeat(SEAT); }

  setMode(m) {
    if (!PET_MODES.includes(m)) return false;
    this.mode = m; savePetMode(m);
    this._applyVisible();
    return true;
  }
  /** 每局 / 難度變了叫一次:換人就換動物 */
  seat(kind) {
    if (kind !== this.kind) {
      this.kind = kind;
      if (!kind) this.figs.remove(SEAT);
      else { this.figs.setKind(SEAT, kind, { pos: { x: 0, y: 0, z: 0 }, lookAt: null, scale: 1, dy: 0, legDrop: 2.56 }); this._fitCamera(); }
      this.thinkCount = 0;
    }
    this.figs.cancel(SEAT);
    this.chat.idleMs = 0; this.chat.said = 0;
    this._applyVisible();
  }
  _applyVisible() {
    this.figs.setVisible(this.on);
    this.dirty = true;
    if (this.on) this._start(); else { this._stop(); this.canvas.hidden = true; this.placement = 'hidden'; }
  }

  /* ── 小窗相機:從前上方 15° 看牠的胸口,二分距離讓「凳面 → 耳尖」在 NDC ±0.93 內 ── */
  _fitCamera() {
    const cam = this.camera;
    const target = new THREE.Vector3(0, 2.05, 0);
    const pts = [new THREE.Vector3(0, HEAD_TOP_LOCAL_Y + EAR_ROOM, 0), new THREE.Vector3(0, SEAT_Y, 0.95), new THREE.Vector3(1.35, 1.2, 0.6), new THREE.Vector3(-1.35, 1.2, 0.6)];
    const inside = (d) => {
      cam.position.set(0, target.y + Math.sin(CAM_PITCH) * d, Math.cos(CAM_PITCH) * d);
      cam.lookAt(target); cam.updateMatrixWorld(true);
      return pts.every((p) => { const v = p.clone().project(cam); return Math.abs(v.x) <= 0.93 && Math.abs(v.y) <= 0.93; });
    };
    let lo = 3, hi = 30;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
    inside(hi);
  }

  /* ── 小窗放哪、多大(量棋盤投影框;拖曳中跳過)── */
  measure() {
    if (this.dragging || !this.on) return;
    const wr = this.wrap.getBoundingClientRect();
    if (!wr.width || !wr.height) return;
    let r = this.board.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (const el of this.board.querySelectorAll('.piece, .nm')) {
      const q = el.getBoundingClientRect(); if (!q.width) continue;
      if (q.left < x0) x0 = q.left; if (q.top < y0) y0 = q.top; if (q.right > x1) x1 = q.right; if (q.bottom > y1) y1 = q.bottom;
    }
    const bb = { l: x0 - wr.left, t: y0 - wr.top, r: x1 - wr.left, b: y1 - wr.top, w: x1 - x0, h: y1 - y0 };
    let box = null, placement = 'hidden';
    const topGap = bb.t, rightGap = wr.width - bb.r;
    // A. 正上方置中:高度吃掉上面的空位(+ 壓進棋盤一點),寬 = 高 × 1.1,但不超過棋盤寬的 45%
    let h = Math.min(topGap / (1 - OVERLAP), bb.w * 0.45, wr.height * 0.6);
    if (h >= MIN_PX) {
      const w = Math.min(h * 1.1, wr.width - 8); h = Math.min(h, w / 1.1);
      const cx = (bb.l + bb.r) / 2;
      box = { l: Math.round(cx - w / 2), t: Math.round(bb.t + h * OVERLAP - h), w: Math.round(w), h: Math.round(h) };
      placement = 'top';
    } else {
      // B. 右上(手機橫向 fit-play:棋盤高度卡住、旁邊有空位)
      let w = Math.min(rightGap - 4, bb.h * 0.42, wr.width * 0.35);
      if (w >= MIN_PX) {
        const hh = Math.min(w / 1.1, wr.height - 8);
        box = { l: Math.round(bb.r + 2), t: Math.round(Math.max(0, bb.t)), w: Math.round(w), h: Math.round(hh) };
        placement = 'right';
      }
    }
    this.placement = placement; this.box = box;
    const c = this.canvas;
    if (!box) { c.hidden = true; return; }
    c.hidden = false;
    c.style.left = box.l + 'px'; c.style.top = box.t + 'px'; c.style.width = box.w + 'px'; c.style.height = box.h + 'px';
    if (c.width !== Math.round(box.w * this.renderer.getPixelRatio()) || c.height !== Math.round(box.h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(box.w, box.h, false);
    }
    this.camera.aspect = box.w / box.h; this.camera.updateProjectionMatrix();
    this._fitCamera();
  }

  /* ── 反應 + 人聲同一個入口 ── */
  react(kind, voiceEvent, delayMs = 0) {
    if (!this.kind) return false;
    const ok = this.figs.react(SEAT, kind);
    if (voiceEvent && this.on && this.voiceOn && this.voice) this.voice.say(this.kind, voiceEvent, delayMs);
    return ok;
  }
  /** 🤔 AI 開始想:姿勢每次、人聲每三手一次 */
  think() { this.thinkCount++; return this.react('think', this.thinkCount % 3 === 1 ? 'think' : null); }
  cancel() { this.figs.cancel(SEAT); }
  noteInput() { this.chat.idleMs = 0; this.chat.said = 0; }

  /* ── rAF 迴圈:只在牠可見時跑;分頁背景暫停 ── */
  _start() { if (this._raf || !this.on || document.hidden) return; this._lastT = 0; this._raf = requestAnimationFrame(this._frame); }
  _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
  _frame = (now) => {
    this._raf = 0;
    if (!this.on || document.hidden) return;
    const dt = this._lastT ? Math.min(0.05, (now - this._lastT) / 1000) : 0.016;
    this._lastT = now;
    if (this.dirty || now - this._lastMeasure > MEASURE_EVERY) { this.dirty = false; this._lastMeasure = now; this.measure(); }
    this.update(dt);
    if (!this.canvas.hidden) this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._frame);
  };
  /** 每幀:idle / 反應 / 閒聊計時(waiting = 輪到你、牠在等;app 每次 render 設) */
  update(dt) {
    this.figs.update(dt, { focus: null, turn: null, reduced: this.reduced });
    const c = this.chat;
    if (!this.waiting || !this.on) { c.idleMs = 0; c.said = 0; return; }
    c.idleMs += dt * 1000;
    if (c.said >= c.max || c.idleMs < c.first + c.said * c.every) return;
    c.said++;
    const ev = 'chat' + (1 + Math.floor(Math.random() * 3));
    c.log.push(ev); if (c.log.length > 20) c.log.shift();
    this.react('chat', ev);
  }

  /** smoke 用:哪一隻、看不看得到、小窗在哪、頭頂 NDC(小窗座標)、頭框(頁面 px) */
  probe() {
    const f = this.figure;
    if (!f) return { kind: this.kind, on: this.on, figure: false, mode: this.mode, placement: this.placement };
    const top = this.figs.headTop(SEAT).project(this.camera);
    const ctr = this.figs.headCenter(SEAT).project(this.camera);
    const cr = this.canvas.getBoundingClientRect();
    const px = (v) => ({ x: cr.left + (v.x + 1) / 2 * cr.width, y: cr.top + (1 - v.y) / 2 * cr.height });
    const c = px(ctr), t = px(top), rad = Math.hypot(c.x - t.x, c.y - t.y);
    return {
      kind: this.kind, on: this.on, figure: true, visible: f.group.visible && !this.canvas.hidden, mode: this.mode, placement: this.placement,
      head: { x: +top.x.toFixed(3), y: +top.y.toFixed(3), inside: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 },
      headBox: { l: Math.round(c.x - rad), t: Math.round(c.y - rad), r: Math.round(c.x + rad), b: Math.round(c.y + rad) },
      canvas: { l: Math.round(cr.left), t: Math.round(cr.top), r: Math.round(cr.right), b: Math.round(cr.bottom), w: Math.round(cr.width), h: Math.round(cr.height) },
      scale: +f.pose.scale.toFixed(3),
    };
  }
}
