/* animals.js — 「桌邊座位型」可愛動物對手引擎:🐱 貓 / 🐻 熊 / 🐰 兔 / 🦉 貓頭鷹 四種 + 座位管理 + idle + 事件反應 + 表情。
 *
 * ★ 與 skill animal-opponent-kit/assets/animals.js **同一份** —— 不要在 repo 裡改;改 skill 再 cp 回各站。
 * ★ 沉澱自 majiang3d src/figures.js(2026-09-27 v6~v8,使用者退件三輪換來的鐵則);差異:
 *   ① 多了 owl ② 座位 / 擺位由呼叫端給(不綁麻將桌:pos / lookAt / scale / dy / legDrop)
 *   ③ 反應動詞改通用名(reach / place / hop / win / lose / pay / shrug / gasp / chat / think)④ 凳子高度可調,腳一定落地。
 *
 * ★ 純觀感層:不碰規則、不進 layout、不進 raycast;相機要不要讓位由站方決定(見 skill 第三節)。
 * ★ 鐵則(figure-head-neck-rules):脖子要有而且**看得到**(頭底 1.85 > 身頂 1.56)、頭是整顆球(後腦不裸)、
 *   眼耳嘴眉齊(userData 旗標給 smoke 遍歷數:neck 1 / eye 2 / ear 2 / brow 2 / mouth 1)、腳不懸空(凳子落地)、idle 要活。
 * ★ 反應是事件驅動、不是恆定人浪:每個 SFX.play 旁邊配一個 react;沒事就只有呼吸 / 眨眼 / 轉頭看子。
 */
import * as THREE from 'three'

export const ANIMALS = {
  cat:    { emoji: '🐱', name: '橘貓',   fur: 0xf29a3e, light: 0xfff0d8, dark: 0xc9731f, nose: 0xf08aa0, inner: 0xf7b3c6 },
  bear:   { emoji: '🐻', name: '棕熊',   fur: 0x8f5a2c, light: 0xdcb98a, dark: 0x5a3418, nose: 0x2a1a12, inner: 0xdcb98a },
  rabbit: { emoji: '🐰', name: '白兔',   fur: 0xf3ede6, light: 0xffffff, dark: 0xd8ccc0, nose: 0xf08aa0, inner: 0xf7b3c6 },
  owl:    { emoji: '🦉', name: '貓頭鷹', fur: 0x8a6a4a, light: 0xe9d9bd, dark: 0x4d3620, nose: 0xf0b03a, inner: 0xf6e7c8 },
}
export const ANIMAL_KINDS = Object.keys(ANIMALS)

/** 反應動詞 → 秒數。新站只挑用得到的;不認得的動詞 react() 回 false(不炸) */
export const REACT_DUR = { reach: 0.6, place: 0.5, hop: 0.9, win: 2.6, lose: 2.6, pay: 2.0, shrug: 1.6, gasp: 1.2, chat: 1.3, think: 8.0 }
const MOOD_OF = { win: 'cheer', lose: 'sad', pay: 'sad', hop: 'wow', shrug: 'wow', gasp: 'wow', chat: 'talk', think: 'think' }
const FACE = {
  happy: { smile: 1, open: 0,    browY: 0,     browIn: 0,    browAsym: 0 },
  sad:   { smile: 0, open: 0,    browY: -0.08, browIn: 0.45, browAsym: 0 },
  wow:   { smile: 1, open: 1,    browY: 0.1,   browIn: 0,    browAsym: 0 },
  cheer: { smile: 1, open: 1.4,  browY: 0.12,  browIn: 0,    browAsym: 0 },
  talk:  { smile: 1, open: 0.75, browY: 0.06,  browIn: 0,    browAsym: 0 },
  think: { smile: 1, open: 0,    browY: 0.02,  browIn: 0.2,  browAsym: 1 },   // 一邊眉毛挑起 = 在想
}

const mat = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o }
const ARM_REST_X = -1.2

/**
 * 一隻動物:正面朝 +z、原點 y=0 在身體底(凳面 y≈-0.2)、頭心 y=2.9、頭頂 y≈3.95、掌心休息在 (±0.88, 0.4, 1.34)。
 * @param {string} kind cat | bear | rabbit | owl
 * @param {{legDrop?:number}} opts legDrop = 凳子底盤離原點多深(預設 2.56;站方用 (dy - floorY) / scale 算,腳一定落地)
 * @returns 各部位(動畫與 smoke 都用這些名字)
 */
