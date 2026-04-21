// Gabriel Barber Studio — Service Worker v2 (PWA + Push)
const CACHE = 'gbs-v2';
const OFFLINE_URLS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Apenas requisições GET
  if(e.request.method !== 'GET') return;
  // Não cachear Firebase
  if(e.request.url.includes('firebasejs') || e.request.url.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Push via Service Worker
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SHOW_NOTIFICATION'){
    const { title, body, icon } = e.data;
    e.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: icon || 'https://i.imgur.com/vcPQoRh.png',
        badge: icon || 'https://i.imgur.com/vcPQoRh.png',
        tag: 'gbs-notification',
        requireInteraction: false,
        vibrate: [200, 100, 200],
      })
    );
  }
});

// Clique na notificação — abre o site
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for(const c of list){
        if(c.url.includes('gabriel-barber-studio') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('https://gabriel-barber-studio.vercel.app');
    })
  );
});
