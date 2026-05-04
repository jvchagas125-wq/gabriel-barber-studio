import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-notify-secret',
};

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];
  let pk = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g,'').replace(/\\n/g,'\n');
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  pk,
    }),
  });
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-notify-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== 'gbs-notify-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon, digits } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const messaging = getMessaging(app);

    // Get all subscribers (no composite index needed)
    const snap = await db.collection('push_subscribers').get();
    let tokens = [];

    if (digits) {
      // Personal: only tokens for this specific client
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.active !== false && (data.digits === digits || d.id === digits) && data.fcmToken) {
          tokens.push(data.fcmToken);
        }
      });
      console.log(`Personal FCM for ${digits}: ${tokens.length} token(s)`);
    } else {
      // Broadcast: all active subscribers
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.active !== false && data.fcmToken) {
          tokens.push(data.fcmToken);
        }
      });
      console.log(`Broadcast FCM: ${tokens.length} token(s)`);
    }

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, message: 'No active subscribers' });
    }

    // Remove duplicate tokens
    tokens = [...new Set(tokens)];

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body: body || '' },
      webpush: {
        notification: {
          icon:  icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          requireInteraction: false,
        },
        fcmOptions: { link: 'https://gabriel-barber-studio.vercel.app' },
      },
      android: {
        notification: {
          icon:  'notification_icon',
          color: '#c9a84c',
          sound: 'default',
        },
        priority: 'high',
      },
    });

    // Clean up invalid tokens from Firestore
    const invalidCodes = ['messaging/registration-token-not-registered','messaging/invalid-registration-token'];
    const cleanups = [];
    response.responses.forEach((r, i) => {
      if (!r.success && invalidCodes.includes(r.error?.code)) {
        // Find and deactivate this token
        snap.docs.forEach(d => {
          if (d.data().fcmToken === tokens[i]) {
            cleanups.push(db.collection('push_subscribers').doc(d.id).update({ active: false, fcmToken: null }));
          }
        });
      }
    });
    if (cleanups.length) await Promise.allSettled(cleanups);

    console.log(`Sent: ${response.successCount} | Failed: ${response.failureCount}`);
    return res.status(200).json({
      sent:   response.successCount,
      failed: response.failureCount,
      total:  tokens.length,
    });

  } catch(e) {
    console.error('Notify error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