export function makeAnimal(kind, opts = {}) {
  const P = ANIMALS[kind] || ANIMALS.cat
  const legDrop = Math.max(0.7, opts.legDrop ?? 2.56)
  const fur = mat(P.fur), light = mat(P.light), dark = mat(P.dark), inner = mat(P.inner), white = mat(0xffffff, 0.4), black = mat(0x1a1a1a, 0.5)
  const g = new THREE.Group()
  g.userData.kind = kind
  // 凳子(座面 / 柱 / 底盤):底盤落在 y = -legDrop,腳不懸空
  const stool = mat(0x4a3222, 0.7)
  g.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.34, 20), stool, 0, -0.37, 0))
  const postTop = -0.54, postBottom = -legDrop + 0.12
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, postTop - postBottom, 12), stool, 0, (postTop + postBottom) / 2, 0))
  g.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 20), stool, 0, -legDrop + 0.06, 0))
  // 身體(蛋形)+ 淺色肚子
  const body = mesh(new THREE.SphereGeometry(1, 24, 18), fur, 0, 0.66, 0)
  body.scale.set(1.0, 0.9, 0.85); body.castShadow = true
  const belly = mesh(new THREE.SphereGeometry(1, 20, 14), light, 0, 0.55, 0.62)
  belly.scale.set(0.62, 0.58, 0.35)
  g.add(body, belly)
  // 脖子:頭底 1.85、身頂 1.56 ⇒ 露出 0.29(加了脖子還要看得到;近拍驗過)
  const neck = mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 14), fur, 0, 1.55, 0)
  neck.userData.neck = true
  g.add(neck)
  // 頭(群組,樞紐 = 頭心;眼耳嘴眉全在裡面,轉頭整組動)
  const head = new THREE.Group(); head.position.set(0, 2.9, 0)
  const skull = mesh(new THREE.SphereGeometry(1.05, 28, 20), fur); skull.castShadow = true
  head.add(skull)
  if (kind === 'owl') {                                   // 🦉 臉盤:淺色心形扁球貼在臉前
    const disc = mesh(new THREE.SphereGeometry(1, 20, 14), light, 0, 0.02, 0.62); disc.scale.set(0.92, 0.8, 0.5)
    head.add(disc)
  }
  const eyes = [], brows = [], ears = []
  const eyeR = kind === 'owl' ? 0.3 : 0.21, eyeX = kind === 'owl' ? 0.42 : 0.4, eyeZ = kind === 'owl' ? 1.0 : 0.93
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * eyeX, 0.14, eyeZ)   // 往外凸一點:埋太深從側面看像瞇眼
    eye.add(mesh(new THREE.SphereGeometry(eyeR, 16, 12), white))
    if (kind === 'owl') eye.add(mesh(new THREE.SphereGeometry(0.19, 14, 10), mat(0xf2b632, 0.5), 0, 0, 0.16))   // 黃虹膜
    eye.add(mesh(new THREE.SphereGeometry(kind === 'owl' ? 0.11 : 0.115, 12, 10), black, 0, 0, kind === 'owl' ? 0.27 : 0.14))
    eye.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), white, -0.05 * sx, 0.06, kind === 'owl' ? 0.34 : 0.23))
    eye.userData.eye = true
    head.add(eye); eyes.push(eye)
    const browY = kind === 'owl' ? 0.58 : 0.5
    const brow = mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), dark, sx * eyeX, browY, 0.92)
    brow.rotation.z = -sx * 0.12          // 外側微微下垂 = 放鬆
    brow.userData.brow = true; brow.userData.rest = { y: browY, z: -sx * 0.12 }
    head.add(brow); brows.push(brow)
  }
  // 嘴:笑弧(∪)+ 張嘴(驚訝 / 歡呼才顯示)
  const mouthY = kind === 'bear' ? -0.46 : kind === 'owl' ? -0.5 : -0.34, mouthZ = kind === 'bear' ? 1.1 : 0.98
  const smile = mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 18, Math.PI), black, 0, mouthY, mouthZ)
  smile.rotation.z = Math.PI            // π = ∪ 笑;0 = ∩ 苦臉
  smile.userData.mouth = true; smile.userData.rest = { y: mouthY }
  const mouthOpen = mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(0x6a2020, 0.6), 0, mouthY - 0.02, mouthZ + 0.02)
  mouthOpen.scale.set(1, 1.2, 0.5); mouthOpen.visible = false
  head.add(smile, mouthOpen)
  // 鼻子 / 耳朵 / 各動物特徵
  let tail = null
  if (kind === 'cat') {
    head.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(P.nose, 0.5), 0, -0.1, 1.02))
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(sx * 0.62, 0.86, -0.05); ear.rotation.z = sx * 0.38
      ear.add(mesh(new THREE.ConeGeometry(0.34, 0.62, 16), fur))
      ear.add(mesh(new THREE.ConeGeometry(0.19, 0.4, 16), inner, 0, -0.04, 0.13))
      ear.userData.ear = true; head.add(ear); ears.push(ear)
      for (let k = 0; k < 3; k++) {                       // 鬍鬚三根一邊
        const w = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.75, 6), mat(0xfafafa, 0.6), sx * 0.98, -0.24 + k * 0.1, 0.72)
        w.rotation.z = Math.PI / 2 + sx * (k - 1) * 0.22
        head.add(w)
      }
    }
    tail = mesh(new THREE.CapsuleGeometry(0.1, 1.1, 6, 10), fur, 0.55, 0.45, -0.85)
    tail.rotation.x = -0.9; tail.rotation.z = -0.35
    tail.userData.rest = { z: -0.35 }
  } else if (kind === 'bear') {
    const muzzle = mesh(new THREE.SphereGeometry(1, 18, 14), light, 0, -0.26, 0.86); muzzle.scale.set(0.52, 0.4, 0.38)
    head.add(muzzle)
    head.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), mat(P.nose, 0.5), 0, -0.12, 1.16))
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(sx * 0.74, 0.8, -0.08)
      ear.add(mesh(new THREE.SphereGeometry(0.33, 16, 12), fur))
      ear.add(mesh(new THREE.SphereGeometry(0.18, 12, 10), inner, -sx * 0.02, 0, 0.22))
      ear.userData.ear = true; head.add(ear); ears.push(ear)
    }
    tail = mesh(new THREE.SphereGeometry(0.22, 12, 10), fur, 0, 0.3, -0.9)
  } else if (kind === 'owl') {
    const beak = mesh(new THREE.ConeGeometry(0.11, 0.3, 10), mat(P.nose, 0.45), 0, -0.14, 1.06)   // 喙:尖朝前
    beak.rotation.x = Math.PI / 2
    head.add(beak)
    for (const sx of [-1, 1]) {                              // 角羽(耳簇):兩撮小尖角,算「耳」
      const ear = new THREE.Group(); ear.position.set(sx * 0.58, 0.9, -0.1); ear.rotation.z = sx * 0.55
      ear.add(mesh(new THREE.ConeGeometry(0.2, 0.55, 12), dark))
      ear.userData.ear = true; head.add(ear); ears.push(ear)
    }
    tail = mesh(new THREE.BoxGeometry(0.5, 0.1, 0.45), dark, 0, 0.1, -0.85)   // 尾羽扇
    tail.rotation.x = 0.5
  } else {
    head.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(P.nose, 0.5), 0, -0.1, 1.02))
    for (const sx of [-1, 1]) {
      // 🐰 垂耳(lop):耳根在頭頂側邊、往下外側垂。直立長耳(majiang3d 那隻)比頭頂還高 1.3,棋類站的相機只讓得出「頭頂剛好入鏡」,
      // 耳尖一定被切 ⇒ 改垂耳:剪影一樣認得出是兔(tsum-3d-kit 剪影鐵則),而且更萌。樞紐 = 耳根,idle 的 rotation.x 小幅擺動照舊。
      const ear = new THREE.Group(); ear.position.set(sx * 0.66, 0.72, -0.05); ear.rotation.z = sx * 0.45
      ear.add(mesh(new THREE.CapsuleGeometry(0.21, 1.3, 6, 12), fur, 0, -0.86, 0))
      const lining = mesh(new THREE.CapsuleGeometry(0.11, 1.0, 6, 12), inner, 0, -0.86, 0.13); lining.scale.z = 0.5
      ear.add(lining)
      ear.userData.ear = true; ear.userData.rest = { x: 0 }; head.add(ear); ears.push(ear)
      head.add(mesh(new THREE.SphereGeometry(0.15, 12, 10), inner, sx * 0.6, -0.18, 0.8))   // 腮紅
    }
    head.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.06), white, 0, -0.42, 0.98))          // 門牙
    tail = mesh(new THREE.SphereGeometry(0.3, 12, 10), light, 0, 0.28, -0.92)
  }
  if (tail) g.add(tail)
  g.add(head)
  // 手(貓頭鷹是翅膀:扁一點、尖端淺色):肩膀樞紐,休息姿勢往前搭在桌沿(掌心落在 y≈0.4、z≈1.34)
  const arms = []
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.88, 1.08, 0.15)
    const limb = mesh(new THREE.CapsuleGeometry(0.19, 0.85, 6, 12), fur, 0, -0.615, 0)
    if (kind === 'owl') limb.scale.set(1.3, 1, 0.6)
    arm.add(limb)
    arm.add(mesh(new THREE.SphereGeometry(0.25, 14, 10), light, 0, -1.28, 0))
    arm.userData.rest = { x: ARM_REST_X, z: sx * 0.1 }
    arm.rotation.set(ARM_REST_X, 0, sx * 0.1)
    g.add(arm); arms.push(arm)
  }
  // 腳:坐著往前垂
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.45, 0.05, 0.35); leg.rotation.x = -0.45
    leg.add(mesh(new THREE.CapsuleGeometry(0.17, 0.55, 6, 12), fur, 0, -0.45, 0))
    leg.add(mesh(new THREE.SphereGeometry(0.22, 14, 10), kind === 'owl' ? mat(P.nose, 0.5) : light, 0, -0.85, 0))
    g.add(leg)
  }
  return { group: g, kind, body, head, eyes, brows, smile, mouthOpen, ears, arms, tail }
}

