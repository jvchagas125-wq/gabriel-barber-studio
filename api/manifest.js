export default async function handler(req, res) {
  const isAdmin = req.query.admin === '1';

  // Default icons — overridden by client-side JS after load
  const defaultIcon = 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png';

  const manifest = {
    name: isAdmin ? 'Gabriel Barber Admin' : 'Gabriel Barber Studio',
    short_name: isAdmin ? 'GBS Admin' : 'Gabriel Barber',
    description: isAdmin
      ? 'Painel administrativo Gabriel Barber Studio'
      : 'Agende seu horário na Gabriel Barber Studio',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#c9a84c',
    orientation: 'portrait',
    icons: [
      { src: defaultIcon, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: defaultIcon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    categories: ['lifestyle', 'shopping'],
    lang: 'pt-BR'
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(manifest);
}
