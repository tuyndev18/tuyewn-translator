// Tuyewn Reader — service worker
// - Context menu / keyboard command → inject reader into the tab (activeTab, no <all_urls>)
// - Dictionary lookups (IPA US/UK, POS, short definition) from Wiktionary, cached in storage.local

const MENU_ID = 'tuyewn-read';
const WIKI_API = 'https://en.wiktionary.org/w/api.php';
const CACHE_PREFIX = 'w2:'; // w2: IPA keeps syllable dots
const BATCH = 20;

const MENU_PAGE = 'tuyewn-page';
const MENU_PICK = 'tuyewn-pick';
const MENU_LOOKUP = 'tuyewn-lookup';

// Keyboard shortcuts as set in chrome://extensions/shortcuts ('' when unassigned)
async function shortcuts() {
  const all = await chrome.commands.getAll();
  return Object.fromEntries(all.map((c) => [c.name, c.shortcut || '']));
}

// The menu items show their shortcut, as read when the menus are (re)built
async function createMenus() {
  const keys = await shortcuts().catch(() => ({}));
  const withKey = (title, cmd) => (keys[cmd] ? `${title}   (${keys[cmd]})` : title);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_LOOKUP, title: withKey('Tuyewn Reader: tra từ', 'lookup'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: MENU_ID, title: withKey('Tuyewn Reader: đọc', 'read'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: MENU_PAGE, title: 'Tuyewn Reader: đọc cả trang', contexts: ['page'] });
  chrome.contextMenus.create({ id: MENU_PICK, title: 'Tuyewn Reader: chọn điểm bắt đầu → kết thúc', contexts: ['page', 'selection'] });
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const frameId = info.frameId ?? 0;
  if (info.menuItemId === MENU_LOOKUP) openReader(tab, frameId, info.selectionText || '', 'lookup');
  else if (info.menuItemId === MENU_ID) openReader(tab, frameId, info.selectionText || '');
  else if (info.menuItemId === MENU_PAGE) openReader(tab, frameId, '', 'page');
  else if (info.menuItemId === MENU_PICK) openReader(tab, frameId, '', 'pick');
});

// Toolbar icon and Alt+R: the selection if there is one, otherwise the whole page
chrome.action.onClicked.addListener((tab) => openReader(tab, 0, '', 'auto'));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'read' && tab) openReader(tab, 0, '', 'auto');
  else if (command === 'lookup' && tab) openReader(tab, 0, '', 'lookup');
});

async function openReader(tab, frameId, selectionText, mode = 'selection') {
  const target = { tabId: tab.id, frameIds: [frameId] };
  try {
    const [probe] = await chrome.scripting.executeScript({
      target,
      func: () => {
        try { return !!window.__tuyewnReader?.alive?.(); } catch { return false; }
      },
    });
    if (!probe?.result) {
      await chrome.scripting.insertCSS({ target, files: ['highlight.css'] });
      await chrome.scripting.executeScript({ target, files: ['lib/compromise.js', 'content.js'] });
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'TR_OPEN', text: selectionText, mode }, { frameId });
    if (res?.ok) return;
  } catch (err) {
    // chrome:// pages, Web Store, PDF viewer, cross-origin iframes without access…
    console.warn('[Tuyewn Reader] cannot inject, falling back to window:', err?.message || err);
  }
  if (selectionText) openStandalone(selectionText);
}

async function openStandalone(text) {
  await chrome.storage.session.set({ pendingText: text });
  chrome.windows.create({ url: chrome.runtime.getURL('reader.html'), type: 'popup', width: 480, height: 700 });
}

// ---------------------------------------------------------------------------
// Messages from the reader
// ---------------------------------------------------------------------------

