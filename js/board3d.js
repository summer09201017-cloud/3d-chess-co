/* board3d.js — 平面棋盤的 3D 底座 v1(joshua-go3d 首用,設計成可被其他棋類直接搬走)
 *
 * 收割自 Desktop/AI/carrom3d src/game.js 的 _initScene / _buildTable / clientToTable:
 *   桌板 + 木框 + 桌腳 + 地板、半球燈 + 桌燈 + 平行光、Raycaster.setFromCamera 打平面取命中點。
 * 為什麼不直接 fork carrom3d:那支把「物理 + 規則 + 畫面」綁在同一個 class,棋類不需要物理;
 *   這裡只留「一張桌子 + 一張棋盤 + 點到哪一格」,棋子長什麼樣、規則怎麼走全部交給上層。
 *
 * 這支**不認得圍棋**:給它 cols/rows/mode 就畫盤,回傳 {row,col}。
 *   mode: 'intersection' 下在線的交叉點(圍棋/五子棋)| 'cell' 下在格子中心(西洋棋/暗棋/跳棋)
 *
 * ★ 相機取景鐵則:棋盤**一定**要整塊入鏡(艦隊踩過「棋盤溢出、四周變藍」的坑 ⇒ /map-fit-check)。
 *   fitCamera() 不是估的——把四個盤角投影到 NDC 迭代收斂,直到最外角落在 ±FIT_EDGE 內。
 *   直向手機、橫向平板、投影機 4:3 都走同一段程式,不必為每種螢幕各調一次。
 */
import * as THREE from "three";

/* 盤角投影後允許的最大 |ndc|,**兩軸分開**:
   左右沒有東西擋(HUD 在上下)⇒ 可以貼到 0.96;上下要讓開狀態列與工具列 ⇒ 0.90。
   合成一個值的舊寫法會讓直向手機白白少掉 6% 的棋盤寬度。 */
const FIT_EDGE_X = 0.96;
const FIT_EDGE_Y = 0.90;
const EXTRA_EDGE_X = 0.98;      // fitExtra 的點(對手頭頂)可以貼到邊
const EXTRA_EDGE_Y = 0.97;
const FIT_EXTRA_MAX = 1.28;     // 為了 fitExtra 最多把相機拉遠到 1.28 倍(棋盤最多縮 ~22%)
const THICK = 0.09;            // 盤身厚度
const TABLE_Y = 0;             // 盤面高度(世界座標 y);棋子站在 y=0 之上

export const VIEWS = {
  top:  { pitch: 58, label: "斜俯視" },   // 預設:看得到立體感,又看得清整盤
  flat: { pitch: 88, label: "正俯視" },   // 像 2D 版,對局最清楚
  sit:  { pitch: 34, label: "對局視角" }, // 低角度,像坐在桌邊
};

const DEFAULTS = {
  cols: 9,
  rows: 0,                 // 0 = 正方形,跟 cols 一樣
  mode: "intersection",
  pitch: 0.26,             // 相鄰兩線的世界距離
  margin: 0.62,            // 盤緣留白(pitch 的倍數);只要放得下盤緣座標就好——
                           // 留白是**吃掉棋盤**換來的:0.95 時 13 路在 390px 手機上棋盤只有 81% 寬,
                           // 收到 0.62 就是 87%,而座標字(pitch×0.34)還有餘裕。
  wood: "#e5c188",
  woodEdge: 0x9c703c,
  woodSide: 0xc49a5e,
  lineColor: "#4b3418",
  background: 0x101a2c,
  labels: true,
  star: null,              // [[row,col],…];null = 不畫
  storageKey: "board3d-view",
  floor: true,
};

