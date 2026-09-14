// ★★★ 2026-09-14 全艦隊修「index.html 進快取名單」地雷(3D-Chess 幻影版實錘,補丁 static-pwa-ship/patches/patch-sw-index.mjs):
//    Cloudflare Pages 把 /index.html 308 轉到 / ⇒ 名單裡有 "./index.html" 的話 install 存到的是 redirected:true 的回應,
//    導覽拿到它瀏覽器直接拒收 ⇒ 裝成 App 開就 ERR_FAILED;每次 bump SW 重踩。⇒ 名單與離線退路只認 "./",永遠不要再把 index.html 加回來。
//    同時 addAll(全部或全無)改成逐一 add + catch:一個檔抓不到不再整批沒快取。
const CACHE_NAME = "3d-chess-co-v28";
const APP_SHELL = [
  "./",
  "./styles.css",
  "./app.js",
  "./ai.js",
  "./puzzles.js",
  "./manifest.webmanifest",
  "./vendor/chess.js",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => null)))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });

        return networkResponse;
      });
    // 離線退路:只有導覽請求(開 App / 重整)退回殼層 "./";其他資源抓不到就老實回錯,不要拿首頁充數
    }).catch(() => (event.request.mode === "navigate" ? caches.match("./") : Response.error())),
  );
});
