/* ============================================================
   NARUA Artist Finder — MVMNTD INC
   script.js · Lógica principal + Firebase Firestore
   ============================================================ */


/* ── FIREBASE FIRESTORE ──────────────────────────────────── */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDYwBUEWhQNCRB5wZUCP1PrkgK_Q57QIZo",
  authDomain:        "artistas-na-rua.firebaseapp.com",
  projectId:         "artistas-na-rua",
  storageBucket:     "artistas-na-rua.firebasestorage.app",
  messagingSenderId: "998571196526",
  appId:             "1:998571196526:web:b3f4e7d65bba6bdf32e67f",
};

const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);
const COLL  = "artistas";

/**
 * Carrega artistas do Firestore.
 * Retorna null em caso de erro (usa fallback localStorage).
 */
async function dbLoad() {
  try {
    const snap = await getDocs(collection(db, COLL));
    if (snap.empty) return null; // sem dados ainda — usa defaults
    return snap.docs.map(d => {
      const data = d.data();
      return { tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [], ...data, id: parseInt(d.id) };
    });
  } catch (e) {
    console.warn("Firestore indisponível, usando localStorage:", e);
    return null;
  }
}

/** Salva/atualiza um artista no Firestore. */
async function dbSave(artist) {
  try {
    await setDoc(doc(db, COLL, String(artist.id)), sanitizeForFirestore(artist));
  } catch (e) {
    console.warn("Erro ao salvar no Firestore:", e);
  }
}

/** Remove um artista do Firestore. */
async function dbDelete(id) {
  try {
    await deleteDoc(doc(db, COLL, String(id)));
  } catch (e) {
    console.warn("Erro ao deletar do Firestore:", e);
  }
}

/** Salva lista inteira (usado em importação). */
async function dbSaveAll(list) {
  try {
    const snap = await getDocs(collection(db, COLL));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, COLL, d.id))));
    await Promise.all(list.map(a => setDoc(doc(db, COLL, String(a.id)), sanitizeForFirestore(a))));
  } catch (e) {
    console.warn("Erro ao salvar tudo no Firestore:", e);
  }
}

/** Remove campos undefined que o Firestore não aceita. */
function sanitizeForFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}


/* ── SPOTIFY API (PKCE — sem secret, seguro no browser) ─────── */

const SPOTIFY_CLIENT_ID = 'c8de8dbc0c824f88bf94b42ce58e38ce';
const SPOTIFY_REDIRECT  = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? location.origin + location.pathname
  : 'https://mvmntdinc.github.io/artistasnarua/';

let spotifyToken    = localStorage.getItem('sp_token')   || null;
let spotifyTokenExp = parseInt(localStorage.getItem('sp_exp') || '0');
let _refreshingToken = false; // evita chamadas paralelas de refresh

/* ── PKCE helpers ─────────────────────────────────────────── */
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function generatePKCE() {
  const verifier  = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/**
 * Inicia o fluxo PKCE — redireciona para o Spotify autorizar.
 */
async function startSpotifyAuth() {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('sp_verifier', verifier);

  const params = new URLSearchParams({
    client_id:             SPOTIFY_CLIENT_ID,
    response_type:         'code',
    redirect_uri:          SPOTIFY_REDIRECT,
    scope:                 'user-read-private',
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });

  location.href = 'https://accounts.spotify.com/authorize?' + params;
}

/**
 * Troca o code por token depois do redirect.
 */
async function handleSpotifyCallback() {
  const code     = new URLSearchParams(location.search).get('code');
  const verifier = sessionStorage.getItem('sp_verifier');
  if (!code || !verifier) return;

  history.replaceState({}, '', location.pathname);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  SPOTIFY_REDIRECT,
      client_id:     SPOTIFY_CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) throw new Error('Falha ao trocar code por token');
  const data = await res.json();
  spotifyToken    = data.access_token;
  spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem('sp_token',   spotifyToken);
  localStorage.setItem('sp_exp',     String(spotifyTokenExp));
  if (data.refresh_token) {
    localStorage.setItem('sp_refresh', data.refresh_token);
  }
  sessionStorage.removeItem('sp_verifier');
  showToast('✓ Spotify conectado!');
}

/** Retorna token válido. Renova via refresh token se expirado. */
async function getSpotifyToken() {
  // Token ainda válido
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

  // Evita chamadas paralelas de refresh
  if (_refreshingToken) {
    await new Promise(r => setTimeout(r, 800));
    return spotifyToken;
  }
  _refreshingToken = true;

  try {
    // 1ª tentativa: refresh token (Spotify PKCE com offline_access)
    const refreshToken = localStorage.getItem('sp_refresh');
    if (refreshToken) {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
          client_id:     SPOTIFY_CLIENT_ID,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        spotifyToken    = data.access_token;
        spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
        localStorage.setItem('sp_token', spotifyToken);
        localStorage.setItem('sp_exp',   String(spotifyTokenExp));
        if (data.refresh_token) localStorage.setItem('sp_refresh', data.refresh_token);
        console.log('[Spotify] Token renovado via refresh_token ✓');
        return spotifyToken;
      }
      console.warn('[Spotify] refresh_token falhou, vai pedir novo login');
    }

    // 2ª tentativa: popup silencioso (evita redirecionar a página)
    const newToken = await silentSpotifyAuth();
    if (newToken) return newToken;

    // Último recurso: redirect normal
    showToast('🔄 Reconectando ao Spotify...', 2000);
    await new Promise(r => setTimeout(r, 1500));
    await startSpotifyAuth();
    return null;

  } finally {
    _refreshingToken = false;
  }
}

/**
 * Abre uma janela popup para re-auth sem sair da página.
 * Retorna o novo token se funcionar, ou null.
 */
