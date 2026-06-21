/* Service Worker：让应用可安装为 PWA，离线也能打开界面。
   策略：静态资源「网络优先、缓存兜底」——联网时永远拿最新版，断网时用缓存。
   API 请求始终直连网络（保证数据实时，不缓存）。 */
const CACHE = 'fam-asset-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // 数据请求直连，不缓存
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html')))
  );
});
