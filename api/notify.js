// Vercel Serverless Function — Enviar FCM via Firebase Admin SDK
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
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
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-notify-secret'] !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title obrigatorio' });

  try {
    // Buscar tokens FCM ativos
    const snap = await db.collection('push_subscribers')
      .where('active', '==', true)
      .get();

    const tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
    console.log('Tokens encontrados:', tokens.length);

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, message: 'Nenhum subscriber com token FCM' });
    }

    // Enviar via Firebase Admin SDK (multicast)
    const message = {
      notification: {
        title,
        body: body || '',
        imageUrl: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
      },
      webpush: {
        notification: {
          title,
          body: body || '',
          icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          vibrate: [200, 100, 200],
        },
        fcmOptions: {
          link: 'https://gabriel-barber-studio.vercel.app',
        },
      },
      tokens,
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log('FCM success:', response.successCount, 'failed:', response.failureCount);

    // Remover tokens inválidos
    const invalidTokens = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        console.error('Token error:', tokens[i], r.error?.code);
        if (r.error?.code === 'messaging/registration-token-not-registered' ||
            r.error?.code === 'messaging/invalid-registration-token') {
          invalidTokens.push(tokens[i]);
        }
      }
    });

    // Desativar tokens inválidos no Firestore
    if (invalidTokens.length > 0) {
      const batch = db.batch();
      snap.docs.forEach(d => {
        if (invalidTokens.includes(d.data().fcmToken)) {
          batch.update(d.ref, { active: false });
        }
      });
      await batch.commit();
    }

    return res.status(200).json({
      sent: response.successCount,
      failed: response.failureCount,
      total: tokens.length,
    });
  } catch (e) {
    console.error('notify handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}

