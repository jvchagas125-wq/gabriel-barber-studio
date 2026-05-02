import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-notify-secret',
};

function setCorHeaders(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  privateKey = privateKey.replace(/^"|"$/g, '');
  privateKey = privateKey.replace(/\\n/g, '\n');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('FIREBASE_PRIVATE_KEY inválida — verifique a variável no Vercel');
  }
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

export default async function handler(req, res) {
  setCorHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-notify-secret'] !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon, digits } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title obrigatório' });

  let db, messaging;
  try {
    const app = getFirebaseApp();
    db        = getFirestore(app);
    messaging = getMessaging(app);
  } catch (initErr) {
    console.error('Firebase init error:', initErr.message);
    return res.status(500).json({ error: 'Erro de configuração Firebase: ' + initErr.message });
  }

  try {
    let tokens = [];

    if (digits) {
      // Personal notification — only tokens for this specific client
      const snap = await db.collection('push_subscribers')
        .where('active', '==', true)
        .where('digits', '==', digits)
        .get();
      tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
      console.log(`Personal FCM for ${digits}: ${tokens.length} token(s)`);
    } else {
      // Broadcast — all active subscribers
      const snap = await db.collection('push_subscribers')
        .where('active', '==', true).get();
      tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
      console.log(`Broadcast FCM: ${tokens.length} token(s)`);
    }

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, message: 'Nenhum subscriber ativo' });
    }

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body: body || '' },
      webpush: {
        notification: {
          icon:  icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
        },
        fcmOptions: { link: 'https://gabriel-barber-studio.vercel.app' },
      },
    });

    console.log('Enviados:', response.successCount, '| Falhos:', response.failureCount);
    response.responses.forEach((r, i) => {
      if (!r.success) console.error('Token falhou:', tokens[i], r.error?.code);
    });

    return res.status(200).json({
      sent:   response.successCount,
      failed: response.failureCount,
      total:  tokens.length,
    });

  } catch (e) {
    console.error('Notify error:', e.code, e.message);
    return res.status(500).json({ error: e.message, code: e.code || 'unknown' });
  }
}