/** 頭頂在動物**本地座標**的高度(頭心 2.9 + 半徑 1.05);站方算取景點用 */
export const HEAD_TOP_LOCAL_Y = 3.95

/* ── 座位管理:add / place / setKind / react / update ── */
export class AnimalFigures {
  constructor(scene) {
    this.scene = scene
    this.list = []
    this.log = []       // 驗收用:最近 40 筆 { seat, kind } —— smoke 靠它證明事件真的接到(grep 到 ≠ 被使用)
    this.on = true
    this._t = 0
  }

  bySeat(seat) { return this.list.find((f) => f.seat === seat) || null }

  /**
   * 加一隻。place = { pos:{x,y,z}, lookAt:{x,z}|null, scale=1, dy=0, legDrop }
   *   pos = 原點(身體底)世界座標;lookAt = 正面朝向的點(只取水平);dy = 整隻升降;legDrop = 凳底離原點深度(本地單位)
   */
  add(seat, kind, place = {}) {
    if (this.bySeat(seat)) this.remove(seat)
    const f = makeAnimal(kind, { legDrop: place.legDrop })
    f.seat = seat
    f.phase = (this.list.length + 1) * 2.1
    f.blinkAt = 1.5 + this.list.length * 0.9
    f.blinkT = 0
    f.look = { yaw: 0, pitch: 0.15 }
    f.mood = 'happy'; f.moodUntil = 0
    f.anim = null
    f.face = { ...FACE.happy }
    this.scene.add(f.group)
    this.list.push(f)
    this._place(f, place)
    f.group.visible = this.on
    return f
  }

