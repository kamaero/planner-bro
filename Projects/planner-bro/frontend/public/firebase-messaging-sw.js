importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

// Initialize Firebase — replace with your actual config
firebase.initializeApp({
  apiKey: self.FIREBASE_API_KEY || '',
  authDomain: self.FIREBASE_AUTH_DOMAIN || '',
  projectId: self.FIREBASE_PROJECT_ID || '',
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: self.FIREBASE_APP_ID || '',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {}
  self.registration.showNotification(title || 'planner-bro', {
    body: body || '',
    icon: '/vite.svg',
    data: payload.data,
  })
})
