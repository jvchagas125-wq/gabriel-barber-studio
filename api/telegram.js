export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notify-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-notify-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== 'gbs-notify-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '8534754261:AAGLFRJhSVVr7-afUbw8SUEwlXZC8q6kwqQ';
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '8680940876';

  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    const data = await r.json();
    if (!data.ok) return res.status(500).json({ error: data.description });
    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
