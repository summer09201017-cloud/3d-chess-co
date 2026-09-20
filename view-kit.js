/* view-kit.js — 六款 3D 棋類共用「視角工具列」
 * 2026-09-20 使用者拍板:「兩邊都做。讓六款 3D 棋類的視角工具列長一樣:預設三段 + 滑桿微調 + 換邊 + 重置。」
 *
 * 零相依、純 DOM、單檔(CSS 內嵌,掛上去時只注入一次)。相機怎麼動交給 adapter,本檔只管 UI 與角度數學。
 *
 *   pitch = 俯視角度(度):0 = 貼著桌面平視,90 = 正上方往下看(gomoku3d 的 VIEWS.pitch 同一套定義)
 *   yaw   = 水平旋轉(度):0 = 開場方向,180 = 換邊(兩人同機用)
 *
 * adapter 介面(全部同步呼叫):
 *   get()            → { yaw, pitch }   目前角度(度;yaw 相對開場方向)
 *   set({yaw,pitch}) → 立刻把相機放到這個角度(距離、注視點由站自己維持)
 *   reset()          → 站自己的「回開場角度」(要連 controls.target 一起歸零,見 3D-Xiangqi 0909 教訓)
 *   onChange(cb)?    → 相機被拖曳改變時呼叫 cb(讓滑桿跟著動);回傳解除函式
 *
 * OrbitControls 的站直接用下面的 orbitAdapter();自製相機的站(3d-chess-co / gomoku3d)自己寫四個方法。
 */

export const VIEW_PRESETS = {
  top:  { pitch: 58, label: "斜俯視" },   // 預設:看得到立體感,又看得清整盤
  flat: { pitch: 88, label: "正俯視" },   // 像 2D 版,對局最清楚
  sit:  { pitch: 34, label: "對局視角" }, // 低角度,像坐在桌邊
};
export const PRESET_ORDER = ["top", "flat", "sit"];
export const PITCH_MIN = 20;
export const PITCH_MAX = 88;
export const PRESET_TOLERANCE = 1.5;   // 滑桿離預設幾度以內就把那顆預設鈕亮起來

export function normYaw(d) {
  d = Number(d) || 0;
  d = ((d % 360) + 360) % 360;
  return Math.round(d) % 360;
}
export function clampPitch(d, min = PITCH_MIN, max = PITCH_MAX) {
  d = Number(d);
  if (!Number.isFinite(d)) return min;
  return Math.round(Math.min(max, Math.max(min, d)));
}
export function presetFor(pitch, presets = VIEW_PRESETS, tol = PRESET_TOLERANCE) {
  for (const k of Object.keys(presets)) {
    if (Math.abs(presets[k].pitch - pitch) <= tol) return k;
  }
  return null;
}
export function nextPreset(key, order = PRESET_ORDER) {
  const i = order.indexOf(key);
  return order[(i + 1) % order.length];
}
/* 從 from 轉到 to 最短要轉幾度(-180 ~ 180),換邊/預設動畫用 */
export function shortestDelta(from, to) {
  const d = (((to - from) % 360) + 360) % 360;   // 0 ~ 359
  return d > 180 ? d - 360 : d;                   // 剛好 180 就回 +180:換邊永遠同一個方向轉
}

const CSS = `
.view-kit{display:grid;gap:8px;color:var(--vk-fg,inherit);font:inherit;box-sizing:border-box;min-width:0}
.view-kit *{box-sizing:border-box}
.vk-title{font-size:14px;font-weight:700;opacity:.9;display:flex;align-items:center;gap:6px}
.vk-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.vk-btn{min-height:44px;padding:6px 4px;border-radius:10px;border:1px solid var(--vk-line,rgba(255,255,255,.28));
  background:var(--vk-bg,rgba(0,0,0,.35));color:inherit;font:inherit;font-size:14px;line-height:1.2;cursor:pointer;
  touch-action:manipulation;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vk-btn:hover{filter:brightness(1.12)}
.vk-btn:focus-visible{outline:2px solid var(--vk-accent,#3fa84c);outline-offset:2px}
.vk-btn[aria-pressed="true"]{background:var(--vk-accent,#3fa84c);border-color:transparent;color:var(--vk-accent-fg,#fff)}
.vk-slider{display:grid;gap:2px;margin:0}
.vk-slider>span{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;opacity:.92}
.vk-slider output{font-variant-numeric:tabular-nums;font-weight:700}
.vk-slider input[type=range]{width:100%;min-height:44px;margin:0;accent-color:var(--vk-accent,#3fa84c);cursor:pointer}
.vk-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
`;