async function silentSpotifyAuth() {
  return new Promise(async (resolve) => {
    const { verifier, challenge } = await generatePKCE();
    sessionStorage.setItem('sp_verifier', verifier);

    const params = new URLSearchParams({
      client_id:             SPOTIFY_CLIENT_ID,
      response_type:         'code',
      redirect_uri:          SPOTIFY_REDIRECT,
      scope:                 'user-read-private',
      code_challenge_method: 'S256',
      code_challenge:        challenge,
    });

    const popup = window.open(
      'https://accounts.spotify.com/authorize?' + params,
      'spotify_auth',
      'width=500,height=650,left=200,top=100'
    );

    if (!popup) { resolve(null); return; }

    // Monitora o popup até ele redirecionar de volta com ?code=
    const check = setInterval(async () => {
      try {
        const popupUrl = popup.location.href;
        if (popupUrl.includes('code=')) {
          clearInterval(check);
          const code = new URL(popupUrl).searchParams.get('code');
          popup.close();

          // Troca o code por token
          const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type:    'authorization_code',
              code,
              redirect_uri:  SPOTIFY_REDIRECT,
              client_id:     SPOTIFY_CLIENT_ID,
              code_verifier: verifier,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            spotifyToken    = data.access_token;
            spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
            localStorage.setItem('sp_token',   spotifyToken);
            localStorage.setItem('sp_exp',     String(spotifyTokenExp));
            if (data.refresh_token) localStorage.setItem('sp_refresh', data.refresh_token);
            sessionStorage.removeItem('sp_verifier');
            showToast('✓ Spotify reconectado!');
            resolve(spotifyToken);
          } else {
            resolve(null);
          }
        }
      } catch {
        // popup ainda em accounts.spotify.com — normal, aguarda
      }
      if (popup.closed) { clearInterval(check); resolve(null); }
    }, 500);

    // Timeout de 2 minutos
    setTimeout(() => { clearInterval(check); popup.close(); resolve(null); }, 120000);
  });
}

/**
 * Busca artistas no Spotify pelo nome — retorna até 5 resultados.
 */
