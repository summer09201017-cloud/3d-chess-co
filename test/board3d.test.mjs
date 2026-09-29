/* board3d.test.mjs — 底座的「純幾何」部分(不需要 WebGL,node 直接跑)
 *
 * 測兩件會靜靜壞掉、而且截圖也看不出來的事:
 *  ① 格 ↔ 世界 座標來回要一致(點下去的那一格,就是畫子的那一格)
 *  ② ★ 相機取景:任何螢幕比例、任何視角、任何盤面大小,**四個盤角都要在畫面內**
 *     ——這條就是艦隊那個「棋盤溢出、四周變藍」的病;它在桌機 16:9 永遠正常,
 *       只有手機直向(aspect≈0.46)才發作 ⇒ 一定要用數字測,不能靠看。
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { Board3D, colLabel } from "../js/board3d.js";

/* 與 game3d.js 同一張表:盤越大格越小,整盤佔的世界大小差不多 */
const PITCH = { 7: 0.3, 9: 0.26, 13: 0.2, 15: 0.17, 19: 0.135 };

/** 不開 WebGL,只借 prototype 上的純幾何方法 */
function fakeBoard({ cols = 9, rows = 0, pitch = 0.26, mode = "intersection", view = "top", yaw = 0 } = {}) {
  const b = Object.create(Board3D.prototype);
  b.opt = { cols, rows, pitch, mode, margin: 0.62 };
  b.cols = cols;
  b.rows = rows || cols;
  b.view = view;
  b.yaw = yaw;
  b.target = new THREE.Vector3(0, 0, 0);
  b.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  return b;
}

let pass = 0;
const ok = (msg) => { pass++; console.log("  ✓ " + msg); };

/* ① 座標來回 */
for (const size of [9, 13, 15, 19]) {
  const b = fakeBoard({ cols: size, pitch: PITCH[size] });
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const w = b.cellToWorld(r, c);
      const back = b.worldToCell(w.x, w.z);
      assert.deepEqual([back.row, back.col], [r, c], `${size} 路 (${r},${c}) 來回對不上`);
      assert.equal(back.idx, r * size + c, "idx 算錯");
    }
  }
}
ok("格 ↔ 世界 座標來回一致(9/13/15/19 路,每一格都驗)");

/* 盤外要回 null(手指滑出盤面不要硬吸進來) */
{
  const b = fakeBoard({ cols: 9 });
  assert.equal(b.worldToCell(99, 0), null, "盤外沒有回 null");
  const edge = b.cellToWorld(0, 0);
  assert.equal(b.worldToCell(edge.x - 0.26 * 0.8, edge.z), null, "離最近交叉點 0.8 格還被吸進來");
  assert.notEqual(b.worldToCell(edge.x - 0.26 * 0.3, edge.z), null, "離 0.3 格反而點不到");
}
ok("盤外 / 離交叉點太遠 → null");

/* cell 模式(西洋棋、暗棋那型:下在格子中心)*/
{
  const b = fakeBoard({ cols: 8, mode: "cell" });
  const w = b.cellToWorld(0, 0);
  assert.ok(Math.abs(w.x) > 0.001, "cell 模式第一格應該在格心,不是在角上");
  assert.deepEqual(
    [b.worldToCell(w.x, w.z).row, b.worldToCell(w.x, w.z).col], [0, 0],
    "cell 模式來回對不上",
  );
}
ok("cell 模式(格心落子)也對");

