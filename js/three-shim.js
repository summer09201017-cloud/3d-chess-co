/* three-global-shim.js — 讓 ESM 的 animals.js 在「CDN 全域 THREE(r128)」的老站上跑(2026-09-28,象棋家族接動物時加的)。
 *
 * ★ 與 skill animal-opponent-kit/assets/three-global-shim.js **同一份**;站裡放 js/three-shim.js,不要在站裡改。
 * 由來:3D-Xiangqi / xiangqi-arena / 3D-Chess(幻影)三站都是 <script src="…/three.js/r128/three.min.js">(全域 THREE)+
 *   傳統 script,而動物引擎是 ES module、`import * as THREE from 'three'`。不想為了牠把三個穩定站的 three 升版
 *   (OrbitControls 也得換 jsm 版,風險大)⇒ index.html 放一段 import map 把 'three' 指到這支,這支把 window.THREE
 *   轉成具名匯出。**animals.js 一個位元組都不用改**。
 * ★ r128 沒有 CapsuleGeometry(r139 才有;animals.js 的手臂 / 腿用它)⇒ 這裡照 three 原版補一個
 *   (Path.absarc 畫半個膠囊剖面 + LatheGeometry 旋轉;r128 兩個都有)。有的話(新版 three 全域)就不碰。
 * ⚠ import map 一定要放在**第一個** <script type="module"> 之前,瀏覽器只讀第一張、而且只在模組載入前讀。
 */
const T = globalThis.THREE
if (!T) throw new Error('three-shim: 要先載入 three.min.js(全域 THREE)再載入任何 ES module')

if (!T.CapsuleGeometry) {
  class CapsuleGeometry extends T.LatheGeometry {
    constructor(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
      const path = new T.Path()
      path.absarc(0, -length / 2, radius, Math.PI * 1.5, 0)
      path.absarc(0, length / 2, radius, 0, Math.PI * 0.5)
      super(path.getPoints(capSegments), radialSegments)
      this.type = 'CapsuleGeometry'
      this.parameters = { radius, length, capSegments, radialSegments }
    }
  }
  T.CapsuleGeometry = CapsuleGeometry
}

export default T
export const {
  Group, Object3D, Mesh, Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer,
  SphereGeometry, CylinderGeometry, CapsuleGeometry, ConeGeometry, BoxGeometry, TorusGeometry, PlaneGeometry, LatheGeometry, CircleGeometry, RingGeometry,
  BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshLambertMaterial, LineBasicMaterial,
  Vector2, Vector3, Vector4, Quaternion, Euler, Matrix4, Color, Box3, Sphere, Raycaster, Path, Shape, Clock,
  AmbientLight, DirectionalLight, PointLight, HemisphereLight,
  MathUtils, DoubleSide, FrontSide, BackSide,
} = T