export class Board3D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opt = { ...DEFAULTS, ...opts };
    this.cols = this.opt.cols;
    this.rows = this.opt.rows || this.opt.cols;
    this.view = this._loadView();
    this.yaw = 0;                       // 換邊(雙人對戰轉 180°)
    this.pitchOverride = null;          // 俯視角度滑桿(view-kit)的覆寫,度;null = 用 VIEWS[view].pitch(+直向自動拉高)
    this._ticks = new Set();
    this._boardGroup = null;
    this.pieceLayer = new THREE.Group();
    this._ndc = new THREE.Vector2();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_Y);
    this._hit = new THREE.Vector3();
    this._initScene();
    this.rebuild(this.cols, this.rows);
  }

  /* ── 場景(桌子 / 燈 / 相機 / 迴圈)── */
  _initScene() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = r;
    this.maxAniso = r.capabilities?.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.opt.background);
    this.scene.fog = new THREE.Fog(this.opt.background, 7, 17);

    // fov 小一點 = 相機退遠 = 透視變形小:46 度時近端的盤緣座標會被拉成遠端的三倍大,
    // 像哈哈鏡;38 度接近真人看棋盤的感覺,盤面四角也比較不會被拉歪。
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    this.target = new THREE.Vector3(0, TABLE_Y, 0);

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2a20, 0.85));
    const lamp = new THREE.PointLight(0xfff0d0, 22, 10, 1.9);
    lamp.position.set(0.4, 2.4, 0.8);
    this.scene.add(lamp);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(2.5, 4, 2);
    this.scene.add(dir);
    this.scene.add(this.pieceLayer);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this._clock = new THREE.Clock();
    r.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    for (const fn of this._ticks) fn(dt);
    this.renderer.render(this.scene, this.camera);
  }

  addTick(fn) { this._ticks.add(fn); return () => this._ticks.delete(fn); }

  resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || window.innerHeight;
    // ★ dpr 要**每次 resize 重設**:換螢幕/瀏覽器縮放會改 devicePixelRatio,只在 init 設一次
    //   的站在手機上是 1/3 解析度再被放大(整個畫面糊,而且零紅燈)⇒ board-game-designer 🔍 那條。
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = Math.max(w / Math.max(h, 1), 0.2);
    this.camera.updateProjectionMatrix();
    this.fitCamera();
  }

  /* ── 幾何:格 ↔ 世界 ── */
  /** 地板的世界 y(桌腳落地處;對手的凳子也要落在這裡) */
  get floorY() { return TABLE_Y - THICK - 0.68; }
  get spanX() { return this.opt.pitch * (this.opt.mode === "cell" ? this.cols : this.cols - 1); }
  get spanZ() { return this.opt.pitch * (this.opt.mode === "cell" ? this.rows : this.rows - 1); }
  get halfX() { return this.spanX / 2 + this.opt.pitch * this.opt.margin; }
  get halfZ() { return this.spanZ / 2 + this.opt.pitch * this.opt.margin; }

  cellToWorld(row, col) {
    const p = this.opt.pitch;
    const off = this.opt.mode === "cell" ? 0.5 : 0;
    return {
      x: (col + off) * p - this.spanX / 2,
      z: (row + off) * p - this.spanZ / 2,
    };
  }

  /** 世界座標 → 最近的格 / 交叉點;離盤太遠回 null(手指滑出盤外不要亂下) */
  worldToCell(x, z) {
    const p = this.opt.pitch;
    const off = this.opt.mode === "cell" ? 0.5 : 0;
    const fc = (x + this.spanX / 2) / p - off;
    const fr = (z + this.spanZ / 2) / p - off;
    const col = Math.round(fc), row = Math.round(fr);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    // 離最近點超過 0.75 格就當沒點到(手指停在盤外的留白上不要硬吸進來)
    if (Math.abs(fc - col) > 0.75 || Math.abs(fr - row) > 0.75) return null;
    return { row, col, idx: row * this.cols + col };
  }

  /** 格 → 螢幕座標(pickCell 的反向;冒煙測試要「真的點在那一格上」就靠這支) */
  cellToScreen(row, col) {
    const w = this.cellToWorld(row, col);
    const v = new THREE.Vector3(w.x, TABLE_Y, w.z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  }

  /** 螢幕座標 → 格(唯一一份 raycast) */
  pickCell(clientX, clientY) {
    const pt = this.pickWorld(clientX, clientY);
    return pt ? this.worldToCell(pt.x, pt.z) : null;
  }

  /* ★ 只打一張無限平面,不走 intersectObjects(scene.children, true):
     拖曳時每一下 pointermove 都會叫到這裡,全場景遍歷會讓沉浸版面卡到 3 秒
     (3d-chess-co v29 實錄)。射線/平面/向量都重用,避免每幀配置新物件。 */
  pickWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    if (!this._ray.ray.intersectPlane(this._plane, this._hit)) return null;
    return { x: this._hit.x, y: this._hit.y, z: this._hit.z };
  }

  /* ── 相機 ── */
  setView(name) {
    if (!VIEWS[name]) return;
    this.view = name;
    this.pitchOverride = null;          // 按預設鈕 = 清掉滑桿覆寫,把「直向自動拉高俯角」的智慧交回 _pitchFor()
    try { localStorage.setItem(this.opt.storageKey, name); } catch { /* 私密模式:不記就算了 */ }
    this.fitCamera();
  }

  _loadView() {
    try {
      const v = localStorage.getItem(this.opt.storageKey);
      if (VIEWS[v]) return v;
    } catch { /* ignore */ }
    return "top";
  }

  setYaw(deg) { this.yaw = deg; this.fitCamera(); }

  /**
   * 俯視角度滑桿(view-kit):使用者說幾度就幾度,**跳過**直向自動拉高。
   * 夾在 5~88°(0° / 90° 會讓 lookAt 的 up 向量退化);非數字 = 取消覆寫。按任何預設鈕(setView)就清掉。
   */
  setPitch(deg) {
    const d = Number(deg);
    this.pitchOverride = Number.isFinite(d) ? Math.min(88, Math.max(5, d)) : null;
    this.fitCamera();
  }

  /**
   * 這個螢幕比例實際要用的俯角。
   * ★ 直向手機:棋盤的**寬**被螢幕寬卡死,再怎麼調相機也不會更寬;但俯角越低,縱向被壓得越扁
   *   ——13 路在 390×844 量到行距只剩橫向的六成,上下各空一大片黑。把俯角往「正上方」拉,
   *   縱向就回來了(格子接近正方形,手指也比較不會點錯列)。橫向/桌機 aspect≥1 不動。
   */
  _pitchFor() {
    if (this.pitchOverride != null) return this.pitchOverride;   // 滑桿覆寫:原樣照用(!= null 也擋掉 undefined)
    const base = VIEWS[this.view].pitch;
    const aspect = this.camera?.aspect || 1;
    const boost = Math.max(0, Math.min(22, (1 - aspect) * 40));
    return Math.min(88, base + boost);
  }

  /** 迭代收斂:讓四個盤角都落在 NDC ±FIT_EDGE 內(棋盤絕不溢出畫面)
   *  ★ 額外取景點(0927,🐾 動物對手):站方可掛 `board.fitExtra = () => [Vector3…]`(例如對手的頭頂),
   *    這些點用比較鬆的邊(EXTRA_EDGE),而且**縮盤上限 FIT_EXTRA_MAX**(距離最多拉到只收盤角時的 1.28 倍)——
   *    棋盤是主角,對手只是配角:讓不下就讓牠被切一點頭,不讓棋盤變小到點不到。fitExtra 回空陣列 = 跟以前完全一樣。 */
  fitCamera() {
    const a = THREE.MathUtils.degToRad(this._pitchFor());
    const y = THREE.MathUtils.degToRad(this.yaw);
    const dirV = new THREE.Vector3(
      Math.sin(y) * Math.cos(a),
      Math.sin(a),
      Math.cos(y) * Math.cos(a),
    ).normalize();
    const pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      pts.push({ p: new THREE.Vector3(sx * this.halfX, TABLE_Y, sz * this.halfZ), ex: FIT_EDGE_X, ey: FIT_EDGE_Y });
    }
    const placeCam = (d) => {
      this.camera.position.copy(this.target).addScaledVector(dirV, d);
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
    };
    const solve = (list, d0) => {
      let d = d0;
      for (let i = 0; i < 12; i++) {
        placeCam(d);
        let k = 0;
        for (const { p, ex, ey } of list) {
          const q = p.clone().project(this.camera);
          k = Math.max(k, Math.abs(q.x) / ex, Math.abs(q.y) / ey);   // 哪一點先頂到,就聽哪一點的
        }
        if (k < 0.0001) break;
        if (Math.abs(k - 1) < 0.004) break;
        d *= k;                       // 投得太外 ⇒ 退遠;太內 ⇒ 靠近
      }
      return d;
    };
    let d = solve(pts, Math.max(this.halfX, this.halfZ) * 3);
    const extra = typeof this.fitExtra === "function" ? this.fitExtra() : null;
    if (extra && extra.length) {
      const dBoard = d;
      const all = pts.concat(extra.map((p) => ({ p, ex: EXTRA_EDGE_X, ey: EXTRA_EDGE_Y })));
      d = Math.min(solve(all, d), dBoard * FIT_EXTRA_MAX);
    }
    placeCam(d);
    this.camDist = d;
    return d;
  }

  /* ── 盤面 ── */
  rebuild(cols, rows) {
    this.cols = cols;
    this.rows = rows || cols;
    if (this._boardGroup) {
      this.scene.remove(this._boardGroup);
      disposeTree(this._boardGroup);
    }
    this._boardGroup = this._buildBoard();
    this.scene.add(this._boardGroup);
    this.resize();
  }

  _buildBoard() {
    const g = new THREE.Group();
    const W = this.halfX * 2, H = this.halfZ * 2;

    // 盤面(上表面貼格線貼圖,側面木色)
    this._gridTex?.dispose();
    const tex = makeGridTexture(this, this.maxAniso);
    this._gridTex = tex;
    const side = new THREE.MeshStandardMaterial({ color: this.opt.woodSide, roughness: 0.75 });
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 });
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(W, THICK, H),
      [side, side, topMat, side, side, side],   // +x,-x,+y,-y,+z,-z
    );
    slab.position.y = TABLE_Y - THICK / 2;
    g.add(slab);

    // 盤邊(深木框)
    const edge = new THREE.MeshStandardMaterial({ color: this.opt.woodEdge, roughness: 0.8 });
    const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.05, H + 0.1), edge);
    rim.position.y = TABLE_Y - THICK - 0.02;
    g.add(rim);

    if (this.opt.floor) {
      // 桌腳 + 地板(有落地感,不像漂在太空)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 10), edge);
        leg.position.set(sx * (W / 2 - 0.12), TABLE_Y - THICK - 0.35, sz * (H / 2 - 0.12));
        g.add(leg);
      }
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(W, H) * 2.6, 40),
        new THREE.MeshStandardMaterial({ color: 0x1a2336, roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = TABLE_Y - THICK - 0.68;
      g.add(floor);
    }
    return g;
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.renderer.setAnimationLoop(null);
    if (this._boardGroup) disposeTree(this._boardGroup);
    disposeTree(this.pieceLayer);
    this._gridTex?.dispose();
    this.renderer.dispose();
  }
}