/* ② 取景:四個盤角一定在畫面內 */
const ASPECTS = [
  [0.46, "手機直向 390×844"],
  [2.16, "手機橫向 844×390"],
  [1.33, "投影機 4:3"],
  [1.78, "桌機 16:9"],
  [0.75, "平板直向"],
];
for (const size of [9, 13, 15, 19]) {
  for (const view of ["top", "flat", "sit"]) {
    for (const yaw of [0, 180]) {
      for (const [aspect, label] of ASPECTS) {
        const b = fakeBoard({ cols: size, pitch: PITCH[size], view, yaw });
        b.camera.aspect = aspect;
        b.camera.updateProjectionMatrix();
        b.fitCamera();
        let wx = 0, wy = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
          wx = Math.max(wx, Math.abs(p.x));
          wy = Math.max(wy, Math.abs(p.y));
        }
        const tag = `${size} 路 / ${view} / yaw${yaw} / ${label}`;
        assert.ok(wx <= 0.98, `${tag}:左右投到 ${wx.toFixed(3)}(溢出畫面)`);
        assert.ok(wy <= 0.93, `${tag}:上下投到 ${wy.toFixed(3)}(會被 HUD 蓋住或溢出)`);
        // 也不能退太遠變成「一顆小郵票」:兩軸至少有一軸貼到該軸的上限
        const fill = Math.max(wx / 0.96, wy / 0.90);
        assert.ok(fill > 0.9, `${tag}:只佔畫面 ${(fill * 100).toFixed(0)}%,退太遠了`);
      }
    }
  }
}
ok(`任何比例都整盤入鏡且不會退太遠(4 盤面 × 3 視角 × 2 方向 × ${ASPECTS.length} 比例 = ${4 * 3 * 2 * ASPECTS.length} 種)`);

/* 盤面換大小,取景要跟著換 */
{
  const small = fakeBoard({ cols: 9, pitch: PITCH[9] });
  const big = fakeBoard({ cols: 19, pitch: PITCH[19] });
  small.camera.aspect = big.camera.aspect = 1;
  small.camera.updateProjectionMatrix();
  big.camera.updateProjectionMatrix();
  const d7 = small.fitCamera(), d13 = big.fitCamera();
  assert.ok(Number.isFinite(d7) && Number.isFinite(d13), "相機距離不是有限數");
  assert.ok(Math.abs(d7 - d13) / d7 < 0.5, "9 路與 19 路的取景距離差太多(格距沒調好)");
}
ok("換盤面大小,相機距離跟著重算");

/* ★ 反例:證明上面那條測試**抓得到病**(不是恆真的空測試)。
   把相機距離寫死成「在 16:9 剛好」的值(這就是 board-game-designer 記的那個實錯),
   手機直向就必須溢出;如果這裡沒紅,代表上面那條斷言根本測不到東西。 */
{
  const b = fakeBoard({ cols: 9 });
  b.camera.aspect = 1.78;
  b.camera.updateProjectionMatrix();
  const fixed = b.fitCamera();            // 在 16:9 算出來的「剛好」距離

  b.camera.aspect = 0.46;                 // 轉成手機直向,但距離**不重算**(舊做法只改 aspect)
  b.camera.updateProjectionMatrix();
  b.camera.position.set(0, 0, 0).addScaledVector(
    new THREE.Vector3(Math.cos(Math.PI / 180 * 58) * 0, Math.sin(Math.PI / 180 * 58), Math.cos(Math.PI / 180 * 58)).normalize(),
    fixed,
  );
  b.camera.lookAt(b.target);
  b.camera.updateMatrixWorld();
  let worst = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
  }
  assert.ok(worst > 0.95,
    `反例沒有紅:寫死距離在手機直向只投到 ${worst.toFixed(3)},那上面那條斷言就抓不到真的溢出`);
  ok(`反例會紅:距離寫死 + 只改 aspect ⇒ 手機直向投到 ${worst.toFixed(2)}(溢出畫面)`);
}