function injectCss(doc) {
  if (doc.getElementById("view-kit-css")) return;
  const s = doc.createElement("style");
  s.id = "view-kit-css";
  s.textContent = CSS;
  doc.head.appendChild(s);
}

function prefersReducedMotion() {
  try { return !!(globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch { return false; }
}

/**
 * mountViewKit(container, adapter, opts)
 *   container: 要塞進去的 DOM 元素(工具列會 append 在它裡面)
 *   opts: { title = "🎥 視角", presets, order, pitchMin, pitchMax, animateMs = 320, onAction(name, detail) }
 * 回傳 { el, sync(), setView(key), cycleView(), flip(), reset(), destroy() }
 */
export function mountViewKit(container, adapter, opts = {}) {
  const doc = container.ownerDocument || document;
  injectCss(doc);
  const presets = opts.presets || VIEW_PRESETS;
  const order = opts.order || Object.keys(presets);
  const pitchMin = opts.pitchMin ?? PITCH_MIN;
  const pitchMax = opts.pitchMax ?? PITCH_MAX;
  const animateMs = opts.animateMs ?? 320;
  const onAction = typeof opts.onAction === "function" ? opts.onAction : () => {};
  const title = opts.title === undefined ? "🎥 視角" : opts.title;

  const el = doc.createElement("section");
  el.className = "view-kit";
  el.setAttribute("aria-label", "視角");
  el.innerHTML = `
    ${title ? `<div class="vk-title">${title}</div>` : ""}
    <div class="vk-presets" role="group" aria-label="預設視角">
      ${order.map((k) => `<button type="button" class="vk-btn" data-vk-view="${k}" aria-pressed="false" title="俯視角度 ${presets[k].pitch}°">${presets[k].label}</button>`).join("")}
    </div>
    <label class="vk-slider"><span>↔ 水平旋轉 <output data-vk-out="yaw">0°</output></span>
      <input type="range" data-vk-range="yaw" min="0" max="359" step="1" value="0" aria-label="水平旋轉角度"></label>
    <label class="vk-slider"><span>↕ 俯視角度 <output data-vk-out="pitch">58°</output></span>
      <input type="range" data-vk-range="pitch" min="${pitchMin}" max="${pitchMax}" step="1" value="58" aria-label="俯視角度"></label>
    <div class="vk-actions">
      <button type="button" class="vk-btn" data-vk-flip title="把棋盤轉 180°,兩人同機換邊用">🔃 換邊</button>
      <button type="button" class="vk-btn" data-vk-reset title="鏡頭回到開場的角度">🎯 重置視角</button>
    </div>`;
  container.appendChild(el);

  const q = (sel) => el.querySelector(sel);
  const yawRange = q('[data-vk-range="yaw"]');
  const pitchRange = q('[data-vk-range="pitch"]');
  const yawOut = q('[data-vk-out="yaw"]');
  const pitchOut = q('[data-vk-out="pitch"]');
  const presetBtns = Array.from(el.querySelectorAll("[data-vk-view]"));

  let busy = false;          // 我們自己在動相機時,忽略 adapter.onChange 回呼(避免迴圈)
  let raf = 0;               // 進行中的補間動畫
  let syncScheduled = false;

  function paint(state) {
    const yaw = normYaw(state.yaw);
    const pitch = clampPitch(state.pitch, pitchMin, pitchMax);
    yawRange.value = String(yaw);
    pitchRange.value = String(pitch);
    yawOut.textContent = yaw + "°";
    pitchOut.textContent = pitch + "°";
    const active = presetFor(pitch, presets);
    for (const b of presetBtns) b.setAttribute("aria-pressed", String(b.dataset.vkView === active));
  }

  function sync() {
    let s;
    try { s = adapter.get(); } catch { return; }
    if (!s) return;
    paint(s);
  }

  function scheduleSync() {
    if (busy || syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => { syncScheduled = false; sync(); });
  }

  function apply(state) {
    busy = true;
    try { adapter.set({ yaw: normYaw(state.yaw), pitch: clampPitch(state.pitch, pitchMin, pitchMax) }); }
    finally { busy = false; }
    paint(state);
  }

  function cancelTween() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  /* 從目前角度補間到目標(換邊/預設/重置用);滑桿則是即時 apply,不補間 */
  function tweenTo(target) {
    cancelTween();
    const from = adapter.get();
    const to = {
      yaw: target.yaw === undefined ? from.yaw : target.yaw,
      pitch: target.pitch === undefined ? from.pitch : clampPitch(target.pitch, pitchMin, pitchMax),
    };
    if (animateMs <= 0 || prefersReducedMotion()) { apply(to); return; }
    const dYaw = shortestDelta(from.yaw, to.yaw);
    const dPitch = to.pitch - from.pitch;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / animateMs);
      const e = ease(t);
      apply({ yaw: from.yaw + dYaw * e, pitch: from.pitch + dPitch * e });
      if (t < 1) raf = requestAnimationFrame(step); else { raf = 0; apply(to); }
    };
    raf = requestAnimationFrame(step);
  }

  function setView(key) {
    if (!presets[key]) return;
    tweenTo({ pitch: presets[key].pitch });
    onAction("view", { key, label: presets[key].label });
  }
  function cycleView() {
    const cur = presetFor(clampPitch(adapter.get().pitch, pitchMin, pitchMax), presets);
    setView(cur ? nextPreset(cur, order) : order[0]);
  }
  function flip() {
    tweenTo({ yaw: adapter.get().yaw + 180 });
    onAction("flip", {});
  }
  function reset() {
    cancelTween();
    busy = true;
    try { adapter.reset(); } finally { busy = false; }
    sync();
    onAction("reset", {});
  }

  for (const b of presetBtns) b.addEventListener("click", () => setView(b.dataset.vkView));
  q("[data-vk-flip]").addEventListener("click", flip);
  q("[data-vk-reset]").addEventListener("click", reset);
  yawRange.addEventListener("input", () => { cancelTween(); apply({ yaw: yawRange.value, pitch: pitchRange.value }); });
  pitchRange.addEventListener("input", () => { cancelTween(); apply({ yaw: yawRange.value, pitch: pitchRange.value }); });
  /* 滑桿上的指標事件不要漏給底下的畫布(OrbitControls 會把它當成拖曳) */
  for (const ev of ["pointerdown", "pointermove", "touchstart", "touchmove", "wheel"]) {
    el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }

  let off = null;
  if (typeof adapter.onChange === "function") off = adapter.onChange(scheduleSync);
  sync();

  return {
    el, sync, setView, cycleView, flip, reset,
    destroy() { cancelTween(); if (off) off(); el.remove(); },
  };
}