const HANDLERS = {
  TR_LOOKUP: async (msg) => ({ entries: await lookup(Array.isArray(msg.words) ? msg.words : []) }),
  TR_TRANSLATE: async (msg) => translateLines(Array.isArray(msg.lines) ? msg.lines : []), // { vi, provider }
  TR_WORDS_VI: async (msg) => ({ vi: await translateWords(Array.isArray(msg.words) ? msg.words : []) }),
  TR_WORD_DICT: async (msg) => ({ dict: await wordDict(String(msg.word || '')) }),
  TR_OPEN_DICT: async (msg) => openDict(String(msg.site || ''), String(msg.word || ''), String(msg.accent || 'US')),
  TR_SUMMARIZE: async (msg) => ({ summary: await summarize(String(msg.text || '')) }),
  TR_GEMINI_GET: async () => geminiPublic(),
  TR_GEMINI_SET: async (msg) => geminiSet(msg),
  TR_GEMINI_MODELS: async () => ({ models: await freeModels(true) }),
  TR_CLEAR_CACHE: async () => clearCache(),
  TR_SHORTCUTS: async () => ({ keys: await shortcuts() }),
  TR_EDGE_TTS: async (msg) => edgeTtsRelay(String(msg.text || ''), String(msg.voice || ''), Number(msg.rate) || 1),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return;
  handler(msg).then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true; // async response
});

// ---------------------------------------------------------------------------
// Vietnamese translation. Providers, in order:
//   1. Google Translate "gtx" endpoint (free, no key, unofficial) — paused 30 min once it rate-limits us
//   2. Gemini, when the user has saved a key (batch, good quality)
//   3. MyMemory (free, no key, ~5,000 chars/day) — only for what the user is looking at, never bulk word lists
// ---------------------------------------------------------------------------

const GT_API = 'https://translate.googleapis.com/translate_a/single';
const GT_MAX_CHARS = 4000;
const GTX_PAUSE_MS = 30 * 60 * 1000;
let gtxBlockedUntil = 0;

async function gtx(q, extra = '') {
  if (Date.now() < gtxBlockedUntil) throw new Error('GTX_BLOCKED');
  const res = await fetch(`${GT_API}?client=gtx&sl=en&tl=vi&dj=1&dt=t${extra}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q }),
    redirect: 'manual',
  });
  // a rate-limited client is redirected to Google's captcha page (google.com/sorry)
  if (res.type === 'opaqueredirect' || res.status === 429 || (res.status >= 300 && res.status < 400)) {
    gtxBlockedUntil = Date.now() + GTX_PAUSE_MS;
    // info, not warn: this is expected and handled (fallback providers), not an extension error
    console.info('[Tuyewn Reader] Google Translate rate-limited — using fallback providers for 30 min');
    throw new Error('GTX_BLOCKED');
  }
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  return res.json();
}

const joinTrans = (r) => (r.sentences || []).map((s) => s.trans || '').join('');
const normLines = (lines) => lines.slice(0, 1000).map((l) => String(l).replace(/\s+/g, ' ').trim());

// Sentences: one line in → one line out, with provider fallback
async function translateLines(lines) {
  lines = normLines(lines);
  try {
    return { vi: await translateLinesGoogle(lines), provider: 'Google Translate' };
  } catch (err) {
    if (err.message !== 'GTX_BLOCKED') console.info('[Tuyewn Reader] Google Translate unavailable:', err.message);
  }
  if ((await geminiConfig()).key) {
    try {
      return { vi: await translateLinesGemini(lines), provider: 'Gemini' };
    } catch (err) {
      console.info('[Tuyewn Reader] Gemini translation failed:', err.message);
    }
  }
  return { vi: await translateLinesMyMemory(lines), provider: 'MyMemory' };
}

// Lines are sent newline-joined, a few thousand chars per request.
async function translateLinesGoogle(lines) {
  const out = new Array(lines.length).fill('');
  for (let i = 0; i < lines.length; ) {
    let j = i;
    let len = 0;
    while (j < lines.length && (j === i || len + lines[j].length + 1 <= GT_MAX_CHARS)) len += lines[j++].length + 1;
    const part = lines.slice(i, j);
    const vi = joinTrans(await gtx(part.join('\n'))).split('\n');
    if (vi.length === part.length) {
      part.forEach((_, k) => (out[i + k] = vi[k].trim()));
    } else {
      // line alignment lost → translate one by one
      for (let k = 0; k < part.length; k++) out[i + k] = part[k] ? joinTrans(await gtx(part[k])).trim() : '';
    }
    i = j;
  }
  return out;
}

// Gemini: JSON array in the same order, ~150 lines per request
async function translateLinesGemini(lines) {
  const model = await effectiveModel();
  const out = [];
  for (let i = 0; i < lines.length; i += 150) {
    const part = lines.slice(i, i + 150);
    const prompt = [
      'Translate each numbered English line into natural Vietnamese for a learner.',
      'Keep names, product names and technical terms as they are. For a single word, give its most common short meaning.',
      `Return a JSON array of exactly ${part.length} strings, one per line, in the same order (no numbering).`,
      '',
      ...part.map((l, k) => `${k + 1}. ${l}`),
    ].join('\n');
    const vi = await geminiGenerate(model, prompt, { type: 'ARRAY', items: { type: 'STRING' } }, 0.2);
    if (!Array.isArray(vi) || vi.length !== part.length) throw new Error('Gemini: số dòng không khớp');
    out.push(...vi.map((s) => String(s).trim()));
  }
  return out;
}

// MyMemory: one request per ≤450-char piece; stops (keeping what it has) when the daily quota runs out
const MM_API = 'https://api.mymemory.translated.net/get';
const mmDecode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function mmPieces(line) {
  if (line.length <= 450) return [line];
  const pieces = [];
  let cur = '';
  for (const part of line.split(/(?<=[,;:.!?])\s+/)) {
    if (cur && cur.length + part.length + 1 > 450) {
      pieces.push(cur);
      cur = '';
    }
    cur = cur ? `${cur} ${part}` : part.slice(0, 450);
  }
  if (cur) pieces.push(cur);
  return pieces;
}

async function mmTranslate(q) {
  const res = await fetch(`${MM_API}?${new URLSearchParams({ q, langpair: 'en|vi' })}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.quotaFinished || (j.responseStatus && Number(j.responseStatus) !== 200)) {
    throw new Error(`MyMemory: ${j.responseDetails || (j.quotaFinished ? 'hết hạn mức hôm nay' : `HTTP ${res.status}`)}`);
  }
  return mmDecode(j.responseData?.translatedText || '');
}

