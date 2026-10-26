/* PIXEL SURVIVAL 서비스 워커 — 게임 파일을 저장해 두어 인터넷이 없어도 켜지게 해요.
   게임 코드(html·js·css)는 인터넷이 되면 항상 최신 파일을 받아 오고, 안 되면 저장해 둔 걸 써요.
   음악·이미지·글꼴은 한 번 받으면 저장해 둔 걸 바로 써요. */
const CACHE = "ps-cache-v2";
const CORE = ["./", "index.html", "game.js", "styles.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const MEDIA = ["bgm_title.mp3", "bgm_tower.mp3", "bgm_field.mp3"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([...CORE, ...MEDIA].map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; };
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname) || (u.hostname === "cdn.jsdelivr.net" && u.pathname.includes("/galmuri"));
  if (u.origin !== location.origin && !font) return; // 로그인·클라우드 저장은 그대로 인터넷으로
  if (font || /\.(mp3|png|webmanifest)$/.test(u.pathname)) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => put(req, r))));
    return;
  }
  e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || caches.match("index.html"))));
});
