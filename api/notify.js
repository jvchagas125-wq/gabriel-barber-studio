// Vercel Serverless Function — Enviar FCM para todos os subscribers
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializar Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

// Obter access token OAuth2 para FCM v1 API
async function getAccessToken(clientEmail, privateKey) {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  }));

  // Assinar com chave privada RSA
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = new TextEncoder().encode(header + '.' + payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  const jwt = header + '.' + payload + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)));

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });
  const data2 = await resp.json();
  return data2.access_token;
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notify-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  if (req.headers['x-notify-secret'] !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, icon } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title obrigatório' });

  try {
    // Buscar tokens FCM
    const snap = await db.collection('push_subscribers')
      .where('active', '==', true)
      .get();

    const tokens = snap.docs.map(d => d.data().fcmToken).filter(Boolean);
    console.log('Tokens encontrados:', tokens.length);

    if (!tokens.length) return res.status(200).json({ sent: 0, message: 'Sem tokens' });

    // Obter access token
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const projectId   = process.env.FIREBASE_PROJECT_ID;

    let sent = 0, failed = 0;
    for (const token of tokens) {
      try {
        const r = await fetch(
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
                notification: { title, body: body || '' },
                webpush: {
                  notification: {
                    title,
                    body: body || '',
                    icon: icon || 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
                    badge: 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png',
                  },
                  fcm_options: { link: 'https://gabriel-barber-studio.vercel.app' },
                },
              },
            }),
          }
        );
        if (r.ok) { sent++; }
        else { failed++; console.error('FCM err:', await r.text()); }
      } catch (e) { failed++; console.error('token err:', e); }
    }

    return res.status(200).json({ sent, failed, total: tokens.length });
  } catch (e) {
    console.error('handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