// 4 requests in flight; stops (keeping what it has) when the quota runs out
async function translateLinesMyMemory(lines) {
  const out = new Array(lines.length).fill('');
  let next = 0;
  let failed = null;
  let done = 0;
  const worker = async () => {
    while (!failed && next < lines.length) {
      const i = next++;
      if (!lines[i]) continue;
      try {
        const parts = [];
        for (const piece of mmPieces(lines[i])) parts.push(await mmTranslate(piece));
        out[i] = parts.join(' ');
        done++;
      } catch (err) {
        failed = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, lines.length) }, worker));
  if (failed && !done) throw failed;
  return out;
}

async function translateWords(words) {
  words = [...new Set(words.filter((w) => typeof w === 'string' && w && w.length < 60))].slice(0, 1000);
  const out = {};
  const stored = await chrome.storage.local.get(words.map((w) => `vw1:${w}`));
  const missing = [];
  for (const w of words) {
    const v = stored[`vw1:${w}`];
    if (v !== undefined) out[w] = v;
    else missing.push(w);
  }
  if (!missing.length) return out;

  let vi = null;
  try {
    vi = await translateLinesGoogle(missing);
  } catch {
    if ((await geminiConfig()).key) vi = await translateLinesGemini(missing).catch(() => null);
    // MyMemory's small daily quota is kept for sentences and the word being looked at
    if (!vi && missing.length <= 5) vi = await translateLinesMyMemory(missing).catch(() => null);
  }
  if (!vi) return out; // no provider right now — the word sheet falls back per word
  const toStore = {};
  missing.forEach((w, k) => {
    if (!vi[k]) return;
    out[w] = vi[k];
    toStore[`vw1:${w}`] = vi[k];
  });
  await chrome.storage.local.set(toStore);
  return out;
}

