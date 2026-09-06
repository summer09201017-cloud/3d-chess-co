# 3D 西洋棋 CO(repo `3d-chess-co`)

單機對 AI 的 3D 西洋棋 PWA。純靜態、零建置、可安裝、可離線;規則引擎用 `vendor/chess.js`。

## 線上網址(正版)

**https://3dchesscodex.pages.dev** —— Cloudflare Pages 專案 `3dchesscodex`。

- 德義作品集卡片:`3dchesscodex`「3D 西洋棋 CO」(棋類)。`sites.json` 棋類已登。
- 舊址 `3dchesscodex.netlify.app` 是 Netlify 時代的完整站副本,**2026-09-03 已停自動建置**(此前 push 會觸發重建燒點數);
  要不要改成 301 殼歸「減站清單」D 組,等使用者拍板。
- ⚠ **名字陷阱**:同家族另兩個西洋棋 repo 各自一張卡,別互相對賬——
  `3D-Chess` → `3dchess-an.pages.dev`(3D 幻影西洋棋);`3d-chess.pages.dev` 是德義另一個作品「3D 西洋棋(線上多人)」,
  源碼在另一顆硬碟、不在這台機的 Cloudflare 帳號(0903 使用者確認)。本 repo 的對賬/部署一律認 `3dchesscodex`。

## 功能

- 📅 **每日殘局**:每天一組 5 題 N 步殺,全世界同一組、由易到難,16 題題庫全部經過電腦數學證明(v11 單題 → v12 一組,2026-08-31)。
  ★ 這是棋類每日殘局的**正本之一**,`3D-Chess` 的每日殘局就是從這裡垂直搬運的。
- 💡 **AI 提示**:借同一支 `getBestMove` 從玩家這邊算一手(2026-09-01,棋類批次 2/5)。
  ⚡ 2026-09-07 提速(自 3D-Chess 搬來):高手檔中局一手 121s → 0.67s(180x)、標準檔 2.8s → 0.13s(22x)。
  病根是每個節點重複產生合法著法幾十次:①`orderMoves` 在 sort 比較函式裡對每手 `move()+isCheckmate()+undo()`
  ②每個葉子 `isGameOver()/isCheckmate()/isDraw()/moves()` 各自重算 ③chess.js 1.x 的 `move()`/verbose `moves()` 每手都 new Move(重算 SAN + 兩次 FEN)。
  修法:排序分一次算完;終局用「沒棋可走」判;搜尋樹內走 vendored chess.js 的底層 `_moves/_makeMove/_undoMove`
  (釘死 1.4.0 隨站出貨,少了就自動退回公開 API 路徑);三次重複計數鏡射公開 API。根層視窗收到「最佳−容忍度−1」,候選桶不變。
  ★ 差分測試(舊 vs 新,easy/medium 各 18 局面 + hard 抽測):根層每一手分數逐一相同 —— 只是快,不是變弱。
  提示按下先畫「💡 想一下…」、下一個 tick 才算(app.js showHint);browser-check 等 `state.hint` 出現而不賭毫秒。
- 對 AI 三檔、棋譜回放、存讀檔、📱 安裝 APP(PWA)。

## 檔案

| 檔 | 用途 |
|---|---|
| `index.html` / `styles.css` | 殼層與版面(`#verTag` 版本簡歷在 index.html) |
| `app.js` | 接線、3D 棋盤、對局流程 |
| `ai.js` | AI(`getBestMove`,提示也借它) |
| `puzzles.js` | 每日殘局題庫(16 題,含證明步數) |
| `vendor/chess.js` | 規則引擎(不要改成 CDN,離線要能玩) |
| `sw.js` | Service Worker,`CACHE_NAME = "3d-chess-co-v20"`(改殼層檔必 +1;verTag 版本簡歷同步改,v13=AI 提示、v14=統計、v15=?daily、v16=手機不溢出、v17=棋子 SVG 重畫、v18=手機放大鈕、v19=3D 旋轉修正、v20=AI 提速) |
| `manifest.webmanifest` / `assets/` | PWA 與圖示 |
| `test/daily.mjs` | `npm test`:每日殘局資料檢查 |
| `scripts/browser-check.mjs` | 真瀏覽器冒煙檢查(playwright-core + 系統 Edge/Chrome) |

## 跑起來 / 測試

```bash
npm install
npm run serve          # py -m http.server 4174;直接雙擊 index.html 會讓 SW 失效
npm test               # node test/daily.mjs
node scripts/browser-check.mjs
```

## 部署(手動,push 不會上線)

```bash
npx wrangler pages deploy . --project-name 3dchesscodex --branch main   # --branch main 必帶,否則進 Preview
# ⚠ 本 repo 部署要加 PII_OK=1:zero-pii-guard 會咬到 vendor/chess.js 授權標頭的作者 email(開源署名,不是個資)。
#   而且 commit/push 與 deploy 不可串同一條指令 —— 守門攔的是整條,串在一起 commit 也會一起被擋(2026-09-07 實測)。
#   PII_OK=1 npx wrangler pages deploy . --project-name 3dchesscodex --branch main --commit-dirty=true
curl -s "https://3dchesscodex.pages.dev/sw.js?b=$RANDOM" | grep CACHE_NAME   # 要是新版號
```

改了 `index.html` / CSS / manifest / assets 任何殼層檔,先把 `sw.js` 的 `CACHE_NAME` 版本 +1 再部署,
否則已安裝的 PWA 永遠看到舊版。

## 帳本 / 待補

- 作品集已收、`sites.json` 已登。新功能上線後照 skill `portfolio-ledger-guard` 收尾。
- ✅ **統計打點已接(0905)**:`index.html` 三層(開啟 / `-done` / `-dwell`),站名 `3dchesscodex`;`-done` 在 `app.js` 的 `render()` 以 game 物件身分去重(同一局只發一次)。hfpc-play-stats 的 `NAMES` 已登顯示名。

---
GitHub:`summer09201017-cloud/3d-chess-co`。本 README 2026-09-03 補(此前文件沒寫網址,作品集對賬只能靠名字猜到本 repo)。