async function searchSpotifyArtists(queryText) {
  const token = await getSpotifyToken();
  if (!token) return [];
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(queryText)}&type=artist&market=BR&limit=5`;
  const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.artists?.items || [];
}

/**
 * Top tracks desativado — endpoint /top-tracks retorna 403
 * na maioria das contas. Retorna sempre array vazio.
 */
async function getTopTracks(_artistId) {
  return [];
}

/**
 * Botão "Buscar no Spotify" — preenche os campos do formulário automaticamente.
 */
/**
 * Extrai o Artist ID de um URL do Spotify.
 * Ex: https://open.spotify.com/artist/246dkjvS1zLTtiykXe5h60
 * Retorna null se não for um URL válido.
 */
function extractSpotifyId(input) {
  // Aceita: spotify.com/artist/ID  ou  spotify.com/intl-pt/artist/ID  etc.
  const match = input.match(/spotify\.com(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/artist\/([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

async function fetchSpotify() {
  const input = document.getElementById('f-nome').value.trim();
  if (!input) { showToast('⚠ Cola o link do Spotify ou nome do artista', 2000); return; }

  const btn = document.getElementById('btn-spotify');
  btn.textContent = '⟳ Buscando...';
  btn.disabled    = true;

  try {
    const artistId = extractSpotifyId(input);

    if (artistId) {
      // URL colado — busca direto pelo ID, sem dropdown
      const token = await getSpotifyToken();
      if (!token) return;
      const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Artista não encontrado');
      const artist = await res.json();
      preencherArtista(artist);
    } else {
      // Texto digitado — retorna lista para escolher
      const results = await searchSpotifyArtists(input);
      if (!results.length) { showToast('Nenhum artista encontrado', 2500); return; }
      if (results.length === 1) {
        preencherArtista(results[0]);
      } else {
        renderSearchDropdown(results);
      }
    }
  } catch (e) {
    console.error(e);
    showToast('Erro ao buscar no Spotify. Tente de novo.', 3000);
  } finally {
    btn.textContent = '🔍 Buscar no Spotify';
    btn.disabled    = false;
  }
}

/** Preenche o formulário com os dados de um artista escolhido. */
function preencherArtista(artist) {
  document.getElementById('f-seg-spot').value = artist.followers?.total || 0;
  document.getElementById('f-pop').value       = artist.popularity      || 0;
  document.getElementById('f-spot-id').value   = artist.id;
  document.getElementById('f-nome').value      = artist.name;

  const followers = artist.followers?.total || 0;
  document.getElementById('f-spotify').value = followers;

  const genreMap = {
    funk: 'funk', trap: 'trap', rap: 'rap', 'hip hop': 'rap',
    'hip-hop': 'rap', 'r&b': 'rb', 'soul': 'rb', reggae: 'outro',
    sertanejo: 'outro', pagode: 'outro', axe: 'outro',
  };
  const genres = artist.genres || [];
  let nichoDetectado = 'outro';
  for (const g of genres) {
    const gLower = g.toLowerCase();
    for (const [key, val] of Object.entries(genreMap)) {
      if (gLower.includes(key)) { nichoDetectado = val; break; }
    }
    if (nichoDetectado !== 'outro') break;
  }
  document.getElementById('f-niche').value = nichoDetectado;

  // Mostra preview do artista confirmado
  renderArtistPreview(artist);

  const genreStr = genres.slice(0, 2).join(', ') || 'gênero não identificado';
  showToast(`✓ ${artist.name} · ${fmtN(followers)} seguidores · ${genreStr}`);
}

window.preencherArtista = preencherArtista;

/** Renderiza dropdown para escolher entre múltiplos resultados. */
function renderSearchDropdown(results) {
  const wrap = document.getElementById('spotify-preview');
  wrap.innerHTML = `
    <div style="margin-bottom:8px;font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;">
      Vários artistas encontrados — escolha o certo:
    </div>
    ${results.map((a, i) => {
      const img = a.images?.[0]?.url
        ? `<img src="${a.images[0].url}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0;">`
        : `<div style="width:40px;height:40px;border-radius:6px;background:var(--surface3);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;">🎵</div>`;
      const followers = fmtN(a.followers?.total || 0);
      const genre     = a.genres?.[0] || 'sem gênero';
      return `
        <div onclick="preencherArtista(${JSON.stringify(a).replace(/"/g, '&quot;')})"
          style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;
                 border:1px solid var(--border);background:var(--surface2);cursor:pointer;
                 margin-bottom:6px;transition:border-color .15s,background .15s;"
          onmouseover="this.style.borderColor='var(--gold)';this.style.background='var(--gold-bg)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface2)'">
          ${img}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name}</div>
            <div style="font-size:11px;color:var(--gray2);">${followers} seguidores · ${genre}</div>
          </div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--gold);flex-shrink:0;">Escolher →</div>
        </div>`;
    }).join('')}
  `;
}

/** Preview compacto do artista confirmado. */
function renderArtistPreview(artist) {
  const wrap = document.getElementById('spotify-preview');
  const img  = artist.images?.[0]?.url
    ? `<img src="${artist.images[0].url}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
    : '';
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;
                border:1px solid var(--gold-dim);background:var(--gold-bg);">
      ${img}
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--white);">✓ ${artist.name}</div>
        <div style="font-size:11px;color:var(--gray2);">${fmtN(artist.followers?.total||0)} seguidores · Popularidade: ${artist.popularity}/100</div>
        <div style="font-size:10px;color:var(--gold);margin-top:2px;">${(artist.genres||[]).slice(0,2).join(', ') || 'gênero não identificado'}</div>
      </div>
    </div>
  `;
}



/* ── PERSISTÊNCIA ───────────────────────────────────────────── */

const STORAGE_KEY = 'narua_artists_v1';
const NEXTID_KEY  = 'narua_nextid_v1';

/** Artistas de exemplo carregados na primeira vez */
const DEFAULT_ARTISTS = [
  { id: 1,  nome: "MC Exemplo A", seg: 8200,  eng: 5.8, reels: 22, spotify: 1200, freq: 4, comp: true,  colab: false, niche: "funk", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 2,  nome: "Trap RJ B",    seg: 14500, eng: 3.1, reels: 9,  spotify: 3400, freq: 2, comp: false, colab: false, niche: "trap", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 3,  nome: "Artista C",    seg: 22000, eng: 1.2, reels: 5,  spotify: 800,  freq: 1, comp: true,  colab: false, niche: "trap", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 4,  nome: "Rapper D",     seg: 6800,  eng: 7.4, reels: 35, spotify: 950,  freq: 5, comp: false, colab: true,  niche: "rap",  tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 5,  nome: "Funkeiro E",   seg: 31000, eng: 4.2, reels: 18, spotify: 5600, freq: 3, comp: false, colab: false, niche: "funk", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 6,  nome: "MC F",         seg: 9500,  eng: 6.1, reels: 28, spotify: 2100, freq: 4, comp: false, colab: false, niche: "funk", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 7,  nome: "Trap G",       seg: 18000, eng: 2.3, reels: 8,  spotify: 1500, freq: 1, comp: true,  colab: false, niche: "trap", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 8,  nome: "Artista H",    seg: 42000, eng: 5.0, reels: 24, spotify: 8900, freq: 3, comp: false, colab: false, niche: "rap",  tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 9,  nome: "MC I",         seg: 12000, eng: 8.2, reels: 42, spotify: 1800, freq: 6, comp: false, colab: false, niche: "funk", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 10, nome: "Rapper J",     seg: 26000, eng: 1.8, reels: 6,  spotify: 600,  freq: 1, comp: true,  colab: true,  niche: "rap",  tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 11, nome: "MC K",         seg: 5200,  eng: 9.1, reels: 51, spotify: 700,  freq: 7, comp: false, colab: false, niche: "funk", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
  { id: 12, nome: "Trap L",       seg: 37000, eng: 3.8, reels: 16, spotify: 6200, freq: 2, comp: false, colab: false, niche: "trap", tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [] },
];

/** Carrega do localStorage (fallback). */
function loadLocalArtists() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_ARTISTS;
    return JSON.parse(saved).map(a => ({
      tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [], ...a,
    }));
  } catch { return DEFAULT_ARTISTS; }
}

/** Salva no localStorage (fallback / cache). */
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(artists));
    localStorage.setItem(NEXTID_KEY,  String(nextId));
  } catch (e) { console.warn('Erro ao salvar localStorage:', e); }
}

/**
 * saveArtists — salva no Firestore (principal) e localStorage (cache).
 * Recebe o artista modificado para evitar reescrever tudo no Firestore.
 * Se artistaModificado não for passado, salva tudo localmente apenas.
 */
function saveArtists(artistaModificado) {
  saveLocal();
  if (artistaModificado) dbSave(artistaModificado);
}

/** Exporta a lista como arquivo JSON. */
function exportJSON() {
  const data = JSON.stringify({ artists, nextId }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'narua-artistas.json'; a.click();
  URL.revokeObjectURL(url);
}

/** Importa a lista a partir de um arquivo JSON. */
function importJSON() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.artists)) throw new Error('inválido');
        artists = data.artists.map(a => ({ tiktok: 0, streams28: 0, ouvintes28: 0, ddChecklist: [], ...a }));
        nextId  = data.nextId || (Math.max(...artists.map(a => a.id)) + 1);
        saveLocal();
        showToast('⟳ Sincronizando com Firestore...', 2000);
        await dbSaveAll(artists);
        render();
        showToast(`✓ ${artists.length} artistas importados e salvos na nuvem`);
      } catch { alert('Arquivo inválido. Use um JSON exportado por este dashboard.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}


/* ── DADOS INICIAIS ─────────────────────────────────────────── */

let artists  = loadLocalArtists(); // substituído pelo Firestore após init
let nextId   = parseInt(localStorage.getItem(NEXTID_KEY) || '13');
let formOpen = true;

let cfg = {
  eng: 3, reels: 15, spotify: 500, freq: 2, segmin: 0, segmax: 50,
};

let abaAtiva = 'todos'; // 'todos' ou 'filtrados'


/* ── CHECKLIST DE DUE DILIGENCE ─────────────────────────────── */

const DD_ITEMS = [
  { key: 'spot4a',   label: 'Print Spotify for Artists (28d)' },
  { key: 'streams',  label: 'Streams ÷ Ouvintes calculado'   },
  { key: 'apple',    label: 'Apple Music for Artists'         },
  { key: 'tiktok',   label: 'TikTok Analytics'                },
  { key: 'contrato', label: 'Assinou carta de intenção'        },
];

/** Abre o modal de due diligence de um artista. */
function openDD(id) {
  const a = artists.find(x => x.id === id);
  if (!a) return;

  const ratio = a.streams28 && a.ouvintes28
    ? (a.streams28 / a.ouvintes28).toFixed(1)
    : null;

  const ratioColor = !ratio ? 'var(--gray2)'
    : ratio >= 10 ? 'var(--green)'
    : ratio >= 4  ? 'var(--amber)'
    : 'var(--red)';

  const ratioLabel = !ratio ? '—'
    : ratio >= 10 ? `${ratio} 🔥 Fã real`
    : ratio >= 4  ? `${ratio} ✓ OK`
    : `${ratio} ⚠ Baixo`;

  const checks = DD_ITEMS.map(item => {
    const checked = (a.ddChecklist || []).includes(item.key);
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" ${checked ? 'checked' : ''}
          onchange="toggleDD(${id},'${item.key}',this.checked)"
          style="width:15px;height:15px;accent-color:var(--gold);cursor:pointer;">
        <span style="font-size:12px;color:${checked?'var(--white)':'var(--gray2)'}">${item.label}</span>
        ${checked ? '<span style="margin-left:auto;font-size:10px;color:var(--green)">✓</span>' : ''}
      </label>`;
  }).join('');

  // Monta bloco de top músicas para o popup
  const topTracksPopup = (a.topTracks && a.topTracks.length)
    ? `<div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">🎵 Top Músicas — Streams Totais</div>
        ${a.topTracks.map((t, i) => {
          const maxStr = a.topTracks[0].streams || 1;
          const pct    = t.streams ? Math.round(t.streams / maxStr * 100) : 0;
          const receita = t.streams ? 'R$' + Math.round(t.streams * 0.013).toLocaleString('pt-BR') : '—';
          return `<div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:12px;color:var(--white);">${i+1}. ${t.nome}</span>
              <span style="font-size:11px;font-family:var(--mono);color:var(--gray2);">${t.streams ? (t.streams/1000).toFixed(0)+'K' : '?'} · <b style="color:var(--gold)">${receita}</b></span>
            </div>
            <div style="height:4px;background:var(--surface3);border-radius:2px;">
              <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;opacity:.8;"></div>
            </div>
          </div>`;
        }).join('')}
        ${a.totalStreams ? `<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px;display:flex;justify-content:space-between;">
          <span style="font-size:11px;color:var(--gray2);">Total acumulado</span>
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--gold);">R$${Math.round(a.totalStreams * 0.013).toLocaleString('pt-BR')}</span>
        </div>` : ''}
      </div>` : '';

  // Perfil resumido no topo
  const perfilHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#000;flex-shrink:0;">${a.nome.charAt(0)}</div>
      <div style="flex:1;">
        <div style="font-size:16px;font-weight:700;color:var(--white);">${a.nome}</div>
        <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--gray2);">👥 <b style="color:var(--white)">${fmtN(a.seg)}</b> seg. IG</span>
          <span style="font-size:11px;color:var(--gray2);">🎧 <b style="color:var(--white)">${fmtN(a.spotify)}</b> ouv/mês</span>
          <span style="font-size:11px;color:var(--gray2);">📊 <b style="color:var(--white)">${a.eng}%</b> eng.</span>
          ${a.tiktok ? `<span style="font-size:11px;color:var(--gray2);">🎵 <b style="color:var(--white)">${fmtN(a.tiktok)}</b> TikTok</span>` : ''}
        </div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;background:${a.niche==='trap'?'rgba(201,168,76,.15)':'var(--surface2)'};color:var(--gold);border:1px solid var(--gold-dim);">${a.niche}</span>
    </div>
    ${topTracksPopup}
  `;

  document.getElementById('dd-title').textContent = `${a.nome}`;
  document.getElementById('dd-body').innerHTML = perfilHtml + `

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;">
        <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Streams 28d</div>
        <input type="number" placeholder="ex: 45000" value="${a.streams28 || ''}"
          oninput="updateDD(${id},'streams28',this.value)"
          style="width:100%;background:transparent;border:none;outline:none;font-size:18px;font-weight:700;font-family:var(--mono);color:var(--white);">
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;">
        <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Ouvintes 28d</div>
        <input type="number" placeholder="ex: 8000" value="${a.ouvintes28 || ''}"
          oninput="updateDD(${id},'ouvintes28',this.value)"
          style="width:100%;background:transparent;border:none;outline:none;font-size:18px;font-weight:700;font-family:var(--mono);color:var(--white);">
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Streams ÷ Ouvintes</div>
        <div style="font-size:11px;color:var(--gray2)">≥10 = fã real · ≥4 = ok · &lt;4 = suspeito</div>
      </div>
      <div id="dd-ratio-${id}" style="font-size:22px;font-weight:700;font-family:var(--mono);color:${ratioColor}">${ratioLabel}</div>
    </div>

    <div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">TikTok — Seguidores</div>
      <input type="number" placeholder="ex: 3500" value="${a.tiktok || ''}"
        oninput="updateDD(${id},'tiktok',this.value)"
        style="width:100%;background:transparent;border:none;outline:none;font-size:18px;font-weight:700;font-family:var(--mono);color:var(--white);">
    </div>

    <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">O que você já coletou</div>
    ${checks}

    <div style="margin-top:14px;background:var(--gold-bg);border:1px solid var(--gold-dim);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--gold);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Script para pedir os dados</div>
      <div style="font-size:12px;color:var(--gray1);line-height:1.6;font-style:italic;">
        "Oi ${a.nome.split(' ')[0]}! Tenho interesse em lançar contigo pelo MVMNTD INC.
        Pra entender se o projeto faz sentido pra ambos, você pode me mandar um print do Spotify for Artists
        mostrando streams e ouvintes dos últimos 28 dias? Trabalho com dados pra garantir que o investimento
        em mídia vai retornar pra você também."
      </div>
    </div>

    <!-- ── CALCULADORA DE FEAT ─────────────────────────────── -->
    <div style="margin-top:16px;border:1px solid var(--border2);border-radius:10px;overflow:hidden;">
      <div style="background:var(--surface2);padding:12px 14px;border-bottom:1px solid var(--border);">
        <div style="font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:.08em;">💰 Calculadora de Retorno — Feat</div>
        <div style="font-size:10px;color:var(--gray2);margin-top:2px;">Baseado nos streams do artista + seu split</div>
      </div>
      <div style="padding:14px;background:var(--surface);">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="background:var(--surface2);border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Streams/mês do artista</div>
            <input type="number" id="calc-streams" placeholder="ex: 80000"
              value="${a.streams28 ? Math.round(a.streams28 * 1.1) : ''}"
              oninput="calcFeat(${id})"
              style="width:100%;background:transparent;border:none;outline:none;font-size:16px;font-weight:700;font-family:var(--mono);color:var(--white);">
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Seus streams/mês</div>
            <input type="number" id="calc-meus-streams" placeholder="ex: 50000"
              oninput="calcFeat(${id})"
              style="width:100%;background:transparent;border:none;outline:none;font-size:16px;font-weight:700;font-family:var(--mono);color:var(--white);">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
          <div style="background:var(--surface2);border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Seu split %</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="range" id="calc-split" min="10" max="90" step="5" value="50"
                oninput="calcFeat(${id});document.getElementById('calc-split-lbl').textContent=this.value+'%'"
                style="flex:1;accent-color:var(--gold);">
              <span id="calc-split-lbl" style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--gold);min-width:32px;">50%</span>
            </div>
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Taxa conversão %</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="range" id="calc-conv" min="5" max="50" step="5" value="20"
                oninput="calcFeat(${id});document.getElementById('calc-conv-lbl').textContent=this.value+'%'"
                style="flex:1;accent-color:var(--gold);">
              <span id="calc-conv-lbl" style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--gold);min-width:32px;">20%</span>
            </div>
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">R$/stream</div>
            <select id="calc-rate" oninput="calcFeat(${id})"
              style="width:100%;background:transparent;border:none;outline:none;font-size:13px;font-weight:700;font-family:var(--mono);color:var(--white);cursor:pointer;">
              <option value="0.013">R$0,013 — Spotify</option>
              <option value="0.019">R$0,019 — Apple</option>
              <option value="0.007">R$0,007 — Deezer</option>
              <option value="0.004">R$0,004 — YouTube</option>
            </select>
          </div>
        </div>

        <!-- Resultado -->
        <div id="calc-resultado-${id}" style="background:var(--surface2);border-radius:8px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--gray2);margin-bottom:8px;">Preencha os streams acima para calcular</div>
        </div>

      </div>
    </div>
  `;

  document.getElementById('dd-modal').style.display = 'flex';
}

/** Calcula retorno financeiro estimado do feat em tempo real. */
function calcFeat(id) {
  const streamsArtista  = parseFloat(document.getElementById('calc-streams')?.value)       || 0;
  const streamsMeus     = parseFloat(document.getElementById('calc-meus-streams')?.value)  || 0;
  const split           = parseFloat(document.getElementById('calc-split')?.value)         / 100 || 0.5;
  const conv            = parseFloat(document.getElementById('calc-conv')?.value)          / 100 || 0.2;
  const rate            = parseFloat(document.getElementById('calc-rate')?.value)          || 0.013;
  const el              = document.getElementById(`calc-resultado-${id}`);
  if (!el) return;

  if (!streamsArtista && !streamsMeus) {
    el.innerHTML = `<div style="font-size:11px;color:var(--gray2);">Preencha os streams acima para calcular</div>`;
    return;
  }

  // Streams gerados pelo feat
  // Audiência do artista: conv% dos ouvintes dele vão ouvir o feat
  // Audiência sua: 100% dos seus ouvintes já está exposto
  const streamsDoArtista = streamsArtista * conv;
  const streamsTotais    = streamsDoArtista + streamsMeus;

  // Curva de decaimento: mês 1 = 100%, mês 2 = 60%, mês 3 = 35%, mês 6 = 15%
  const m1 = streamsTotais;
  const m2 = streamsTotais * 0.60;
  const m3 = streamsTotais * 0.35;
  const m6 = streamsTotais * 0.15;
  const total6m = m1 + m2 + m3 + (streamsTotais * 0.25) + (streamsTotais * 0.20) + m6;

  const receitaMes = (v) => (v * rate * split).toFixed(2).replace('.', ',');
  const receitaTotal = (total6m * rate * split).toFixed(2).replace('.', ',');
  const fmtStr = (v) => v >= 1000 ? (v/1000).toFixed(0)+'K' : Math.round(v).toString();

  const corMes1 = (m1 * rate * split) >= 500 ? 'var(--green)' : (m1 * rate * split) >= 100 ? 'var(--amber)' : 'var(--gray1)';

  el.innerHTML = `
    <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">
      Projeção — ${fmtStr(streamsTotais)} streams/mês · Split ${Math.round(split*100)}%
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px;">
      ${[['Mês 1', m1, true], ['Mês 2', m2, false], ['Mês 3', m3, false], ['Mês 6', m6, false]].map(([label, str, destaque]) => `
        <div style="background:${destaque?'var(--gold-bg)':'var(--surface3)'};border:1px solid ${destaque?'var(--gold-dim)':'var(--border)'};border-radius:7px;padding:8px;text-align:center;">
          <div style="font-size:9px;color:var(--gray2);margin-bottom:3px;">${label}</div>
          <div style="font-size:11px;font-family:var(--mono);color:var(--gray2);">${fmtStr(str)} str.</div>
          <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:${destaque?corMes1:'var(--white)'};">R$${receitaMes(str)}</div>
        </div>`).join('')}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface3);border-radius:8px;padding:10px 14px;">
      <div>
        <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;">Total 6 meses</div>
        <div style="font-size:11px;color:var(--gray2);">${fmtStr(total6m)} streams acumulados</div>
      </div>
      <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--gold);">R$${receitaTotal}</div>
    </div>
    <div style="font-size:10px;color:var(--gray3);margin-top:8px;line-height:1.5;">
      * Conversão ${Math.round(conv*100)}% = % dos ouvintes do artista que vão ouvir o feat.
      Curva de decaimento padrão da indústria (mês 1 → 6). Valores estimados.
    </div>
  `;
}

window.calcFeat = calcFeat;

/** Atualiza campo de due diligence e recalcula ratio ao vivo. */
function updateDD(id, field, value) {
  const a = artists.find(x => x.id === id);
  if (!a) return;
  a[field] = parseFloat(value) || 0;

  if (field === 'streams28' || field === 'ouvintes28') {
    const ratio = a.streams28 && a.ouvintes28
      ? (a.streams28 / a.ouvintes28).toFixed(1)
      : null;
    const el = document.getElementById(`dd-ratio-${id}`);
    if (el) {
      const c = !ratio ? 'var(--gray2)' : ratio >= 10 ? 'var(--green)' : ratio >= 4 ? 'var(--amber)' : 'var(--red)';
      const l = !ratio ? '—' : ratio >= 10 ? `${ratio} 🔥 Fã real` : ratio >= 4 ? `${ratio} ✓ OK` : `${ratio} ⚠ Baixo`;
      el.style.color = c;
      el.textContent = l;
    }
  }

  saveArtists(a);
}

/** Marca/desmarca item do checklist de due diligence. */
function toggleDD(id, key, checked) {
  const a = artists.find(x => x.id === id);
  if (!a) return;
  a.ddChecklist = a.ddChecklist || [];
  if (checked) { if (!a.ddChecklist.includes(key)) a.ddChecklist.push(key); }
  else         { a.ddChecklist = a.ddChecklist.filter(k => k !== key); }
  saveArtists(a);
}

function closeDD() {
  document.getElementById('dd-modal').style.display = 'none';
  render();
}


/* ── ALGORITMO DE SCORE ─────────────────────────────────────── */

function calcScore(a) {
  let s = 0;

  // Engajamento Instagram (35pts)
  if      (a.eng >= 6)   s += 35;
  else if (a.eng >= 4)   s += 25;
  else if (a.eng >= 2.5) s += 12;

  // Reels reach por 1K seguidores (25pts)
  const rp = a.seg > 0 ? a.reels / (a.seg / 1000) : 0;
  if      (rp >= 3)   s += 25;
  else if (rp >= 1.5) s += 15;
  else                s += 5;

  // Spotify ouvintes mensais (20pts)
  if      (a.spotify >= 3000) s += 20;
  else if (a.spotify >= 1000) s += 12;
  else                        s += 5;

  // Frequência de postagem (15pts)
  if      (a.freq >= 4) s += 15;
  else if (a.freq >= 2) s += 8;

  // Penalidades
  if (a.comp) s -= 20;

  // Bônus base
  if (a.colab) s += 5;

  // Bônus due diligence: ratio streams/ouvintes
  if (a.streams28 && a.ouvintes28) {
    const ratio = a.streams28 / a.ouvintes28;
    if      (ratio >= 10) s += 10;
    else if (ratio >= 5)  s += 5;
    else if (ratio < 2)   s -= 5;
  }

  // Bônus TikTok
  if      (a.tiktok >= 10000) s += 5;
  else if (a.tiktok >= 3000)  s += 3;

  return Math.max(0, Math.min(100, Math.round(s)));
}

function tier(score) {
  return score >= 65 ? 'ideal' : score >= 40 ? 'ok' : 'fraco';
}


/* ── UTILITÁRIOS ────────────────────────────────────────────── */

function barColor(t) {
  return t === 'ideal' ? 'var(--green)' : t === 'ok' ? 'var(--amber)' : 'var(--red)';
}

function fmtN(n) { return n >= 1000 ? (n / 1000).toFixed(0) + 'K' : String(n); }
function fmtS(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }

function ddProgress(a) {
  const done  = (a.ddChecklist || []).length;
  const total = DD_ITEMS.length;
  return { done, total, pct: Math.round(done / total * 100) };
}


/* ── SVG SCORE RING ─────────────────────────────────────────── */

function buildRing(sc, t) {
  const color = t === 'ideal' ? '#00C98D' : t === 'ok' ? '#F0A030' : '#FF4D4D';
  const r = 22, cx = 28, cy = 28;
  const circ = 2 * Math.PI * r;
  const dash  = (sc / 100) * circ;
  return `
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#222" stroke-width="5"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
        stroke-dashoffset="${(circ / 4).toFixed(1)}"
        stroke-linecap="round"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
        font-size="12" font-weight="700"
        font-family="'Space Mono',monospace"
        fill="${color}">${sc}</text>
    </svg>`;
}


/* ── ABAS ───────────────────────────────────────────────────── */

function setTab(aba) {
  abaAtiva = aba;
  document.getElementById('tab-todos').classList.toggle('active',     aba === 'todos');
  document.getElementById('tab-filtrados').classList.toggle('active', aba === 'filtrados');
  render();
}

window.setTab = setTab;


/* ── FILTROS ────────────────────────────────────────────────── */

function sf(key, val, suffix) {
  cfg[key] = parseFloat(val);
  document.getElementById('lbl-' + key).textContent = val + suffix;
  render();
}

function sfSpot(val) {
  cfg.spotify = parseInt(val);
  const n = parseInt(val);
  document.getElementById('lbl-spotify').textContent =
    n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n;
  render();
}


/* ── FORMULÁRIO ─────────────────────────────────────────────── */

function toggleForm() {
  formOpen = !formOpen;
  document.getElementById('form-body').style.display = formOpen ? 'block' : 'none';
  const ch = document.getElementById('form-chevron');
  ch.textContent = formOpen ? '▲' : '▼';
  ch.className   = 'add-chevron' + (formOpen ? ' open' : '');
}

async function addArtist() {
  const nome = document.getElementById('f-nome').value.trim();
  if (!nome) { alert('Coloca o nome do artista!'); return; }

  const novoArtista = {
    id:          nextId++,
    nome,
    seg:         parseInt(document.getElementById('f-seg').value)     || 0,
    eng:         parseFloat(document.getElementById('f-eng').value)   || 0,
    reels:       parseFloat(document.getElementById('f-reels').value) || 0,
    spotify:     parseInt(document.getElementById('f-spotify').value) || 0,
    freq:        parseInt(document.getElementById('f-freq').value)    || 0,
    niche:       document.getElementById('f-niche').value,
    comp:        document.getElementById('f-comp').checked,
    colab:       document.getElementById('f-colab').checked,
    tiktok:      parseInt(document.getElementById('f-tiktok').value)  || 0,
    streams28:   0,
    ouvintes28:  0,
    ddChecklist: [],
    spotifyId:   document.getElementById('f-spot-id').value || '',
  };

  artists.push(novoArtista);

  ['f-nome','f-seg','f-eng','f-reels','f-spotify','f-freq','f-tiktok','f-spot-id','f-seg-spot','f-pop']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f-comp').checked  = false;
  document.getElementById('f-colab').checked = false;
  document.getElementById('spotify-preview').innerHTML = '';

  saveLocal();
  showToast('⟳ Salvando na nuvem...', 1500);
  await dbSave(novoArtista);
  render();
  showToast('✓ Artista salvo na nuvem ☁');
}

async function deleteArtist(id) {
  artists = artists.filter(a => a.id !== id);
  saveLocal();
  await dbDelete(id);
  render();
  showToast('Artista removido');
}

async function clearAll() {
  if (confirm('Remover todos os artistas cadastrados?')) {
    const ids = artists.map(a => a.id);
    artists = [];
    saveLocal();
    await Promise.all(ids.map(id => dbDelete(id)));
    render();
  }
}


/* ── RENDER PRINCIPAL ───────────────────────────────────────── */

function render() {
  const excComp = document.getElementById('tgl-comp').checked;

  const scored = artists.map(a => ({
    ...a, sc: calcScore(a), tier: tier(calcScore(a)),
  }));

  // "Todos" mostra tudo, sem filtro — só ordena por score
  // "Filtrados" aplica todos os filtros da sidebar
  const filtered = abaAtiva === 'todos'
    ? scored
    : scored.filter(a =>
        a.eng    >= cfg.eng &&
        (a.seg > 0 ? (a.reels / (a.seg / 1000)) : 0) >= (cfg.reels / 10) &&
        a.spotify >= cfg.spotify &&
        a.freq   >= cfg.freq &&
        a.seg    >= cfg.segmin * 1000 &&
        a.seg    <= cfg.segmax * 1000 &&
        (!excComp || !a.comp)
      );

  const ideais = filtered.filter(a => a.tier === 'ideal').length;
  const oks    = filtered.filter(a => a.tier === 'ok').length;
  const fracos = filtered.filter(a => a.tier === 'fraco').length;
  const avg    = filtered.length
    ? Math.round(filtered.reduce((s, a) => s + a.sc, 0) / filtered.length) : 0;

  // Summary strip
  document.getElementById('summary').innerHTML = `
    <div class="scard"><div class="scard-val">${scored.length}</div><div class="scard-label">cadastrados</div></div>
    <div class="scard"><div class="scard-val">${filtered.length}</div><div class="scard-label">no filtro</div></div>
    <div class="scard" style="border-color:rgba(0,201,141,.3);background:rgba(0,201,141,.07)">
      <div class="scard-val" style="color:var(--green)">${ideais}</div><div class="scard-label">ideal ≥65pts</div>
    </div>
    <div class="scard" style="border-color:rgba(240,160,48,.25)">
      <div class="scard-val" style="color:var(--amber)">${oks}</div><div class="scard-label">aceitável</div>
    </div>
    <div class="scard" style="border-color:rgba(255,77,77,.2)">
      <div class="scard-val" style="color:var(--red)">${fracos}</div><div class="scard-label">não rec.</div>
    </div>
    <div class="scard"><div class="scard-val">${avg}</div><div class="scard-label">score médio</div></div>
  `;

  // Ideal banner
  const excChip   = excComp ? `<span class="ib-chip danger">Sem <b>audiência comprada</b></span>` : '';
  const spotLabel = cfg.spotify >= 1000 ? (cfg.spotify/1000).toFixed(1)+'K' : cfg.spotify;
  document.getElementById('ideal-banner').innerHTML = `
    <div class="ib-label">Perfil que você está buscando agora</div>
    <div class="ib-chips">
      <span class="ib-chip">Eng. <b>≥${cfg.eng}%</b></span>
      <span class="ib-chip">Reels <b>≥${cfg.reels}%</b></span>
      <span class="ib-chip">Spotify <b>≥${spotLabel}</b></span>
      <span class="ib-chip">Posts <b>≥${cfg.freq}x/sem</b></span>
      <span class="ib-chip">Seg. <b>${cfg.segmin}K–${cfg.segmax}K</b></span>
      ${excChip}
    </div>
  `;

  document.getElementById('grid-count').innerHTML = `<b>${filtered.length}</b> artistas encontrados`;

  const sorted = [...filtered].sort((a, b) => b.sc - a.sc);
  const grid   = document.getElementById('artist-grid');

  if (!sorted.length) {
    grid.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">Nenhum artista passou nos filtros.</div>
        <div class="no-results-sub">Ajuste os sliders ou cadastre novos artistas acima.</div>
      </div>`;
    return;
  }

  grid.innerHTML = sorted.map(a => buildCard(a)).join('');
}


