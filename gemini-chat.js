/* ============================================================
   NARUA — Gemini AI Chat Widget
   gemini-chat.js · Assistente de A&R powered by Gemini
   ============================================================ */

const GEMINI_MODEL = 'gemini-2.0-flash';
const STORAGE_KEY  = 'narua_gemini_key';

function getGeminiKey() { return localStorage.getItem(STORAGE_KEY) || ''; }
function saveGeminiKey(k) { localStorage.setItem(STORAGE_KEY, k.trim()); }

const SYSTEM_PROMPT = `Você é um assistente de A&R (Artist & Repertoire) da MVMNTD INC, empresa de música independente sediada no Rio de Janeiro em 2026.

Sua especialidade: funk carioca, trap, rap e R&B brasileiro. Você analisa artistas, métricas de streaming, potencial de mercado e ajuda a equipe a tomar decisões sobre parcerias e lançamentos.

Contexto do site: NARUA Artist Finder — ferramenta interna que busca dados do Spotify (ouvintes, popularidade, gêneros, top tracks, áudio features) e métricas de redes sociais (Instagram, TikTok) para calcular um score de compatibilidade com a MVMNTD INC.

Score do sistema:
- Ideal: 65+ pontos
- Aceitável: 40–64 pontos
- Não recomendado: abaixo de 40

Pesos do score: Engajamento Instagram 35pts, Reels reach 25pts, Spotify mensal 20pts, Frequência de postagem 15pts. Penalidade de -20pts para audiência comprada, bônus de +5pts para quem já colaborou com selos.

Responda sempre em português, de forma direta e objetiva. Quando analisar um artista, seja honesto sobre pontos fortes e fracos. Não é só elogio — a equipe precisa de análise real para tomar decisões de negócio.`;

/* ── Estado da conversa ── */
let chatHistory = [];
let chatOpen    = false;
let isTyping    = false;

/* ── Contexto do artista atual (preenchido pelo site) ── */
window.geminiSetArtistContext = function(artist) {
  window._currentArtistCtx = artist;
};

/* ── Chama a API do Gemini ── */
async function callGemini(userMessage) {
  chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

  const key = getGeminiKey();
  if (!key) throw new Error('API key não configurada. Clique no ícone de chave para configurar.');

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: chatHistory,
    generationConfig: {
      temperature:     0.75,
      maxOutputTokens: 1024,
      topP:            0.9,
    },
  };

  // Tenta com API key na URL
  let res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  // Fallback: Bearer token (para keys OAuth AQ.xxx)
  if (!res.ok && res.status === 400) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro ${res.status}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta.';
  chatHistory.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

