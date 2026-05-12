import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC5cKDMTXBnkB7bRnhbQGInHp5NVPOW9zk",
  authDomain: "gabriel-barber-studio.firebaseapp.com",
  projectId: "gabriel-barber-studio",
};

function getApp(){
  if(getApps().length) return getApps()[0];
  return initializeApp(firebaseConfig);
}

export default async function handler(req, res) {
  const isAdmin = req.query.admin === '1';

  let iconUrl = 'https://i.postimg.cc/FFpNdnLT/Design-sem-nome.png';

  try {
    const app = getApp();
    const db = getFirestore(app);
    const snap = await getDoc(doc(db, 'config', 'appearance'));
    if(snap.exists()){
      const d = snap.data();
      iconUrl = isAdmin
        ? (d.pwaAdminIcon || d.pwaIcon || iconUrl)
        : (d.pwaIcon || iconUrl);
    }
  } catch(e){
    console.warn('manifest fetch error:', e.message);
  }

  const manifest = {
    name: isAdmin ? 'Gabriel Barber Admin' : 'Gabriel Barber Studio',
    short_name: isAdmin ? 'GBS Admin' : 'Gabriel Barber',
    description: isAdmin ? 'Painel administrativo' : 'Agende seu horário na Gabriel Barber Studio',
    start_url: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#c9a84c',
    orientation: 'portrait',
    icons: [
      { src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    categories: ['lifestyle', 'shopping'],
    lang: 'pt-BR'
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(manifest);
}
