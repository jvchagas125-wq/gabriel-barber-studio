// api/mp-checkout.js
// Cria uma preferência de pagamento no Mercado Pago

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productId, productName, price, clientPhone, clientName } = req.body || {};
  if (!productId || !productName || !price) {
    return res.status(400).json({ error: 'productId, productName e price são obrigatórios' });
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  const baseUrl = 'https://gabriel-barber-studio.vercel.app';

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{
          id: productId,
          title: productName,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(price),
        }],
        payer: {
          name: clientName || '',
          phone: { number: (clientPhone || '').replace(/\D/g, '') },
        },
        back_urls: {
          success: `${baseUrl}/?payment=success&product=${encodeURIComponent(productId)}&phone=${encodeURIComponent((clientPhone||'').replace(/\D/g,''))}`,
          failure: `${baseUrl}/?payment=failure`,
          pending: `${baseUrl}/?payment=pending`,
        },
        auto_return: 'approved',
        notification_url: `https://gabriel-barber-studio.vercel.app/api/mp-webhook`,
        metadata: {
          product_id: productId,
          client_phone: (clientPhone || '').replace(/\D/g, ''),
          client_name: clientName || '',
        },
        statement_descriptor: 'GABRIEL BARBER',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('MP API error:', JSON.stringify(data));
      return res.status(500).json({ error: data.message || 'Erro ao criar preferência' });
    }

    return res.status(200).json({
      preferenceId: data.id,
      initPoint: data.init_point,
    });

  } catch (err) {
    console.error('mp-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
