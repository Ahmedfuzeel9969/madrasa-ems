/* EMS Firebase Cloud Messaging — background push (Phase 10) */
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyBdcP1CEpupMTGuWxHUQqsYCd1Z-qTHr7Y',
    authDomain: 'madrasa-mangment-app.firebaseapp.com',
    projectId: 'madrasa-mangment-app',
    storageBucket: 'madrasa-mangment-app.firebasestorage.app',
    messagingSenderId: '529775229216',
    appId: '1:529775229216:web:77a1e019dae4b974e3ff45'
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
    var title = (payload.notification && payload.notification.title) || 'EMS';
    var body = (payload.notification && payload.notification.body) || '';
    var options = {
        body: body,
        icon: 'https://cdn-icons-png.flaticon.com/512/3003/3003511.png',
        data: payload.data || {}
    };
    return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            if (list.length) return list[0].focus();
            return clients.openWindow('./index.html');
        })
    );
});
