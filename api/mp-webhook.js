// api/mp-webhook.js
// Recebe as notificações do Mercado Pago e, quando o pagamento é APROVADO:
//  - Compra de GB$   → credita os GB$ na carteira do cliente
//  - Produto em R$   → registra o pedido em "Resgates de clientes" (painel admin) e consome o cupom
//
// Idempotente: o MP reenvia notificações; cada pagamento é processado UMA vez só
// (marcador mp_processed/{paymentId} gravado no mesmo batch atômico do crédito).

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

const isAlreadyExists = e => e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message || ''));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body  = req.body || {};
  const topic = body.type || req.query?.type || req.query?.topic;
  const mpId  = body.data?.id || req.query?.['data.id'] || req.query?.id;
  if (topic !== 'payment' || !mpId) return res.status(200).json({ ok: true, skipped: true });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  try {
    // Sempre confirma o pagamento direto na API do MP (não confia no corpo da notificação)
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) throw new Error('MP API error: ' + mpRes.status);
    const payment = await mpRes.json();

    const status      = payment.status; // approved | pending | rejected | ...
    const meta        = payment.metadata || {};
    const paymentType = meta.type || 'product';
    const productId   = meta.product_id;
    const clientPhone = (meta.client_phone || '').replace(/\D/g, '');
    const clientName  = meta.client_name || '';
    const paymentId   = String(payment.id);

    if (!productId || !clientPhone) {
      console.log('Webhook sem productId/clientPhone, ignorando');
      return res.status(200).json({ ok: true });
    }

    const db  = initFirebase();
    const now = new Date().toISOString();

    // ── Pagamento aprovado ───────────────────────────────────────────
    if (status === 'approved') {
      const batch = db.batch();

      // Marcador de idempotência: se já existir, o batch inteiro falha e nada é creditado de novo
      batch.create(db.collection('mp_processed').doc(paymentId), {
        paymentId, type: paymentType, productId, clientPhone,
        amount: payment.transaction_amount, processedAt: FieldValue.serverTimestamp(),
      });

      if (paymentType === 'gbs') {
        const coins = parseInt(meta.coins) || 0;
        const bonus = parseInt(meta.bonus) || 0;
        const total = coins + bonus;
        const walletRef = db.collection('wallets').doc(clientPhone);

        batch.set(walletRef, {
          balance: FieldValue.increment(total), digits: clientPhone, updatedAt: now,
        }, { merge: true });
        batch.set(db.collection('gb_purchases').doc(productId), {
          status: 'approved', paymentId, coins, bonus, approvedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(walletRef.collection('transactions').doc(paymentId), {
          type: 'purchase', amount: total, coins, bonus, paymentId, createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        const orderId    = meta.order_id || '';
        const couponCode = meta.coupon_code || '';

        batch.set(db.collection('store_payments').doc(paymentId), {
          paymentId, orderId, productId, clientPhone, clientName,
          amount: payment.transaction_amount, status: 'approved',
          couponCode, createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Aparece em "Resgates de clientes" no painel admin (mesmo formato dos resgates em GB$)
        batch.set(db.collection('redemptions').doc(paymentId), {
          clientPhone, clientName, digits: clientPhone,
          productId, productName: meta.product_name || 'Produto',
          productCost: 0,                       // pago em R$, não debitou GB$
          paidBrl: payment.transaction_amount,
          category: meta.category || 'Geral',
          couponCode, paymentId,
          redeemedAt: now, status: 'pending',
        });

        if (couponCode) {
          batch.set(db.collection('clients').doc(clientPhone), {
            coupons: { [couponCode]: { uses: FieldValue.increment(1), lastUsedAt: now } },
          }, { merge: true });
        }
      }

      try {
        await batch.commit();
      } catch (e) {
        if (isAlreadyExists(e)) return res.status(200).json({ ok: true, duplicate: true });
        throw e;
      }
      console.log(`✅ Pagamento aprovado (${paymentType}): ${paymentId} | ${clientPhone}`);
      return res.status(200).json({ ok: true, status, type: paymentType });
    }

    // ── Outros status (pending/rejected...) ──────────────────────────
    // Atualiza o pedido de GB$ sem nunca rebaixar um pedido que já foi aprovado
    if (paymentType === 'gbs') {
      const ref  = db.collection('gb_purchases').doc(productId);
      const snap = await ref.get();
      if (!snap.exists || snap.data().status !== 'approved') {
        await ref.set({ status, paymentId }, { merge: true });
      }
    }
    console.log(`ℹ️ Pagamento ${status}: ${paymentId}`);
    return res.status(200).json({ ok: true, status, type: paymentType });

  } catch (err) {
    console.error('mp-webhook error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
