/* হিসাব খাতা — offline helper (also used by the Android app).
   Pages: try the internet first, keep a copy; no internet → the last copy, so the app still opens.
   /api/* is never touched (db.js keeps unsent saves itself and sends them when the internet is back). */
const CACHE = 'khata-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const pageKey = url => { const u = new URL(url); return u.origin + (u.pathname === '/' ? '/khata/index.html' : u.pathname); };

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const same = url.origin === self.location.origin;
  if (same && url.pathname.startsWith('/api/')) return;
  // fonts, icons, Next's own files: copy kept after the first time
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || (same && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')))) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (!same) return;
  if (req.mode === 'navigate' || url.pathname.startsWith('/khata/') || url.pathname === '/login') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        // keep a copy of a real page (not the "please log in" redirect)
        if (res.ok && !res.redirected) c.put(pageKey(req.url), res.clone());
        return res;
      } catch (err) {
        const hit = await c.match(pageKey(req.url)) || (req.mode === 'navigate' ? await c.match(self.location.origin + '/khata/index.html') : null);
        if (hit) return hit;
        return new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:40px 20px;text-align:center"><h2>📴 ইন্টারনেট নেই</h2><p>ইন্টারনেট চালু করে আবার খুলুন।</p></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});
