// ♟️ 真 3D 西洋棋盤的純幾何驗收(2026-09-29)—— node test/chess3d-geo.mjs,不開 WebGL
//
// 守的東西(規格第 5 節):
//   ① 64 格逐格 格名 ↔ 世界 ↔ 格名 一致;盤框 / 桌外點下去是 null(不會吸成 a1)
//   ② 方位:yaw 0 白方近端(a1 左下、h8 右上);yaw 90 = 舊 CSS rotateZ(90°) 順時針(a1 跑到左上);yaw 180 對調
//   ③ 取景:3 俯角 × 2 水平角 × 6 螢幕比例,盤角全在 ±0.96 / ±0.90;加上動物頭頂讓位也不超過 1.28 倍距離
//   ④ 反例:寫死 16:9 的距離、只改成直向 ⇒ 盤角必超界
//   ⑤ 六種棋子都是有體積的幾何(三軸都有厚度),不是立起來的薄片
import assert from "node:assert/strict";
import * as THREE from "three";
import { Board3D } from "../js/board3d.js";
import { PITCH, FILES, squareToRC, rcToSquare, worldToSquare } from "../js/chess3d.js";
import { makePiece, PIECE_HEIGHT } from "../js/pieces3d.js";

let pass = 0;
const ok = (msg) => { pass++; console.log("  ✓ " + msg); };

/** 跟 chess3d.js 同一組參數,只借 prototype 的純幾何方法 */
function fakeBoard({ yaw = 0, pitch = 58, aspect = 16 / 9 } = {}) {
  const b = Object.create(Board3D.prototype);
  b.opt = { cols: 8, rows: 8, pitch: PITCH, mode: "cell", margin: 0.5 };
  b.cols = 8; b.rows = 8; b.view = "top"; b.yaw = yaw; b.pitchOverride = pitch;
  b.target = new THREE.Vector3(0, 0, 0);
  b.camera = new THREE.PerspectiveCamera(38, aspect, 0.05, 60);
  b.fitCamera();
  return b;
}
const ndc = (b, sq) => {
  const rc = squareToRC(sq);
  const w = b.cellToWorld(rc.row, rc.col);
  return new THREE.Vector3(w.x, 0, w.z).project(b.camera);
};

/* ① 逐格 */
{
  const b = fakeBoard();
  let n = 0;
  for (const f of FILES) for (let r = 1; r <= 8; r++) {
    const sq = `${f}${r}`;
    const rc = squareToRC(sq);
    assert.equal(rcToSquare(rc.row, rc.col), sq);
    const w = b.cellToWorld(rc.row, rc.col);
    assert.equal(worldToSquare(b, w.x, w.z), sq, `${sq} 來回對不上`);
    // 格內偏 0.4 格也還是同一格
    assert.equal(worldToSquare(b, w.x + PITCH * 0.4, w.z - PITCH * 0.4), sq, `${sq} 格內偏移被判到別格`);
    n++;
  }
  assert.equal(n, 64);
  const a1 = b.cellToWorld(7, 0);
  assert.equal(worldToSquare(b, a1.x - PITCH * 0.6, a1.z), null, "點在 a1 左邊的盤框被吸成 a1");
  assert.equal(worldToSquare(b, a1.x, a1.z + PITCH * 0.6), null, "點在 a1 下方的盤框被吸成 a1");
  assert.equal(worldToSquare(b, 9, 9), null);
  assert.equal(squareToRC("i9"), null);
  assert.equal(squareToRC(undefined), null);
  ok("64 格逐格 格名 ↔ 世界 一致;盤框 / 桌外 / 亂格名 → null");
}

/* ② 方位 */
{
  const b0 = fakeBoard({ yaw: 0 });
  const a1 = ndc(b0, "a1"), h8 = ndc(b0, "h8"), e2 = ndc(b0, "e2"), e7 = ndc(b0, "e7");
  assert.ok(a1.x < 0 && a1.y < 0, "yaw 0:a1 應在左下");
  assert.ok(h8.x > 0 && h8.y > 0, "yaw 0:h8 應在右上");
  assert.ok(e2.y < e7.y, "yaw 0:白兵 e2 應比黑兵 e7 靠近玩家(畫面下方)");
  const b90 = fakeBoard({ yaw: 90 });
  const a1r = ndc(b90, "a1");
  assert.ok(a1r.x < 0 && a1r.y > 0, `yaw 90 應 = CSS rotateZ(90°) 順時針:a1 到左上,實際 (${a1r.x.toFixed(2)},${a1r.y.toFixed(2)})`);
  const b180 = fakeBoard({ yaw: 180 });
  const a1f = ndc(b180, "a1");
  assert.ok(a1f.x > 0 && a1f.y > 0, "yaw 180:a1 應在右上(黑方近端)");
  ok("方位:yaw 0 白方近端、90 = 舊 CSS 順時針、180 換邊");
}

