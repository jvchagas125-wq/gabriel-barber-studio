// Vercel Serverless Function — Enviar FCM para todos os subscribers
// Variáveis de ambiente necessárias no Vercel:
// FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const { GoogleAuth } = require('google-auth-library');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Inicializar Firebase Admin (uma vez)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar segredo para evitar chamadas não autorizadas
  const secret = req.headers['x-notify-secret'];
  if (secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title e body são obrigatórios' });
  }

  try {
    // Buscar todos os tokens FCM ativos
    const snap = await db.collection('push_subscribers')
      .where('active', '==', true)
      .get();

    const tokens = snap.docs
      .map(d => d.data().fcmToken)
      .filter(Boolean);

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0, message: 'Nenhum subscriber com token' });
    }

    // Obter access token OAuth2 para FCM v1 API
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const accessToken = await auth.getAccessToken();
    const projectId = process.env.FIREBASE_PROJECT_ID;

    // Enviar para cada token via FCM v1 API
    let sent = 0, failed = 0;
    for (const token of tokens) {
      try {
        const resp = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: {
                  title,
                  body,
                  image: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
                },
                webpush: {
                  notification: {
                    icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
                    badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
                    vibrate: [200, 100, 200],
                  },
                  fcm_options: {
                    link: 'https://gabriel-barber-studio.vercel.app',
                  },
                },
              },
            }),
          }
        );
        if (resp.ok) sent++;
        else { failed++; console.error('FCM error token:', await resp.text()); }
      } catch(e) { failed++; }
    }

    return res.status(200).json({ sent, failed, total: tokens.length });
  } catch (e) {
    console.error('notify error:', e);
    return res.status(500).json({ error: e.message });
  }
}
