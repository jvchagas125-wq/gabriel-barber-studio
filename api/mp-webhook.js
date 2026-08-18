// api/mp-webhook.js
// Recebe notificações do Mercado Pago quando pagamento é confirmado
// e atualiza o Firestore com status do pagamento

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, data } = req.body || {};

  // MP envia type=payment quando um pagamento é processado
  if (type !== 'payment' || !data?.id) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  try {
    // Buscar detalhes do pagamento na API do MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) throw new Error('MP API error: ' + mpRes.status);
    const payment = await mpRes.json();

    const status      = payment.status;           // approved, rejected, pending
    const productId   = payment.metadata?.product_id;
    const clientPhone = payment.metadata?.client_phone;
    const clientName  = payment.metadata?.client_name;
    const amount      = payment.transaction_amount;
    const paymentId   = String(payment.id);

    if (!productId || !clientPhone) {
      console.log('Webhook sem productId/clientPhone, ignorando');
      return res.status(200).json({ ok: true });
    }

    const db = initFirebase();

    // Salvar registro do pagamento no Firestore
    await db.collection('store_payments').doc(paymentId).set({
      paymentId,
      productId,
      clientPhone,
      clientName,
      amount,
      status,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Se aprovado, salvar também na wallet do cliente como resgate pendente
    if (status === 'approved') {
      await db.collection('store_redeems').add({
        productId,
        clientPhone,
        clientName,
        amount,
        paymentId,
        paymentStatus: 'approved',
        status: 'pending_delivery', // Gabriel confirma a entrega
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`✅ Pagamento aprovado: ${paymentId} | produto: ${productId} | cliente: ${clientPhone}`);
    }

    return res.status(200).json({ ok: true, status });

  } catch (err) {
    console.error('mp-webhook error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
