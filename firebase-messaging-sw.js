// Firebase Messaging Service Worker — Gabriel Barber Studio
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBuqPBQocq7gFFnbtD8VoMB6kTu1I3R_9w",
  authDomain: "gabriel-barber-studio.firebaseapp.com",
  projectId: "gabriel-barber-studio",
  storageBucket: "gabriel-barber-studio.firebasestorage.app",
  messagingSenderId: "618389372519",
  appId: "1:618389372519:web:e17540f85980687ad75ec2"
});

const messaging = firebase.messaging();

// Notificação quando app está em background/fechado
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Gabriel Barber Studio', {
    body: body || '',
    icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
    badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
    tag: 'gbs-push',
    vibrate: [200, 100, 200],
  });
});

// Clique na notificação abre o site
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('gabriel-barber-studio') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('https://gabriel-barber-studio.vercel.app');
    })
  );
});
