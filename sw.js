// Gabriel Barber Studio — Service Worker para Push Notifications
const CACHE_NAME = 'gbs-sw-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Recebe mensagens do app para disparar notificações
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
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

// Clique na notificação abre o site
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('gabriel-barber-studio') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('https://gabriel-barber-studio.vercel.app');
    })
  );
});