/* ── 格線貼圖:用 Canvas 畫線比用幾何畫線省上千個 draw call,放大也不鋸齒 ── */
export function makeGridTexture(board, maxAniso = 1, doc = globalThis.document) {
  const { cols, rows } = board;
  const o = board.opt;
  const px = Math.min(2048, Math.max(768, (cols + 2) * 110));
  const cv = doc.createElement("canvas");
  const W = board.halfX * 2, H = board.halfZ * 2;
  cv.width = px;
  cv.height = Math.round(px * (H / W));
  const cx = cv.getContext("2d");
  const sx = cv.width / W;                       // 世界 → 貼圖像素
  const toPx = (wx, wz) => [(wx + W / 2) * sx, (wz + H / 2) * sx];

  // 底色 + 木紋
  cx.fillStyle = o.wood;
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.fillStyle = "rgba(120,80,30,0.06)";
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * cv.height + Math.sin(i * 2.7) * 6;
    cx.fillRect(0, y, cv.width, (cv.height / 90) * (0.6 + (i % 3) * 0.3));
  }

  const lw = Math.max(1.5, sx * o.pitch * 0.035);
  cx.strokeStyle = o.lineColor;
  cx.lineWidth = lw;
  cx.lineCap = "square";
  const first = board.cellToWorld(0, 0), last = board.cellToWorld(rows - 1, cols - 1);
  if (o.mode === "cell") {
    // 格子盤:一格一格畫(西洋棋那型上層還會再貼深淺格)
    for (let c = 0; c <= cols; c++) {
      const x = c * o.pitch - board.spanX / 2;
      strokeLine(cx, toPx(x, -board.spanZ / 2), toPx(x, board.spanZ / 2));
    }
    for (let r = 0; r <= rows; r++) {
      const z = r * o.pitch - board.spanZ / 2;
      strokeLine(cx, toPx(-board.spanX / 2, z), toPx(board.spanX / 2, z));
    }
  } else {
    for (let c = 0; c < cols; c++) {
      const x = board.cellToWorld(0, c).x;
      strokeLine(cx, toPx(x, first.z), toPx(x, last.z));
    }
    for (let r = 0; r < rows; r++) {
      const z = board.cellToWorld(r, 0).z;
      strokeLine(cx, toPx(first.x, z), toPx(last.x, z));
    }
    // 外框加粗(真棋盤的樣子)
    cx.lineWidth = lw * 1.9;
    const [ax, ay] = toPx(first.x, first.z);
    cx.strokeRect(ax, ay, (last.x - first.x) * sx, (last.z - first.z) * sx);
  }

  // 星位
  if (o.star) {
    cx.fillStyle = o.lineColor;
    for (const [r, c] of o.star) {
      const w = board.cellToWorld(r, c);
      const [ax, ay] = toPx(w.x, w.z);
      cx.beginPath();
      cx.arc(ax, ay, Math.max(2.5, sx * o.pitch * 0.09), 0, 7);
      cx.fill();
    }
  }

  // 盤緣座標(老師報座標用:橫排字母、直排數字)
  if (o.labels) {
    const fs = Math.max(10, sx * o.pitch * 0.34);
    cx.fillStyle = "rgba(60,40,15,0.62)";
    cx.font = `600 ${fs}px "Microsoft JhengHei",system-ui,sans-serif`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    const edgeZ = board.halfZ - o.pitch * o.margin * 0.5;
    const edgeX = board.halfX - o.pitch * o.margin * 0.5;
    for (let c = 0; c < cols; c++) {
      const w = board.cellToWorld(0, c);
      cx.fillText(colLabel(c), ...toPx(w.x, -edgeZ));
      cx.fillText(colLabel(c), ...toPx(w.x, edgeZ));
    }
    for (let r = 0; r < rows; r++) {
      const w = board.cellToWorld(r, 0);
      cx.fillText(String(rows - r), ...toPx(-edgeX, w.z));
      cx.fillText(String(rows - r), ...toPx(edgeX, w.z));
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A,B,…(跳過 I:圍棋慣例,I 跟 1 太像) */
export function colLabel(i) {
  const L = "ABCDEFGHJKLMNOPQRST";
  return L[i] || String(i + 1);
}

function strokeLine(cx, a, b) {
  cx.beginPath();
  cx.moveTo(a[0], a[1]);
  cx.lineTo(b[0], b[1]);
  cx.stroke();
}

export function disposeTree(root) {
  root.traverse?.((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
    else m?.dispose?.();
  });
  while (root.children?.length) root.remove(root.children[0]);
}
