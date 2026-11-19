// Service worker del panel (/admin): recibe las notificaciones de pedidos nuevos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'EpicOutlet', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'EpicOutlet', {
    body: d.body || '',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/admin' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/admin', self.location.origin).href;
  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of lista) {
      if (new URL(c.url).pathname.startsWith('/admin')) {
        await c.focus();
        c.postMessage({ tipo: 'abrir', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
