// Service Worker para Notificaciones Push de Athleticenter

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Notificación push recibida', event);

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Athleticenter Pro', body: event.data.text() };
    }
  }

  const title = data.title || 'Athleticenter Pro';
  const options = {
    body: data.body || data.message || 'Nueva notificación del sistema.',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'general-notification',
    renotify: data.renotify !== undefined ? data.renotify : true,
    requireInteraction: true,
    data: {
      url: data.url || data.link || '/dashboard'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Click en la notificación recibido.');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(windowClients) {
        // Si hay una pestaña abierta con esa URL, enfocarla
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          const clientUrl = new URL(client.url, self.location.origin).pathname;
          const targetUrl = new URL(urlToOpen, self.location.origin).pathname;
          if (clientUrl === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Si no, abrir una nueva pestaña
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});