/* ── BUILD CARD ─────────────────────────────────────────────── */

function buildCard(a) {
  const t       = a.tier;
  const bc      = barColor(t);
  const pillCls = t === 'ideal' ? 'sp-ideal' : t === 'ok' ? 'sp-ok' : 'sp-fraco';
  const pillLbl = t === 'ideal' ? 'Ideal' : t === 'ok' ? 'Aceitável' : 'Fraco';

  const warns = [];
  if (a.comp)    warns.push('⚠ Audiência comprada');
  if (a.eng < 2) warns.push('⚠ Eng. baixo');
  if (a.freq < 2) warns.push('⚠ Posta pouco');
  if (a.streams28 && a.ouvintes28 && (a.streams28 / a.ouvintes28) < 2)
    warns.push('⚠ Ratio baixo');

  const goods = [];
  if (a.colab)           goods.push('✓ Já colaborou');
  if (a.eng >= 6)        goods.push('✓ Engaj. excelente');
  if (a.spotify >= 3000) goods.push('✓ Spotify sólido');
  if (a.streams28 && a.ouvintes28 && (a.streams28 / a.ouvintes28) >= 10)
    goods.push('✓ Fã real');

  const eB = Math.min(100, Math.round(a.eng / 15 * 100));
  const rB = Math.min(100, Math.round((a.seg > 0 ? a.reels / (a.seg / 1000) : 0) / 5 * 100));
  const sB = Math.min(100, Math.round(a.spotify / 10000 * 100));
  const fB = Math.min(100, Math.round(a.freq / 7 * 100));

  const dd     = ddProgress(a);
  const hasRatio = a.streams28 && a.ouvintes28;
  const ratio    = hasRatio ? (a.streams28 / a.ouvintes28).toFixed(1) : null;
  const ratioC   = !ratio ? 'var(--gray3)' : ratio >= 10 ? 'var(--green)' : ratio >= 4 ? 'var(--amber)' : 'var(--red)';

  // Top músicas (se existirem)
  const topTracksHtml = (a.topTracks && a.topTracks.length)
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Top Músicas</div>
        ${a.topTracks.filter(t => t.streams > 0).map((t, i) => {
          const maxStr = a.topTracks[0].streams || 1;
          const pct    = Math.round(t.streams / maxStr * 100);
          const receita = 'R$' + (t.streams * 0.013).toLocaleString('pt-BR', {maximumFractionDigits: 0});
          return `
            <div style="margin-bottom:7px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                <span style="font-size:11px;color:var(--gray1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%;">${i+1}. ${t.nome}</span>
                <span style="font-size:10px;font-family:var(--mono);color:var(--gray2);">${(t.streams/1000).toFixed(0)}K · <span style="color:var(--gold)">${receita}</span></span>
              </div>
              <div style="height:3px;background:var(--surface3);border-radius:2px;">
                <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;opacity:.7;"></div>
              </div>
            </div>`;
        }).join('')}
        ${a.totalStreams ? `<div style="font-size:10px;color:var(--gray2);margin-top:4px;">Total acumulado: <b style="color:var(--white)">${(a.totalStreams/1000).toFixed(0)}K streams</b> · <b style="color:var(--gold)">R$${(a.totalStreams * 0.013).toLocaleString('pt-BR', {maximumFractionDigits: 0})}</b></div>` : ''}
      </div>`
    : '';

  const ddBar = `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
        <span style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.05em;">Due Diligence</span>
        <span style="font-size:10px;font-family:var(--mono);color:${dd.done===dd.total?'var(--green)':'var(--gray2)'}">${dd.done}/${dd.total}</span>
      </div>
      <div style="height:3px;background:var(--surface3);border-radius:2px;overflow:hidden;margin-bottom:8px;">
        <div style="height:100%;width:${dd.pct}%;background:${dd.done===dd.total?'var(--green)':'var(--gold)'};border-radius:2px;transition:width .4s;"></div>
      </div>
      ${ratio ? `<div style="font-size:11px;font-family:var(--mono);color:${ratioC};margin-bottom:6px;">Ratio: <b>${ratio}</b> streams/ouvinte</div>` : ''}
      ${a.tiktok ? `<div style="font-size:11px;color:var(--gray2);">TikTok: <b style="color:var(--white)">${fmtN(a.tiktok)}</b></div>` : ''}
    </div>`;

  return `
    <div class="acard ${t}" onclick="openDD(${a.id})" style="cursor:pointer;" title="Clique para ver detalhes">
      <div class="acard-top"></div>
      <button class="btn-del" onclick="event.stopPropagation();deleteArtist(${a.id})" title="Remover">×</button>
      <div class="acard-inner">
        <div class="acard-head">
          <div>
            <div class="acard-name">${a.nome}</div>
            <div class="acard-meta"><span class="niche-tag">${a.niche}</span></div>
          </div>
          <span class="score-pill ${pillCls}">${pillLbl} · ${a.sc}</span>
        </div>
        <div class="acard-metrics">
          <div class="ring-wrap">${buildRing(a.sc, t)}</div>
          <div class="mini-stats">
            <div class="ms"><div class="ms-label">Seg.</div>    <div class="ms-val">${fmtN(a.seg)}</div></div>
            <div class="ms"><div class="ms-label">Eng.</div>    <div class="ms-val">${a.eng}%</div></div>
            <div class="ms"><div class="ms-label">Spotify</div> <div class="ms-val">${fmtS(a.spotify)}</div></div>
            <div class="ms"><div class="ms-label">Reels%</div>  <div class="ms-val">${a.reels}%</div></div>
            <div class="ms"><div class="ms-label">Posts</div>   <div class="ms-val">${a.freq}x</div></div>
            <div class="ms"><div class="ms-label">Colab</div>   <div class="ms-val">${a.colab ? 'Sim' : 'Não'}</div></div>
          </div>
        </div>
        <div class="acard-bars">
          <div class="brow">
            <span class="blbl">Engajamento</span>
            <div class="bbg"><div class="bfill" style="width:${eB}%;background:${bc}"></div></div>
            <span class="bnum">${eB}</span>
          </div>
          <div class="brow">
            <span class="blbl">Reels reach</span>
            <div class="bbg"><div class="bfill" style="width:${rB}%;background:${bc}"></div></div>
            <span class="bnum">${rB}</span>
          </div>
          <div class="brow">
            <span class="blbl">Spotify</span>
            <div class="bbg"><div class="bfill" style="width:${sB}%;background:${bc}"></div></div>
            <span class="bnum">${sB}</span>
          </div>
          <div class="brow">
            <span class="blbl">Frequência</span>
            <div class="bbg"><div class="bfill" style="width:${fB}%;background:${bc}"></div></div>
            <span class="bnum">${fB}</span>
          </div>
        </div>
        <div class="acard-tags">
          ${warns.map(w => `<span class="tag-w">${w}</span>`).join('')}
          ${goods.map(g => `<span class="tag-g">${g}</span>`).join('')}
        </div>
        <!-- DD progress mini -->
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:10px;color:var(--gray3);">Clique para ver detalhes + calculadora</span>
          <span style="font-size:10px;font-family:var(--mono);color:${dd.done===dd.total?'var(--green)':'var(--gray2)'}">DD ${dd.done}/${dd.total}</span>
        </div>
      </div>
    </div>`;
}


/* ── TOAST ──────────────────────────────────────────────────── */

function showToast(msg, ms = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), ms);
}


/* ── EXPÕE FUNÇÕES PARA O HTML (onclick=) ────────────────────── */
// Como o script usa "type=module", as funções não ficam no escopo global
// automaticamente. Precisamos expô-las manualmente via window.

window.fetchSpotify  = fetchSpotify;
window.exportJSON    = exportJSON;
window.importJSON    = importJSON;
window.toggleForm    = toggleForm;
window.addArtist     = addArtist;
window.deleteArtist  = deleteArtist;
window.clearAll      = clearAll;
window.sf            = sf;
window.sfSpot        = sfSpot;
window.openDD        = openDD;
window.closeDD       = closeDD;
window.updateDD      = updateDD;
window.toggleDD      = toggleDD;
window.render        = render;


/* ── INIT ───────────────────────────────────────────────────── */

async function init() {
  // Mostra dados do localStorage imediatamente (sem piscar)
  render();

  // Tenta carregar do Firestore em paralelo
  const fbArtists = await dbLoad();
  if (fbArtists && fbArtists.length > 0) {
    artists = fbArtists;
    nextId  = Math.max(...artists.map(a => a.id)) + 1;
    saveLocal(); // atualiza o cache local
    render();    // re-renderiza com dados da nuvem
    showToast(`☁ ${artists.length} artistas carregados da nuvem`);
  }

  // Processa callback do Spotify se vier com ?code=
  if (location.search.includes('code=')) {
    await handleSpotifyCallback();
    render();
  }
}

init();
