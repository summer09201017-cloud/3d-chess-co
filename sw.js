// ★★★ 2026-09-14 全艦隊修「index.html 進快取名單」地雷(3D-Chess 幻影版實錘,補丁 static-pwa-ship/patches/patch-sw-index.mjs):
//    Cloudflare Pages 把 /index.html 308 轉到 / ⇒ 名單裡有 "./index.html" 的話 install 存到的是 redirected:true 的回應,
//    導覽拿到它瀏覽器直接拒收 ⇒ 裝成 App 開就 ERR_FAILED;每次 bump SW 重踩。⇒ 名單與離線退路只認 "./",永遠不要再把 index.html 加回來。
//    同時 addAll(全部或全無)改成逐一 add + catch:一個檔抓不到不再整批沒快取。
const CACHE_NAME = "3d-chess-co-v32";
const APP_SHELL = [
  "./",
  "./styles.css",
  "./app.js",
  "./view-kit.js",
  "./ai.js",
  "./puzzles.js",
  "./manifest.webmanifest",
  "./vendor/chess.js",
  "./js/three-shim.js",
  "./js/animals.js",
  "./js/voice.js",
  "./js/opponent.js",
  "./js/voicePhrases.js",
  "./js/dice-toss.js",
  /* voice:begin(scripts/gen-voice.mjs 照目錄重生,不手抄) */
  "./voice/manifest.json",
  "./voice/bear-chat1.mp3",
  "./voice/bear-chat2.mp3",
  "./voice/bear-chat3.mp3",
  "./voice/bear-check.mp3",
  "./voice/bear-draw.mp3",
  "./voice/bear-lose.mp3",
  "./voice/bear-think.mp3",
  "./voice/bear-win.mp3",
  "./voice/bear-wow.mp3",
  "./voice/cat-chat1.mp3",
  "./voice/cat-chat2.mp3",
  "./voice/cat-chat3.mp3",
  "./voice/cat-check.mp3",
  "./voice/cat-draw.mp3",
  "./voice/cat-lose.mp3",
  "./voice/cat-think.mp3",
  "./voice/cat-win.mp3",
  "./voice/cat-wow.mp3",
  "./voice/owl-chat1.mp3",
  "./voice/owl-chat2.mp3",
  "./voice/owl-chat3.mp3",
  "./voice/owl-check.mp3",
  "./voice/owl-draw.mp3",
  "./voice/owl-lose.mp3",
  "./voice/owl-think.mp3",
  "./voice/owl-win.mp3",
  "./voice/owl-wow.mp3",
  "./voice/rabbit-chat1.mp3",
  "./voice/rabbit-chat2.mp3",
  "./voice/rabbit-chat3.mp3",
  "./voice/rabbit-check.mp3",
  "./voice/rabbit-draw.mp3",
  "./voice/rabbit-lose.mp3",
  "./voice/rabbit-think.mp3",
  "./voice/rabbit-win.mp3",
  "./voice/rabbit-wow.mp3",
  /* voice:end */
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
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
