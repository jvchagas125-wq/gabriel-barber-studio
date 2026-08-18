// api/mp-webhook.js
// Recebe notificações do Mercado Pago e processa:
// - Compra de GB$: credita GB$ na carteira do cliente
// - Produto em R$: registra pedido como aprovado

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }     from 'firebase-admin/firestore';

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

    const status      = payment.status; // approved, rejected, pending
    const meta        = payment.metadata || {};
    const paymentType = meta.type || 'product';
    const productId   = meta.product_id;
    const clientPhone = meta.client_phone;
    const clientName  = meta.client_name;
    const coins       = parseInt(meta.coins)  || 0;
    const bonus       = parseInt(meta.bonus)  || 0;
    const paymentId   = String(payment.id);

    if (!productId || !clientPhone) {
      console.log('Webhook sem productId/clientPhone, ignorando');
      return res.status(200).json({ ok: true });
    }

    const db = initFirebase();

    if (status === 'approved') {

      // ── COMPRA DE GB$ ──────────────────────────────────────────────
      if (paymentType === 'gbs') {
        const totalCoins = coins + bonus;
        const digits = clientPhone.replace(/\D/g, '');

        // Creditar GB$ na carteira do cliente
        const walletRef = db.collection('wallets').doc(digits);
        await walletRef.set({
          balance:   FieldValue.increment(totalCoins),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Atualizar o pedido para approved
        await db.collection('gb_purchases').doc(productId).set({
          status:     'approved',
          paymentId,
          approvedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Registrar transação no histórico
        await db.collection('wallets').doc(digits).collection('transactions').add({
          type:      'purchase',
          amount:    totalCoins,
          coins,
          bonus,
          paymentId,
          createdAt: FieldValue.serverTimestamp(),
        });

        console.log(`✅ GB$ creditados: +${totalCoins} para ${clientPhone}`);
      }

      // ── PRODUTO EM R$ ──────────────────────────────────────────────
      else {
        // Registrar pagamento aprovado
        await db.collection('store_payments').doc(paymentId).set({
          paymentId,
          productId,
          clientPhone,
          clientName,
          amount:     payment.transaction_amount,
          status:     'approved',
          createdAt:  FieldValue.serverTimestamp(),
        }, { merge: true });

        // Registrar resgate pendente de entrega
        await db.collection('store_redeems').add({
          productId,
          clientPhone,
          clientName,
          paymentId,
          paymentStatus: 'approved',
          status:        'pending_delivery',
          createdAt:     FieldValue.serverTimestamp(),
        });

        console.log(`✅ Produto aprovado: ${productId} | cliente: ${clientPhone}`);
      }

    } else {
      // Pagamento recusado/pendente — atualizar status
      if (paymentType === 'gbs') {
        await db.collection('gb_purchases').doc(productId).set({
          status:    status,
          paymentId,
        }, { merge: true });
      }
      console.log(`ℹ️ Pagamento ${status}: ${paymentId}`);
    }

    return res.status(200).json({ ok: true, status, type: paymentType });

  } catch (err) {
    console.error('mp-webhook error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
