import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

function buildCredential() {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  
  // Remover aspas se existirem
  privateKey = privateKey.replace(/^"|"$/g, '');
  
  // Converter \n literal para quebra de linha real
  privateKey = privateKey.replace(/\\n/g, '\n');
  
  // Garantir que tem cabeçalho e rodapé corretos
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('FIREBASE_PRIVATE_KEY invalida — falta BEGIN PRIVATE KEY');
  }

  return cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  });
}

if (!getApps().length) {
  initializeApp({ credential: buildCredential() });
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
      .where('active', '==', true).get();
    const tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
    
    console.log('Tokens encontrados:', tokens.length);
    if (!tokens.length) return res.status(200).json({ sent: 0, message: 'Sem tokens' });

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body: body || '' },
      webpush: {
        notification: {
          icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
          badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
        },
        fcmOptions: { link: 'https://gabriel-barber-studio.vercel.app' },
      },
    });

    console.log('Enviados:', response.successCount, 'Falhos:', response.failureCount);
    return res.status(200).json({ sent: response.successCount, failed: response.failureCount, total: tokens.length });
  } catch (e) {
    console.error('ERRO COMPLETO:', e);
    return res.status(500).json({ error: e.message, code: e.code || 'unknown' });
  }
}