  _place(f, place) {
    const p = { pos: { x: 0, y: 0, z: 0 }, lookAt: null, scale: 1, dy: 0, legDrop: 2.56, ...(f.pose || {}), ...place }
    f.pose = p
    f.baseY = p.pos.y + p.dy
    f.group.position.set(p.pos.x, f.baseY, p.pos.z)
    f.group.scale.setScalar(p.scale)
    if (p.lookAt) f.group.lookAt(p.lookAt.x, f.baseY, p.lookAt.z)
  }

  /** 重新擺位(換邊 / 轉盤時);legDrop 變了要 setKind 重做 */
  place(seat, place) { const f = this.bySeat(seat); if (f) this._place(f, place); return !!f }

  /** 換一隻動物,座位與擺位不變 */
  setKind(seat, kind, place = {}) {
    const f = this.bySeat(seat)
    const pose = f ? { ...f.pose, ...place } : place
    return this.add(seat, kind, pose)
  }

  remove(seat) {
    const f = this.bySeat(seat)
    if (!f) return false
    this.scene.remove(f.group)
    f.group.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (Array.isArray(m)) m.forEach((x) => x?.dispose?.()); else m?.dispose?.() })
    this.list = this.list.filter((x) => x !== f)
    return true
  }

  setVisible(on) {
    this.on = !!on
    for (const f of this.list) f.group.visible = this.on     // ★ 嚴格布林:three 只認 visible === false
  }

  /** 事件反應。kind 見 REACT_DUR;不認得回 false。同一隻連續 react 後者蓋前者(think 會被 place 打斷,對的) */
  react(seat, kind) {
    const f = this.bySeat(seat)
    if (!f || !REACT_DUR[kind]) return false
    f.anim = { kind, t: 0, dur: REACT_DUR[kind] }
    const mood = MOOD_OF[kind]
    if (mood) { f.mood = mood; f.moodUntil = this._t + REACT_DUR[kind] + 0.4 } else if (f.mood === 'think') { f.mood = 'happy' }
    this.log.push({ seat, kind }); if (this.log.length > 40) this.log.shift()
    return true
  }

  /** 收掉進行中的反應(例如 think 等到了手) */
  cancel(seat) { const f = this.bySeat(seat); if (!f) return false; f.anim = null; f.mood = 'happy'; return true }

  /** 頭頂世界座標(取景 / smoke 驗「頭在畫面裡」用) */
  headTop(seat) {
    const f = this.bySeat(seat)
    if (!f) return null
    return f.group.localToWorld(new THREE.Vector3(0, HEAD_TOP_LOCAL_Y, 0))
  }
  headCenter(seat) {
    const f = this.bySeat(seat)
    return f ? f.head.getWorldPosition(new THREE.Vector3()) : null
  }

  /** 每幀。ctx = { focus: Vector3|null(要看的東西,例如最後那顆子), turn: seat|null(輪到誰 ⇒ 低頭看自己手邊), reduced: 減少動態 } */
  update(dt, ctx = {}) {
    this._t += dt
    if (!this.on) return
    const t = this._t
    const k = 1 - Math.exp(-dt * 6)
    for (const f of this.list) {
      // ── 呼吸 / 微晃 ──
      if (!ctx.reduced) {
        f.body.scale.y = 0.9 + 0.018 * Math.sin(t * 1.9 + f.phase)
        f.head.position.y = 2.9 + 0.03 * Math.sin(t * 1.9 + f.phase)
        f.body.rotation.z = 0.02 * Math.sin(t * 0.7 + f.phase)
        if (f.kind === 'cat' && f.tail) f.tail.rotation.z = f.tail.userData.rest.z + 0.25 * Math.sin(t * 1.6 + f.phase)
        if (f.kind === 'rabbit') f.ears.forEach((e, i) => { e.rotation.x = 0.06 * Math.sin(t * 2.3 + i * 1.7 + f.phase) })
      }
      // ── 眨眼(各自錯開的節奏,決定性) ──
      if (f.blinkT > 0) { f.blinkT -= dt; if (f.blinkT <= 0) { f.blinkT = 0; f.blinkAt = t + 2.6 + ((Math.sin(t * 7.3 + f.phase) + 1) * 1.8) } }
      else if (t >= f.blinkAt) f.blinkT = 0.13
      const eyeY = f.blinkT > 0 ? 0.08 : (f.mood === 'sad' ? 0.6 : 1)
      for (const e of f.eyes) e.scale.y += (eyeY - e.scale.y) * (f.blinkT > 0 ? 1 : k)
      // ── 看哪裡:輪到自己看自己手邊;不然看 focus;都沒有就看前方 ──
      let ty = 0, tp = 0.15
      const p = ctx.turn === f.seat ? f.group.localToWorld(new THREE.Vector3(0, 0.3, 2.0)) : (ctx.focus || null)
      if (p) {
        const l = f.group.worldToLocal(p.clone())
        const dx = l.x, dy = l.y - f.head.position.y, dz = l.z
        ty = THREE.MathUtils.clamp(Math.atan2(dx, dz), -0.75, 0.75)
        tp = THREE.MathUtils.clamp(Math.atan2(-dy, Math.hypot(dx, dz)), -0.25, 0.5)
      }
      // ── 反應動畫(事件驅動;結束就回休息姿勢) ──
      let armX = [null, null], armZ = [null, null], hop = 0, pitchAdd = 0, tiltAdd = 0
      if (f.anim) {
        const a = f.anim; a.t += dt
        const u = Math.min(1, a.t / a.dur), s = Math.sin(u * Math.PI)     // 0→1→0 的一個鐘形
        const R = ARM_REST_X
        if (a.kind === 'reach') { armX[1] = R - 0.85 * s }
        else if (a.kind === 'place') { armX[1] = R - 0.45 * s; armZ[1] = 0.1 + 0.8 * s }
        else if (a.kind === 'hop') { armX = [R - 1.0 * s, R - 1.0 * s]; hop = 0.18 * s }
        else if (a.kind === 'win') { const up = Math.min(1, a.t / 0.35); armX = [R - 1.8 * up, R - 1.8 * up]; armZ = [-0.35 * up, 0.35 * up]; hop = 0.3 * Math.abs(Math.sin(a.t * 3 * Math.PI / a.dur)) * (1 - u * 0.5) }
        else if (a.kind === 'lose' || a.kind === 'pay') { const d = a.kind === 'lose' ? 1 : 0.55; armX = [R + 0.8 * s * d, R + 0.8 * s * d]; pitchAdd = 0.45 * s * d }
        else if (a.kind === 'shrug') { armX = [R - 0.5 * s, R - 0.5 * s]; armZ = [-0.6 * s, 0.6 * s] }
        else if (a.kind === 'gasp') { armX = [R - 0.7 * s, R - 0.7 * s]; hop = 0.1 * s }
        else if (a.kind === 'chat') { armX[1] = R - 0.9 * s; armZ[1] = 0.1 + 0.55 * s; tiltAdd = 0.16 * s }   // 💬 一隻手向你揮、頭歪一下
        else if (a.kind === 'think') {                                                                  // 🤔 手托腮、頭歪、看著盤面
          const inn = Math.min(1, a.t / 0.5), out = Math.min(1, (a.dur - a.t) / 0.5), w = Math.min(inn, out)
          armX[1] = R - 1.15 * w; armZ[1] = 0.1 - 0.62 * w; tiltAdd = -0.14 * w; pitchAdd = 0.12 * w
        }
        if (a.t >= a.dur) f.anim = null
      }
      if (ctx.reduced) hop = 0
      f.arms.forEach((arm, i) => {
        const r = arm.userData.rest
        const gx = armX[i] != null ? armX[i] : r.x, gz = armZ[i] != null ? armZ[i] : r.z
        arm.rotation.x += (gx - arm.rotation.x) * (f.anim ? Math.min(1, dt * 14) : k)
        arm.rotation.z += (gz - arm.rotation.z) * (f.anim ? Math.min(1, dt * 14) : k)
      })
      f.group.position.y += ((f.baseY + hop * f.pose.scale) - f.group.position.y) * Math.min(1, dt * 16)
      f.look.yaw += (ty - f.look.yaw) * k
      f.look.pitch += (tp + pitchAdd - f.look.pitch) * k
      f.head.rotation.set(f.look.pitch, f.look.yaw, tiltAdd)
      // ── 表情(mood → 目標數值 → lerp) ──
      if (f.mood !== 'happy' && t >= f.moodUntil) f.mood = 'happy'
      const M = FACE[f.mood] || FACE.happy
      const F = f.face
      for (const key of ['smile', 'open', 'browY', 'browIn', 'browAsym']) F[key] += (M[key] - F[key]) * Math.min(1, dt * 8)
      f.smile.rotation.z = Math.PI * F.smile                       // 1 = ∪ 笑、0 = ∩ 苦
      f.smile.position.y = f.smile.userData.rest.y - 0.08 * (1 - F.smile)
      f.smile.visible = F.open < 0.5
      f.mouthOpen.visible = F.open >= 0.5
      f.mouthOpen.scale.set(F.open, F.open * 1.2, 0.5)
      f.brows.forEach((b, i) => {
        const sx = i === 0 ? -1 : 1, r = b.userData.rest
        b.position.y = r.y + F.browY + F.browAsym * (i === 0 ? 0.09 : -0.03)
        b.rotation.z = r.z - sx * F.browIn * 0.9    // 內側往上 = 苦臉的「八」字眉(繞 z 轉 +θ 是 +x 端往上;左眉在 -x,內側是 +x 端)
      })
    }
  }
}