async function wordDict(word) {
  if (!word || word.length > 60) return null;
  const key = `vd1:${word}`;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored !== undefined) return stored;
  try {
    const r = await gtx(word, '&dt=bd');
    const dict = {
      trans: joinTrans(r).trim(),
      pos: (r.dict || []).map((d) => ({ pos: d.pos, terms: (d.terms || []).slice(0, 6) })),
    };
    await chrome.storage.local.set({ [key]: dict });
    return dict;
  } catch {
    // Google unavailable: short meaning only, not cached (Google's entry with meanings by POS is richer)
    const { vi } = await translateLines([word]);
    const trans = (vi[0] || '').trim();
    // fallback services sometimes echo the English word back — that is not a translation
    return trans && trans.toLowerCase() !== word.toLowerCase() ? { trans, pos: [] } : null;
  }
}

// ---------------------------------------------------------------------------
// Full dictionary entries: opened in a popup window for the user to read
// (no scraping — the user's browser simply shows the dictionary's own page)
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;
const DICT_URLS = {
  // dictionaries
  oxford: (w) => `https://www.oxfordlearnersdictionaries.com/search/english/direct/?q=${enc(w)}`,
  cambridge: (w) => `https://dictionary.cambridge.org/search/direct/?datasetsearch=english-vietnamese&q=${enc(w)}`,
  // how to pronounce a word
  youglish: (w, acc) => `https://youglish.com/pronounce/${enc(w)}/english/${acc === 'UK' ? 'uk' : 'us'}`, // real speakers on YouTube
  google: (w) => `https://www.google.com/search?q=${enc(`how to pronounce ${w}`)}`, // slow-motion + mouth animation
  forvo: (w) => `https://forvo.com/word/${enc(w.toLowerCase())}/#en`, // native-speaker recordings
  cambridgeSay: (w) => `https://dictionary.cambridge.org/pronunciation/english/${enc(w.toLowerCase())}`, // UK + US audio
  longman: (w) => `https://www.ldoceonline.com/dictionary/${enc(w.toLowerCase().replace(/\s+/g, '-'))}`, // BrE/AmE + example audio
  // how to make one sound (IPA symbol)
  sound: (sym, acc) => `https://www.youtube.com/results?search_query=${enc(`how to pronounce /${sym}/ sound ${acc === 'UK' ? 'British' : 'American'} English`)}`,
  chart: () => 'https://www.englishclub.com/pronunciation/phonemic-chart-ia.php', // interactive phonemic chart with audio
};

// Reuse one popup window (its id survives service-worker restarts via storage.session)
async function openDict(site, word, accent) {
  const make = DICT_URLS[site];
  if (!make || (site !== 'chart' && !word) || word.length > 60) throw new Error('bad dictionary request');
  const url = make(word, accent);
  const { dictWin } = await chrome.storage.session.get('dictWin');
  if (dictWin != null) {
    try {
      const [tab] = await chrome.tabs.query({ windowId: dictWin });
      if (tab) {
        await chrome.tabs.update(tab.id, { url });
        await chrome.windows.update(dictWin, { focused: true });
        return { ok: true };
      }
    } catch {
      // window was closed — open a new one
    }
  }
  const win = await chrome.windows.create({ url, type: 'popup', width: 560, height: 760 });
  await chrome.storage.session.set({ dictWin: win.id });
  return { ok: true };
}

// Offscreen document: runs the Edge neural TTS WebSocket (extension-page context)
let offscreenReady = null;
async function ensureOffscreen() {
  const has = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (has) return;
  offscreenReady ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Synthesize natural-sounding speech for the reader',
    })
    .catch((err) => {
      if (!/single offscreen/i.test(err?.message || '')) throw err; // already open is fine
    })
    .finally(() => (offscreenReady = null));
  await offscreenReady;
}

// Natural voices: Microsoft Edge "Read aloud" neural TTS (free, unofficial) — see edge-tts.js
async function edgeTtsRelay(text, voice, rate) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ type: 'OFF_TTS', text, voice, rate });
  if (!r || r.error) throw new Error(r?.error || 'Edge TTS: no response');
  return r;
}

