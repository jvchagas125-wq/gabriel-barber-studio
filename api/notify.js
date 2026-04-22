import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY || '';
  // Tratar todas as variações possíveis do Vercel
  if (key.includes('\\n')) return key.replace(/\\n/g, '\n');
  if (key.includes('\n')) return key;
  // Chave sem quebras — adicionar manualmente
  return key
    .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
    .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n');
}

if (!getApps().length) {
  const privateKey = getPrivateKey();
  console.log('Key starts with:', privateKey.substring(0, 30));
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db        = getFirestore();
const messaging = getMessaging();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notify-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-notify-secret'] !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title obrigatorio' });

  try {
    const snap = await db.collection('push_subscribers')
      .where('active', '==', true)
      .get();

    const tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
    console.log('Tokens:', tokens.length);

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, message: 'Sem tokens FCM' });
    }

    const response = await messaging.sendEachForMulticast({
      notification: {
        title,
        body: body || '',
      },
      webpush: {
        notification: {
          title,
          body: body || '',
          icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
        },
        fcmOptions: { link: 'https://gabriel-barber-studio.vercel.app' },
      },
      tokens,
    });

    console.log('Sent:', response.successCount, 'Failed:', response.failureCount);

    return res.status(200).json({
      sent:   response.successCount,
      failed: response.failureCount,
      total:  tokens.length,
    });
  } catch (e) {
    console.error('Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