/* ③ 取景(含動物頭頂讓位) */
{
  let n = 0;
  const HEAD_Y = 0.9;   // 動物頭頂離盤面的高度量級(opponent3d:dy + HEAD_TOP_LOCAL_Y × scale ≈ 0.85)
  for (const pitch of [34, 58, 88]) for (const yaw of [0, 180]) for (const aspect of [390 / 844, 0.75, 1, 4 / 3, 16 / 9, 844 / 390]) {
    const b = fakeBoard({ yaw, pitch, aspect });
    const dBoard = b.camDist;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
      assert.ok(Math.abs(p.x) <= 0.96 * 1.005 && Math.abs(p.y) <= 0.90 * 1.005, `盤角超界 pitch ${pitch} yaw ${yaw} aspect ${aspect.toFixed(2)}:(${p.x.toFixed(3)},${p.y.toFixed(3)})`);
    }
    // 加上動物頭頂(座位在相機對面)
    const R = Math.max(b.halfX, b.halfZ) * 1.3;
    const y = THREE.MathUtils.degToRad(yaw);
    b.fitExtra = () => (pitch >= 76 ? [] : [new THREE.Vector3(-Math.sin(y) * R, HEAD_Y, -Math.cos(y) * R)]);
    b.fitCamera();
    assert.ok(b.camDist <= dBoard * 1.28 + 1e-6, "為動物讓位超過 1.28 倍");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
      assert.ok(Math.abs(p.x) <= 0.96 * 1.005 && Math.abs(p.y) <= 0.90 * 1.005, "讓位後盤角超界");
    }
    n++;
  }
  ok(`取景:3 俯角 × 2 水平角 × 6 比例 = ${n} 種盤角都入鏡;動物讓位 ≤ 1.28 倍距離`);
}

/* ④ 反例 */
{
  const wide = fakeBoard({ aspect: 16 / 9, pitch: 34 });
  const d = wide.camDist;
  const tall = fakeBoard({ aspect: 390 / 844, pitch: 34 });
  tall.camera.position.copy(tall.target).add(new THREE.Vector3(0, Math.sin(34 * Math.PI / 180), Math.cos(34 * Math.PI / 180)).multiplyScalar(d));
  tall.camera.lookAt(tall.target); tall.camera.updateMatrixWorld(); tall.camera.updateProjectionMatrix();
  let worst = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) worst = Math.max(worst, Math.abs(new THREE.Vector3(sx * tall.halfX, 0, sz * tall.halfZ).project(tall.camera).x));
  assert.ok(worst > 0.96, `反例沒紅:寫死距離在直向只到 ${worst.toFixed(2)}`);
  ok(`反例會紅:寫死 16:9 距離改直向 ⇒ 盤角投到 ${worst.toFixed(2)}`);
}

/* ⑤ 棋子有體積 */
{
  for (const type of ["p", "r", "n", "b", "q", "k"]) {
    const g = makePiece(type, "w");
    const box = new THREE.Box3().setFromObject(g);
    const s = box.getSize(new THREE.Vector3());
    assert.ok(s.x > 0.2 && s.z > 0.2, `${type} 的寬 / 深太薄(${s.x.toFixed(2)} × ${s.z.toFixed(2)})`);
    assert.ok(Math.abs(s.y - PIECE_HEIGHT[type]) < 0.2, `${type} 高 ${s.y.toFixed(2)} 跟 PIECE_HEIGHT ${PIECE_HEIGHT[type]} 差太多`);
    g.traverse((o) => { if (o.isMesh) { assert.ok(o.geometry.attributes.position.count > 20, `${type} 有零件頂點太少`); } });
  }
  const h = (t) => new THREE.Box3().setFromObject(makePiece(t, "b")).getSize(new THREE.Vector3()).y;
  assert.ok(h("p") < h("r") && h("r") < h("n") && h("n") < h("b") && h("b") < h("q") && h("q") < h("k"), "高度分級應為 兵<城堡<騎士<主教<皇后<國王");
  ok("六種棋子三軸都有厚度、高度分級 兵<城堡<騎士<主教<皇后<國王");
}

console.log(`\n✅ chess3d-geo ${pass} 項全過`);