// ---------------------------------------------------------------------------
// Gemini summary (user's own free API key from Google AI Studio, kept in storage.local)
// ---------------------------------------------------------------------------

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
// Text models with a free tier (ai.google.dev/gemini-api/docs/pricing, checked 2026-10).
// Newer gemini-X.Y-flash / -flash-lite models found in the API list are treated as free too.
const GEMINI_FREE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];
const GEMINI_FREE_PATTERN = /^gemini-\d+(\.\d+)?-flash(-lite)?(-preview)?$/;
const MODELS_TTL_MS = 24 * 60 * 60 * 1000;
const summaryCache = new Map();

// Newest first; at the same version: stable > preview, flash > flash-lite > pro (speed + free quota)
function modelRank(id) {
  const m = id.match(/^gemini-(\d+)(?:\.(\d+))?-(flash-lite|flash|pro)(-preview)?/);
  if (!m) return -1;
  const version = Number(m[1]) * 100 + Number(m[2] || 0);
  const tier = { flash: 3, 'flash-lite': 2, pro: 1 }[m[3]];
  return version * 100 + (m[4] ? 0 : 10) + tier;
}
const byNewest = (a, b) => modelRank(b) - modelRank(a);

async function geminiConfig() {
  const { gemini } = await chrome.storage.local.get('gemini');
  // model '' = automatic (newest free model)
  return { key: gemini?.key || '', model: gemini?.model || '' };
}

// Free models this key can use, newest first (cached for a day; falls back to the known list)
async function freeModels(force = false) {
  const { geminiModels: cache } = await chrome.storage.local.get('geminiModels');
  if (!force && cache && Date.now() - cache.t < MODELS_TTL_MS) return cache.models;
  let models = [...GEMINI_FREE_MODELS];
  try {
    const available = await listGeminiModels();
    models = available.filter((id) => GEMINI_FREE_MODELS.includes(id) || GEMINI_FREE_PATTERN.test(id));
    if (!models.length) models = [...GEMINI_FREE_MODELS];
    await chrome.storage.local.set({ geminiModels: { models: models.sort(byNewest), t: Date.now() } });
  } catch (err) {
    if (force) throw err;
  }
  return models.sort(byNewest);
}

async function effectiveModel() {
  const { model } = await geminiConfig();
  if (model) return model;
  const models = await freeModels();
  return models.find((id) => /-flash$/.test(id)) || models[0] || GEMINI_FREE_MODELS[0];
}

// Never hand the key itself back to the page-side script
async function geminiPublic() {
  const { key, model } = await geminiConfig();
  const { geminiModels: cache } = await chrome.storage.local.get('geminiModels');
  return {
    hasKey: !!key,
    keyHint: key ? `…${key.slice(-4)}` : '',
    model, // '' = automatic
    effective: key ? await effectiveModel() : GEMINI_FREE_MODELS[0],
    models: (cache?.models || GEMINI_FREE_MODELS).slice().sort(byNewest),
  };
}

async function geminiSet(msg) {
  const cur = await geminiConfig();
  const next = {
    key: typeof msg.key === 'string' ? msg.key.trim() : cur.key,
    model: typeof msg.model === 'string' ? msg.model.trim() : cur.model,
  };
  await chrome.storage.local.set({ gemini: next });
  if (next.key !== cur.key) await chrome.storage.local.remove('geminiModels'); // new key → refresh list
  summaryCache.clear();
  return geminiPublic();
}