/* 直向手機要自動拉高俯角(不然行距被壓成六成、上下空一片黑)*/
{
  const b = fakeBoard({ cols: 19, pitch: PITCH[19], view: "top" });
  b.camera.aspect = 1.78;
  const wide = b._pitchFor();
  b.camera.aspect = 0.46;
  const tall = b._pitchFor();
  assert.equal(wide, 58, "桌機 16:9 不該動俯角");
  assert.ok(tall > wide + 15, `直向沒有拉高俯角(${wide}° → ${tall}°)`);
  assert.ok(tall <= 88, "俯角不可以超過 88°(會退化成正交,失去立體感)");

  // 量真正在乎的東西:直向的「行距 / 欄距」要接近 1(格子是方的),不是 0.6
  const ratio = (aspect) => {
    b.camera.aspect = aspect;
    b.camera.updateProjectionMatrix();
    b.fitCamera();
    const mid = Math.floor(b.rows / 2);
    const p = (r, c) => new THREE.Vector3(b.cellToWorld(r, c).x, 0, b.cellToWorld(r, c).z).project(b.camera);
    const dCol = Math.abs(p(mid, mid + 1).x - p(mid, mid).x);
    const dRow = Math.abs(p(mid + 1, mid).y - p(mid, mid).y);
    return (dRow / aspect) / dCol;     // 換算回像素:y 的 ndc 要除以 aspect 才跟 x 同尺
  };
  const r = ratio(0.46);
  assert.ok(r > 0.7, `直向格子還是被壓扁(行距/欄距 = ${r.toFixed(2)},要 >0.7)`);
  ok(`直向自動拉高俯角 ${wide}° → ${tall}°,格子長寬比 ${r.toFixed(2)}`);
}

/* 俯視角度滑桿(view-kit):setPitch 覆寫 → 任何比例、20°~88° 都整盤入鏡且不退太遠;setView 清掉覆寫;夾 5~88° */
{
  for (const size of [9, 13, 15, 19]) {
    for (const pitch of [20, 34, 58, 88]) {
      for (const [aspect, label] of ASPECTS) {
        const b = fakeBoard({ cols: size, pitch: PITCH[size] });
        b.camera.aspect = aspect;
        b.camera.updateProjectionMatrix();
        b.setPitch(pitch);
        assert.equal(b._pitchFor(), pitch, `setPitch(${pitch}) 之後 _pitchFor 要原樣回 ${pitch}(跳過直向自動拉高)`);
        let wx = 0, wy = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
          wx = Math.max(wx, Math.abs(p.x));
          wy = Math.max(wy, Math.abs(p.y));
        }
        const tag = `${size} 路 / 俯角 ${pitch}° / ${label}`;
        assert.ok(wx <= 0.98, `${tag}:左右投到 ${wx.toFixed(3)}(溢出畫面)`);
        assert.ok(wy <= 0.93, `${tag}:上下投到 ${wy.toFixed(3)}(溢出畫面)`);
        const fill = Math.max(wx / 0.96, wy / 0.90);
        assert.ok(fill > 0.9, `${tag}:只佔畫面 ${(fill * 100).toFixed(0)}%,退太遠了`);
      }
    }
  }
  const b = fakeBoard({ cols: 13, pitch: PITCH[13], view: "top" });
  b.camera.aspect = 0.46;
  b.camera.updateProjectionMatrix();
  b.setPitch(20);
  assert.equal(b.pitchOverride, 20);
  b.setView("top");
  assert.equal(b.pitchOverride, null, "setView 之後覆寫要歸 null");
  assert.ok(b._pitchFor() > 58, "清掉覆寫後,直向自動拉高要回來");
  b.setPitch(0);
  assert.equal(b.pitchOverride, 5, "0° 要夾到 5°(lookAt 才不退化)");
  b.setPitch(95);
  assert.equal(b.pitchOverride, 88, "95° 要夾到 88°");
  b.setPitch("abc");
  assert.equal(b.pitchOverride, null, "非數字 = 取消覆寫");
  assert.equal(fakeBoard({ cols: 9 })._pitchFor(), 58, "沒建構子的假盤(pitchOverride 是 undefined)也要當成沒覆寫");
}
ok(`俯視角度滑桿:4 盤面 × 4 俯角 × ${ASPECTS.length} 比例 = ${4 * 4 * ASPECTS.length} 種都整盤入鏡;setView 清覆寫、夾 5~88°`);

/* 座標標籤:圍棋慣例跳過 I */
assert.equal(colLabel(0), "A");
assert.equal(colLabel(8), "J", "第 9 欄應該是 J(跳過 I)");
ok("盤緣座標跳過 I(圍棋慣例)");

console.log(`\n✅ board3d ${pass} 項全過`);