/**
 * orbitAdapter({ THREE, camera, controls, reset })
 * 給 OrbitControls 的站用。角度算法照抄 OrbitControls 內部:先把 offset 轉到 camera.up = +Y 的座標系
 * 再取球座標,所以「棋盤在 XY 平面、up 是 +Z」(3D-Xiangqi)和「棋盤在 XZ 平面、up 是 +Y」(3D-Chess)都對。
 *   yaw 0 = 建立 adapter 當下(或每次 reset 之後)的方位角 ⇒ 開場方向就是 0°。
 */
export function orbitAdapter({ THREE, camera, controls, reset }) {
  const up = camera.up.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  const quatInv = quat.clone().invert();
  const sph = new THREE.Spherical();
  const off = new THREE.Vector3();
  const EPS = 0.02;
  let home = 0;

  function read() {
    off.copy(camera.position).sub(controls.target).applyQuaternion(quat);
    sph.setFromVector3(off);
    return sph;
  }
  function captureHome() { home = read().theta; }
  captureHome();

  return {
    get() {
      const s = read();
      return { yaw: THREE.MathUtils.radToDeg(s.theta - home), pitch: 90 - THREE.MathUtils.radToDeg(s.phi) };
    },
    set({ yaw, pitch }) {
      const s = read();
      s.theta = home + THREE.MathUtils.degToRad(yaw);
      const minPhi = Math.max(EPS, controls.minPolarAngle ?? 0);
      const maxPhi = Math.min(Math.PI - EPS, controls.maxPolarAngle ?? Math.PI);
      s.phi = Math.min(maxPhi, Math.max(minPhi, THREE.MathUtils.degToRad(90 - pitch)));
      s.makeSafe();
      off.setFromSpherical(s).applyQuaternion(quatInv);
      camera.position.copy(controls.target).add(off);
      camera.lookAt(controls.target);
      /* 有阻尼時 update() 會慢慢滑回去 ⇒ 關掉阻尼硬放一次(3D-Chess resetCamera 的做法) */
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = damping;
    },
    reset() { reset(); captureHome(); },
    onChange(cb) {
      controls.addEventListener("change", cb);
      return () => controls.removeEventListener("change", cb);
    },
  };
}
