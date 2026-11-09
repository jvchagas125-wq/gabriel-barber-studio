// api/mp-checkout.js
// Cria a preferência de pagamento no Mercado Pago.
//
// SEGURANÇA: preço, pacote de GB$ e desconto são sempre buscados no Firestore (Admin SDK).
// O navegador só informa QUAL produto/pacote quer e QUAL cupom está usando — nunca o valor.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

// Mesmo fallback do site, usado só se config/gb_packages não existir
const DEFAULT_GB_PACKAGES = [
  { id: 'pkg1', price: 10,  coins: 11,  bonus: 1,   active: true },
  { id: 'pkg2', price: 25,  coins: 30,  bonus: 5,   active: true },
  { id: 'pkg3', price: 50,  coins: 70,  bonus: 20,  active: true },
  { id: 'pkg4', price: 150, coins: 250, bonus: 100, active: true },
];

const round2  = n => Math.round(n * 100) / 100;
const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD

// Valida o cupom: existe, ativo, dentro da validade, cobre o produto,
// foi resgatado por este cliente e ainda tem usos sobrando.
async function findValidCoupon(db, code, digits, productId) {
  code = String(code || '').toUpperCase();
  const cfg = await db.collection('config').doc('coupons').get();
  const list = (cfg.exists && Array.isArray(cfg.data().list)) ? cfg.data().list : [];
  const c = list.find(x => x.code === code);
  if (!c || c.active === false)                  return { error: 'Cupom inválido ou desativado.' };
  if (c.expiresAt && c.expiresAt < todayBR())    return { error: 'Este cupom expirou.' };
  if (!(c.allProducts || (c.productIds || []).includes(productId)))
                                                 return { error: 'Este cupom não vale para este produto.' };
  const cl = await db.collection('clients').doc(digits).get();
  const mine = cl.exists ? ((cl.data().coupons || {})[code]) : null;
  if (!mine)                                     return { error: 'Você ainda não resgatou este cupom.' };
  const max = c.maxUsesPerClient === undefined ? 1 : (parseInt(c.maxUsesPerClient) || 0); // 0 = ilimitado
  if (max > 0 && (mine.uses || 0) >= max)        return { error: 'Você já utilizou este cupom.' };
  return { coupon: c };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, productId, packageId, clientPhone, clientName, couponCode, orderId } = req.body || {};
  const phone = (clientPhone || '').replace(/\D/g, '');
  if (!productId || !phone) return res.status(400).json({ error: 'productId e clientPhone são obrigatórios' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  const baseUrl = 'https://gabriel-barber-studio.vercel.app';
  const kind = type === 'gbs' ? 'gbs' : 'product';

  try {
    const db = initFirebase();
    let title, price, meta;

    if (kind === 'gbs') {
      // ── Compra de GB$: pacote vem do Firestore ──
      const snap = await db.collection('config').doc('gb_packages').get();
      const pkgs = (snap.exists && Array.isArray(snap.data().packages) && snap.data().packages.length)
        ? snap.data().packages : DEFAULT_GB_PACKAGES;
      const pkg = pkgs.find(p => p.id === packageId && p.active !== false);
      if (!pkg) return res.status(400).json({ error: 'Pacote de GB$ inválido ou indisponível.' });
      const coins = parseInt(pkg.coins) || 0;
      const bonus = parseInt(pkg.bonus) || 0;
      price = round2(Number(pkg.price));
      title = `${coins + bonus} GB$ — Gabriel Barber`;
      meta  = { type: 'gbs', package_id: String(pkg.id), coins, bonus };
    } else {
      // ── Produto da loja em R$: preço e cupom validados aqui ──
      const snap = await db.collection('store_products').doc(String(productId)).get();
      if (!snap.exists) return res.status(404).json({ error: 'Produto não encontrado.' });
      const prod = snap.data();
      if (prod.active === false || prod.costType !== 'brl' || !(Number(prod.priceBrl) > 0)) {
        return res.status(400).json({ error: 'Produto indisponível para compra em R$.' });
      }
      price = round2(Number(prod.priceBrl));
      title = prod.name || 'Produto';
      let coupon = null;
      if (couponCode) {
        const r = await findValidCoupon(db, couponCode, phone, String(productId));
        if (r.error) return res.status(409).json({ error: r.error });
        coupon = r.coupon;
        price = round2(price * (100 - (parseFloat(coupon.discountPct) || 0)) / 100);
      }
      meta = {
        type: 'product',
        product_name: title,
        category: prod.category || 'Geral',
        coupon_code: coupon ? coupon.code : '',
        coupon_pct:  coupon ? coupon.discountPct : 0,
      };
    }

    if (!(price >= 1)) return res.status(400).json({ error: 'O valor mínimo para pagamento online é R$ 1,00.' });

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({
        items: [{
          id: String(productId), title, quantity: 1, currency_id: 'BRL', unit_price: price,
        }],
        payer: { name: clientName || '', phone: { number: phone } },
        back_urls: {
          success: `${baseUrl}/?payment=success`,
          failure: `${baseUrl}/?payment=failure`,
          pending: `${baseUrl}/?payment=pending`,
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/api/mp-webhook`,
        metadata: {
          ...meta,
          product_id:   String(productId),
          order_id:     String(orderId || ''),
          client_phone: phone,
          client_name:  clientName || '',
        },
        statement_descriptor: 'GABRIEL BARBER',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('MP API error:', JSON.stringify(data));
      return res.status(500).json({ error: data.message || 'Erro ao criar preferência' });
    }

    return res.status(200).json({ preferenceId: data.id, initPoint: data.init_point, finalPrice: price });

  } catch (err) {
    console.error('mp-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