async function geminiFetch(path, init = {}) {
  const { key } = await geminiConfig();
  if (!key) throw new Error('NO_KEY');
  const res = await fetch(`${GEMINI_API}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function listGeminiModels() {
  const j = await geminiFetch('models?pageSize=200');
  return (j.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name))
    .map((m) => m.name.replace(/^models\//, ''));
}

// Structured JSON generation. Light thinking for Flash models (faster, less quota);
// a model that rejects the thinking setting is retried without it.
async function geminiGenerate(model, prompt, schema, temperature = 0.3) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
  };
  if (/^gemini-([3-9]|\d\d)/.test(model) && /flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  else if (/2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const call = () => geminiFetch(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
  let j;
  try {
    j = await call();
  } catch (err) {
    if (err.status !== 400 || !body.generationConfig.thinkingConfig) throw err;
    delete body.generationConfig.thinkingConfig;
    j = await call();
  }
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!raw) throw new Error(`Gemini không trả kết quả (${j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'unknown'})`);
  return JSON.parse(raw);
}

async function summarize(text) {
  text = text.replace(/\s+\n/g, '\n').trim().slice(0, 30000);
  if (!text) throw new Error('Không có nội dung để tóm tắt');
  const model = await effectiveModel();
  const cacheKey = `${model}\n${text}`;
  if (summaryCache.has(cacheKey)) return summaryCache.get(cacheKey);

  const part = {
    type: 'OBJECT',
    properties: { summary: { type: 'STRING' }, points: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['summary', 'points'],
  };
  const prompt = [
    'Summarize the following English passage for a Vietnamese learner of English.',
    'Return JSON with:',
    '- en.summary: a 2-4 sentence summary in clear, simple English (about B1 level).',
    '- en.points: 3-5 key points in English, one short sentence each.',
    '- vi.summary: the same summary written naturally in Vietnamese.',
    '- vi.points: the same key points in Vietnamese.',
    'Keep names, product names and technical terms as they are. Use only information from the passage.',
    '',
    'Passage:',
    '"""',
    text,
    '"""',
  ].join('\n');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { en: part, vi: part }, required: ['en', 'vi'] },
    },
  };
  // 2.5 Flash models think by default; a summary doesn't need it (faster, less quota)
  // Flash models think by default; a summary doesn't need much (faster, less quota).
  // Gemini 3+ uses thinkingLevel, 2.5 uses thinkingBudget; unsupported settings are retried without.
  if (/^gemini-([3-9]|\d\d)/.test(model) && /flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  else if (/2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const call = (b) => geminiFetch(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body: JSON.stringify(b) });
  let j;
  try {
    j = await call(body);
  } catch (err) {
    if (err.status !== 400 || !body.generationConfig.thinkingConfig) throw err;
    delete body.generationConfig.thinkingConfig; // model doesn't accept that setting
    j = await call(body);
  }
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!raw) throw new Error(`Gemini không trả kết quả (${j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'unknown'})`);
  const summary = JSON.parse(raw);
  summaryCache.set(cacheKey, summary);
  return summary;
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => /^(w1|w2|vw1|vd1|ox1):/.test(k));
  await chrome.storage.local.remove(keys);
  mem.clear();
  return { removed: keys.length };
}

// ---------------------------------------------------------------------------
// Dictionary lookup (Wiktionary)
// ---------------------------------------------------------------------------

const mem = new Map();

async function lookup(words) {
  words = [...new Set(words.filter((w) => typeof w === 'string' && /^\p{L}[\p{L}'.\-]{0,58}$/u.test(w)))].slice(0, 200);
  const out = {};
  const notMem = [];
  for (const w of words) {
    if (mem.has(w)) out[w] = mem.get(w);
    else notMem.push(w);
  }
  const missing = [];
  if (notMem.length) {
    const stored = await chrome.storage.local.get(notMem.map((w) => CACHE_PREFIX + w));
    for (const w of notMem) {
      const v = stored[CACHE_PREFIX + w];
      if (v !== undefined) {
        out[w] = v.e;
        mem.set(w, v.e);
      } else missing.push(w);
    }
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const got = await fetchBatch(batch);
    const toStore = {};
    for (const w of batch) {
      if (!(w in got)) continue;
      out[w] = got[w];
      mem.set(w, got[w]);
      toStore[CACHE_PREFIX + w] = { e: got[w], t: Date.now() };
    }
    await chrome.storage.local.set(toStore);
  }
  return out;
}

async function fetchBatch(words) {
  const result = {};
  let pending = words.slice();
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      origin: '*',
      titles: pending.join('|'),
    });
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'Api-User-Agent': 'TuyewnReader/1.0 (browser extension)' },
    });
    if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
    const q = (await res.json()).query || {};

    const resolve = (w) => {
      let t = w;
      for (const n of q.normalized || []) if (n.from === t) t = n.to;
      for (const r of q.redirects || []) if (r.from === t) t = r.to;
      return t;
    };
    const byTitle = new Map();
    for (const w of pending) {
      const t = resolve(w);
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(w);
    }

    const retry = [];
    for (const page of q.pages || []) {
      const ws = byTitle.get(page.title) || [];
      if (page.missing || page.invalid) {
        for (const w of ws) result[w] = null;
        continue;
      }
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (content == null) {
        retry.push(...ws); // response truncated — ask again
        continue;
      }
      const entry = parseEntry(content);
      for (const w of ws) result[w] = entry;
    }
    pending = retry;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Wikitext parsing
// ---------------------------------------------------------------------------

const POS_KEYS = {
  Noun: 'noun', 'Proper noun': 'noun', Verb: 'verb', Adjective: 'adj', Adverb: 'adv',
  Pronoun: 'pron', Preposition: 'prep', Conjunction: 'conj', Determiner: 'det', Article: 'det',
  Numeral: 'num', Number: 'num', Interjection: 'intj', Particle: 'other', Contraction: 'other',
  Phrase: 'other', 'Prepositional phrase': 'other', Prefix: 'other', Suffix: 'other',
};

const UK_RE = /^(RP|UK|SSB|British|BrE|Received Pronunciation|England|Southern England|Standard Southern British)$/i;
const US_RE = /^(GA|GenAm|US|USA|General American|AmE|American)$/i;
const OTHER_RE = /\b(Australia|AU|NZ|New Zealand|Canada|CA|Ireland|Irish|Scotland|Scottish|Wales|Welsh|India|Indic|South Africa|Philippines|Singapore|Northern England|Midlands|Northumbria|Geordie|Cockney|Estuary|Southern US|Boston|New York|Jamaica|Caribbean|Nigeria|Hong Kong|Malaysia|Kenya|Yorkshire|Lancashire|West Country)\b/i;

const FORM_OF_RE = /\{\{(?:inflection of|infl of|plural of|past participle of|present participle of|past tense of|simple past of|en-past of|en-simple past of|en-third-person singular of|en-third person singular of|third-person singular of|en-ing form of|alternative form of|alt form|comparative of|superlative of|en-comparative of|en-superlative of|en-archaic second-person singular of)\|(?:en\|)?([^|}]+)/;

function englishSection(text) {
  const m = text.match(/^==\s*English\s*==\s*$/m);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^==[^=].*==\s*$/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (s[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  parts.push(cur);
  return parts;
}

function classifyAccent(raw) {
  const tokens = raw
    .replace(/\{\{w\|([^}|]+)[^}]*\}\}/g, '$1')
    .replace(/<<|>>|\[\[|\]\]/g, '')
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uk = tokens.some((t) => UK_RE.test(t));
  const us = tokens.some((t) => US_RE.test(t));
  if (uk || us) return { uk, us };
  if (tokens.some((t) => OTHER_RE.test(t))) return { other: true };
  return null; // not an accent label (e.g. "weak form") → inherit from parent bullet
}

function cleanIpa(raw) {
  const m = raw.match(/\/[^/]+\//) || raw.match(/\[[^\]]+\]/);
  if (!m) return '';
  // keep syllable dots (ˈskɛd.ʒuːl) — the panel shows them as syllable breaks
  return m[0].replace(/ɹ/g, 'r').replace(/͡|͜/g, '').trim();
}

function parsePronunciation(sec) {
  let us = '';
  let uk = '';
  let generic = '';
  const ctx = [];
  // First match wins, but a phonemic /…/ transcription replaces an earlier phonetic […] one.
  const better = (old, ipa) => !old || (old.startsWith('[') && ipa.startsWith('/'));
  const take = (cls, ipa) => {
    if (!ipa || !cls) return;
    if (cls.uk && better(uk, ipa)) uk = ipa;
    if (cls.us && better(us, ipa)) us = ipa;
    if (cls.generic && better(generic, ipa)) generic = ipa;
  };

  for (const line of sec.split('\n')) {
    const bullets = line.match(/^(\*+)/);
    if (!bullets) {
      if (line.startsWith('=')) ctx.length = 0;
      continue;
    }
    const depth = bullets[1].length;
    ctx.length = depth;
    let inherited = null;
    for (let d = depth - 1; d >= 1; d--) if (ctx[d]) { inherited = ctx[d]; break; }

    const accentTpl = line.match(/\{\{(?:a|accent)\|en\|([^}]*)\}\}/);
    const lineCls = accentTpl ? classifyAccent(accentTpl[1]) : null;
    let firstCls = null;

    for (const m of line.matchAll(/\{\{IPA\|en\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g)) {
      const params = splitTop(m[1]);
      const named = Object.fromEntries(
        params.filter((p) => /^\w+=/.test(p)).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])
      );
      const positional = params.filter((p) => !/^\w+=/.test(p));
      const cls = (named.a && classifyAccent(named.a)) || lineCls || inherited || { generic: true };
      firstCls ??= cls;
      const ipaRaw = positional.find((p) => p.trim().startsWith('/')) || positional.find((p) => p.trim().startsWith('['));
      take(cls, ipaRaw ? cleanIpa(ipaRaw) : '');
    }

    // {{audio|en|file.ogg|a=US|IPA=/…/}} as a last resort
    for (const m of line.matchAll(/\{\{audio\|en\|([^{}]*)\}\}/g)) {
      const params = splitTop(m[1]);
      const a = params.find((p) => p.startsWith('a='));
      const ipa = params.find((p) => p.startsWith('IPA='));
      if (a && ipa) take(classifyAccent(a.slice(2)), cleanIpa(ipa.slice(4)));
    }

    ctx[depth] = lineCls || firstCls || null;
  }
  return { us: us || generic, uk: uk || generic };
}

function cleanWiki(s) {
  s = s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{(?:en-)?([a-z -]*? of)\|(?:en\|)?([^|{}]+)[^{}]*\}\}/g, (_, name, w) =>
      `${name === 'infl of' ? 'inflection of' : name} ${w}`)
    .replace(/\{\{(?:lb|lbl|label)\|en\|([^{}]*)\}\}/g, (_, x) => {
      const labels = x.split('|').filter((p) => p && p !== '_' && !p.includes('='));
      return labels.length ? `(${labels.join(', ')})` : '';
    })
    .replace(/\{\{(?:l|m|ll|w|vern|taxlink|ngd|non-gloss definition|n-g|1)\|(?:en\|)?([^|{}]+)[^{}]*\}\}/g, '$1')
    .replace(/\{\{(?:gloss|gl)\|([^{}|]+)\}\}/g, '($1)');
  for (let i = 0; i < 5 && s.includes('{{'); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,;:]\s*/, '')
    .trim();
  return s.length > 220 ? `${s.slice(0, 217)}…` : s;
}

function parseEntry(wikitext) {
  const sec = englishSection(wikitext);
  if (!sec) return null;
  const { us, uk } = parsePronunciation(sec);

  const senses = [];
  let formOf = '';
  let pos = null;
  let gotDef = false;
  for (const line of sec.split('\n')) {
    const head = line.match(/^={3,6}\s*([^=]+?)\s*={3,6}\s*$/);
    if (head) {
      pos = POS_KEYS[head[1]] ? head[1] : null;
      gotDef = false;
      continue;
    }
    if (!pos || gotDef || !/^#\s/.test(line)) continue;
    gotDef = true; // first definition of each POS section only
    if (!formOf) {
      const f = line.match(FORM_OF_RE);
      if (f) formOf = f[1].trim();
    }
    const def = cleanWiki(line.slice(1));
    if (def && senses.length < 8) senses.push({ pos, key: POS_KEYS[pos], def });
  }
  return { us, uk, senses, formOf };
}