/* ── Cria o HTML do widget ── */
function createWidget() {
  // Botão flutuante
  const fab = document.createElement('button');
  fab.id = 'gem-fab';
  fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  fab.title = 'Chat com IA';
  fab.onclick = toggleChat;

  // Painel de chat
  const panel = document.createElement('div');
  panel.id = 'gem-panel';
  panel.innerHTML = `
    <div id="gem-header">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#4285f4,#9b59b6);border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff;">Assistente A&R</div>
          <div style="font-size:10px;color:rgba(255,255,255,.6);">Gemini · MVMNTD INC</div>
        </div>
      </div>
      <button id="gem-close" onclick="window.toggleGeminiChat()" title="Fechar">×</button>
    </div>
    <div id="gem-messages">
      <div class="gem-msg gem-ai">
        <div class="gem-bubble">Olá! Sou o assistente de A&R da MVMNTD INC. Posso analisar artistas, avaliar métricas e ajudar nas decisões de parceria. O que você quer saber?</div>
      </div>
    </div>
    <div id="gem-input-area">
      <div id="gem-key-setup" style="display:none;padding:10px 0 6px;">
        <div style="font-size:11px;color:#aaa;margin-bottom:6px;">Cole sua Gemini API key para começar:</div>
        <div style="display:flex;gap:6px;">
          <input id="gem-key-input" type="password" placeholder="AQ... ou AIzaSy..."
            style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;color:#fff;font-size:12px;padding:7px 10px;outline:none;font-family:'Space Grotesk',sans-serif;"
            onkeydown="if(event.key==='Enter')window.gemSaveKey()"/>
          <button onclick="window.gemSaveKey()"
            style="background:linear-gradient(135deg,#4285f4,#9b59b6);color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
            Salvar
          </button>
        </div>
        <div style="font-size:10px;color:#555;margin-top:5px;">Salvo localmente no seu browser. Não vai para o GitHub.</div>
      </div>
      <div id="gem-suggestions">
        <button class="gem-sug" onclick="gemSuggest(this)">Analisar artista atual</button>
        <button class="gem-sug" onclick="gemSuggest(this)">Gerar script de contato</button>
        <button class="gem-sug" onclick="gemSuggest(this)">Dicas para aumentar o score</button>
      </div>
      <div id="gem-input-row">
        <textarea id="gem-input" placeholder="Pergunte sobre artistas, métricas, estratégias..." rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();gemSend()}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
        <button id="gem-send" onclick="gemSend()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);
  injectStyles();
}

/* ── CSS do widget ── */
function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #gem-fab {
      position: fixed;
      bottom: 24px;
      left: 24px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4285f4, #9b59b6);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(66,133,244,.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 400;
      transition: transform .2s, box-shadow .2s;
    }
    #gem-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(66,133,244,.55);
    }
    #gem-fab.open {
      background: #444;
      box-shadow: 0 4px 16px rgba(0,0,0,.3);
    }

    #gem-panel {
      position: fixed;
      bottom: 90px;
      left: 24px;
      width: 360px;
      max-height: 560px;
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      display: none;
      flex-direction: column;
      z-index: 400;
      box-shadow: 0 20px 60px rgba(0,0,0,.7);
      overflow: hidden;
      animation: gemSlideIn .25s cubic-bezier(.34,1.56,.64,1) both;
    }
    #gem-panel.open { display: flex; }

    @keyframes gemSlideIn {
      from { opacity: 0; transform: translateY(20px) scale(.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (max-width: 500px) {
      #gem-panel {
        left: 8px; right: 8px; width: auto;
        bottom: 84px; max-height: 70vh;
      }
    }

    #gem-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }

    #gem-close {
      background: none;
      border: none;
      color: rgba(255,255,255,.5);
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
      transition: color .15s, background .15s;
    }
    #gem-close:hover { color: #fff; background: rgba(255,255,255,.1); }

    #gem-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scrollbar-width: thin;
      scrollbar-color: #333 #111;
    }
    #gem-messages::-webkit-scrollbar { width: 4px; }
    #gem-messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

    .gem-msg { display: flex; }
    .gem-msg.gem-user { justify-content: flex-end; }
    .gem-msg.gem-ai   { justify-content: flex-start; }

    .gem-bubble {
      max-width: 80%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .gem-user .gem-bubble {
      background: linear-gradient(135deg, #4285f4, #2c67d5);
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .gem-ai .gem-bubble {
      background: #1e1e1e;
      color: #e0e0e0;
      border: 1px solid #2a2a2a;
      border-bottom-left-radius: 4px;
    }

    /* Typing indicator */
    .gem-typing {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 10px 14px;
    }
    .gem-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #4285f4;
      animation: gemDot 1.2s infinite;
    }
    .gem-dot:nth-child(2) { animation-delay: .2s; }
    .gem-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes gemDot {
      0%, 80%, 100% { transform: scale(.6); opacity: .4; }
      40%            { transform: scale(1);  opacity: 1; }
    }

    #gem-input-area {
      border-top: 1px solid #1e1e1e;
      padding: 10px 12px;
      flex-shrink: 0;
    }

    #gem-suggestions {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .gem-sug {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 20px;
      color: #aaa;
      font-size: 10px;
      font-weight: 600;
      padding: 3px 10px;
      cursor: pointer;
      transition: background .15s, color .15s, border-color .15s;
      font-family: 'Space Grotesk', sans-serif;
    }
    .gem-sug:hover { background: #252525; border-color: #4285f4; color: #fff; }

    #gem-input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    #gem-input {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      color: #fff;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px;
      padding: 8px 12px;
      resize: none;
      outline: none;
      line-height: 1.4;
      transition: border-color .15s;
      max-height: 120px;
    }
    #gem-input::placeholder { color: #444; }
    #gem-input:focus { border-color: #4285f4; }

    #gem-send {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #4285f4, #9b59b6);
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity .15s, transform .1s;
    }
    #gem-send:hover   { opacity: .85; }
    #gem-send:active  { transform: scale(.95); }
    #gem-send:disabled { opacity: .4; cursor: not-allowed; }
  `;
  document.head.appendChild(s);
}

