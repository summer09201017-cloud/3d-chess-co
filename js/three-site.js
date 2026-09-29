/* three-site.js — 本站的 'three' 入口(import map 指到這支;2026-09-29 真 3D 升級時加)
 *
 * ★ 為什麼不直接改 js/three-shim.js:那支與 skill animal-opponent-kit/assets/three-global-shim.js **同一份**(共用正本,不在站裡改)。
 *   它只匯出動物引擎用得到的東西;棋盤底座 board3d.js 還要 Fog / Plane / CanvasTexture 等 ⇒ 這支「先讓 shim 補好 CapsuleGeometry,
 *   再把整個全域 THREE 原樣轉成具名匯出」。只增不改:animals.js 拿到的還是同一個 THREE。
 * ★ r128 與新版 three 的差異(board3d.js 是照 three 0.177 寫的):
 *   ① colorSpace / SRGBColorSpace 是 r152 才有的 —— r128 沒有這個屬性,設了也無害(貼圖照原色讀);這裡匯出一個字串佔位,
 *      board3d.js 一行不用改。
 *   ② 燈光單位:新版預設是物理燈光(強度不乘 π),r128 預設是舊制 ⇒ 由 chess3d.js 在建好 renderer 後開 physicallyCorrectLights,
 *      同一組燈光數值(半球 0.85 / 桌燈 22 / 平行光 0.55)兩邊看起來才一樣亮。
 */
import T from './three-shim.js';

if (!T.SRGBColorSpace) T.SRGBColorSpace = 'srgb';

export default T;
export const {
  Group, Object3D, Mesh, Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer,
  SphereGeometry, CylinderGeometry, CapsuleGeometry, ConeGeometry, BoxGeometry, TorusGeometry, PlaneGeometry, LatheGeometry,
  CircleGeometry, RingGeometry, ExtrudeGeometry, BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshLambertMaterial, LineBasicMaterial, SpriteMaterial, Sprite,
  Vector2, Vector3, Vector4, Quaternion, Euler, Matrix4, Color, Box3, Sphere, Raycaster, Plane, Path, Shape, Clock, Fog,
  CanvasTexture, Texture, AmbientLight, DirectionalLight, PointLight, HemisphereLight,
  MathUtils, DoubleSide, FrontSide, BackSide, SRGBColorSpace,
} = T;
