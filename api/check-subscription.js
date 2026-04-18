// api/check-subscription.js
// Consultado pelo site para verificar se o telefone tem assinatura ativa no MP

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
  // CORS para o site
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email required" });

  try {
    const db = initFirebase();

    // Busca assinatura ativa pelo email do pagador
    const snap = await db
      .collection("subscriptions")
      .where("payerEmail", "==", email.toLowerCase())
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(200).json({ active: false });
    }

    const sub = snap.docs[0].data();
    return res.status(200).json({
      active:    true,
      planName:  sub.planName,
      planPrice: sub.planPrice,
      benefits:  sub.benefits || [],
    });

  } catch (err) {
    console.error("check-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
}