/* ── Salva key ── */
window.gemSaveKey = function() {
  const k = document.getElementById('gem-key-input').value.trim();
  if (!k) return;
  saveGeminiKey(k);
  document.getElementById('gem-key-setup').style.display = 'none';
  document.getElementById('gem-input-row').style.display = 'flex';
  document.getElementById('gem-suggestions').style.display = 'flex';
  document.getElementById('gem-input').focus();
  addMessage('API key salva! Pode perguntar o que quiser.', 'ai');
};

/* ── Toggle chat ── */
function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('gem-panel');
  const fab   = document.getElementById('gem-fab');
  if (chatOpen) {
    panel.classList.add('open');
    fab.classList.add('open');
    fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    // Mostra setup se não tem key
    if (!getGeminiKey()) {
      document.getElementById('gem-key-setup').style.display = 'block';
      document.getElementById('gem-input-row').style.display = 'none';
      document.getElementById('gem-key-input')?.focus();
    } else {
      document.getElementById('gem-input')?.focus();
    }
  } else {
    panel.classList.remove('open');
    fab.classList.remove('open');
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  }
}

window.toggleGeminiChat = toggleChat;

/* ── Adiciona mensagem na tela ── */
function addMessage(text, role) {
  const msgs = document.getElementById('gem-messages');
  const div  = document.createElement('div');
  div.className = `gem-msg gem-${role}`;
  div.innerHTML = `<div class="gem-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

/* ── Typing indicator ── */
function showTyping() {
  const msgs = document.getElementById('gem-messages');
  const div  = document.createElement('div');
  div.id = 'gem-typing-indicator';
  div.className = 'gem-msg gem-ai';
  div.innerHTML = `<div class="gem-bubble gem-typing"><div class="gem-dot"></div><div class="gem-dot"></div><div class="gem-dot"></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  document.getElementById('gem-typing-indicator')?.remove();
}

/* ── Envia mensagem ── */
window.gemSend = async function() {
  if (isTyping) return;
  const input = document.getElementById('gem-input');
  const text  = input.value.trim();
  if (!text) return;

  // Esconde sugestões após primeira mensagem
  document.getElementById('gem-suggestions').style.display = 'none';

  input.value = '';
  input.style.height = 'auto';
  addMessage(text, 'user');

  // Contexto do artista se disponível
  let fullMessage = text;
  if (window._currentArtistCtx) {
    const a = window._currentArtistCtx;
    fullMessage = `[Contexto: artista "${a.nome || a.name}" — ${a.seg || 0} seguidores IG, ${a.spotify || 0} ouvintes Spotify/mês, engajamento ${a.eng || 0}%, score ${a.sc || a.popularity || '—'}]\n\n${text}`;
  }

  isTyping = true;
  document.getElementById('gem-send').disabled = true;
  showTyping();

  try {
    const reply = await callGemini(fullMessage);
    hideTyping();
    addMessage(reply, 'ai');
  } catch(e) {
    hideTyping();
    addMessage(`Erro ao conectar com o Gemini: ${e.message}`, 'ai');
  } finally {
    isTyping = false;
    document.getElementById('gem-send').disabled = false;
    input.focus();
  }
};

/* ── Sugestões rápidas ── */
window.gemSuggest = function(btn) {
  const ctx = window._currentArtistCtx;
  const name = ctx?.nome || ctx?.name || 'o artista atual';
  const map = {
    'Analisar artista atual': ctx
      ? `Analise o perfil de ${name}: ${ctx.seg || 0} seguidores no Instagram, engajamento de ${ctx.eng || 0}%, ${ctx.spotify || 0} ouvintes mensais no Spotify, score ${ctx.sc || '—'}. Vale a pena para a MVMNTD INC?`
      : 'Como devo avaliar um artista para parceria com a MVMNTD INC?',
    'Gerar script de contato': ctx
      ? `Crie um script de DM profissional para abordar ${name} propondo parceria com a MVMNTD INC. Tom: direto, respeitoso, mostra que fizemos nossa lição de casa.`
      : 'Crie um script de DM para abordar artistas propondo parceria com a MVMNTD INC.',
    'Dicas para aumentar o score': 'Quais métricas têm mais impacto no score do NARUA e como um artista pode melhorá-las?',
  };
  const msg = map[btn.textContent] || btn.textContent;
  document.getElementById('gem-input').value = msg;
  document.getElementById('gem-input').focus();
};

/* ── Escape HTML ── */
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

/* ── Inicializa ── */
createWidget();
