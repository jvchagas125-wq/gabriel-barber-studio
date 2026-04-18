// api/webhook.js
// Recebe notificações do Mercado Pago e atualiza o Firestore

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Mapeamento: ID do plano MP → nome interno
const PLAN_MAP = {
  "088faf9bd4814ffb84b415736cfb1f80": { name: "LumberJack", price: "R$80/mes" },
  "694d9ae32b03435b85f961ac3d4b2428": { name: "Ontheruler", price: "R$90/mes" },
  "35515cb8289947f6a21fbe00747e2986": { name: "Linedup",    price: "R$125/mes" },
  "e398fc94b6a84ce28276f5675e1c981f": { name: "Gentleman",  price: "R$200/mes" },
};

const PLAN_BENEFITS = {
  LumberJack: ["1 Cabelo & Barba por mes", "1 Limpeza de Sobrancelha por mes"],
  Ontheruler: ["2 Cabelo & Barba por mes", "2 Limpezas de Sobrancelha por mes"],
  Linedup:    ["1 Corte por semana (4/mes)"],
  Gentleman:  ["1 Corte por semana (4/mes)", "1 Sobrancelha por semana (4/mes)", "1 Limpeza de Pele por mes"],
};

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") return res.status(405).end();

  // Token de segurança — bloqueia requisições sem o token correto
  const secret = req.headers["x-webhook-secret"] || req.query.secret;
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body;
  const topic = body?.type || req.query.topic;
  const resourceId = body?.data?.id || req.query.id;

  // Só processa eventos de assinatura (preapproval)
  if (topic !== "preapproval" || !resourceId) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    // Busca detalhes da assinatura no MP
    const mpRes = await fetch(
      `https://api.mercadopago.com/preapproval/${resourceId}`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    if (!mpRes.ok) throw new Error("MP API error: " + mpRes.status);
    const subscription = await mpRes.json();

    const planId    = subscription.preapproval_plan_id;
    const email     = subscription.payer_email;
    const phone     = subscription.payer_id?.toString(); // usaremos como ID do assinante
    const status    = subscription.status; // "authorized" | "paused" | "cancelled" | "pending"
    const subId     = subscription.id;

    const planInfo  = PLAN_MAP[planId];
    if (!planInfo) return res.status(200).json({ ok: true, unknown_plan: planId });

    const db = initFirebase();
    const ref = db.collection("subscriptions").doc(subId);

    if (status === "authorized") {
      // Ativa assinatura
      await ref.set({
        subscriptionId: subId,
        planId,
        planName:    planInfo.name,
        planPrice:   planInfo.price,
        benefits:    PLAN_BENEFITS[planInfo.name] || [],
        payerEmail:  email,
        payerMpId:   phone,
        status:      "active",
        activatedAt: FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      }, { merge: true });

    } else {
      // Pausa, cancela ou qualquer outro status → desativa
      await ref.set({
        status:    "inactive",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return res.status(200).json({ ok: true, status, plan: planInfo?.name });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
