// Tuyewn Reader — reader panel (injected on demand into the page, or loaded by reader.html)
// Requires lib/compromise.js (global `nlp`) to be loaded first.

(() => {
  const prev = window.__tuyewnReader;
  if (prev?.alive?.()) return;
  prev?.destroy?.(); // leftover from a reloaded extension version

  const STANDALONE = location.protocol === 'chrome-extension:';
  const HAS_HL = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  const MAX_LOOKUP_WORDS = 1500;
  const MAX_CHUNK_CHARS = 220; // browser voices: long sentences are split at commas (Chrome cuts long utterances)
  const MAX_NEURAL_CHARS = 900;
  const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

  const TAGS = [
    { key: 'noun', label: 'Noun', vi: 'danh từ', abbr: 'n.', color: '#3b82f6' },
    { key: 'verb', label: 'Verb', vi: 'động từ', abbr: 'v.', color: '#ef4444' },
    { key: 'adj', label: 'Adjective', vi: 'tính từ', abbr: 'adj.', color: '#22c55e' },
    { key: 'adv', label: 'Adverb', vi: 'trạng từ', abbr: 'adv.', color: '#f59e0b' },
    { key: 'pron', label: 'Pronoun', vi: 'đại từ', abbr: 'pron.', color: '#a855f7' },
    { key: 'prep', label: 'Preposition', vi: 'giới từ', abbr: 'prep.', color: '#06b6d4' },
    { key: 'conj', label: 'Conjunction', vi: 'liên từ', abbr: 'conj.', color: '#ec4899' },
    { key: 'det', label: 'Determiner', vi: 'từ hạn định', abbr: 'det.', color: '#64748b' },
    { key: 'num', label: 'Number', vi: 'số từ', abbr: 'num.', color: '#84cc16' },
    { key: 'intj', label: 'Interjection', vi: 'thán từ', abbr: 'interj.', color: '#f97316' },
    { key: 'other', label: 'Other', vi: 'khác', abbr: '', color: '#9ca3af' },
  ];
  const TAG = Object.fromEntries(TAGS.map((t) => [t.key, t]));

  // Microsoft Edge "Read aloud" neural voices (free, online). The "Multilingual" ones are the newer,
  // conversational generation — the most natural sounding, so they come first.
  const NEURAL_VOICES = {
    US: [
      ['en-US-AndrewMultilingualNeural', 'Andrew — nam · tự nhiên nhất'],
      ['en-US-AvaMultilingualNeural', 'Ava — nữ · tự nhiên nhất'],
      ['en-US-EmmaMultilingualNeural', 'Emma — nữ · tự nhiên nhất'],
      ['en-US-BrianMultilingualNeural', 'Brian — nam · tự nhiên nhất'],
      ['en-US-AriaNeural', 'Aria — nữ'],
      ['en-US-JennyNeural', 'Jenny — nữ'],
      ['en-US-AvaNeural', 'Ava — nữ'],
      ['en-US-EmmaNeural', 'Emma — nữ'],
      ['en-US-MichelleNeural', 'Michelle — nữ'],
      ['en-US-AndrewNeural', 'Andrew — nam'],
      ['en-US-BrianNeural', 'Brian — nam'],
      ['en-US-GuyNeural', 'Guy — nam'],
      ['en-US-ChristopherNeural', 'Christopher — nam'],
      ['en-US-EricNeural', 'Eric — nam'],
      ['en-US-RogerNeural', 'Roger — nam'],
      ['en-US-SteffanNeural', 'Steffan — nam'],
    ],
    UK: [
      ['en-GB-SoniaNeural', 'Sonia — nữ'],
      ['en-GB-LibbyNeural', 'Libby — nữ'],
      ['en-GB-MaisieNeural', 'Maisie — bé gái'],
      ['en-GB-RyanNeural', 'Ryan — nam'],
      ['en-GB-ThomasNeural', 'Thomas — nam'],
    ],
  };

  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    stop: 'M6 6h12v12H6z',
    prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
    speaker: 'M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
    from: 'M4 5h2v14H4zM9 5v14l11-7z',
    min: 'M5 11h14v2H5z',
    close: 'M18.3 5.7 16.9 4.3 12 9.2 7.1 4.3 5.7 5.7 10.6 10.6 5.7 15.5 7.1 16.9 12 12l4.9 4.9 1.4-1.4-4.9-4.9z',
    copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z',
    repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    up: 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z',
    down: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
    book: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z',
    system: 'M3 4h18v13H3V4zm2 2v9h14V6H5zm3 13h8v2H8z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.4 5.4 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z',
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const settings = {
    accent: 'US',
    rate: 1,
    engine: 'neural', // 'neural' (Edge voices, online) | 'browser' (Web Speech API)
    neuralUS: 'en-US-AndrewMultilingualNeural',
    neuralUK: 'en-GB-SoniaNeural',
    voiceUS: '',
    voiceUK: '',
    tab: 'read', // read | vocab | sum | settings
    fontSize: 16,
    bilingual: false, // translation under every sentence (else only the current one)
    hideTrans: false, // blur translations until clicked
    showIPA: false,
    showVI: false,
    tagSel: [],
    repeat: false,
    repeatTimes: 3, // 0 = endless
    shadowGap: 1, // pause after each sentence = sentence duration × this
    shadowBeep: true, // short beep when it's the learner's turn to speak
    subtitles: true, // YouTube-style Vietnamese subtitle over the page
    subSize: 16, // subtitle font size (px)
    subPos: 'bottom', // bottom | top
    subBg: 'solid', // solid | dim | none
    pageTimeline: true, // reading timeline pinned at the bottom of the page
    theme: '', // light | dark ('' = follow the system the first time, then remembered)
    dimOthers: true, // fade the other sentences while reading
    skipAllLinks: false, // also drop links that sit inside a sentence
    hoverCard: true, // quick-look card when hovering a word of the passage on the page
    viMark: true, // mark the current word's meaning in the sentence translation (best effort)
    width: 420,
    pushPage: true,
    defaultsVersion: 0, // bumped when a default is changed for existing installs
  };
  const settingsReady = chrome.storage.sync
    .get('trSettings')
    .then(({ trSettings }) => {
      Object.assign(settings, trSettings || {});
      if (!['read', 'vocab', 'sum', 'settings'].includes(settings.tab)) settings.tab = 'read';
      if (!['light', 'dark'].includes(settings.theme)) {
        settings.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      // v1: American English is the default accent — reset a previously saved UK choice once
      if (settings.defaultsVersion < 1) {
        settings.accent = 'US';
        settings.defaultsVersion = 1;
        saveSettings();
      }
      // v2: the old default US voice (Aria) → the more natural Ava Multilingual
      if (settings.defaultsVersion < 2) {
        if (!settings.neuralUS || settings.neuralUS === 'en-US-AriaNeural') settings.neuralUS = 'en-US-AndrewMultilingualNeural';
        if (settings.engine !== 'browser') settings.engine = 'neural';
        settings.defaultsVersion = 2;
        saveSettings();
      }
      // v3: subtitle text defaults to 16px
      if (settings.defaultsVersion < 3) {
        if (!settings.subSize || settings.subSize === 19) settings.subSize = 16;
        settings.defaultsVersion = 3;
        saveSettings();
      }
      // v4: Andrew (Multilingual) is the default US natural voice, natural voices are the default engine
      if (settings.defaultsVersion < 4) {
        if (!settings.neuralUS || /^en-US-(Aria|AvaMultilingual)Neural$/.test(settings.neuralUS)) settings.neuralUS = 'en-US-AndrewMultilingualNeural';
        settings.engine = 'neural';
        settings.defaultsVersion = 4;
        saveSettings();
      }
    })
    .catch(() => {});
  let saveTimer = 0;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.sync.set({ trSettings: settings }).catch(() => {}), 300);
  }

  let doc = null; // { text, tokens, sentences, map }
  const entries = new Map(); // lookup key → Wiktionary entry | null
  const viWord = new Map(); // lookup key → short Vietnamese translation
  const viDict = new Map(); // lookup key → { trans, pos: [{ pos, terms }] } | null
  let viSent = []; // sentence index → Vietnamese translation
  let transProvider = 'Google Translate';
  let dictTimer = 0;
  let detailWaiting = null; // word whose Vietnamese meanings are scheduled or being fetched
  let sumState = { state: 'idle', data: null, error: '' };
  let gemini = { hasKey: false, keyHint: '', model: '', effective: '', models: [] }; // model '' = automatic
  const send = (msg) => chrome.runtime.sendMessage(msg).catch((err) => ({ error: err.message }));
  const ui = {};
  let cardTok = null;
  let sheetOpen = false;
  let voices = [];
  const player = {
    playing: false,
    finished: false,
    cur: -1,
    sentMarked: -1,
    gen: 0,
    utter: null,
    source: null, // neural AudioBufferSourceNode
    timers: [],
    noBoundary: new Set(), // browser voices observed to never fire word-boundary events
    neuralDownUntil: 0, // neural service failed → browser voices until this time, then retry
    startedAt: 0,
    sentStartAt: 0,
    rep: { sent: -1, count: 0 },
    lastScroll: 0,
  };

  // ---------------------------------------------------------------------------
  // Selection capture → plain text + char→DOM map (for page highlighting)
  // ---------------------------------------------------------------------------

  const blockCache = new WeakMap();
  function blockOf(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      let isBlock = blockCache.get(e);
      if (isBlock === undefined) {
        const d = getComputedStyle(e).display;
        isBlock = !d.startsWith('inline') && d !== 'contents';
        blockCache.set(e, isBlock);
      }
      if (isBlock) return e;
    }
    return document.documentElement;
  }

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    return captureRange(sel.getRangeAt(0));
  }

  // Page furniture skipped when reading a whole page / a picked region (not for an explicit selection)
  const PAGE_CHROME =
    'nav,header,footer,aside,form,button,pre,figure > figcaption,[role="navigation"],[role="banner"],[role="contentinfo"],' +
    '[role="complementary"],[role="dialog"],[aria-hidden="true"],.sr-only,.visually-hidden,.screen-reader-text';
  const MAX_PAGE_CHARS = 60000;
  const FOOTNOTE_RE = /^\s*[[(]?\s*(\d{1,4}|[a-z]|[*†‡§¶])\s*[\])]?\s*$/i;
  // only plain text is read: no scripts, media, graphics, formulas or embedded frames
  const NON_TEXT_TAGS =
    /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|SELECT|svg|SVG|MATH|math|CANVAS|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|PICTURE|IMG)$/;
  const CODE_LIKE_RE = /[(){}[\];=<>/\\|`$#@]|\w\.\w|^\s*\S{25,}\s*$/;
  // links, e-mail addresses and emoji found inside text
  const NON_TEXT_RES = [
    /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/gi,
    /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    /\p{Extended_Pictographic}️?/gu,
    // separators left dangling at the end of a line by dropped links ("Tags: go, sched" → "Tags: ,")
    /(?:[ \t]*[,;|•·]|[ \t]+[:–—-])+[ \t]*(?=\n|$)/g,
  ];

  // Drop link / e-mail / emoji characters from a capture, keeping the char→DOM map aligned
  function cleanCapture(text, nodes, offs) {
    const drop = new Uint8Array(text.length);
    for (const re of NON_TEXT_RES) for (const m of text.matchAll(re)) drop.fill(1, m.index, m.index + m[0].length);
    if (!drop.includes(1)) return { text, map: { nodes, offs } };
    let out = '';
    const n2 = [];
    const o2 = [];
    const isSep = (ch) => ch === ' ' || ch === '\n';
    for (let i = 0; i < text.length; i++) {
      if (drop[i]) continue;
      const ch = text[i];
      const last = out[out.length - 1];
      if (isSep(ch)) {
        if (!out) continue;
        if (isSep(last)) {
          // collapse the gap left by a removed link; a paragraph break wins over a space
          if (ch === '\n') out = `${out.slice(0, -1)}\n`;
          continue;
        }
      } else if (/[,.;:!?)]/.test(ch) && last === ' ') {
        // "see https://x.com, then" → "see, then"
        out = out.slice(0, -1);
        n2.pop();
        o2.pop();
      }
      out += ch;
      n2.push(nodes[i]);
      o2.push(offs[i]);
    }
    while (out && isSep(out[out.length - 1])) {
      out = out.slice(0, -1);
      n2.pop();
      o2.pop();
    }
    return out ? { text: out, map: { nodes: n2, offs: o2 } } : null;
  }

  // Links are not read when they stand on their own (menus, "Read more", related posts, tags, link lists),
  // show an address ("github.com/…") or a marker ("[edit]", "[1]"). A link inside a sentence is read as part
  // of it, unless settings.skipAllLinks — then every link is dropped.
  const URLISH_RE = /^(?:https?:|ftp:|www\.|\/\S)|^[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|edu|gov|co|vn|app|ai|me|info|xyz|uk|us|de|fr|jp|tv|ly|gg)(?:[/:?#]\S*)?$/i;
  function linkToSkip(a, nonLinkChars) {
    if (settings.skipAllLinks) return true;
    const text = a.textContent.trim();
    if (!text) return false;
    if (URLISH_RE.test(text) || FOOTNOTE_RE.test(text) || /^\[.*\]$/.test(text)) return true;
    // a heading made of a link is still the title
    const block = blockOf(a.parentElement);
    if (!block || /^H[1-6]$/.test(block.tagName)) return false;
    return nonLinkChars(block) < 12;
  }

  // Letters in a block that are not inside a link
  function nonLinkLetters(block) {
    let n = 0;
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (!t.parentElement.closest('a')) n += (t.data.match(/\p{L}/gu) || []).length;
    return n;
  }

  // Range → plain text + char→DOM map (for page highlighting)
  function captureRange(range, opts = {}) {
    // a selection made only of link text is read as is
    return captureRangeWith(range, opts, false) || captureRangeWith(range, opts, true);
  }

  function captureRangeWith(range, { skipChrome = false, maxChars = Infinity } = {}, keepLinks) {
    const common = range.commonAncestorContainer;
    const root = common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode;
    if (!root) return null;
    const insideLink = !!root.closest('a');
    const letters = new Map();
    const nonLinkChars = (block) => {
      if (!letters.has(block)) letters.set(block, nonLinkLetters(block));
      return letters.get(block);
    };

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n === ui.host || NON_TEXT_TAGS.test(n.tagName)) return NodeFilter.FILTER_REJECT;
          // inline code that reads as code ("go work()", "runtime.Gosched") — plain identifiers stay
          if (/^(CODE|KBD|SAMP|TT)$/.test(n.tagName) && CODE_LIKE_RE.test(n.textContent)) return NodeFilter.FILTER_REJECT;
          // footnote markers ("feedback.¹⁰⁷ It…", "[12]") break sentence splitting and get read aloud
          if (n.tagName === 'SUP' && FOOTNOTE_RE.test(n.textContent)) return NodeFilter.FILTER_REJECT;
          if (!keepLinks && !insideLink && n.tagName === 'A' && linkToSkip(n, nonLinkChars)) return NodeFilter.FILTER_REJECT;
          if (skipChrome && n !== root && n.matches(PAGE_CHROME)) return NodeFilter.FILTER_REJECT;
          if (n.checkVisibility && !n.checkVisibility()) return NodeFilter.FILTER_REJECT;
          return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = '';
    const nodes = [];
    const offs = [];
    let lastBlock = null;
    let pendingSpace = false;
    let pendingBreak = false;
    const pushSep = (ch) => {
      text += ch;
      nodes.push(null);
      offs.push(0);
    };

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        pendingBreak = true; // <br>
        continue;
      }
      // very long pages: stop at a paragraph boundary
      if (text.length > maxChars && blockOf(n.parentElement) !== lastBlock) break;
      const start = n === range.startContainer ? range.startOffset : 0;
      const end = n === range.endContainer ? range.endOffset : n.data.length;
      if (start >= end) continue;
      const block = blockOf(n.parentElement);
      if (lastBlock && block !== lastBlock) pendingBreak = true;
      lastBlock = block;
      for (let i = start; i < end; i++) {
        const ch = n.data[i];
        if (/\s/.test(ch)) {
          pendingSpace = true;
          continue;
        }
        if (text) {
          if (pendingBreak) pushSep('\n');
          else if (pendingSpace) pushSep(' ');
        }
        pendingBreak = pendingSpace = false;
        text += ch;
        nodes.push(n);
        offs.push(i);
      }
    }
    return text ? cleanCapture(text, nodes, offs) : null;
  }

  // ---------------------------------------------------------------------------
  // Whole page / picked region
  // ---------------------------------------------------------------------------

  const paragraphChars = (el) =>
    [...el.querySelectorAll('p, li, h1, h2, h3, blockquote')].reduce((n, p) => n + (p.checkVisibility?.() === false ? 0 : p.textContent.trim().length), 0);

  // The element holding the article: semantic containers first, else the densest block of paragraphs
  function findMainContent() {
    const cands = [
      ...document.querySelectorAll(
        'article, main, [role="main"], #content, #main, .post, .article, .entry-content, .post-content, .article-body, .markdown-body'
      ),
    ].filter((el) => !el.closest('nav, aside, footer'));
    let best = null;
    let bestLen = 0;
    for (const el of cands) {
      const n = paragraphChars(el);
      if (n > bestLen) [best, bestLen] = [el, n];
    }
    // prefer the innermost candidate that still holds most of the text (article inside main)
    for (const el of cands) if (best?.contains(el) && el !== best && paragraphChars(el) >= bestLen * 0.85) best = el;

    if (!best || bestLen < 500) {
      const score = new Map();
      for (const p of document.querySelectorAll('p')) {
        const len = p.textContent.trim().length;
        if (len < 40 || p.closest(PAGE_CHROME)) continue;
        score.set(p.parentElement, (score.get(p.parentElement) || 0) + len);
      }
      for (const [el, s] of score) if (s > bestLen) [best, bestLen] = [el, s];
    }
    return best || document.body;
  }

  function capturePage() {
    const range = document.createRange();
    range.selectNodeContents(findMainContent());
    return captureRange(range, { skipChrome: true, maxChars: MAX_PAGE_CHARS });
  }

  // --- pick a start point and an end point on the page ---------------------------

  const pick = { step: 0, start: null };

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    const r = document.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  // Snap a caret to the start (or end) of the word it is in
  function snapToWord(pos, toEnd) {
    if (pos?.node?.nodeType !== Node.TEXT_NODE) return pos;
    const s = pos.node.data;
    let i = pos.offset;
    if (toEnd) while (i < s.length && /\S/.test(s[i])) i++;
    else while (i > 0 && /\S/.test(s[i - 1])) i--;
    return { node: pos.node, offset: i };
  }

  function wordRangeAt(pos) {
    const a = snapToWord(pos, false);
    const b = snapToWord(pos, true);
    const r = document.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch {
      return null;
    }
    return r;
  }

  function startPick() {
    if (!ui.host?.isConnected) buildUI();
    setMinimized(false);
    stop();
    clearPageHighlights();
    hideTip();
    setLookupCursor(null);
    pick.step = 1;
    pick.start = null;
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    showPickBanner('① Bấm vào chỗ BẮT ĐẦU đọc trên trang');
    status('Chọn vùng đọc: bấm điểm bắt đầu, rồi bấm điểm kết thúc · Esc để huỷ');
  }

  function endPick() {
    pick.step = 0;
    pick.start = null;
    document.documentElement.style.removeProperty('cursor');
    ui.pickBanner?.remove();
    if (HAS_HL) CSS.highlights.delete('tuyewn-mark');
  }

  function showPickBanner(text) {
    ui.pickBanner?.remove();
    ui.pickBanner = h(
      'div',
      { class: 'pick-banner', role: 'status' },
      h('span', null, text),
      h('button', { class: 'btn sm', onclick: () => (endPick(), status('Đã huỷ chọn vùng')) }, 'Huỷ (Esc)')
    );
    applyTheme();
    ui.root.append(ui.pickBanner);
  }

  function onPickClick(e) {
    if (!pick.step || e.button !== 0 || e.composedPath().includes(ui.host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const pos = caretAt(e.clientX, e.clientY);
    if (!pos) return;
    if (pick.step === 1) {
      pick.start = snapToWord(pos, false);
      pick.step = 2;
      const mark = wordRangeAt(pos);
      if (HAS_HL && mark) CSS.highlights.set('tuyewn-mark', new Highlight(mark));
      showPickBanner('② Bấm vào chỗ KẾT THÚC đọc');
      return;
    }
    // second click: build the region (either order) and read it
    const endPos = snapToWord(pos, true);
    const a = document.createRange();
    a.setStart(pick.start.node, pick.start.offset);
    const b = document.createRange();
    b.setStart(endPos.node, endPos.offset);
    const range = document.createRange();
    if (a.compareBoundaryPoints(Range.START_TO_START, b) <= 0) {
      range.setStart(pick.start.node, pick.start.offset);
      range.setEnd(endPos.node, endPos.offset);
    } else {
      const s2 = snapToWord(pos, false);
      const e2 = snapToWord(pick.start, true);
      range.setStart(s2.node, s2.offset);
      range.setEnd(e2.node, e2.offset);
    }
    endPick();
    const cap = captureRange(range, { skipChrome: true, maxChars: MAX_PAGE_CHARS });
    if (cap) open(cap.text, cap.map);
    else status('Vùng đã chọn không có chữ — thử lại');
  }

  function onPickKey(e) {
    if (pick.step && e.key === 'Escape') {
      endPick();
      status('Đã huỷ chọn vùng');
    }
  }

  // Reader entry for the panel / context menu
  function readPage() {
    const cap = capturePage();
    if (cap) open(cap.text, cap.map);
    else status('Không tìm thấy nội dung để đọc trên trang này');
  }

  // ---------------------------------------------------------------------------
  // NLP: tokens, POS tags, sentences
  // ---------------------------------------------------------------------------

  function mapPos(tags) {
    const t = new Set(tags);
    if (t.has('Pronoun')) return 'pron';
    if (t.has('Determiner')) return 'det';
    if (t.has('Preposition')) return 'prep';
    if (t.has('Conjunction')) return 'conj';
    if (t.has('Value')) return 'num';
    if (t.has('Adverb')) return 'adv';
    if (t.has('Adjective')) return 'adj';
    if (t.has('Verb')) return 'verb';
    if (t.has('Noun') || t.has('Date') || t.has('Place') || t.has('Person')) return 'noun';
    if (t.has('Expression')) return 'intj';
    return 'other';
  }

  const straight = (s) => s.replace(/[’‘]/g, "'");

  function analyze(text, map) {
    const tokens = [];
    const sentences = [];
    for (const para of text.matchAll(/[^\n]+/g)) {
      const pBase = para.index;
      let json = [];
      try {
        const d = nlp(para[0]);
        d.compute('root');
        json = d.json({ offset: true });
      } catch (err) {
        console.warn('[Tuyewn Reader] nlp failed', err);
      }
      for (const s of json) {
        const first = tokens.length;
        let cursor = s.offset ? pBase + s.offset.start : pBase;
        for (const t of s.terms || []) {
          if (!t.text) continue; // contraction placeholders ("we'll" → we + will)
          let start = t.offset ? pBase + t.offset.start : -1;
          if (text.substr(start, t.text.length) !== t.text) {
            start = text.indexOf(t.text, cursor);
            if (start < 0) continue;
          }
          const end = start + t.text.length;
          cursor = end;
          const normal = straight(t.normal || t.text.toLowerCase());
          const key = t.text === 'I' ? 'I' : normal.replace(/'s$/, '');
          const root = t.root ? straight(t.root) : '';
          tokens.push({
            i: tokens.length,
            text: t.text,
            start,
            end,
            tag: mapPos(t.tags || []),
            key: /^\p{L}[\p{L}'.\-]*$/u.test(key) ? key : '',
            lemma: root && root !== key ? root : '',
            sent: sentences.length,
          });
        }
        if (tokens.length > first) {
          const last = tokens.length - 1;
          const sStart = s.offset ? pBase + s.offset.start : tokens[first].start;
          const sEnd = s.offset ? pBase + s.offset.start + s.offset.length : tokens[last].end;
          sentences.push({
            start: Math.min(sStart, tokens[first].start),
            end: Math.max(sEnd, tokens[last].end),
            first,
            last,
          });
        }
      }
    }
    return { text, tokens, sentences, map };
  }

  function tokenAt(pos, from, to) {
    let lo = from;
    let hi = to;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (doc.tokens[mid].start <= pos) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (ans < 0) return from;
    // boundary landed in the gap after a word → advance to the next word
    if (pos >= doc.tokens[ans].end && ans < to) return ans + 1;
    return ans;
  }

  const sentText = (si) => doc.text.slice(doc.sentences[si].start, doc.sentences[si].end);

  // ---------------------------------------------------------------------------
  // Dictionary (IPA / senses) via background
  // ---------------------------------------------------------------------------

  function infoFor(t) {
    if (!t?.key) return { e: null, via: '', base: null };
    const own = entries.get(t.key);
    const cands = [t.key, t.lemma, own?.formOf].filter(Boolean);
    for (const k of cands) {
      const x = entries.get(k);
      if (x && (x.us || x.uk)) return { e: x, via: k === t.key ? '' : k, base: own || x };
    }
    return { e: null, via: '', base: own || (t.lemma && entries.get(t.lemma)) || null };
  }

  function ipaOf(e, acc = settings.accent) {
    if (!e) return '';
    return acc === 'UK' ? e.uk || e.us : e.us || e.uk;
  }

  async function fetchEntries(keys, forDoc, progress) {
    const need = keys.filter((k) => !entries.has(k));
    for (let i = 0; i < need.length; i += 40) {
      if (doc !== forDoc) return;
      const chunk = need.slice(i, i + 40);
      const res = await send({ type: 'TR_LOOKUP', words: chunk });
      if (res?.error) {
        status(`Không tra được IPA: ${res.error}`);
        return;
      }
      for (const k of chunk) if (res?.entries && k in res.entries) entries.set(k, res.entries[k]);
      progress?.(Math.min(i + 40, need.length), need.length);
      refreshLookupViews();
    }
  }

  async function lookupAll() {
    const forDoc = doc;
    const keys = [...new Set(doc.tokens.map((t) => t.key).filter(Boolean))].slice(0, MAX_LOOKUP_WORDS);
    if (!keys.length) return;
    await fetchEntries(keys, forDoc, (n, total) => status(`Đang tra IPA… ${n}/${total}`));
    if (doc !== forDoc) return;

    // Inflected forms without their own pronunciation → try lemma / "form of" target
    const second = new Set();
    for (const t of doc.tokens) {
      if (!t.key) continue;
      const e = entries.get(t.key);
      if (e && (e.us || e.uk)) continue;
      if (t.lemma && !entries.has(t.lemma)) second.add(t.lemma);
      if (e?.formOf && !entries.has(e.formOf)) second.add(e.formOf);
    }
    if (second.size) await fetchEntries([...second], forDoc);
    if (doc === forDoc) status(docStats());
  }

  function refreshLookupViews() {
    updateInlineIpa();
    updateInlineVi();
    if (settings.tab === 'vocab') renderVocab();
    if (cardTok) showCard(cardTok);
    markViWord();
  }

  // ---------------------------------------------------------------------------
  // Vietnamese translation via background (Google Translate)
  // ---------------------------------------------------------------------------

  const GT_POS = {
    noun: 'noun', verb: 'verb', 'auxiliary verb': 'verb', adjective: 'adj', adverb: 'adv', pronoun: 'pron',
    preposition: 'prep', conjunction: 'conj', article: 'det', determiner: 'det', interjection: 'intj', number: 'num',
  };

  // Chrome's built-in Translator API: on-device, free, unlimited, never rate-limited — the first
  // choice. The network providers in the background (Google → Gemini → MyMemory) are the fallback.
  // Chrome downloads the en→vi language pack once, and that download must start from a user click.
  const LOCAL_NAME = 'Chrome (dịch trên máy)';
  const local = { translator: null, state: 'unknown', pending: null };

  async function localAvailability() {
    if (typeof Translator === 'undefined') return 'unavailable';
    try {
      return await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'vi' });
    } catch {
      return 'unavailable';
    }
  }

  // interactive = called from a user click, so it may start the one-time download
  async function localTranslator(interactive = false) {
    if (local.translator) return local.translator;
    if (local.pending) return local.pending;
    const av = await localAvailability();
    local.state = av;
    if (av === 'unavailable' || (av !== 'available' && !interactive)) return null;
    local.pending = Translator.create({
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => status(`Đang tải bộ dịch của Chrome… ${Math.round(e.loaded * 100)}%`));
      },
    })
      .then((t) => {
        local.translator = t;
        local.state = 'available';
        return t;
      })
      .catch((err) => {
        console.info('[Tuyewn Reader] Chrome translator unavailable:', err.message);
        return null;
      })
      .finally(() => (local.pending = null));
    return local.pending;
  }

  // Chrome's translator may return only the first sentence of a multi-sentence input
  // (e.g. "feedback.107 It can occur…"), so each line is translated sentence by sentence.
  const splitSentences = (line) =>
    line
      .split(/(?<=[.!?…]["'”’)\]]*\d{0,4})\s+(?=["“'(\[]?[A-Z0-9])/)
      .map((s) => s.trim())
      .filter(Boolean);

  async function localTranslate(lines) {
    const t = await localTranslator();
    if (!t) return null;
    const out = [];
    for (const l of lines) {
      if (!l) {
        out.push('');
        continue;
      }
      const parts = [];
      for (const piece of splitSentences(l)) parts.push((await t.translate(piece)).trim());
      out.push(parts.join(' '));
    }
    return out;
  }

  // Offer the one-time download when Chrome supports it but the pack isn't installed yet
  function updateLocalOffer() {
    if (!ui.offer) return;
    ui.offer.hidden = !(local.state === 'downloadable' || local.state === 'downloading') || !!local.translator;
  }

  async function enableLocal() {
    ui.offer.hidden = true;
    const t = await localTranslator(true);
    if (!t) {
      status('Không bật được bộ dịch của Chrome — vẫn dùng nguồn dịch online');
      updateLocalOffer();
      return;
    }
    status('Đã bật dịch trên máy của Chrome — miễn phí, không giới hạn');
    // re-translate what is still missing with the local translator
    if (doc) {
      transRequested = new Set([...transRequested].filter((i) => viSent[i]));
      translateAll();
    }
  }

  // Sentence translations are fetched in windows around the reading position, so a whole page
  // doesn't spend the translators' quota up front. Short passages are translated in one go.
  const TRANS_WINDOW = 25;
  const SHORT_DOC_SENTENCES = 60;
  let transRequested = new Set();
  let transHigh = 0; // first sentence index not yet requested in the forward window

  async function translateSentences(from, count = TRANS_WINDOW) {
    const forDoc = doc;
    const idx = [];
    for (let i = from; i < Math.min(doc.sentences.length, from + count); i++) {
      if (!transRequested.has(i)) {
        transRequested.add(i);
        idx.push(i);
      }
    }
    if (!idx.length) return;
    transHigh = Math.max(transHigh, idx[idx.length - 1] + 1);
    const lines = idx.map((i) => sentText(i));
    let vi = await localTranslate(lines).catch(() => null);
    let provider = LOCAL_NAME;
    if (!vi) {
      const res = await send({ type: 'TR_TRANSLATE', lines });
      if (doc !== forDoc) return;
      if (res?.error) {
        idx.forEach((i) => transRequested.delete(i));
        updateLocalOffer();
        throw new Error(res.error);
      }
      vi = res?.vi || [];
      provider = res?.provider || 'Google Translate';
    }
    if (doc !== forDoc) return;
    idx.forEach((si, k) => (viSent[si] = vi[k] || ''));
    transProvider = provider;
    fillTranslations();
    updateLocalOffer();
    if (provider !== 'Google Translate' && provider !== LOCAL_NAME) status(`Google Translate đang tạm chặn — bản dịch lấy từ ${provider}`);
  }

  // keep the window ahead of the reader
  function ensureTranslated(sent) {
    if (sent < 0 || !doc) return;
    const run = (from) => translateSentences(from).catch((err) => status(`Không dịch được: ${err.message}`));
    if (!transRequested.has(sent)) run(sent);
    else if (sent + 8 >= transHigh) run(transHigh);
  }

  async function translateAll() {
    const forDoc = doc;
    transRequested = new Set();
    transHigh = 0;
    try {
      // the first few sentences first, so the reader sees a translation right away
      await translateSentences(0, 5);
      if (doc !== forDoc) return;
      const short = doc.sentences.length <= SHORT_DOC_SENTENCES;
      await translateSentences(5, short ? doc.sentences.length : TRANS_WINDOW - 5);
      if (doc !== forDoc) return;

      const keys = [...new Set(doc.tokens.map((t) => t.key).filter((k) => k && !viWord.has(k)))].slice(0, MAX_LOOKUP_WORDS);
      for (let i = 0; i < keys.length; i += 300) {
        const chunk = keys.slice(i, i + 300);
        const vi = await localTranslate(chunk).catch(() => null);
        if (doc !== forDoc) return;
        if (vi) chunk.forEach((k, j) => vi[j] && viWord.set(k, vi[j]));
        else {
          const r = await send({ type: 'TR_WORDS_VI', words: chunk });
          if (doc !== forDoc) return;
          if (r?.error) throw new Error(r.error);
          for (const [k, v] of Object.entries(r?.vi || {})) viWord.set(k, v);
        }
        refreshLookupViews();
      }
    } catch (err) {
      if (doc === forDoc) status(`Không dịch được: ${err.message}`);
    }
  }

  // Vietnamese meanings by POS — only for a word the sheet rests on, never for every word read
  function scheduleDetail(t) {
    clearTimeout(dictTimer);
    if (!t?.key || viDict.has(t.key)) return;
    detailWaiting = t.key;
    dictTimer = setTimeout(async () => {
      await fetchDetail(t.key);
      if (detailWaiting === t.key) detailWaiting = null;
      if (cardTok?.key === t.key) showCard(cardTok);
      if (tip.tok?.key === t.key) showTip(tip.tok);
      markViWord(); // more meanings to find in the sentence translation
    }, player.playing ? 900 : 150);
  }

  // the word's meanings are on their way (shown as a spinner instead of stale or empty details)
  const detailLoading = (t) => !!t?.key && (detailWaiting === t.key || viDict.get(t.key) === null);
  const loadingLine = (text) => h('div', { class: 'loading-line' }, h('span', { class: 'spin' }), text);

  async function fetchDetail(key) {
    if (viDict.has(key)) return;
    viDict.set(key, null);
    const r = await send({ type: 'TR_WORD_DICT', word: key });
    let dict = r?.dict || null;
    // Google's meanings-by-POS unavailable → at least a short meaning from Chrome's translator
    if (!dict?.pos?.length && !viWord.get(key)) {
      const vi = await localTranslate([key]).catch(() => null);
      if (vi?.[0] && vi[0].toLowerCase() !== key.toLowerCase()) dict = { trans: vi[0], pos: dict?.pos || [] };
    }
    viDict.set(key, dict);
  }

  // Pages are opened in a popup window for the user to read/watch (no scraping)
  function openDict(site, word) {
    if (!word && site !== 'chart') return;
    send({ type: 'TR_OPEN_DICT', site, word: word || '', accent: settings.accent }).then(
      (r) => r?.error && status(`Không mở được trang: ${r.error}`)
    );
  }

  // "How to pronounce" + dictionary links for one word
  function linkGroups(getWord) {
    const btn = (site, label, title) => h('button', { class: 'btn sm', title, onclick: () => openDict(site, getWord()) }, label);
    return h(
      'div',
      { class: 'links' },
      h('div', { class: 'lbl' }, 'Nghe & xem cách phát âm'),
      btn('youglish', '▶ YouGlish', `Video người bản xứ nói từ này trong ngữ cảnh (giọng ${settings.accent})`),
      btn('google', 'Google', 'Công cụ phát âm của Google: đọc chậm, hình khẩu hình miệng'),
      btn('forvo', 'Forvo', 'Bản ghi âm của người bản xứ'),
      btn('cambridgeSay', 'Cambridge', 'Trang phát âm Cambridge: giọng UK + US'),
      btn('longman', 'Longman', 'Từ điển Longman: phát âm BrE/AmE và câu ví dụ có audio'),
      h('div', { class: 'lbl' }, 'Từ điển'),
      btn('oxford', 'Oxford ↗', "Oxford Learner's Dictionaries"),
      btn('cambridge', 'Cambridge Anh–Việt ↗', 'Cambridge English–Vietnamese')
    );
  }

  // --- IPA display: stress marks, syllables and a sound-by-sound guide -------------

  // Vietnamese hint + example word for each English sound
  const PHONEMES = {
    'iː': ['i dài, căng môi như cười', 'see'], i: ['i ngắn ở cuối từ', 'happy'], 'ɪ': ['i ngắn, bật nhanh, hơi giống "ê"', 'sit'],
    e: ['e', 'bed'], 'ɛ': ['e', 'bed'], 'æ': ['a bẹt — giữa "a" và "e", mở miệng rộng', 'cat'],
    'ɑː': ['a dài, mở rộng miệng', 'father'], 'ɑ': ['a, mở rộng miệng', 'hot (US)'], 'ɒ': ['o ngắn, tròn môi (Anh-Anh)', 'hot (UK)'],
    'ɔː': ['o dài, tròn môi', 'law'], 'ɔ': ['o, tròn môi', 'law'], 'ʊ': ['u ngắn, môi hơi tròn', 'book'],
    'uː': ['u dài, chu môi', 'food'], u: ['u', 'food'], 'ʌ': ['ă ngắn', 'cup'],
    'ɜː': ['ơ dài', 'bird'], 'ɝ': ['ơ dài, cong lưỡi (Anh-Mỹ)', 'bird'], 'ɜ': ['ơ', 'bird'],
    'ə': ['ơ rất nhẹ, không nhấn (schwa) — âm hay gặp nhất', 'about'], 'ɚ': ['ơ nhẹ, cong lưỡi (Anh-Mỹ)', 'teacher'],
    'ʉ': ['u, lưỡi hơi đưa ra trước', 'goose (UK)'], 'ɐ': ['a ngắn', 'cut'], o: ['ô', 'go'],
    'eɪ': ['ây', 'day'], 'aɪ': ['ai', 'my'], 'ɔɪ': ['oi', 'boy'], 'aʊ': ['ao', 'now'],
    'əʊ': ['âu (Anh-Anh)', 'go (UK)'], 'oʊ': ['ô-u (Anh-Mỹ)', 'go (US)'], 'ɪə': ['ia', 'near (UK)'],
    'eə': ['e-ơ', 'hair (UK)'], 'ɛə': ['e-ơ', 'hair (UK)'], 'ʊə': ['u-ơ', 'tour (UK)'],
    p: ['p bật hơi mạnh', 'pen'], b: ['b', 'bad'], t: ['t bật hơi (khác "t" tiếng Việt)', 'tea'], d: ['đ', 'did'],
    k: ['k bật hơi', 'cat'], 'ɡ': ['g', 'go'], g: ['g', 'go'], f: ['ph', 'fish'], v: ['v — răng trên chạm môi dưới', 'van'],
    'θ': ['th không rung — lưỡi giữa hai răng, thổi hơi', 'think'], 'ð': ['th có rung — lưỡi giữa hai răng, rung cổ họng', 'this'],
    s: ['x', 'see'], z: ['z có rung (không đọc thành "d")', 'zoo'], 'ʃ': ['s nặng, chu môi (sh)', 'she'],
    'ʒ': ['giống ʃ nhưng rung', 'vision'], h: ['h', 'hat'], 'tʃ': ['ch, chu môi', 'chair'], 'dʒ': ['giơ (j), chu môi', 'job'],
    m: ['m', 'man'], n: ['n', 'no'], 'ŋ': ['ng', 'sing'], l: ['l — cuối từ thì cong lưỡi chạm lợi', 'leg'],
    'ɫ': ['l tối, cuối từ', 'feel'], r: ['r cong lưỡi, không rung lưỡi', 'red'], j: ['y', 'yes'], w: ['u/qu, tròn môi', 'wet'],
    'ɾ': ['t/d đọc lướt, nghe như "r" nhẹ (Anh-Mỹ)', 'water (US)'], 'ʔ': ['ngắt hơi ở cổ họng', 'button'], x: ['kh', 'loch'],
  };
  const VOWELS = new Set(['iː', 'i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑː', 'ɑ', 'ɒ', 'ɔː', 'ɔ', 'ʊ', 'uː', 'u', 'ʌ', 'ɜː', 'ɝ', 'ɜ', 'ə', 'ɚ', 'ʉ', 'ɐ', 'o',
    'eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'əʊ', 'oʊ', 'ɪə', 'eə', 'ɛə', 'ʊə']);
  const IPA_KEYS = Object.keys(PHONEMES).sort((a, b) => b.length - a.length);
  const MARKS = /[ːˑ̀-ͯʰʷʲ]/;
  const baseSym = (sym) => sym.replace(new RegExp(MARKS.source, 'g'), '');

  function ipaTokens(ipa) {
    const s = (ipa || '').replace(/^[/[]|[/\]]$/g, '').replace(/[()]/g, '');
    const out = [];
    for (let i = 0; i < s.length; ) {
      const c = s[i];
      if (c === 'ˈ' || c === 'ˌ') out.push({ stress: c === 'ˈ' ? 1 : 2 });
      else if (c === '.') out.push({ dot: true });
      else if (/\s/.test(c)) out.push({ space: true });
      else {
        let sym = IPA_KEYS.find((k) => s.startsWith(k, i)) || c;
        i += sym.length;
        while (i < s.length && MARKS.test(s[i])) sym += s[i++];
        const base = baseSym(sym);
        out.push({ sym, base, info: PHONEMES[sym] || PHONEMES[base] || PHONEMES[`${base}ː`], vowel: VOWELS.has(sym) || VOWELS.has(base) });
        continue;
      }
      i++;
    }
    return out;
  }

  // Plain dictionary-style transcription: /ˈskedʒuːl/ (syllable dots dropped)
  const ipaText = (ipa) => (ipa ? `/${ipa.replace(/^[/[]|[/\]]$/g, '').replace(/\./g, '')}/` : '');
  const ipaPretty = (ipa) => h('span', { class: 'ipa-p' }, ipaText(ipa) || '—');

  // One chip per sound; hover = Vietnamese hint, click = video guide for that sound
  function phonemeRow(ipa) {
    const toks = ipaTokens(ipa);
    if (!toks.some((t) => t.sym)) return null;
    const row = h('div', { class: 'phon', 'aria-label': 'Các âm trong từ' });
    for (const t of toks) {
      if (t.stress) row.append(h('span', { class: 'ph st', title: t.stress === 1 ? 'Trọng âm chính' : 'Trọng âm phụ' }, t.stress === 1 ? 'ˈ' : 'ˌ'));
      else if (t.dot || t.space) row.append(h('span', { class: 'ph sep' }));
      else {
        const [hint, ex] = t.info || ['', ''];
        row.append(
          h(
            'button',
            {
              class: `ph${t.vowel ? ' v' : ''}`,
              title: `/${t.sym}/ — ${hint || 'âm này'}${ex ? ` · ví dụ: ${ex}` : ''}${/ː/.test(t.sym) ? ' · dấu ː = đọc kéo dài' : ''}\nBấm để xem video hướng dẫn phát âm âm này`,
              onclick: () => openDict('sound', t.base || t.sym),
            },
            t.sym
          )
        );
      }
    }
    row.append(h('button', { class: 'ph chart', title: 'Bảng phiên âm tương tác: bấm từng ký hiệu để nghe (EnglishClub)', onclick: () => openDict('chart', '') }, 'Bảng IPA ↗'));
    return row;
  }

  // IPA for the chosen accent (compact line)
  const ipaShort = (t) => ipaOf(infoFor(t).e);

  // Dictionary-style IPA (as in Oxford): one line per accent — blue speaker = British, red = American.
  // The speaker reads the word in that accent. Then the sound-by-sound chips for the chosen accent.
  function ipaNodes(t) {
    const { e } = infoFor(t);
    if (!e) return [h('span', { class: 'ipa-none' }, !t.key ? '' : entries.has(t.key) ? 'Không có dữ liệu IPA' : 'Đang tra IPA…')];
    const line = (acc) =>
      h(
        'div',
        { class: `ipa-line ${acc.toLowerCase()}${settings.accent === acc ? ' on' : ''}` },
        h(
          'button',
          {
            class: 'spk',
            title: acc === 'UK' ? 'Nghe giọng Anh-Anh (UK)' : 'Nghe giọng Anh-Mỹ (US)',
            'aria-label': acc === 'UK' ? 'Nghe giọng Anh-Anh' : 'Nghe giọng Anh-Mỹ',
            onclick: (ev) => {
              ev.stopPropagation();
              sayText(t.text, acc);
            },
          },
          icon('speaker')
        ),
        h('span', { class: 'ipa-p', title: acc === 'UK' ? 'Anh-Anh (UK)' : 'Anh-Mỹ (US)' }, ipaText(e[acc.toLowerCase()]) || '—')
      );
    return [h('div', { class: 'ipa-lines' }, line('US'), line('UK')), phonemeRow(ipaOf(e))];
  }

  // English definition + source line
  function enDefNodes(t, tagKey, max = 1) {
    const { via, base } = infoFor(t);
    const senses = base?.senses || [];
    const ordered = [...senses.filter((s) => s.key === tagKey), ...senses.filter((s) => s.key !== tagKey)].slice(0, max);
    return [
      ...(via ? [h('div', null, `IPA lấy theo từ gốc "${via}"`)] : []),
      ...ordered.map((s) => h('div', null, h('i', null, TAG[s.key]?.abbr || s.pos), s.def)),
      ...(ordered.length || via ? [h('div', { class: 'src' }, 'Wiktionary')] : []),
    ];
  }

  // Vietnamese: short translation + Google dictionary terms by POS
  function viNodes(t, tagKey, maxPos = 2) {
    const dict = viDict.get(t.key);
    const short = viWord.get(t.key) || dict?.trans || '';
    const kids = [];
    if (short) kids.push(h('b', null, 'VI'), h('span', { class: 'short' }, short));
    if (dict?.pos?.length) {
      const ranked = [...dict.pos.filter((p) => GT_POS[p.pos] === tagKey), ...dict.pos.filter((p) => GT_POS[p.pos] !== tagKey)].slice(0, maxPos);
      for (const p of ranked) kids.push(h('div', { class: 'terms' }, h('i', null, TAG[GT_POS[p.pos]]?.abbr || p.pos), p.terms.slice(0, 6).join(', ')));
    }
    return kids;
  }

  // ---------------------------------------------------------------------------
  // Voices
  // ---------------------------------------------------------------------------

  const accentLang = (acc) => (acc === 'UK' ? 'en-gb' : 'en-us');
  const voiceLang = (v) => v.lang.replace('_', '-').toLowerCase();
  const useNeural = () => settings.engine === 'neural' && Date.now() >= player.neuralDownUntil;
  const neuralVoice = (acc = settings.accent) => settings[`neural${acc}`] || NEURAL_VOICES[acc][0][0];

  // Preferred browser voices (also the automatic fallback when the natural voices fail):
  // Edge "Natural" voices first, then Microsoft Mark (US) / George (UK) and friends
  const PREFERRED_VOICES = {
    'en-us': [/natural|neural/i, /\bmark\b/i, /\bzira\b/i, /\bdavid\b/i, /google/i],
    'en-gb': [/natural|neural/i, /\bgeorge\b/i, /\bhazel\b/i, /\bsusan\b/i, /google/i],
  };

  function scoreVoice(v) {
    const prefs = PREFERRED_VOICES[voiceLang(v)] || [];
    const idx = prefs.findIndex((re) => re.test(v.name));
    let s = idx >= 0 ? (prefs.length - idx) * 10 : 0;
    if (v.localService) s += 2; // local voices fire word-boundary events → exact highlighting
    return s;
  }

  function voicesFor(acc) {
    return voices.filter((v) => voiceLang(v) === accentLang(acc)).sort((a, b) => scoreVoice(b) - scoreVoice(a));
  }

  function currentVoice(acc = settings.accent) {
    const list = voicesFor(acc);
    const saved = settings[`voice${acc}`];
    return list.find((v) => v.name === saved) || list[0] || voices.find((v) => v.default) || voices[0] || null;
  }

  function loadVoices() {
    voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    if (settings.tab === 'settings' && ui.settingsView) renderSettings();
  }
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices();

  // ---------------------------------------------------------------------------
  // Neural TTS: synthesized in the extension (Edge voices), played with Web Audio
  // (Web Audio isn't subject to the page's media-src CSP)
  // ---------------------------------------------------------------------------

  const neural = { ctx: null, cache: new Map() };

  function audioCtx() {
    neural.ctx ??= new AudioContext();
    if (neural.ctx.state === 'suspended') neural.ctx.resume();
    return neural.ctx;
  }

  function synth(text, voice = neuralVoice(), rate = settings.rate) {
    const key = `${voice}|${rate}|${text}`;
    if (neural.cache.has(key)) return neural.cache.get(key);
    const p = send({ type: 'TR_EDGE_TTS', text, voice, rate }).then(async (r) => {
      if (r?.error) throw new Error(r.error);
      const bin = atob(r.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buffer = await audioCtx().decodeAudioData(bytes.buffer);
      return { buffer, words: r.words || [] };
    });
    neural.cache.set(key, p);
    p.catch(() => neural.cache.delete(key));
    if (neural.cache.size > 40) neural.cache.delete(neural.cache.keys().next().value);
    return p;
  }

  function playBuffer(buffer, onended) {
    const ctx = audioCtx();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = onended;
    src.start();
    player.source = src;
    return src;
  }

  function stopSource() {
    const src = player.source;
    player.source = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {}
    }
  }

  // ---------------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------------

  function clearTimers() {
    for (const t of player.timers) clearTimeout(t);
    player.timers = [];
  }

  function halt() {
    player.gen++;
    clearTimers();
    speechSynthesis.cancel();
    stopSource();
    player.utter = null;
    setShadow(-1);
    setShadowPhase('idle');
  }

  function play(from) {
    if (!doc?.tokens.length) return;
    if (!(from >= 0 && from < doc.tokens.length)) from = 0;
    halt();
    player.playing = true;
    player.finished = false;
    player.sentStartAt = 0;
    player.rep = { sent: -1, count: 0 };
    if (useNeural()) audioCtx(); // unlock audio inside the click gesture
    // show the new position right away — a natural voice may take a moment to synthesize it
    if (player.cur !== from) setCurrent(from);
    updatePlayBtn();
    const gen = player.gen;
    // Chrome sometimes drops a speak() issued right after cancel()
    setTimeout(() => {
      if (gen === player.gen && player.playing) speakChunk(from);
    }, 40);
  }

  function pause() {
    player.playing = false;
    halt();
    updatePlayBtn();
  }

  function stop() {
    pause();
    markCurrent(-1);
    if (HAS_HL) {
      CSS.highlights.delete('tuyewn-word');
      CSS.highlights.delete('tuyewn-sent');
    }
  }

  function togglePlay() {
    if (player.playing) pause();
    else play(player.finished || player.cur < 0 ? 0 : player.cur);
  }

  function finish() {
    player.playing = false;
    player.finished = true;
    clearTimers();
    updatePlayBtn();
    status('Đã đọc xong');
  }

  // ---------------------------------------------------------------------------
  // Reading-time estimate: words ÷ (voice's words-per-minute × playback speed), plus repeats and
  // shadowing pauses. Each voice's pace is learned from what was actually spoken and remembered.
  // ---------------------------------------------------------------------------

  const DEFAULT_WPM = { neural: 140, browser: 160 }; // at 1×, incl. pauses between sentences
  const MIN_LEARNED_WORDS = 20;
  let voiceWpm = {}; // voice key → { w: words, s: seconds at 1× }
  let wpmSaveTimer = 0;
  chrome.storage.local
    .get('voiceWpm')
    .then((r) => {
      voiceWpm = r.voiceWpm || {};
      updateTimeEstimate();
    })
    .catch(() => {});

  const voiceKey = () => (useNeural() ? neuralVoice() : `browser:${currentVoice()?.name || ''}`);
  const isWord = (t) => !!t.key || t.tag === 'num';

  function countWords(from, to) {
    let n = 0;
    for (let k = from; k <= to; k++) if (isWord(doc.tokens[k])) n++;
    return n;
  }

  function learnWpm(key, words, seconds, rate) {
    if (!key || words < 3 || seconds < 0.3) return;
    const st = voiceWpm[key] || { w: 0, s: 0 };
    st.w += words;
    st.s += seconds * rate; // normalise to 1×
    if (st.w > 3000) {
      // keep it a moving average
      st.s *= 3000 / st.w;
      st.w = 3000;
    }
    voiceWpm[key] = st;
    clearTimeout(wpmSaveTimer);
    wpmSaveTimer = setTimeout(() => chrome.storage.local.set({ voiceWpm }).catch(() => {}), 2000);
    updateTimeEstimate();
  }

  function currentWpm() {
    const st = voiceWpm[voiceKey()];
    if (st && st.w >= MIN_LEARNED_WORDS) return { wpm: st.w / (st.s / 60), measured: true };
    return { wpm: DEFAULT_WPM[useNeural() ? 'neural' : 'browser'], measured: false };
  }

  // seconds to read sentences [from, end); Infinity with endless repeat
  function estimateSeconds(from) {
    if (!doc?.sentences.length) return 0;
    const perWord = 60 / (currentWpm().wpm * settings.rate);
    const times = settings.repeat ? settings.repeatTimes || Infinity : 1;
    if (times === Infinity) return Infinity;
    let total = 0;
    for (let i = Math.max(0, from); i < doc.sentences.length; i++) {
      const s = doc.sentences[i];
      s.words ??= countWords(s.first, s.last);
      const sec = s.words * perWord;
      // same pause rule as afterChunk()
      const gap = settings.repeat ? (settings.shadowGap ? Math.min(20, Math.max(0.8, sec * settings.shadowGap)) : 0.25) : 0;
      total += times * (sec + gap);
    }
    return total;
  }

  function fmtDuration(sec) {
    if (sec === Infinity) return '∞';
    if (sec < 60) return '<1 phút';
    const s = Math.round(sec);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  }

  // m:ss / h:mm:ss clock
  function fmtClock(sec) {
    if (sec === Infinity) return '∞';
    const s = Math.max(0, Math.round(sec));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }

  // position in the passage (seconds), media-player style: estimate of the sentences before the
  // current one + time already spent in the current sentence
  function readPosition(cur, total, left) {
    if (total === Infinity) return 0;
    let pos = total - left;
    if (player.playing && player.sentStartAt && cur >= 0) {
      const sentSec = left - estimateSeconds(cur + 1);
      pos += Math.min(sentSec, (performance.now() - player.sentStartAt) / 1000);
    }
    return pos;
  }

  function updateTimeEstimate() {
    if (!ui.time) return;
    positionSubtitle(); // the timeline shows up once a passage is open
    if (!doc?.sentences.length) {
      ui.time.textContent = '';
      if (ui.pfill) ui.pfill.style.width = '0';
      return;
    }
    const cur = player.sentMarked >= 0 ? player.sentMarked : 0;
    const total = estimateSeconds(0);
    const left = estimateSeconds(cur);
    const pos = readPosition(player.sentMarked, total, left);
    const { wpm, measured } = currentWpm();
    const voiceName = useNeural()
      ? (NEURAL_VOICES[settings.accent].find(([id]) => id === neuralVoice())?.[1] || neuralVoice()).replace(/ — .*/, '')
      : currentVoice()?.name || 'giọng trình duyệt';
    ui.time.textContent = `${fmtClock(pos)} / ${fmtClock(total)}`;
    if (ui.pfill) ui.pfill.style.width = total === Infinity || !total ? '0' : `${Math.min(100, (pos / total) * 100)}%`;
    ui.time.title = [
      'Thời gian đọc (ước lượng)',
      `Đã đọc: ${fmtClock(pos)} · còn lại: ${fmtClock(Math.max(0, total - pos))} · cả đoạn: ${fmtClock(total)}`,
      `Giọng ${voiceName}: ~${Math.round(wpm)} từ/phút ở 1× ${measured ? '(đo từ lúc đọc thực tế)' : '(ước tính — sẽ chính xác hơn sau vài câu)'}`,
      `Tốc độ phát ${settings.rate}× → ~${Math.round(wpm * settings.rate)} từ/phút`,
      settings.repeat ? `Lặp mỗi câu ${settings.repeatTimes || '∞'} lần + khoảng nghỉ nói theo` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Click on the progress bar → jump to the sentence at that point of the (estimated) timeline
  function seekToFraction(frac) {
    if (!doc?.sentences.length) return;
    const total = estimateSeconds(0);
    if (!total || total === Infinity) return;
    const target = total * clamp(frac, 0, 1);
    let lo = 0;
    let hi = doc.sentences.length - 1;
    // estimateSeconds(i) decreases with i: find the last sentence whose start ≤ target
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (total - estimateSeconds(mid) <= target) lo = mid;
      else hi = mid - 1;
    }
    const first = doc.sentences[lo].first;
    if (player.playing) play(first);
    else setCurrent(first);
  }

  // End token of the chunk starting at `from`
  function chunkEnd(from, limit) {
    const s = doc.sentences[doc.tokens[from].sent];
    const base = doc.tokens[from].start;
    if (s.end - base <= limit) return s.last;
    let cut = -1;
    for (let k = from; k < s.last; k++) {
      if (doc.tokens[k].end - base > limit) break;
      const gap = doc.text.slice(doc.tokens[k].end, doc.tokens[k + 1].start);
      if (/[,;:—–]/.test(gap)) cut = k;
    }
    if (cut >= from) return cut;
    let k = from;
    while (k < s.last && doc.tokens[k + 1].end - base <= limit) k++;
    return k;
  }

  function chunkText(from, to) {
    const s = doc.sentences[doc.tokens[from].sent];
    const endChar = to === s.last ? s.end : doc.tokens[to + 1].start;
    return doc.text.slice(doc.tokens[from].start, endChar).trim();
  }

  function speakChunk(from) {
    if (settings.repeat) setShadowPhase('listen');
    if (useNeural()) speakNeural(from);
    else speakBrowser(from);
  }

  // After a chunk finished: next chunk, or shadowing pause / repeat at sentence end
  function afterChunk(from, to, gen) {
    const live = () => gen === player.gen && player.playing;
    if (!live()) return;
    clearTimers();
    const si = doc.tokens[from].sent;
    const s = doc.sentences[si];
    const next = () => {
      if (!live()) return;
      if (to + 1 < doc.tokens.length) speakChunk(to + 1);
      else finish();
    };
    if (to !== s.last || !settings.repeat) {
      if (to === s.last) player.sentStartAt = 0;
      next();
      return;
    }
    // shadowing: pause so the learner can repeat, then play the sentence again or move on
    if (player.rep.sent !== si) player.rep = { sent: si, count: 0 };
    player.rep.count++;
    const times = settings.repeatTimes || Infinity;
    const again = player.rep.count < times;
    const dur = player.sentStartAt ? performance.now() - player.sentStartAt : 2000;
    const gap = settings.shadowGap ? Math.min(20000, Math.max(800, dur * settings.shadowGap)) : 250;
    player.sentStartAt = 0;
    setShadow(si, `🎤 Đến lượt bạn — nói to theo câu này (lần ${player.rep.count}/${times === Infinity ? '∞' : times})`);
    setShadowPhase('speak', gap);
    player.timers.push(
      setTimeout(() => {
        if (!live()) return;
        setShadow(-1);
        if (again) speakChunk(s.first);
        else {
          player.rep = { sent: -1, count: 0 };
          next();
        }
      }, gap)
    );
  }

  function speakNeural(from) {
    const s = doc.sentences[doc.tokens[from].sent];
    const to = chunkEnd(from, MAX_NEURAL_CHARS);
    const say = chunkText(from, to);
    const base = doc.tokens[from].start;
    const gen = player.gen;
    const live = () => gen === player.gen;
    if (!player.sentStartAt || from === s.first) player.sentStartAt = 0;

    // the first sentence (nothing prefetched yet) can take a few seconds to synthesize
    let loading = false;
    const loadingTimer = setTimeout(() => {
      if (!live()) return;
      loading = true;
      status('Đang tải giọng đọc tự nhiên…');
    }, 500);
    synth(say).then(
      ({ buffer, words }) => {
        clearTimeout(loadingTimer);
        if (!live() || !player.playing) return;
        if (loading) status(docStats());
        learnWpm(neuralVoice(), countWords(from, to), buffer.duration, settings.rate);
        const t0 = performance.now();
        player.startedAt = t0;
        if (!player.sentStartAt) player.sentStartAt = t0;
        setCurrent(from);
        // word timings → token highlights
        let cursor = 0;
        for (const w of words) {
          const idx = say.indexOf(w.text, cursor);
          if (idx < 0) continue;
          cursor = idx + w.text.length;
          const tok = tokenAt(base + doc.text.slice(base).indexOf(say) + idx, from, to);
          player.timers.push(setTimeout(() => live() && setCurrent(tok), w.at / 1));
        }
        // lets the page (e.g. a demo recorder) know what is being spoken and when
        document.dispatchEvent(new CustomEvent('tuyewn-reader:speak', { detail: JSON.stringify({ text: say, voice: neuralVoice(), rate: settings.rate }) }));
        playBuffer(buffer, () => {
          if (live()) afterChunk(from, to, gen);
        });
        // prefetch the next chunk so there is no gap between sentences
        if (to + 1 < doc.tokens.length) {
          const nTo = chunkEnd(to + 1, MAX_NEURAL_CHARS);
          synth(chunkText(to + 1, nTo)).catch(() => {});
        }
      },
      (err) => {
        clearTimeout(loadingTimer);
        if (!live()) return;
        // fall back for a minute, then try the natural voice again
        player.neuralDownUntil = Date.now() + 60000;
        player.neuralError = err.message;
        const fb = currentVoice()?.name?.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '') || 'giọng trình duyệt';
        status(`Giọng tự nhiên tạm lỗi (${err.message}) — tự chuyển sang ${fb}, sẽ thử lại sau 1 phút`);
        speakBrowser(from);
      }
    );
  }

  function speakBrowser(from) {
    const s = doc.sentences[doc.tokens[from].sent];
    const to = chunkEnd(from, MAX_CHUNK_CHARS);
    const base = doc.tokens[from].start;
    const say = chunkText(from, to);
    const v = currentVoice();
    const gen = player.gen;
    const live = () => gen === player.gen;

    const u = new SpeechSynthesisUtterance(say);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = settings.accent === 'UK' ? 'en-GB' : 'en-US';
    u.rate = settings.rate;
    player.utter = u; // keep a reference: Chrome may GC the utterance and drop its events

    let gotBoundary = false;
    u.onstart = () => {
      if (!live()) return;
      player.startedAt = performance.now();
      if (from === s.first || !player.sentStartAt) player.sentStartAt = player.startedAt;
      setCurrent(from);
      if (v && player.noBoundary.has(v.name)) estimate(from, to, 0);
      else {
        player.timers.push(
          setTimeout(() => {
            if (live() && !gotBoundary) estimate(from, to, performance.now() - player.startedAt);
          }, 800)
        );
      }
    };
    u.onboundary = (e) => {
      if (!live() || (e.name && e.name !== 'word')) return;
      if (!gotBoundary) {
        gotBoundary = true;
        clearTimers();
        player.noBoundary.delete(v?.name);
      }
      setCurrent(tokenAt(base + e.charIndex, from, to));
    };
    u.onend = () => {
      if (!live()) return;
      if (!gotBoundary && v && say.length > 25) player.noBoundary.add(v.name);
      learnWpm(`browser:${v?.name || ''}`, countWords(from, to), (performance.now() - player.startedAt) / 1000, settings.rate);
      afterChunk(from, to, gen);
    };
    u.onerror = (e) => {
      if (!live() || e.error === 'interrupted' || e.error === 'canceled') return;
      clearTimers();
      player.playing = false;
      updatePlayBtn();
      status(`Lỗi đọc: ${e.error}`);
    };
    speechSynthesis.speak(u);
  }

  // Browser voice gives no word events → move the highlight on an estimated timeline
  function estimate(from, to, elapsed) {
    clearTimers();
    const cps = 14 * settings.rate; // ~150 wpm at 1×
    let acc = 0;
    let latest = from;
    for (let k = from; k <= to; k++) {
      const at = (acc / cps) * 1000 - elapsed;
      if (at <= 0) latest = k;
      else {
        const kk = k;
        player.timers.push(setTimeout(() => setCurrent(kk), at));
      }
      const t = doc.tokens[k];
      const gap = k < to ? doc.text.slice(t.end, doc.tokens[k + 1].start) : '';
      acc += t.end - t.start + 1 + (/[.!?]/.test(gap) ? 8 : /[,;:—–]/.test(gap) ? 4 : 0);
    }
    setCurrent(latest);
  }

  // One-off speech (a word, a selection, a summary), optionally in a specific accent
  function sayText(text, acc = settings.accent) {
    if (!text) return;
    if (player.playing) pause();
    else halt();
    const gen = player.gen;
    if (useNeural()) {
      audioCtx();
      const rate = Math.min(settings.rate, 1);
      synth(text, neuralVoice(acc), rate).then(
        ({ buffer }) => {
          if (gen !== player.gen) return;
          document.dispatchEvent(new CustomEvent('tuyewn-reader:speak', { detail: JSON.stringify({ text, voice: neuralVoice(acc), rate }) }));
          playBuffer(buffer, null);
        },
        () => gen === player.gen && sayBrowser(text, acc)
      );
      return;
    }
    sayBrowser(text, acc);
  }

  function sayBrowser(text, acc = settings.accent) {
    const v = currentVoice(acc);
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = Math.min(settings.rate, 1);
      player.utter = u;
      speechSynthesis.speak(u);
    }, 40);
  }

  // ---------------------------------------------------------------------------
  // Current word / sentence: panel + page highlight + word sheet
  // ---------------------------------------------------------------------------

  function markCurrent(i) {
    doc?.tokens[player.cur]?.el?.classList.remove('cur');
    player.cur = i;
    const t = doc?.tokens[i];
    const sent = t ? t.sent : -1;
    if (player.sentMarked !== sent) {
      doc?.sentences[player.sentMarked]?.el?.classList.remove('cur');
      doc?.sentences[sent]?.el?.classList.add('cur');
      player.sentMarked = sent;
      if (sent >= 0) scrollIntoPanel(doc.sentences[sent].el);
      ensureTranslated(sent);
      updateTimeEstimate();
      applyPageDim();
      if (ui.readView) applyViewClasses(); // focus mode starts once there is a position
    }
    t?.el?.classList.add('cur');
    updateSubtitle();
    if (ui.prog) ui.prog.textContent = doc?.sentences.length ? `câu ${t ? t.sent + 1 : 0}/${doc.sentences.length}` : '';
  }

  function scrollIntoPanel(el) {
    if (!el || settings.tab !== 'read') return;
    const view = ui.readView;
    const r = el.getBoundingClientRect();
    const vr = view.getBoundingClientRect();
    if (r.top < vr.top + 8 || r.bottom > vr.bottom - 8) view.scrollTop += r.top - vr.top - Math.min(80, vr.height / 4);
  }

  function setCurrent(i) {
    const t = doc?.tokens[i];
    if (!t) return;
    markCurrent(i);
    if (t.el && settings.tab === 'read') {
      const r = t.el.getBoundingClientRect();
      const vr = ui.readView.getBoundingClientRect();
      if (r.bottom > vr.bottom - 8) ui.readView.scrollTop += r.bottom - vr.bottom + vr.height / 3;
    }
    showCard(t);
    highlightPage(t);
    markViWord();
  }

  // --- the Vietnamese counterpart of the current word, best effort ---------------------------
  // Sentences are translated as a whole, so there is no word alignment. With Chrome's on-device
  // translator the sentence is translated again with the word in brackets ("… [games] …" →
  // "… [trò chơi] …"), and the bracketed part is looked for in the shown translation. Without it,
  // a content word's dictionary meanings are looked for instead. Nothing is marked when not found.
  const MARKABLE_TAGS = new Set(['noun', 'verb', 'adj', 'adv', 'num']);

  function projectWord(t) {
    doc.viProj ??= new Map();
    if (doc.viProj.has(t.i)) return;
    const tr = local.translator;
    if (!tr) return;
    const forDoc = doc;
    const s = doc.sentences[t.sent];
    const src = sentText(t.sent);
    const a = t.start - s.start;
    const b = t.end - s.start;
    doc.viProj.set(t.i, null); // pending
    tr.translate(`${src.slice(0, a)}[${src.slice(a, b)}]${src.slice(b)}`)
      .then((v) => {
        const i = v.indexOf('[');
        const j = v.indexOf(']', i + 1);
        const span = i >= 0 && j > i ? v.slice(i + 1, j).replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '') : '';
        forDoc.viProj.set(t.i, span ? { span, rel: i / v.length } : { span: '' });
      })
      .catch(() => forDoc.viProj.set(t.i, { span: '' }))
      .finally(() => doc === forDoc && doc.tokens[player.cur] === t && markViWord());
  }

  // The best whole-syllable occurrence of any candidate in text, preferring longer ones
  // and those near the expected relative position
  function findSpan(text, candidates, rel) {
    const low = viNorm(text);
    let best = null;
    for (const c of candidates) {
      for (let i = low.indexOf(c); i >= 0 && c; i = low.indexOf(c, i + 1)) {
        if (isWordChar(low[i - 1]) || isWordChar(low[i + c.length])) continue;
        const score = c.length - Math.abs(i / low.length - rel) * 12;
        if (!best || score > best.score) best = { start: i, end: i + c.length, score };
      }
    }
    return best;
  }
  const VI_FILLERS = new Set(['sự', 'việc', 'các', 'những', 'cái', 'một', 'được', 'bị', 'sẽ', 'đã', 'đang']);
  const viNorm = (s) => String(s || '').normalize('NFC').toLocaleLowerCase('vi');
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);

  function viCandidates(t) {
    const out = new Set();
    const add = (s) => {
      for (const part of viNorm(s).replace(/\(.*?\)/g, '').split(/[,;/]|\s+hoặc\s+/)) {
        const words = part.trim().split(/\s+/).filter(Boolean);
        // "sự cài đặt" also as "cài đặt"
        while (words.length > 1 && VI_FILLERS.has(words[0])) {
          out.add(words.join(' '));
          words.shift();
        }
        const v = words.join(' ');
        if (v.length >= 2 && !VI_FILLERS.has(v)) out.add(v);
      }
    };
    for (const key of new Set([t.key, t.lemma].filter(Boolean))) {
      add(viWord.get(key));
      const dict = viDict.get(key);
      add(dict?.trans);
      for (const p of dict?.pos || []) p.terms.slice(0, 8).forEach(add);
    }
    return [...out];
  }

  function viSpan(t, text) {
    if (!t?.key || !text) return null;
    if (local.translator) {
      const p = doc.viProj?.get(t.i);
      if (p === undefined) projectWord(t);
      return p?.span ? findSpan(text, [viNorm(p.span)], p.rel) : null;
    }
    if (!MARKABLE_TAGS.has(t.tag)) return null;
    const s = doc.sentences[t.sent];
    return findSpan(text, viCandidates(t), (t.start - s.start) / Math.max(1, s.end - s.start));
  }

  function renderVi(el, text, span) {
    if (!span) el.textContent = text;
    else el.replaceChildren(text.slice(0, span.start), h('mark', { class: 'vh' }, text.slice(span.start, span.end)), text.slice(span.end));
  }

  let viMarkedSent = -1;
  function markViWord() {
    if (!doc) return;
    const t = doc.tokens[player.cur];
    const si = t ? t.sent : -1;
    if (viMarkedSent >= 0 && viMarkedSent !== si) {
      const prev = doc.sentences[viMarkedSent];
      if (prev?.vnEl) prev.vnEl.textContent = viSent[viMarkedSent] || '';
    }
    viMarkedSent = si;
    if (si < 0) return;
    const text = (viSent[si] || '').normalize('NFC');
    const span = settings.viMark ? viSpan(t, text) : null;
    const s = doc.sentences[si];
    if (s.vnEl) renderVi(s.vnEl, text, span);
    if (ui.subVi && sub.sent === si) renderVi(ui.subVi, text, span);
  }

  function setShadow(si, label) {
    for (const el of ui.readView?.querySelectorAll('.sb.shadow') || []) el.classList.remove('shadow');
    if (HAS_HL) CSS.highlights.delete('tuyewn-speak');
    const s = doc?.sentences[si];
    if (!s?.el) return;
    s.el.dataset.shadow = label || '';
    s.el.classList.add('shadow');
    // the sentence to repeat turns orange on the page too
    const r = HAS_HL && doc.map ? pageRange(s.start, s.end) : null;
    if (r) {
      const hl = new Highlight(r);
      hl.priority = 3;
      CSS.highlights.set('tuyewn-speak', hl);
    }
  }

  // --- shadowing coach: 🎧 listen → 🎤 your turn (countdown), repeated N times ---------------

  function shadowCount() {
    const si = player.sentMarked;
    return si >= 0 && player.rep.sent === si ? player.rep.count : 0;
  }

  function beep() {
    if (!settings.shadowBeep) return;
    try {
      const ctx = audioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  // phase: 'idle' | 'listen' | 'speak'
  function setShadowPhase(phase, gapMs = 0) {
    const bar = ui.shadowBar;
    if (!bar) return;
    bar.hidden = !settings.repeat || settings.tab !== 'read' || !doc?.sentences.length;
    if (bar.hidden) return;
    const times = settings.repeatTimes || Infinity;
    const done = shadowCount(); // finished listens of the current sentence
    const round = phase === 'speak' ? done : Math.min(done + 1, times);
    bar.dataset.phase = phase;
    document.dispatchEvent(new CustomEvent('tuyewn-reader:shadow', { detail: JSON.stringify({ phase }) }));
    ui.shDots.replaceChildren(
      ...(times === Infinity
        ? [h('span', { class: 'n' }, `lần ${Math.max(round, 1)}`)]
        : Array.from({ length: times }, (_, i) => h('span', { class: `dot${i < round ? ' on' : ''}${i === round - 1 ? ' cur' : ''}` })))
    );
    ui.shDots.title = times === Infinity ? 'Lặp mãi' : `Lần ${Math.max(round, 1)}/${times}`;
    const simultaneous = !settings.shadowGap;
    ui.shMsg.textContent =
      phase === 'speak'
        ? simultaneous
          ? 'Chuẩn bị nghe lại…'
          : 'Đến lượt bạn! Nói to câu vừa nghe, bắt chước ngữ điệu.'
        : phase === 'listen'
          ? simultaneous
            ? 'Nói cùng lúc với giọng đọc (shadowing)'
            : 'Nghe kỹ: chú ý trọng âm, nối âm và ngữ điệu…'
          : 'Bấm ▶ để bắt đầu luyện nói theo từng câu';
    // countdown for the learner's turn
    const fill = ui.shCountFill;
    fill.style.transition = 'none';
    fill.style.width = phase === 'speak' && !simultaneous ? '100%' : '0';
    if (phase === 'speak' && !simultaneous) {
      void fill.offsetWidth; // restart the transition
      fill.style.transition = `width ${gapMs}ms linear`;
      fill.style.width = '0';
      beep();
    }
  }

  function pageRange(start, end) {
    const m = doc?.map;
    if (!m) return null;
    let a = start;
    let b = end - 1;
    while (a <= b && !m.nodes[a]) a++;
    while (b >= a && !m.nodes[b]) b--;
    if (a > b) return null;
    try {
      const r = new Range();
      r.setStart(m.nodes[a], m.offs[a]);
      r.setEnd(m.nodes[b], m.offs[b] + 1);
      return r;
    } catch {
      return null; // page DOM changed since capture
    }
  }

  function tokenPageRange(t) {
    if (!t || !doc?.map) return null;
    return t.pageRange || (t.pageRange = pageRange(t.start, t.end));
  }

  function rangeContainsPoint(range, x, y, pad = 0) {
    if (!range) return false;
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad) return true;
    }
    return false;
  }

  function pageTokenAtPoint(x, y) {
    if (!doc?.map) return null;
    const selection = doc.pageSelectionRange || (doc.pageSelectionRange = pageRange(0, doc.text.length));
    if (!rangeContainsPoint(selection, x, y)) return null;
    for (const t of doc.tokens) {
      if (!t.key) continue;
      const range = tokenPageRange(t);
      if (rangeContainsPoint(range, x, y, 1)) return t;
    }
    return null;
  }

  // --- quick look: hovering a word of the passage (while a sentence is in focus) shows its card ---

  const tip = { tok: null, showTimer: 0, hideTimer: 0, raf: 0, x: 0, y: 0 };

  // DOM caret → index in doc.text, through a lazily built node → char indexes map
  function pageCharIndex(node, offset) {
    const m = doc.map;
    if (!m.byNode) {
      m.byNode = new Map();
      m.nodes.forEach((n, i) => {
        if (!n) return;
        if (!m.byNode.has(n)) m.byNode.set(n, []);
        m.byNode.get(n).push(i);
      });
    }
    const list = m.byNode.get(node);
    if (!list) return -1;
    return list.find((i) => m.offs[i] === offset) ?? list.find((i) => m.offs[i] === offset - 1) ?? -1;
  }

  function hoverToken(x, y) {
    const c = caretAt(x, y);
    if (!c || c.node.nodeType !== Node.TEXT_NODE) return null;
    const ci = pageCharIndex(c.node, c.offset);
    if (ci < 0) return null;
    let lo = 0;
    let hi = doc.tokens.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = doc.tokens[mid];
      if (ci < t.start) hi = mid - 1;
      else if (ci >= t.end) lo = mid + 1;
      else return t.key && rangeContainsPoint(tokenPageRange(t), x, y, 1) ? t : null;
    }
    return null;
  }

  // The panel's magnifier cursor over the passage's words on the page (they open the word card on click).
  // A text range can't carry a cursor, so the element holding the hovered word gets a class for the time.
  let cursorEl = null;
  function setLookupCursor(el) {
    if (cursorEl === el) return;
    cursorEl?.classList.remove('tuyewn-lookup');
    cursorEl = el;
    if (!el) return;
    if (!document.getElementById('tuyewn-lookup-style')) {
      const st = document.createElement('style');
      st.id = 'tuyewn-lookup-style';
      st.textContent = `.tuyewn-lookup{cursor:${LOOKUP_CURSOR}!important}`;
      (document.head || document.documentElement).append(st);
    }
    el.classList.add('tuyewn-lookup');
  }

  function onPageHover(e) {
    if (!ui.tip || pick.step || e.buttons) return;
    if (e.composedPath().includes(ui.host)) {
      // reached the card: keep it, even if the way here crossed other words
      if (e.composedPath().includes(ui.tip)) {
        clearTimeout(tip.hideTimer);
        clearTimeout(tip.showTimer);
      }
      return;
    }
    tip.x = e.clientX;
    tip.y = e.clientY;
    if (!tip.raf) tip.raf = requestAnimationFrame(updateHover);
  }

  function updateHover() {
    tip.raf = 0;
    const word = doc?.map ? hoverToken(tip.x, tip.y) : null;
    setLookupCursor(word ? tokenPageRange(word)?.startContainer.parentElement : null);
    if (tip.lookup) return; // a looked-up word's card stays until closed
    // the quick-look card only while a sentence is in focus
    const t = word && settings.hoverCard && player.sentMarked >= 0 ? word : null;
    if (t && t === tip.tok) {
      clearTimeout(tip.hideTimer);
      return;
    }
    clearTimeout(tip.showTimer);
    // switching words while a card is open waits a little, so moving into the card doesn't swap it
    if (t) tip.showTimer = setTimeout(() => showTip(t), ui.tip.hidden ? 350 : 200);
    else if (!ui.tip.hidden) {
      clearTimeout(tip.hideTimer);
      tip.hideTimer = setTimeout(hideTip, 250);
    }
  }

  function showTip(t) {
    clearTimeout(tip.hideTimer);
    const r = tokenPageRange(t)?.getBoundingClientRect();
    if (!r || !r.width) return hideTip();
    tip.tok = t;
    if (!viDict.has(t.key)) scheduleDetail(t);
    ui.tip.classList.remove('full');
    ui.tip.replaceChildren(...wordCardNodes(t).filter(Boolean), h('div', { class: 'tip-ft' }, 'Bấm vào từ để chọn — chi tiết ở thẻ từ cuối panel'));
    placeTip(r);
  }

  // word, POS, short meaning, IPA US/UK with speakers, Vietnamese meanings, English definition;
  // full = everything the panel's word card has (sound-by-sound chips, pronunciation and dictionary links)
  function wordCardNodes(t, full = false) {
    const tg = TAG[t.tag] || TAG.other;
    const loading = detailLoading(t);
    const short = viWord.get(t.key) || viDict.get(t.key)?.trans || '';
    const vi = viNodes(t, t.tag);
    return [
      h(
        'div',
        { class: 'tip-hd' },
        h('b', { class: 'sh-word' }, t.text),
        tg.abbr || t.tag !== 'other' ? h('span', { class: 'c-pos', title: `${tg.label} — ${tg.vi}`, style: `--c:${tg.color}` }, tg.abbr || tg.label) : null,
        h('span', { class: 'tip-vi' }, short),
        loading ? h('span', { class: 'spin on', title: 'Đang tải thông tin từ…' }) : null
      ),
      ...(full ? ipaNodes(t) : ipaNodes(t).slice(0, 1)),
      h('div', { class: 'c-vi' }, ...(loading && !vi.length ? [loadingLine('Đang tải nghĩa tiếng Việt…')] : vi)),
      h('div', { class: 'c-def' }, ...enDefNodes(t, t.tag, full ? 2 : 1)),
      full && t.key ? linkGroups(() => t.key) : null,
    ];
  }

  // above the target (below if there is no room), kept clear of the panel
  function placeTip(r) {
    ui.tip.hidden = false;
    const w = ui.tip.offsetWidth;
    const ht = ui.tip.offsetHeight;
    const right = ui.panel && !ui.panel.hidden ? Math.min(innerWidth, ui.panel.getBoundingClientRect().left) - 8 : innerWidth - 8;
    let top = r.top - ht - 10;
    if (top < 8) top = Math.min(r.bottom + 10, innerHeight - ht - 8);
    ui.tip.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, right - w))}px`;
    ui.tip.style.top = `${Math.max(8, top)}px`;
  }

  function hideTip() {
    clearTimeout(tip.showTimer);
    clearTimeout(tip.hideTimer);
    tip.tok = null;
    if (tip.lookup && HAS_HL) CSS.highlights.delete('tuyewn-lookup');
    tip.lookup = null;
    if (ui.tip) {
      ui.tip.hidden = true;
      ui.tip.classList.remove('full');
    }
  }

  // --- "tra từ" from the context menu: a card for the selected word (or a translated phrase) -------

  const SINGLE_WORD_RE = /^\p{L}[\p{L}'’.-]*$/u;
  let shortcutKeys = null; // command → shortcut, from chrome://extensions/shortcuts

  async function lookupSelection(fallbackText) {
    await settingsReady;
    if (!ui.host?.isConnected) {
      // just the card: the panel stays closed until the user opens the reader
      buildUI();
      ui.panel.hidden = true;
      ui.pill.hidden = true;
      applyDock();
    }
    if (!shortcutKeys) send({ type: 'TR_SHORTCUTS' }).then((r) => (shortcutKeys = r?.keys || {}) && tip.lookup && renderLookup());
    const sel = window.getSelection();
    let range = sel?.rangeCount && !sel.isCollapsed && sel.toString().trim() ? sel.getRangeAt(0).cloneRange() : null;
    // text selected inside a text field is not part of the page selection
    const field = document.activeElement;
    const inField = !range && /^(INPUT|TEXTAREA)$/.test(field?.tagName) && field.selectionEnd > field.selectionStart;
    const text = ((range && sel.toString()) || (inField && field.value.slice(field.selectionStart, field.selectionEnd)) || fallbackText || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return false;
    let rect = range?.getBoundingClientRect() || (inField && field.getBoundingClientRect());
    if (!rect || (!rect.width && !rect.height)) rect = new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0);
    // keep the looked-up text marked while its card is open (the native selection would hide the mark)
    if (range && HAS_HL) {
      CSS.highlights.set('tuyewn-lookup', new Highlight(range));
      sel.removeAllRanges();
    }
    const t = SINGLE_WORD_RE.test(text) ? wordInContext(range, text) : null;
    const L = { text, t, rect, vi: '', viFailed: false };
    tip.tok = null;
    tip.lookup = L;
    renderLookup();
    const live = () => tip.lookup === L;
    if (t?.key) {
      const keys = [t.key, t.lemma].filter((k) => k && !entries.has(k));
      const jobs = [];
      if (keys.length) {
        jobs.push(
          send({ type: 'TR_LOOKUP', words: keys }).then(async (res) => {
            for (const k of keys) if (res?.entries && k in res.entries) entries.set(k, res.entries[k]);
            // an inflected form without its own IPA: try the word it is a form of
            const formOf = entries.get(t.key)?.formOf;
            if (formOf && !entries.has(formOf)) {
              const r2 = await send({ type: 'TR_LOOKUP', words: [formOf] });
              if (r2?.entries?.[formOf]) entries.set(formOf, r2.entries[formOf]);
            }
            if (live()) renderLookup();
          })
        );
      }
      if (!viWord.has(t.key)) {
        jobs.push(
          (async () => {
            const vi = await localTranslate([t.key]).catch(() => null);
            if (vi?.[0] && vi[0].toLowerCase() !== t.key) viWord.set(t.key, vi[0]);
            else {
              const r = await send({ type: 'TR_WORDS_VI', words: [t.key] });
              if (r?.vi?.[t.key]) viWord.set(t.key, r.vi[t.key]);
            }
            if (live()) renderLookup();
          })()
        );
      }
      if (!viDict.has(t.key)) {
        const p = fetchDetail(t.key);
        renderLookup(); // the meanings are now pending: spinner
        jobs.push(p.then(() => live() && renderLookup()));
      }
      await Promise.allSettled(jobs);
    } else {
      let vi = (await localTranslate([text]).catch(() => null))?.[0];
      if (!vi) {
        const r = await send({ type: 'TR_TRANSLATE', lines: [text] });
        vi = r?.vi?.[0] || '';
      }
      if (!live()) return true;
      L.vi = vi;
      L.viFailed = !vi;
      renderLookup();
    }
    return true;
  }

  // The selected word as a token, with its part of speech taken from the sentence around it
  function wordInContext(range, word) {
    const lower = word.toLowerCase();
    try {
      const block = range && blockOf(range.startContainer.parentElement || range.startContainer);
      const ctx = block?.textContent || '';
      if (block && ctx.length <= 5000) {
        const pre = document.createRange();
        pre.setStart(block, 0);
        pre.setEnd(range.startContainer, range.startOffset);
        const off = pre.toString().length;
        const tok = analyze(ctx, null).tokens.find((x) => x.start <= off + 1 && off < x.end && x.text.toLowerCase().includes(lower));
        if (tok?.key) return { ...tok, text: word };
      }
    } catch {}
    const tok = analyze(word, null).tokens[0];
    return tok?.key ? { ...tok, text: word } : { i: -1, text: word, key: lower, lemma: '', tag: 'other', sent: -1 };
  }

  function renderLookup() {
    const L = tip.lookup;
    if (!L) return;
    const x = h('button', { class: 'ic mini tip-x', title: 'Đóng (Esc)', 'aria-label': 'Đóng', onclick: hideTip }, icon('close'));
    let body;
    if (L.t) body = wordCardNodes(L.t, true);
    else {
      const say = h('button', { class: 'ic mini', title: 'Nghe', 'aria-label': 'Nghe', onclick: () => sayText(L.text) }, icon('speaker'));
      body = [
        h('div', { class: 'tip-hd' }, h('b', { class: 'tip-src' }, L.text.length > 160 ? `${L.text.slice(0, 160)}…` : L.text), say),
        L.vi
          ? h('div', { class: 'tip-tr' }, L.vi)
          : L.viFailed
            ? h('div', { class: 'loading-line' }, 'Không dịch được — thử lại sau')
            : loadingLine('Đang dịch…'),
      ];
    }
    const kbd = (k) => h('kbd', null, k);
    const quick = shortcutKeys?.['lookup-selection'];
    const help = h(
      'div',
      { class: 'tip-ft tip-keys' },
      h('span', null, kbd('1'), ' nghe giọng Mỹ'),
      h('span', null, kbd('2'), ' nghe giọng Anh'),
      h('span', null, kbd('Esc'), ' đóng'),
      L.t ? h('div', { class: 'tip-note' }, 'Đỏ = Anh-Mỹ, xanh = Anh-Anh. Rê chuột lên từng âm để xem cách đọc, bấm để xem video.') : null,
      quick ? h('div', { class: 'tip-note' }, 'Tra nhanh: bôi đen rồi bấm ', kbd(quick)) : null
    );
    ui.tip.replaceChildren(x, ...body.filter(Boolean), help);
    ui.tip.classList.add('full');
    placeTip(L.rect);
  }

  function onTipOutside(e) {
    if (!tip.lookup || ui.tip?.hidden) return;
    if (!e.composedPath().includes(ui.tip)) hideTip();
  }

  // In the looked-up card: 1 / 2 = hear it in the US / UK voice, Esc = close
  function onTipKey(e) {
    if (!ui.tip || ui.tip.hidden) return;
    if (e.key === 'Escape') return hideTip();
    const L = tip.lookup;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (!L || typing || e.ctrlKey || e.metaKey || e.altKey || (e.key !== '1' && e.key !== '2')) return;
    e.preventDefault();
    e.stopPropagation();
    sayText(L.t ? L.t.text : L.text, e.key === '1' ? 'US' : 'UK');
  }

  function onPageWordClick(e) {
    if (pick.step) return; // picking a reading region
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!ui.host?.isConnected || !doc?.map || e.composedPath().includes(ui.host)) return;
    const t = pageTokenAtPoint(e.clientX, e.clientY);
    if (!t) return;

    // A normal click inside the captured passage inspects that word instead of
    // following an underlying link or triggering the host page's click handler.
    e.preventDefault();
    e.stopImmediatePropagation();
    hideTip();
    if (player.playing) play(t.i);
    setCurrent(t.i);
  }

  function highlightPage(t) {
    if (!HAS_HL || !doc.map) return;
    const wr = tokenPageRange(t);
    const s = doc.sentences[t.sent];
    const sr = pageRange(s.start, s.end);
    if (sr) {
      const hs = new Highlight(sr);
      hs.priority = 1;
      CSS.highlights.set('tuyewn-sent', hs);
    }
    if (!wr) return;
    const hw = new Highlight(wr);
    hw.priority = 10;
    CSS.highlights.set('tuyewn-word', hw);

    // follow the reading position on the page, keeping it clear of the subtitle and timeline
    if (player.playing && performance.now() - player.lastScroll > 800) {
      const rect = wr.getBoundingClientRect();
      let topLimit = 60;
      let bottomLimit = innerHeight - (ui.tl && !ui.tl.hidden ? 56 : 60);
      const subBox = ui.sub && !ui.sub.hidden ? ui.sub.firstChild.getBoundingClientRect() : null;
      if (subBox) {
        if (subBox.top > innerHeight / 2) bottomLimit = Math.min(bottomLimit, subBox.top - 16);
        else topLimit = Math.max(topLimit, subBox.bottom + 16);
      }
      if (rect.height && (rect.top < topLimit || rect.bottom > bottomLimit)) {
        player.lastScroll = performance.now();
        scrollReadingPoint(wr.startContainer, rect.top);
      }
    }
  }

  function highlightPageSelection() {
    if (!HAS_HL || !doc?.map || !doc.text) return;
    const range = doc.pageSelectionRange || (doc.pageSelectionRange = pageRange(0, doc.text.length));
    if (!range) return;
    const highlight = new Highlight(range);
    highlight.priority = 0;
    CSS.highlights.set('tuyewn-selection', highlight);
  }

  function applyPageTagHighlights() {
    if (!HAS_HL) return;
    for (const tg of TAGS) {
      const name = `tuyewn-tag-${tg.key}`;
      if (!doc?.map || !settings.tagSel.includes(tg.key)) {
        CSS.highlights.delete(name);
        continue;
      }
      const hl = new Highlight();
      hl.priority = 5;
      for (const t of doc.tokens) {
        if (t.tag !== tg.key) continue;
        const r = tokenPageRange(t);
        if (r) hl.add(r);
      }
      CSS.highlights.set(name, hl);
    }
  }

  // ---------------------------------------------------------------------------
  // YouTube-style subtitle over the page: the Vietnamese translation of the sentence being read
  // (the English sentence itself is already highlighted on the page), centred at the bottom
  // ---------------------------------------------------------------------------

  const sub = { sent: -1, raf: 0 };

  // Bring a reading point (viewport y) to ~30% from the top — of the page, or of the scrollable
  // box it sits in (articles inside app-like layouts)
  function scrollReadingPoint(node, y) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        const box = el.getBoundingClientRect();
        el.scrollBy({ top: y - box.top - el.clientHeight * 0.3, behavior: 'smooth' });
        return;
      }
    }
    window.scrollBy({ top: y - innerHeight * 0.3, behavior: 'smooth' });
  }

  // The subtitle never jumps around. If it would cover the sentence being read: while playing,
  // the page scrolls that sentence up into the reading zone; otherwise (the user scrolled it
  // there) the subtitle turns see-through so the text underneath stays readable.
  function avoidSubtitleOverlap() {
    const box = ui.sub?.firstChild;
    const s = doc?.sentences[player.sentMarked];
    if (!box || ui.sub.hidden || !s || !doc.map) return;
    s.pageRange ??= pageRange(s.start, s.end);
    const rects = s.pageRange ? [...s.pageRange.getClientRects()] : [];
    if (!rects.length) return;
    const GAP = 12; // keep some breathing room between the sentence and the subtitle
    const b = box.getBoundingClientRect();
    const covered = rects.some((r) => r.bottom > b.top - GAP && r.top < b.bottom + GAP && r.right > b.left && r.left < b.right);
    if (covered && player.playing && performance.now() - player.lastScroll > 800) {
      player.lastScroll = performance.now();
      scrollReadingPoint(s.pageRange.startContainer, Math.min(...rects.map((r) => r.top)));
      return; // re-checked on the scroll events that follow
    }
    ui.sub.classList.toggle('see-through', covered);
  }

  function onPageScrollForSub() {
    if (sub.raf) return;
    sub.raf = requestAnimationFrame(() => {
      sub.raf = 0;
      avoidSubtitleOverlap();
    });
  }

  function updateSubtitle() {
    const box = ui.sub;
    if (!box) return;
    syncCcButtons();
    const si = player.sentMarked;
    const vi = viSent[si] || '';
    if (!settings.subtitles || si < 0 || !vi || STANDALONE) {
      box.hidden = true;
      sub.sent = -1;
      return;
    }
    if (sub.sent !== si) {
      sub.sent = si;
      ui.subVi.classList.remove('shown'); // "hide translation": blurred again for each new sentence
    }
    ui.subVi.textContent = vi;
    markViWord();
    ui.subVi.classList.toggle('blur', settings.hideTrans);
    box.hidden = false;
    positionSubtitle();
    avoidSubtitleOverlap();
  }

  function toggleSubtitles() {
    settings.subtitles = !settings.subtitles;
    saveSettings();
    updateSubtitle();
    if (!ui.menu?.hidden) renderMenu();
    status(settings.subtitles ? 'Phụ đề: bật' : 'Phụ đề: tắt — bấm CC để bật lại');
  }

  function syncCcButtons() {
    for (const b of [ui.ccBtn, ui.pillCc]) {
      if (!b) continue;
      b.classList.toggle('on', settings.subtitles);
      b.title = settings.subtitles ? 'Ẩn phụ đề tiếng Việt (C)' : 'Hiện phụ đề tiếng Việt kiểu YouTube (C)';
    }
  }

  // Lay out the page overlays over the part of the page the panel leaves visible:
  // the timeline pinned at the bottom, the subtitle above it (or at the top)
  function positionSubtitle() {
    if (!ui.sub || !ui.tl) return;
    const panelOpen = ui.panel && !ui.panel.hidden;
    const panelW = panelOpen ? ui.panel.getBoundingClientRect().width : 0;
    const areaW = Math.max(240, innerWidth - panelW);
    const showTl = settings.pageTimeline && !!doc?.sentences.length && !STANDALONE;
    ui.tl.hidden = !showTl;
    // compact, centred under the reading area; keeps clear of the minimized pill at the bottom-right
    const tlW = Math.max(220, Math.min(560, areaW - 32 - (panelOpen ? 0 : 300)));
    ui.tl.style.width = `${tlW}px`;
    ui.tl.style.left = `${Math.max(12, (areaW - tlW) / 2)}px`;
    ui.sub.style.left = '0px';
    ui.sub.style.width = `${areaW}px`;
    const top = settings.subPos === 'top';
    ui.sub.style.top = top ? '16px' : 'auto';
    ui.sub.style.bottom = top ? 'auto' : `${showTl ? 50 : 20}px`;
    ui.sub.style.setProperty('--sub-size', `${settings.subSize}px`);
    ui.sub.dataset.bg = settings.subBg;
  }

  // Focus mode on the page: once there is a reading position (playing or paused), the sentences
  // not read yet fade strongly and the ones already read fade lightly
  function applyPageDim() {
    if (!HAS_HL) return;
    const cur = player.sentMarked;
    if (!doc?.map || !settings.dimOthers || cur < 0) {
      CSS.highlights.delete('tuyewn-dim');
      CSS.highlights.delete('tuyewn-dim-read');
      return;
    }
    const ahead = new Highlight();
    const read = new Highlight();
    ahead.priority = read.priority = 2; // above the passage tint, below the current word
    doc.sentences.forEach((s, i) => {
      if (i === cur) return;
      s.pageRange ??= pageRange(s.start, s.end);
      if (s.pageRange) (i > cur ? ahead : read).add(s.pageRange);
    });
    CSS.highlights.set('tuyewn-dim', ahead);
    CSS.highlights.set('tuyewn-dim-read', read);
  }

  function clearPageHighlights() {
    if (!HAS_HL) return;
    CSS.highlights.delete('tuyewn-dim');
    CSS.highlights.delete('tuyewn-dim-read');
    CSS.highlights.delete('tuyewn-selection');
    CSS.highlights.delete('tuyewn-word');
    CSS.highlights.delete('tuyewn-sent');
    for (const tg of TAGS) CSS.highlights.delete(`tuyewn-tag-${tg.key}`);
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
    return el;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name]);
    svg.append(p);
    return svg;
  }

  const iconBtn = (name, title, onclick, cls = '') =>
    h('button', { class: `ic ${cls}`, title, 'aria-label': title, onclick }, icon(name));

  // Inline fallback used only if the manifest icon cannot be loaded.
  function logo() {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const svg = el('svg', { viewBox: '16 16 224 224', class: 'logo', role: 'img', 'aria-label': 'Tuyewn Reader' });
    svg.append(
      el('rect', { x: 16, y: 16, width: 224, height: 224, rx: 52, fill: '#102A43' }),
      el('rect', { x: 46, y: 82, width: 164, height: 78, rx: 18, fill: '#FFD400' }),
      el('path', { d: 'M109 102 157 121q12 7 0 14l-48 19Z', fill: '#102A43' }),
      el('rect', { x: 67, y: 174, width: 122, height: 10, rx: 5, fill: '#FF6D00' })
    );
    return svg;
  }

  // The extension's own icon (manifest "icons"); falls back to the vector mark if it can't load
  function brandIcon() {
    const icons = chrome.runtime.getManifest().icons || {};
    const path = icons['128'] || icons['48'] || icons['32'];
    if (!path) return logo();
    const img = h('img', { class: 'logo', src: chrome.runtime.getURL(path), alt: 'Tuyewn Reader', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(logo()), { once: true });
    return img;
  }

  // Two modes only: light / dark. The button shows the mode it switches to (☀ in dark, 🌙 in light).
  function applyTheme() {
    const dark = settings.theme === 'dark';
    for (const el of [ui.panel, ui.pill, ui.pickBanner, ui.tip]) el?.classList.toggle('t-dark', dark);
    if (ui.themeBtn) {
      ui.themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon'));
      ui.themeBtn.title = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
    }
  }

  function toggleTheme() {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      ui.panel.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  // "Look up" cursor for words: a magnifier in the logo colours (hotspot = lens centre);
  // falls back to the standard help cursor if the page blocks custom cursor images
  const LOOKUP_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      // white halo keeps it visible on dark backgrounds
      '<path d="M14.5 14.5 21 21" stroke="#fff" stroke-width="7" stroke-linecap="round"/>' +
      '<circle cx="9.5" cy="9.5" r="7" fill="#fff" stroke="#fff" stroke-width="4.4"/>' +
      '<path d="M14.5 14.5 21 21" stroke="#102A43" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M14.5 14.5 21 21" stroke="#FF6D00" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="9.5" cy="9.5" r="7" fill="#FFD400" stroke="#102A43" stroke-width="2.4"/>' +
      '</svg>'
  )}") 9 9, help`;

  // fonts with complete, readable IPA glyphs first (installed on most Windows/macOS/Android systems)
  const IPA_FONT = '"Charis SIL","Doulos SIL","Noto Sans","Segoe UI","Lucida Sans Unicode","Arial Unicode MS",system-ui,sans-serif';

  // Themes built on the logo palette: navy #102A43, highlight yellow #FFD400, underline orange #FF6D00
  // (the same yellow/orange marks the spoken word on the page)
  const THEMES = {
    light: {
      bg: '#ffffff', fg: '#1b2430', muted: '#5d6b7a', line: '#e2e7ed', soft: '#f3f6f9',
      accent: '#102A43', 'accent-fg': '#ffffff', link: '#1f5fa8',
      hl: '#FFD400', 'hl-fg': '#102A43', under: '#FF6D00',
      sent: '#fff8d6', 'sent-line': '#f2c200', vi: '#0d6e5f', shadow: 'rgba(16,42,67,.12)',
      uk: '#1f4e9c', us: '#c8102e', // dictionary convention: blue = British, red = American
    },
    dark: {
      bg: '#0f1c2b', fg: '#e8edf3', muted: '#93a3b5', line: '#243a52', soft: '#162739',
      accent: '#FFD400', 'accent-fg': '#102A43', link: '#8cc4ff',
      hl: '#FFD400', 'hl-fg': '#102A43', under: '#FF6D00',
      sent: 'rgba(255,212,0,.09)', 'sent-line': '#FFD400', vi: '#7fd6c3', shadow: 'rgba(0,0,0,.4)',
      uk: '#7fb2ff', us: '#ff7a8c',
    },
  };
  const themeVars = (t) => Object.entries(THEMES[t]).map(([k, v]) => `--${k}:${v}`).join(';');
  const THEME_CSS = `
.panel,.pill,.pick-banner,.wtip{${themeVars('light')};font:13px/1.45 ${FONT};color:var(--fg)}
.t-dark{${themeVars('dark')}}
`;

  const STYLE = `
:host{all:initial}
*{box-sizing:border-box}
${THEME_CSS}
a{color:var(--link)}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;border-radius:6px;padding:0}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
select{font:inherit;font-size:12px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:4px 6px;min-width:0}

/* panel docked to the right edge */
.panel{position:fixed;top:0;right:0;bottom:0;width:420px;display:flex;flex-direction:column;background:var(--bg);
  border-left:1px solid var(--line);box-shadow:-10px 0 30px var(--shadow);z-index:2147483647}
.panel[hidden]{display:none}
.panel.standalone{position:static;width:100vw!important;height:100vh;border:0;box-shadow:none}
.resizer{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:3}
.resizer:hover,.resizer.drag{background:linear-gradient(90deg,transparent 3px,var(--accent) 3px,var(--accent) 5px,transparent 5px)}
.standalone .resizer,.standalone .min-btn{display:none}

.ic{display:inline-grid;place-items:center;width:30px;height:30px;color:var(--muted);flex:none}
.ic:hover{background:var(--soft);color:var(--fg)}
.ic.on{color:var(--accent);background:var(--sent)}
.ic svg{width:17px;height:17px}
.ic.mini{width:22px;height:22px;vertical-align:-6px;margin-left:2px}
.ic.mini svg{width:14px;height:14px}

.hd{display:flex;align-items:center;gap:4px;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line)}
.brand{flex:1;display:flex;align-items:center;min-width:0}
.logo{display:block;width:30px;height:30px;flex:none;border-radius:7px;object-fit:contain}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex:none;margin-right:4px}
.seg button{padding:4px 10px;font-size:12px;font-weight:700;color:var(--muted);border-radius:0}
.seg button.on{background:var(--accent);color:var(--accent-fg)}

.toolbar{position:relative;display:flex;align-items:center;gap:2px;padding:8px 10px;border-bottom:1px solid var(--line)}
.play{width:40px;height:40px;border-radius:50%;background:var(--accent);color:var(--accent-fg);display:grid;place-items:center;margin:0 2px;flex:none}
.play svg{width:20px;height:20px}
.rep{position:relative}
.rep .badge{position:absolute;right:1px;bottom:1px;min-width:13px;height:13px;padding:0 2px;border-radius:7px;background:var(--accent);
  color:var(--accent-fg);font-size:9px;font-weight:700;line-height:13px;display:none}
.rep.on .badge{display:block}
.speed{margin-left:6px;font-variant-numeric:tabular-nums;font-weight:600}
.aa{width:auto;padding:0 8px;font-weight:800;font-size:13px;letter-spacing:-.02em}
/* reading timeline pinned on the page (YouTube-style) */
.tl{position:fixed;bottom:10px;display:flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 4px;border-radius:999px;
  background:rgba(8,12,18,.72);color:#fff;font:600 12px/1 ${FONT};box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:2147483646;
  opacity:.6;transition:opacity .2s}
.tl:hover{opacity:1}
.tl[hidden]{display:none}
.tl-btn{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;color:#fff;flex:none}
.tl-btn:hover{background:rgba(255,255,255,.15)}
.tl-btn svg{width:15px;height:15px}
.tl-time{font-variant-numeric:tabular-nums;white-space:nowrap;cursor:help}
.tl-bar{flex:1;min-width:60px;height:20px;display:flex;align-items:center;cursor:pointer}
.tl-track{position:relative;width:100%;height:3px;border-radius:2px;background:rgba(255,255,255,.25);transition:height .12s}
.tl:hover .tl-track{height:5px}
.tl-fill{position:relative;height:100%;width:0;border-radius:inherit;background:#FFD400;transition:width .3s linear}
.tl-fill::after{content:'';position:absolute;right:-5px;top:50%;width:10px;height:10px;margin-top:-5px;border-radius:50%;background:#FFD400;
  opacity:0;transition:opacity .15s}
.tl:hover .tl-fill::after{opacity:1}
.tl-sent{color:rgba(255,255,255,.7);font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}

.menu{position:absolute;top:calc(100% + 4px);right:8px;width:310px;max-height:70vh;overflow:auto;background:var(--bg);border:1px solid var(--line);
  border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.22);padding:12px 14px;z-index:6}
.menu[hidden]{display:none}
.menu h5{margin:14px 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.menu h5:first-child{margin-top:0}
.opt{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer}
.opt input{accent-color:var(--accent);margin:0;flex:none}
.sub{font-size:12px;color:var(--muted);margin:6px 0 4px}
.pills{display:flex;flex-wrap:wrap;gap:4px}
.pills button{padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px}
.pills button.on{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
.fs{display:flex;align-items:center;gap:6px}
.fs b{min-width:22px;text-align:center}

.tabs{display:flex;padding:0 8px;border-bottom:1px solid var(--line)}
.tabs button{flex:1;padding:9px 6px;color:var(--muted);font-weight:600;border-radius:0;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button.on{color:var(--fg);border-bottom-color:var(--accent)}

.view{flex:1;min-height:0;overflow:auto;padding:12px 14px 18px}
.view[hidden]{display:none}

/* reading: one block per sentence */
.read-view{font-size:var(--fs,16px);line-height:1.7;padding:10px 8px 40px}
.sb{position:relative;padding:6px 34px 6px 12px;margin:2px 0;border-left:3px solid transparent;border-radius:0 10px 10px 0}
.sb.para{margin-top:16px}
.sb.cur{background:var(--sent);border-left-color:var(--sent-line)}
.read-view.focus .sb{opacity:.5;transition:opacity .25s}
.read-view.focus .sb.cur{opacity:1}
.read-view.focus .sb.cur ~ .sb{opacity:.28}
.read-view.focus .sb:hover{opacity:.85}
.sb .en{overflow-wrap:break-word}
.sb .vn{display:none;margin-top:5px;font-size:.88em;line-height:1.55;color:var(--vi)}
.bilingual .sb .vn,.sb.cur .vn{display:block}
.sb .vn:empty{display:none!important}
mark.vh{background:color-mix(in srgb,var(--hl) 40%,transparent);color:inherit;border-radius:3px;box-shadow:0 1px 0 var(--under)}
.sub-vi mark.vh{background:rgba(255,212,0,.3);color:#fff;border-radius:3px;box-shadow:0 2px 0 #FF6D00}
.hide-trans .vn:not(.shown){filter:blur(5px);cursor:pointer;user-select:none}
.hide-trans .sb.cur .vn:not(.shown)::after{content:''}
.sb-play{position:absolute;right:4px;top:5px;opacity:0;transition:opacity .15s}
.sb:hover .sb-play,.sb.cur .sb-play{opacity:1}
.sb.shadow{border-left-color:var(--under);background:color-mix(in srgb,var(--under) 13%,transparent);animation:tr-pulse 1.4s ease-in-out infinite}
.sb.shadow::after{content:attr(data-shadow);display:block;margin-top:8px;font-size:13px;font-weight:700;color:var(--under)}
@keyframes tr-pulse{50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--under) 28%,transparent)}}
@media (prefers-reduced-motion:reduce){.sb.shadow{animation:none}}

/* shadowing coach */
.shadow-bar{padding:8px 12px 0;border-bottom:1px solid var(--line);background:var(--soft)}
.shadow-bar[hidden]{display:none}
.sb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.shadow-bar .step{padding:3px 10px;border-radius:999px;font-weight:700;font-size:12.5px;color:var(--muted);border:1px solid var(--line);background:var(--bg)}
.shadow-bar .arrow{color:var(--muted)}
.shadow-bar[data-phase="listen"] .step.listen{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.shadow-bar[data-phase="speak"] .step.speak{background:var(--under);color:#fff;border-color:var(--under);animation:tr-pulse 1.4s ease-in-out infinite}
.shadow-bar .dots{display:inline-flex;gap:4px;margin-left:4px;align-items:center}
.shadow-bar .dot{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--muted)}
.shadow-bar .dot.on{background:var(--muted)}
.shadow-bar .dot.cur{background:var(--accent);border-color:var(--accent)}
.shadow-bar[data-phase="speak"] .dot.cur{background:var(--under);border-color:var(--under)}
.shadow-bar .dots .n{font-size:12px;color:var(--muted)}
.sb-btns{margin-left:auto;display:flex;gap:4px}
.sb-msg{margin:6px 0 6px;font-size:13px;font-weight:600;color:var(--fg)}
.shadow-bar[data-phase="speak"] .sb-msg{color:var(--under);font-size:14px}
.countdown{height:4px;margin:0 -12px;background:transparent}
.countdown .fill{height:100%;width:0;background:var(--under)}
.w{border-radius:4px;cursor:${LOOKUP_CURSOR}}
.w:hover{background:var(--line)}
.ipa,.wvi{display:none;user-select:none;white-space:nowrap}
.ipa{font-size:.66em;line-height:1.3;color:var(--muted);font-family:${IPA_FONT}}
.ipa.approx{font-style:italic;opacity:.7}
.wvi{font-size:.64em;line-height:1.3;color:var(--vi);max-width:9em;overflow:hidden;text-overflow:ellipsis}
.show-ipa .w,.show-vi .w{display:inline-flex;flex-direction:column;align-items:center;vertical-align:top;line-height:1.35;margin-bottom:6px}
.show-ipa .ipa,.show-vi .wvi{display:block}

/* word sheet (bottom) */
.sheet{border-top:1px solid var(--line);background:var(--soft)}
.sheet[hidden]{display:none}
.sh-line{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 14px;cursor:pointer;min-height:48px}
.sh-word{font-weight:700;font-size:15px;white-space:nowrap}
.sh-ipa{color:var(--muted);font-family:${IPA_FONT};white-space:nowrap}
.sh-vi{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vi);font-weight:600}
.sh-more{padding:0 14px 12px;max-height:42vh;overflow:auto}
.sheet:not(.open) .sh-more{display:none}
.spin{display:none;width:14px;height:14px;flex:none;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:tr-spin .8s linear infinite}
.sheet.loading .sh-line .spin,.spin.on,.loading-line .spin{display:inline-block}
.loading-line{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12.5px;color:var(--muted)}
@keyframes tr-spin{to{transform:rotate(360deg)}}
/* quick-look card on the page */
.wtip{position:fixed;z-index:2147483647;width:max-content;max-width:min(380px,calc(100vw - 16px));max-height:min(320px,60vh);overflow:auto;padding:10px 12px 8px;
  background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px var(--shadow),0 2px 6px rgba(0,0,0,.12)}
.wtip[hidden]{display:none}
.wtip.full{width:400px;max-height:min(560px,calc(100vh - 16px))}
.tip-hd{display:flex;align-items:center;gap:8px;margin-bottom:4px;min-width:200px}
.tip-vi{color:var(--vi);font-weight:600}
.wtip .ipa-line{font-size:16px}
.tip-ft{margin-top:6px;font-size:11px;color:var(--muted)}
.wtip .tip-x{float:right;margin:-4px -6px 0 8px}
.tip-keys{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}
.tip-note{width:100%;line-height:1.5}
.wtip kbd{display:inline-block;min-width:18px;padding:0 5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;
  background:var(--soft);color:var(--fg);font:600 11px/16px ${FONT};text-align:center}
/* accent captions in the cards */
.wtip .ipa-line::before{width:22px;flex:none;font:700 10px/1 ${FONT};letter-spacing:.04em}
.wtip .ipa-line.us::before{content:'US';color:var(--us)}
.wtip .ipa-line.uk::before{content:'UK';color:var(--uk)}
.tip-src{font-weight:600;font-size:14px;line-height:1.45}
.tip-tr{margin-top:6px;font-size:15px;line-height:1.5;font-weight:600;color:var(--vi)}
.c-pos{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;color:var(--c);border:1px solid var(--c);white-space:nowrap;flex:none}
.c-ipa{font-family:${IPA_FONT}}
.ipa-p{font-family:${IPA_FONT};white-space:nowrap}
.ipa-lines{display:flex;flex-direction:column;gap:2px}
.ipa-line{display:flex;align-items:center;gap:6px;font-size:17px;color:var(--fg)}
.ipa-line .ipa-p{white-space:normal}
.ipa-line .spk{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;flex:none}
.ipa-line .spk svg{width:20px;height:20px}
.ipa-line .spk:hover{background:var(--soft)}
.ipa-line.uk .spk{color:var(--uk)}
.ipa-line.us .spk{color:var(--us)}
.ipa-none{color:var(--muted)}
.sh-ipa .ipa-p{font-size:14px}
.phon{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:8px}
.ph{min-width:30px;padding:3px 7px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);
  font-family:${IPA_FONT};font-size:15px;line-height:1.3;text-align:center}
.ph.v{background:var(--sent);border-color:var(--sent-line)}
button.ph:hover{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.ph.st{border:0;background:none;min-width:0;padding:0 1px;color:var(--under);font-size:17px}
.ph.sep{border:0;background:none;min-width:6px;padding:0}
.ph.chart{font-family:${FONT};font-size:11.5px;color:var(--muted);border-style:dashed;margin-left:4px}
.links{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:10px}
.links .lbl{width:100%;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-top:4px}
.btn.sm{padding:4px 9px;font-size:12px;border-radius:7px}
.c-vi{margin-top:6px;font-size:13.5px}
.c-vi > b{font-size:10px;font-weight:700;margin-right:6px;color:var(--muted)}
.c-vi .short{color:var(--vi);font-weight:600}
.terms{margin-top:2px;font-size:12px;color:var(--muted)}
.terms i,.c-def i{font-style:normal;font-weight:700;color:var(--fg);margin-right:4px}
.c-def{margin-top:6px;color:var(--muted);font-size:12.5px}
.src{font-size:11px;color:var(--muted);margin-top:3px}
.sh-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}

.offer{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--sent);border-bottom:1px solid var(--line);font-size:12px;line-height:1.45}
.offer[hidden]{display:none}
.offer .btn{flex:none}
.ft{padding:4px 14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:22px}

/* minimized pill */
/* YouTube-style subtitle over the page */
.subs{position:fixed;bottom:36px;display:flex;justify-content:center;pointer-events:none;z-index:2147483646}
.subs[hidden]{display:none}
.sub-box{max-width:min(860px,88%);padding:8px 16px 10px;border-radius:8px;background:rgba(8,12,18,.82);color:#fff;text-align:center;
  font:500 15px/1.45 ${FONT};box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:auto}
.sub-box{position:relative;transition:opacity .25s}
/* the sentence being read is underneath (user scrolled it there): let it show through */
.subs.see-through .sub-box{opacity:.18}
.subs.see-through .sub-box:hover{opacity:1}
.sub-vi{color:#fff;font-size:var(--sub-size,16px);font-weight:600;line-height:1.4;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.subs[data-bg="dim"] .sub-box{background:rgba(8,12,18,.5)}
.subs[data-bg="none"] .sub-box{background:transparent;box-shadow:none}
.subs[data-bg="none"] .sub-vi{text-shadow:0 0 3px #000,0 0 3px #000,0 1px 5px #000}
.sub-x{position:absolute;top:-10px;right:-10px;width:24px;height:24px;border-radius:50%;background:#1b2430;color:#fff;border:1px solid rgba(255,255,255,.3);
  font:700 15px/1 ${FONT};opacity:0;transition:opacity .15s}
.sub-box:hover .sub-x,.sub-x:focus-visible{opacity:1}
.ic.cc.on{color:var(--accent);background:var(--sent)}
.sub-vi.blur:not(.shown){filter:blur(6px);cursor:pointer}
.pick-banner{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;
  background:var(--accent);color:var(--accent-fg);border-radius:999px;box-shadow:0 10px 30px var(--shadow);font-weight:600;font-size:14px;z-index:2147483647}
.pick-banner .btn{background:var(--bg);color:var(--fg);border-color:transparent}
.pill{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:4px;padding:4px 12px 4px 4px;background:var(--bg);
  border:1px solid var(--line);border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:2147483647}
.pill[hidden]{display:none}
.pill .play{width:34px;height:34px}
.pill .open{display:grid;place-items:center;padding:2px}
.pill .logo{width:30px;height:30px}

/* shared bits */
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;white-space:nowrap}
.btn:hover{background:var(--soft)}
.btn svg{width:14px;height:14px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
.btn[disabled]{opacity:.55;cursor:default}
.linkbtn{color:var(--accent);text-decoration:underline}
.vtools{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;padding:2px 0 6px}
.note{color:var(--muted);padding:20px 0;text-align:center}
.note-box{padding:12px;border:1px dashed var(--line);border-radius:10px;font-size:13px;line-height:1.6}
.err{margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.12);color:#ef4444;font-size:12.5px}
.warn{margin:8px 0;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,.14);font-size:12px;line-height:1.5}
.hint{font-size:11.5px;color:var(--muted)}
.row{display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap}
.inp{flex:1;min-width:0;font:inherit;font-size:12.5px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.section h4{margin:16px 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.section h4:first-child{margin-top:2px}
.section select{flex:1}

/* chips */
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--muted)}
.chip .dot{width:8px;height:8px;border-radius:50%;background:var(--c)}
.chip small{font-size:10.5px;opacity:.8}
.chip.on{color:var(--fg);border-color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent)}
.chip.all{font-weight:600}

/* vocabulary */
.vocab-view .chips{margin-bottom:8px}
.vg h4{display:flex;align-items:center;gap:6px;margin:14px 0 4px;font-size:12px;font-weight:700}
.vg h4 .dot{width:9px;height:9px;border-radius:50%;background:var(--c)}
.vg h4 small{font-weight:400;color:var(--muted)}
.vr{display:grid;grid-template-columns:minmax(70px,1fr) minmax(80px,1.3fr) 34px 28px;align-items:center;gap:2px 8px;padding:4px 4px 4px 8px;border-radius:8px;cursor:pointer}
.vr:hover{background:var(--soft)}
.vw{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vi{color:var(--muted);font-family:${IPA_FONT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc{font-size:11px;color:var(--muted);text-align:right}
.vv{grid-column:1 / 3;font-size:12px;color:var(--vi);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* summary */
.sum-block{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.sum-block h4{display:flex;align-items:center;gap:2px;margin:0 0 6px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.sum-block p{margin:0;font-size:14px;line-height:1.6}
.sum-block ul{margin:8px 0 0;padding-left:18px;font-size:13.5px;line-height:1.55}
.src-list{margin:0;padding-left:16px;font-size:12.5px;line-height:1.55}
.src-list li{margin-bottom:4px}

`;

  // Tag colouring rules + current-word rule last so it always wins
  const TAG_STYLE =
    TAGS.map((t) => `.read-view.sel-${t.key} .t-${t.key}{background:${t.color}2e;box-shadow:inset 0 -2px 0 ${t.color}}`).join('\n') +
    '\n.read-view .w.cur{background:var(--hl);color:var(--hl-fg);box-shadow:inset 0 -3px 0 var(--under)}' +
    '\n.read-view .w.cur .ipa,.read-view .w.cur .wvi{color:var(--hl-fg);opacity:.8}';

  // ---------------------------------------------------------------------------
  // Build UI
  // ---------------------------------------------------------------------------

  function buildUI() {
    const host = document.createElement('tuyewn-reader');
    host.style.cssText = 'all:initial';
    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE + TAG_STYLE);
    root.adoptedStyleSheets = [sheet];
    ui.host = host;
    ui.root = root;

    // header
    ui.accentBtns = ['US', 'UK'].map((acc) =>
      h('button', { 'data-acc': acc, title: acc === 'US' ? 'Giọng & IPA Anh-Mỹ' : 'Giọng & IPA Anh-Anh', onclick: () => setAccent(acc) }, acc)
    );
    ui.gearBtn = iconBtn('gear', 'Cài đặt & nguồn dữ liệu', () => setTab(settings.tab === 'settings' ? 'read' : 'settings'));
    const header = h(
      'header',
      { class: 'hd' },
      h('div', { class: 'brand', title: 'Tuyewn Reader' }, brandIcon()),
      h('div', { class: 'seg' }, ui.accentBtns),
      (ui.themeBtn = iconBtn('moon', 'Đổi giao diện sáng / tối', toggleTheme)),
      ui.gearBtn,
      iconBtn('min', 'Thu nhỏ', () => setMinimized(true), 'min-btn'),
      iconBtn('close', 'Đóng', close)
    );

    // toolbar
    ui.playBtn = h('button', { class: 'play', title: 'Phát / Tạm dừng (Space)', onclick: togglePlay }, icon('play'));
    ui.repBtn = h(
      'button',
      { class: 'ic rep', title: 'Lặp câu để luyện nói theo (R)', onclick: () => toggleRepeat() },
      icon('repeat'),
      (ui.repBadge = h('span', { class: 'badge' }))
    );
    ui.speedSel = h('select', { class: 'speed', title: 'Tốc độ đọc', 'aria-label': 'Tốc độ đọc' });
    ui.speedSel.addEventListener('change', () => {
      settings.rate = Number(ui.speedSel.value);
      saveSettings();
      updateTimeEstimate();
      if (player.playing) play(player.cur);
    });
    ui.aaBtn = h('button', { class: 'ic aa', title: 'Tùy chọn hiển thị & luyện tập', onclick: toggleMenu }, 'Aa');
    ui.menu = h('div', { class: 'menu', hidden: true });
    const toolbar = h(
      'div',
      { class: 'toolbar' },
      iconBtn('prev', 'Câu trước (←)', () => jumpSentence(-1)),
      ui.playBtn,
      iconBtn('next', 'Câu sau (→)', () => jumpSentence(1)),
      ui.repBtn,
      (ui.ccBtn = iconBtn('cc', 'Phụ đề', toggleSubtitles, 'cc')),
      ui.speedSel,
      ui.aaBtn,
      ui.menu
    );

    // tabs
    ui.tabBtns = [
      h('button', { 'data-tab': 'read', onclick: () => setTab('read') }, 'Đọc'),
      h('button', { 'data-tab': 'vocab', onclick: () => setTab('vocab') }, 'Từ vựng'),
      h('button', { 'data-tab': 'sum', onclick: () => setTab('sum') }, 'Tóm tắt'),
    ];
    const tabs = h('div', { class: 'tabs' }, ui.tabBtns);

    // views
    ui.readView = h('div', { class: 'view read-view' });
    ui.readView.addEventListener('mouseup', onPanelWordSelection);
    ui.readView.addEventListener('click', onReadClick);
    ui.readView.addEventListener('dblclick', (e) => {
      const w = e.target.closest?.('.w');
      if (w) play(Number(w.dataset.i));
    });
    ui.vocabView = h('div', { class: 'view vocab-view', hidden: true });
    ui.sumView = h('div', { class: 'view sum-view', hidden: true });
    ui.settingsView = h('div', { class: 'view section', hidden: true });

    // word sheet
    ui.shWord = h('span', { class: 'sh-word' });
    ui.shIpa = h('span', { class: 'sh-ipa' });
    ui.shPos = h('span', { class: 'c-pos' });
    ui.shVi = h('span', { class: 'sh-vi' });
    ui.shLoad = h('span', { class: 'spin', title: 'Đang tải thông tin từ…' });
    ui.shSay = iconBtn('speaker', 'Phát âm từ này', (e) => {
      e.stopPropagation();
      sayCardWord();
    });
    ui.shToggle = iconBtn('up', 'Xem chi tiết', (e) => {
      e.stopPropagation();
      setSheetOpen(!sheetOpen);
    });
    ui.cIpa = h('div', { class: 'c-ipa' });
    ui.cVi = h('div', { class: 'c-vi' });
    ui.cDef = h('div', { class: 'c-def' });
    ui.sheet = h(
      'div',
      { class: 'sheet', hidden: true },
      h('div', { class: 'sh-line', onclick: () => setSheetOpen(!sheetOpen) }, ui.shWord, ui.shIpa, ui.shPos, ui.shVi, ui.shLoad, ui.shSay, ui.shToggle),
      h(
        'div',
        { class: 'sh-more' },
        ui.cIpa,
        ui.cVi,
        ui.cDef,
        linkGroups(() => cardTok?.key),
        h(
          'div',
          { class: 'sh-actions' },
          h('button', { class: 'btn', onclick: () => cardTok && play(cardTok.i) }, icon('from'), 'Đọc từ đây'),
          h('button', { class: 'btn', onclick: () => cardTok && play(doc.sentences[cardTok.sent].first) }, icon('play'), 'Đọc cả câu')
        )
      )
    );

    ui.status = h('div', { class: 'ft' });

    ui.panel = h(
      'div',
      { class: `panel${STANDALONE ? ' standalone' : ''}`, role: 'complementary', 'aria-label': 'Tuyewn Reader' },
      (ui.resizer = h('div', { class: 'resizer', title: 'Kéo để đổi độ rộng' })),
      header,
      toolbar,
      tabs,
      (ui.shadowBar = h(
        'div',
        { class: 'shadow-bar', hidden: true, 'data-phase': 'idle', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { class: 'sb-row' },
          h('span', { class: 'step listen' }, '🎧 Nghe'),
          h('span', { class: 'arrow' }, '→'),
          h('span', { class: 'step speak' }, '🎤 Nói theo'),
          (ui.shDots = h('span', { class: 'dots' })),
          h(
            'span',
            { class: 'sb-btns' },
            h('button', { class: 'btn sm', title: 'Nghe lại câu này', onclick: replaySentence }, '↻ Nghe lại'),
            h('button', { class: 'btn sm', title: 'Sang câu tiếp theo', onclick: () => jumpSentence(1) }, 'Câu tiếp ⏭')
          )
        ),
        (ui.shMsg = h('div', { class: 'sb-msg' })),
        h('div', { class: 'countdown' }, (ui.shCountFill = h('div', { class: 'fill' })))
      )),
      (ui.offer = h(
        'div',
        { class: 'offer', hidden: true },
        h('span', null, 'Bật dịch trên máy của Chrome: miễn phí, không giới hạn, không bị chặn như dịch online. Chrome tải gói Anh–Việt 1 lần.'),
        h('button', { class: 'btn primary sm', onclick: enableLocal }, 'Bật')
      )),
      ui.readView,
      ui.vocabView,
      ui.sumView,
      ui.settingsView,
      ui.sheet,
      ui.status
    );

    // minimized pill
    ui.pillPlay = h('button', { class: 'play', title: 'Phát / Tạm dừng', onclick: togglePlay }, icon('play'));
    ui.pill = h(
      'div',
      { class: 'pill', hidden: true },
      ui.pillPlay,
      (ui.pillCc = iconBtn('cc', 'Phụ đề', toggleSubtitles, 'cc')),
      h('button', { class: 'open', title: 'Mở lại Tuyewn Reader', onclick: () => setMinimized(false) }, brandIcon())
    );

    ui.subVi = h('div', { class: 'sub-vi', title: 'Bản dịch câu đang đọc' });
    ui.subVi.addEventListener('click', () => ui.subVi.classList.add('shown')); // reveal when "hide translation" is on
    ui.sub = h(
      'div',
      { class: 'subs', hidden: true },
      h(
        'div',
        { class: 'sub-box' },
        ui.subVi,
        h('button', { class: 'sub-x', title: 'Ẩn phụ đề (bật lại bằng nút CC)', 'aria-label': 'Ẩn phụ đề', onclick: toggleSubtitles }, '×')
      )
    );
    // reading timeline pinned on the page (YouTube-style controls), outside the panel
    ui.tlPlay = h('button', { class: 'tl-btn', title: 'Phát / Tạm dừng', onclick: togglePlay }, icon('play'));
    ui.time = h('span', { class: 'tl-time' });
    ui.pfill = h('div', { class: 'tl-fill' });
    ui.pbar = h(
      'div',
      {
        class: 'tl-bar',
        title: 'Tiến độ đọc — bấm để nhảy tới vị trí đó',
        onclick: (e) => {
          const r = ui.pbar.getBoundingClientRect();
          seekToFraction((e.clientX - r.left) / r.width);
        },
      },
      h('div', { class: 'tl-track' }, ui.pfill)
    );
    ui.prog = h('span', { class: 'tl-sent', title: 'Câu hiện tại / tổng số câu' });
    // compact on purpose: play/pause, time, progress, sentence — the rest lives in the panel
    ui.tl = h('div', { class: 'tl', hidden: true }, ui.tlPlay, ui.time, ui.pbar, ui.prog);
    ui.tip = h('div', { class: 'wtip', hidden: true, role: 'tooltip' });
    ui.tip.addEventListener('pointerleave', () => {
      if (tip.lookup) return; // closed by the user (×, Esc, click outside)
      clearTimeout(tip.hideTimer);
      tip.hideTimer = setTimeout(hideTip, 250);
    });
    root.append(ui.panel, ui.pill, ui.sub, ui.tl, ui.tip);

    host.addEventListener('keydown', onPanelKey);
    applyTheme();
    if (!STANDALONE) setupResize();
    (document.body || document.documentElement).append(host);

    send({ type: 'TR_GEMINI_GET' }).then((r) => {
      if (!r?.error) gemini = r;
      if (settings.tab === 'sum') renderSummary();
    });
    addEventListener('resize', applyDock);
    syncControls();
    applyDock();
  }

  function onPanelKey(e) {
    e.stopPropagation(); // don't trigger page shortcuts
    const target = e.composedPath()[0];
    if (/^(SELECT|INPUT|TEXTAREA)$/.test(target?.tagName)) return;
    if (e.code === 'Space' && target?.tagName !== 'BUTTON') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') jumpSentence(-1);
    else if (e.key === 'ArrowRight') jumpSentence(1);
    else if (e.key === 'r' || e.key === 'R') toggleRepeat();
    else if (e.key === 'c' || e.key === 'C') toggleSubtitles();
    else if (e.key === 'Escape') ui.menu.hidden = true;
  }

  function onReadClick(e) {
    const sel = panelSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const vn = e.target.closest?.('.vn');
    if (vn) {
      vn.classList.toggle('shown');
      return;
    }
    const sbPlay = e.target.closest?.('.sb-play');
    if (sbPlay) {
      play(doc.sentences[Number(sbPlay.dataset.s)].first);
      return;
    }
    const w = e.target.closest?.('.w');
    if (!w) return;
    const i = Number(w.dataset.i);
    if (player.playing) play(i);
    setCurrent(i);
  }

  function panelSelection() {
    return ui.root?.getSelection?.() || window.getSelection();
  }

  function selectionWord(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return el?.closest?.('.w') || null;
  }

  function onPanelWordSelection(e) {
    if (e.button !== 0) return;
    setTimeout(() => {
      const sel = panelSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount !== 1) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (!text || /\s/u.test(text)) return;

      const range = sel.getRangeAt(0);
      const start = selectionWord(range.startContainer);
      const end = selectionWord(range.endContainer);
      if (!start || start !== end || !ui.readView.contains(start)) return;

      const t = doc?.tokens[Number(start.dataset.i)];
      if (!t?.key || text.toLocaleLowerCase() !== t.text.toLocaleLowerCase()) return;
      setCurrent(t.i);
    }, 0);
  }

  // --- dock / resize / minimize ---------------------------------------------

  let pushed = false;
  let pushPrev = ['', ''];
  function setPush(px) {
    if (STANDALONE) return;
    const st = document.documentElement.style;
    if (px > 0) {
      if (!pushed) {
        pushPrev = [st.getPropertyValue('margin-right'), st.getPropertyPriority('margin-right')];
        pushed = true;
      }
      st.setProperty('margin-right', `${px}px`, 'important');
    } else if (pushed) {
      if (pushPrev[0]) st.setProperty('margin-right', pushPrev[0], pushPrev[1]);
      else st.removeProperty('margin-right');
      pushed = false;
    }
  }

  function applyDock() {
    if (STANDALONE || !ui.panel) return;
    const MIN_PANEL = 300;
    const MIN_PAGE = 360; // what the page keeps beside the panel
    let w = clamp(settings.width, MIN_PANEL, 760);
    // narrow window: shrink the panel (not below MIN_PANEL) so the page still fits beside it
    if (innerWidth - w < MIN_PAGE) w = Math.max(MIN_PANEL, innerWidth - MIN_PAGE);
    ui.panel.style.width = `${w}px`;
    const visible = !ui.panel.hidden && ui.host.isConnected;
    // push the page aside unless the window is too small to show both (then the panel overlays)
    setPush(visible && settings.pushPage && innerWidth - w >= 300 ? w : 0);
    positionSubtitle();
  }

  function setupResize() {
    ui.resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      ui.resizer.setPointerCapture(e.pointerId);
      ui.resizer.classList.add('drag');
      const move = (ev) => {
        settings.width = Math.round(innerWidth - ev.clientX);
        applyDock();
      };
      const up = () => {
        ui.resizer.removeEventListener('pointermove', move);
        ui.resizer.removeEventListener('pointerup', up);
        ui.resizer.classList.remove('drag');
        saveSettings();
      };
      ui.resizer.addEventListener('pointermove', move);
      ui.resizer.addEventListener('pointerup', up);
    });
  }

  function setMinimized(min) {
    ui.panel.hidden = min;
    ui.pill.hidden = !min;
    ui.menu.hidden = true;
    applyDock();
  }

  function close() {
    stop();
    clearPageHighlights();
    hideTip();
    setLookupCursor(null);
    if (STANDALONE) {
      window.close();
      return;
    }
    setPush(0);
    ui.host?.remove();
  }

  // --- controls ---------------------------------------------------------------

  function syncControls() {
    for (const b of ui.accentBtns) b.classList.toggle('on', b.dataset.acc === settings.accent);
    const speeds = SPEEDS.includes(settings.rate) ? SPEEDS : [...SPEEDS, settings.rate].sort((a, b) => a - b);
    ui.speedSel.replaceChildren(...speeds.map((v) => h('option', { value: String(v) }, `${v}×`)));
    ui.speedSel.value = String(settings.rate);
    for (const b of ui.tabBtns) b.classList.toggle('on', b.dataset.tab === settings.tab);
    ui.gearBtn.classList.toggle('on', settings.tab === 'settings');
    ui.readView.hidden = settings.tab !== 'read';
    ui.vocabView.hidden = settings.tab !== 'vocab';
    ui.sumView.hidden = settings.tab !== 'sum';
    ui.settingsView.hidden = settings.tab !== 'settings';
    updateRepeatBtn();
    applyViewClasses();
    updateSheetVisibility();
  }

  function replaySentence() {
    if (!doc?.sentences.length) return;
    const si = player.sentMarked >= 0 ? player.sentMarked : 0;
    play(doc.sentences[si].first);
  }

  // show / hide the shadowing bar without restarting a running countdown
  function syncShadowBar() {
    if (!ui.shadowBar) return;
    if (player.playing && settings.repeat) ui.shadowBar.hidden = settings.tab !== 'read';
    else setShadowPhase('idle');
  }

  function updateRepeatBtn() {
    syncShadowBar();
    ui.repBtn.classList.toggle('on', settings.repeat);
    ui.repBadge.textContent = settings.repeatTimes ? String(settings.repeatTimes) : '∞';
    ui.repBtn.title = settings.repeat
      ? `Đang lặp mỗi câu ${settings.repeatTimes || '∞'} lần, có khoảng nghỉ để nói theo — bấm để tắt (R)`
      : 'Lặp câu để luyện nói theo (R)';
    updateTimeEstimate(); // repeats and pauses change the estimate
  }

  function toggleRepeat() {
    settings.repeat = !settings.repeat;
    saveSettings();
    updateRepeatBtn();
    if (!ui.menu.hidden) renderMenu();
    status(settings.repeat ? `Lặp câu: bật — mỗi câu ${settings.repeatTimes || '∞'} lần (chỉnh trong Aa)` : 'Lặp câu: tắt');
  }

  function toggleMenu() {
    ui.menu.hidden = !ui.menu.hidden;
    if (!ui.menu.hidden) renderMenu();
  }

  function updatePlayBtn() {
    const name = player.playing ? 'pause' : 'play';
    ui.playBtn?.replaceChildren(icon(name));
    ui.pillPlay?.replaceChildren(icon(name));
    ui.tlPlay?.replaceChildren(icon(name));
    if (ui.readView) applyViewClasses(); // focus mode follows playback (panel + page)
    applyPageDim();
    // tick the elapsed / total clock every second while reading
    clearInterval(player.clockTimer);
    if (player.playing) player.clockTimer = setInterval(updateTimeEstimate, 1000);
    updateTimeEstimate();
  }

  function status(text) {
    if (ui.status) ui.status.textContent = text;
  }

  function docStats() {
    const words = doc.tokens.filter((t) => t.key).length;
    const dur = fmtDuration(estimateSeconds(0));
    return `${words} từ · ${doc.sentences.length} câu · ${dur.startsWith('<') ? dur : `~${dur}`} đọc · bấm vào từ để xem nghĩa`;
  }

  function setAccent(acc) {
    settings.accent = acc;
    saveSettings();
    syncControls();
    refreshLookupViews();
    if (settings.tab === 'settings') renderSettings();
    if (player.playing) play(player.cur);
  }

  function setTab(tab) {
    settings.tab = tab;
    saveSettings();
    ui.menu.hidden = true;
    syncControls();
    if (tab === 'vocab') renderVocab();
    if (tab === 'sum') renderSummary();
    if (tab === 'settings') renderSettings();
    if (tab === 'read' && player.sentMarked >= 0) scrollIntoPanel(doc?.sentences[player.sentMarked]?.el);
  }

  function jumpSentence(delta) {
    if (!doc?.sentences.length) return;
    const curSent = player.cur >= 0 ? doc.tokens[player.cur].sent : -1;
    const target = clamp(curSent + delta, 0, doc.sentences.length - 1);
    const first = doc.sentences[target].first;
    if (player.playing) play(first);
    else setCurrent(first);
  }

  function applyViewClasses() {
    ui.readView.className = [
      'view',
      'read-view',
      settings.dimOthers && player.sentMarked >= 0 && 'focus',
      settings.bilingual && 'bilingual',
      settings.hideTrans && 'hide-trans',
      settings.showIPA && 'show-ipa',
      settings.showVI && 'show-vi',
      ...settings.tagSel.map((k) => `sel-${k}`),
    ]
      .filter(Boolean)
      .join(' ');
    ui.readView.style.setProperty('--fs', `${settings.fontSize}px`);
  }

  // --- "Aa" menu: display + practice options ----------------------------------

  function renderMenu() {
    const opt = (label, key, after) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!settings[key];
      cb.addEventListener('change', () => {
        settings[key] = cb.checked;
        saveSettings();
        applyViewClasses();
        after?.();
      });
      return h('label', { class: 'opt' }, cb, label);
    };
    const choice = (key, values, fmt) =>
      h(
        'div',
        { class: 'pills' },
        values.map((v) =>
          h(
            'button',
            {
              class: settings[key] === v ? 'on' : '',
              onclick: () => {
                settings[key] = v;
                saveSettings();
                updateRepeatBtn();
                updateSubtitle();
                renderMenu();
              },
            },
            fmt(v)
          )
        )
      );
    const fsBtn = (d, label) =>
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            settings.fontSize = clamp(settings.fontSize + d, 12, 26);
            saveSettings();
            applyViewClasses();
            renderMenu();
          },
        },
        label
      );
    const subSizeBtn = (d, label) =>
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            settings.subSize = clamp(settings.subSize + d * 2, 13, 33);
            saveSettings();
            positionSubtitle();
            renderMenu();
          },
        },
        label
      );
    ui.menuChips = h('div', { class: 'chips' });
    ui.menu.replaceChildren(
      h('h5', null, 'Hiển thị'),
      h('div', { class: 'opt fs' }, 'Cỡ chữ', fsBtn(-1, 'A−'), h('b', null, String(settings.fontSize)), fsBtn(1, 'A+')),
      opt('Làm mờ các câu chưa đọc / đã đọc (panel + trang)', 'dimOthers', applyPageDim),
      opt('Song ngữ: bản dịch dưới mọi câu', 'bilingual'),
      opt('Ẩn bản dịch — bấm vào để xem (tự đoán trước)', 'hideTrans'),
      opt('IPA dưới mỗi từ', 'showIPA'),
      opt('Nghĩa tiếng Việt dưới mỗi từ', 'showVI'),
      opt('Tô nghĩa của từ đang đọc trong câu dịch (gần đúng)', 'viMark', markViWord),
      opt('Rê chuột vào từ trên trang để xem nhanh (khi đang đọc)', 'hoverCard', hideTip),
      h('h5', null, 'Phụ đề & timeline trên trang'),
      opt('Phụ đề tiếng Việt kiểu YouTube (phím C / nút CC)', 'subtitles', updateSubtitle),
      h(
        'div',
        { class: 'opt fs' },
        'Cỡ chữ phụ đề',
        subSizeBtn(-1, 'A−'),
        h('b', null, String(settings.subSize)),
        subSizeBtn(1, 'A+')
      ),
      h('div', { class: 'sub' }, 'Vị trí phụ đề'),
      choice('subPos', ['bottom', 'top'], (v) => (v === 'top' ? 'Trên' : 'Dưới')),
      h('div', { class: 'sub' }, 'Nền phụ đề'),
      choice('subBg', ['solid', 'dim', 'none'], (v) => ({ solid: 'Đậm', dim: 'Mờ', none: 'Trong suốt' })[v]),
      opt('Thanh timeline (thời gian đọc) ở cuối trang', 'pageTimeline', positionSubtitle),
      h('h5', null, 'Tô màu loại từ'),
      ui.menuChips,
      h('h5', null, 'Lặp câu — luyện nói theo (shadowing)'),
      opt('Bật lặp câu', 'repeat', updateRepeatBtn),
      opt('Tiếng "bíp" khi đến lượt bạn nói', 'shadowBeep'),
      h('div', { class: 'sub' }, 'Nghe mỗi câu'),
      choice('repeatTimes', [1, 2, 3, 5, 0], (v) => (v ? `${v} lần` : '∞')),
      h('div', { class: 'sub' }, 'Khoảng nghỉ sau mỗi lần để bạn nói theo'),
      choice('shadowGap', [0, 0.5, 1, 1.5, 2], (v) => (v ? `${v}× câu` : 'Không')),
      h('h5', null, 'Nội dung đọc'),
      opt('Bỏ qua cả link nằm giữa câu (áp dụng từ lần đọc sau)', 'skipAllLinks'),
      STANDALONE
        ? null
        : h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', title: 'Đọc phần nội dung chính của trang (bỏ qua menu, quảng cáo, chân trang)', onclick: () => ((ui.menu.hidden = true), readPage()) }, 'Đọc cả trang'),
            h('button', { class: 'btn', title: 'Bấm vào trang để chọn điểm bắt đầu, rồi điểm kết thúc', onclick: () => ((ui.menu.hidden = true), startPick()) }, 'Chọn bắt đầu → kết thúc')
          ),
      h('h5', null, 'Khác'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: copyTrans }, icon('copy'), 'Copy bản dịch'),
        h('button', { class: 'btn', onclick: () => (stop(), (ui.readView.scrollTop = 0)) }, icon('stop'), 'Dừng & về đầu')
      )
    );
    renderChips();
  }

  // --- reading view -----------------------------------------------------------

  function renderRead() {
    const blocks = doc.sentences.map((s, si) => {
      const para = si > 0 && doc.text.slice(doc.sentences[si - 1].end, s.start).includes('\n');
      const en = h('div', { class: 'en' });
      let pos = s.start;
      for (let k = s.first; k <= s.last; k++) {
        const t = doc.tokens[k];
        if (t.start > pos) en.append(doc.text.slice(pos, t.start));
        t.ipaEl = h('span', { class: 'ipa' });
        t.viEl = h('span', { class: 'wvi' });
        t.el = h('span', { class: `w t-${t.tag}`, 'data-i': t.i }, h('span', { class: 'wt' }, t.text), t.ipaEl, t.viEl);
        en.append(t.el);
        pos = t.end;
      }
      if (s.end > pos) en.append(doc.text.slice(pos, s.end));
      s.vnEl = h('div', { class: 'vn', title: 'Bản dịch (Google Translate)' }, viSent[si] || '');
      s.el = h(
        'div',
        { class: `sb${para ? ' para' : ''}`, 'data-s': si },
        en,
        s.vnEl,
        h('button', { class: 'ic mini sb-play', title: 'Đọc câu này', 'data-s': si }, icon('play'))
      );
      return s.el;
    });
    ui.readView.replaceChildren(...blocks);
    ui.readView.scrollTop = 0;
    applyViewClasses();
    updateInlineIpa();
    updateInlineVi();
  }

  function fillTranslations() {
    updateSubtitle();
    if (!doc) return;
    doc.sentences.forEach((s, i) => {
      if (!s.vnEl) return;
      s.vnEl.textContent = viSent[i] || '';
      s.vnEl.title = `Bản dịch (${transProvider})`;
    });
    markViWord();
  }

  function updateInlineVi() {
    if (!doc) return;
    for (const t of doc.tokens) {
      if (!t.viEl) continue;
      const vi = t.key ? viWord.get(t.key) || '' : '';
      // skip words that come back untranslated (names, code identifiers…)
      t.viEl.textContent = vi && vi.toLowerCase() !== t.key.toLowerCase() ? vi : '';
      t.viEl.title = t.viEl.textContent;
    }
  }

  function updateInlineIpa() {
    if (!doc) return;
    for (const t of doc.tokens) {
      if (!t.ipaEl) continue;
      const { e, via } = infoFor(t);
      t.ipaEl.textContent = e ? ipaOf(e).replace(/^\/|\/$/g, '') : '';
      t.ipaEl.classList.toggle('approx', !!via);
      t.ipaEl.title = via ? `IPA của "${via}"` : '';
    }
  }

  async function copyTrans() {
    let text = '';
    doc.sentences.forEach((s, i) => {
      if (i > 0) text += doc.text.slice(doc.sentences[i - 1].end, s.start).includes('\n') ? '\n\n' : ' ';
      text += viSent[i] || '';
    });
    await copyText(text);
    status('Đã copy bản dịch');
  }

  // --- tag chips (Aa menu + vocabulary tab) ----------------------------------

  function chipEls() {
    const counts = {};
    for (const t of doc?.tokens || []) counts[t.tag] = (counts[t.tag] || 0) + 1;
    const present = TAGS.filter((t) => counts[t.key]);
    settings.tagSel = settings.tagSel.filter((k) => TAG[k]);
    return [
      h(
        'button',
        {
          class: 'chip all',
          onclick: () => {
            settings.tagSel = settings.tagSel.length ? [] : present.map((t) => t.key);
            onTagChange();
          },
        },
        settings.tagSel.length ? 'Bỏ chọn' : 'Tất cả'
      ),
      ...present.map((tg) => {
        const on = settings.tagSel.includes(tg.key);
        return h(
          'button',
          {
            class: `chip${on ? ' on' : ''}`,
            style: `--c:${tg.color}`,
            title: `${tg.label} — ${tg.vi}`,
            'aria-pressed': String(on),
            onclick: () => {
              settings.tagSel = on ? settings.tagSel.filter((k) => k !== tg.key) : [...settings.tagSel, tg.key];
              onTagChange();
            },
          },
          h('span', { class: 'dot' }),
          tg.label,
          h('small', null, String(counts[tg.key]))
        );
      }),
    ];
  }

  function renderChips() {
    ui.menuChips?.replaceChildren(...chipEls());
    ui.vocabChips?.replaceChildren(...chipEls());
  }

  function onTagChange() {
    saveSettings();
    renderChips();
    applyViewClasses();
    applyPageTagHighlights();
    if (settings.tab === 'vocab') renderVocab();
  }

  // --- vocabulary grouped by tag --------------------------------------------

  function vocabGroups() {
    const groups = new Map();
    for (const t of doc.tokens) {
      if (!t.key) continue;
      if (!groups.has(t.tag)) groups.set(t.tag, new Map());
      const g = groups.get(t.tag);
      if (g.has(t.key)) g.get(t.key).count++;
      else g.set(t.key, { word: t.key, tok: t, count: 1 });
    }
    const shown = settings.tagSel.length ? TAGS.filter((t) => settings.tagSel.includes(t.key)) : TAGS;
    return shown.filter((tg) => groups.has(tg.key)).map((tg) => ({ tag: tg, items: [...groups.get(tg.key).values()] }));
  }

  function renderVocab() {
    if (!doc) return;
    const groups = vocabGroups();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    ui.vocabChips = h('div', { class: 'chips' }, chipEls());
    const tools = h(
      'div',
      { class: 'vtools' },
      h('span', null, settings.tagSel.length ? `${total} từ trong loại đã chọn` : `${total} từ · chọn loại từ để lọc`),
      h('button', { class: 'btn', title: 'Copy dạng bảng (dán vào Excel/Sheets/Anki)', onclick: copyVocab }, icon('copy'), 'Copy')
    );
    const sections = groups.map(({ tag, items }) =>
      h(
        'div',
        { class: 'vg' },
        h('h4', { style: `--c:${tag.color}` }, h('span', { class: 'dot' }), tag.label, h('small', null, `${tag.vi} · ${items.length}`)),
        items.map((it) => {
          const ipa = ipaShort(it.tok) || (entries.has(it.tok.key) ? '—' : '…');
          return h(
            'div',
            {
              class: 'vr',
              onclick: () => {
                setTab('read');
                setCurrent(it.tok.i);
              },
            },
            h('span', { class: 'vw' }, it.word),
            h('span', { class: 'vi' }, ipa),
            h('span', { class: 'vc' }, `×${it.count}`),
            iconBtn('speaker', `Phát âm "${it.word}"`, (ev) => {
              ev.stopPropagation();
              sayText(it.word);
            }),
            h('span', { class: 'vv' }, viWord.get(it.word) || '')
          );
        })
      )
    );
    ui.vocabView.replaceChildren(ui.vocabChips, tools, ...(sections.length ? sections : [h('div', { class: 'note' }, 'Không có từ nào.')]));
  }

  async function copyVocab() {
    const lines = ['word\tIPA US\tIPA UK\tPOS\tvi\tcount\tdefinition'];
    for (const { tag, items } of vocabGroups()) {
      for (const it of items) {
        const { e, base } = infoFor(it.tok);
        const def = base?.senses?.find((s) => s.key === tag.key)?.def || base?.senses?.[0]?.def || '';
        lines.push([it.word, e?.us || '', e?.uk || '', tag.label, viWord.get(it.word) || '', it.count, def].join('\t'));
      }
    }
    await copyText(lines.join('\n'));
    status(`Đã copy ${lines.length - 1} từ`);
  }

  // --- word sheet ----------------------------------------------------------------

  function updateSheetVisibility() {
    ui.sheet.hidden = !cardTok || !['read', 'vocab'].includes(settings.tab);
  }

  function setSheetOpen(open) {
    sheetOpen = open;
    ui.sheet.classList.toggle('open', open);
    ui.shToggle.replaceChildren(icon(open ? 'down' : 'up'));
    ui.shToggle.title = open ? 'Thu gọn' : 'Xem chi tiết';
    // the details were not rendered while collapsed: render them for the current word
    if (open && cardTok) showCard(cardTok);
  }

  function sayCardWord() {
    if (cardTok) sayText(cardTok.text);
  }

  function showCard(t) {
    cardTok = t || null;
    updateSheetVisibility();
    if (!t) return;
    const tg = TAG[t.tag];
    ui.shWord.textContent = t.text;
    const short = ipaShort(t);
    ui.shIpa.replaceChildren(short ? ipaPretty(short) : '');
    ui.shPos.textContent = tg.abbr || tg.label;
    ui.shPos.title = `${tg.label} — ${tg.vi}`;
    ui.shPos.style.setProperty('--c', tg.color);
    ui.shVi.textContent = (t.key && (viWord.get(t.key) || viDict.get(t.key)?.trans)) || '';
    ui.sheet.classList.toggle('open', sheetOpen);
    // details are fetched for a word the reader rests on (or the user opened)
    if (sheetOpen || !player.playing) scheduleDetail(t);
    const loading = detailLoading(t);
    ui.sheet.classList.toggle('loading', loading);
    if (sheetOpen) {
      ui.cIpa.replaceChildren(...ipaNodes(t));
      const vi = t.key ? viNodes(t, t.tag) : [];
      ui.cVi.replaceChildren(...(loading && !vi.length ? [loadingLine('Đang tải nghĩa tiếng Việt…')] : vi));
      ui.cDef.replaceChildren(...(t.key ? enDefNodes(t, t.tag, 2) : []));
    }
  }

  // --- summary (Gemini) ------------------------------------------------------

  function renderSummary() {
    if (!ui.sumView) return;
    if (!gemini.hasKey) {
      ui.sumView.replaceChildren(
        h(
          'div',
          { class: 'note-box' },
          'Tóm tắt tiếng Anh + tiếng Việt dùng Gemini API (gói miễn phí) — cần API key của bạn. ',
          h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'Lấy key miễn phí ↗'),
          ' rồi dán vào ',
          h('button', { class: 'linkbtn', onclick: () => setTab('settings') }, 'Cài đặt ⚙'),
          '.'
        )
      );
      return;
    }
    const loading = sumState.state === 'loading';
    const kids = [
      h(
        'div',
        { class: 'vtools' },
        h('span', null, `Gemini · ${gemini.model || gemini.effective}${gemini.model ? '' : ' (tự động)'}`),
        h(
          'button',
          { class: 'btn primary', disabled: loading || !doc?.tokens.length, onclick: runSummary },
          loading ? 'Đang tóm tắt…' : sumState.data ? 'Tóm tắt lại' : 'Tóm tắt đoạn văn'
        )
      ),
    ];
    if (sumState.state === 'error') kids.push(h('div', { class: 'err' }, sumState.error));
    for (const [lang, label] of [['en', 'English'], ['vi', 'Tiếng Việt']]) {
      const d = sumState.data?.[lang];
      if (!d) continue;
      const points = d.points || [];
      kids.push(
        h(
          'div',
          { class: 'sum-block' },
          h(
            'h4',
            null,
            label,
            lang === 'en' ? iconBtn('speaker', 'Nghe bản tóm tắt tiếng Anh', () => sayText([d.summary, ...points].join(' ')), 'mini') : null,
            iconBtn('copy', 'Copy', () => copyText([d.summary, '', ...points.map((p) => `- ${p}`)].join('\n')).then(() => status('Đã copy tóm tắt')), 'mini')
          ),
          h('p', null, d.summary),
          points.length ? h('ul', null, points.map((p) => h('li', null, p))) : null
        )
      );
    }
    if (!sumState.data && !loading && sumState.state !== 'error') kids.push(h('div', { class: 'note' }, 'Bấm "Tóm tắt đoạn văn" để tạo bản tóm tắt EN + VI.'));
    ui.sumView.replaceChildren(...kids);
  }

  async function runSummary() {
    if (!doc?.tokens.length) return;
    const forDoc = doc;
    sumState = { state: 'loading', data: sumState.data, error: '' };
    renderSummary();
    const r = await send({ type: 'TR_SUMMARIZE', text: doc.text });
    if (doc !== forDoc) return;
    if (r?.error) {
      const msg =
        r.error === 'NO_KEY'
          ? 'Chưa có API key — vào Cài đặt ⚙ để nhập.'
          : /quota|exhausted|429|rate/i.test(r.error)
            ? `Hết hạn mức miễn phí của Gemini, thử lại sau ít phút. (${r.error})`
            : r.error;
      sumState = { state: 'error', data: null, error: msg };
    } else sumState = { state: 'done', data: r.summary, error: '' };
    renderSummary();
  }

  // --- settings & sources (⚙) -----------------------------------------------

  function renderSettings() {
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
    const check = (label, key, after) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!settings[key];
      cb.addEventListener('change', () => {
        settings[key] = cb.checked;
        saveSettings();
        after?.();
      });
      return h('label', { class: 'opt' }, cb, label);
    };

    // voice
    const engineSel = h(
      'select',
      { 'aria-label': 'Nguồn giọng đọc' },
      h('option', { value: 'neural' }, 'Giọng tự nhiên — Microsoft Neural (online)'),
      h('option', { value: 'browser' }, 'Giọng của trình duyệt (offline)')
    );
    engineSel.value = settings.engine;
    engineSel.addEventListener('change', () => {
      settings.engine = engineSel.value;
      player.neuralDownUntil = 0;
      updateTimeEstimate();
      saveSettings();
      renderSettings();
      if (player.playing) play(player.cur);
    });
    let voiceSel;
    if (settings.engine === 'neural') {
      voiceSel = h('select', { 'aria-label': 'Giọng đọc' }, NEURAL_VOICES[settings.accent].map(([id, name]) => h('option', { value: id }, name)));
      voiceSel.value = neuralVoice();
      voiceSel.addEventListener('change', () => {
        settings[`neural${settings.accent}`] = voiceSel.value;
        player.neuralDownUntil = 0;
        updateTimeEstimate();
        saveSettings();
        if (player.playing) play(player.cur);
        else sayText('This is how I sound when I read to you.');
      });
    } else {
      const list = voicesFor(settings.accent);
      const cur = currentVoice();
      voiceSel = h(
        'select',
        { 'aria-label': 'Giọng đọc' },
        list.length ? list.map((v) => h('option', { value: v.name }, v.name.replace(/^Microsoft\s+/, ''))) : h('option', { value: '' }, `Không có giọng ${settings.accent}`)
      );
      if (cur && list.includes(cur)) voiceSel.value = cur.name;
      voiceSel.addEventListener('change', () => {
        settings[`voice${settings.accent}`] = voiceSel.value;
        saveSettings();
        updateTimeEstimate();
        if (player.playing) play(player.cur);
        else sayText('This is how I sound when I read to you.');
      });
    }
    const voiceHint =
      settings.engine === 'neural'
        ? Date.now() < player.neuralDownUntil
          ? h(
              'div',
              { class: 'err' },
              `Giọng tự nhiên vừa bị lỗi (${player.neuralError || 'không rõ'}) nên đang tạm dùng giọng trình duyệt — sẽ tự thử lại sau 1 phút (hoặc chọn lại giọng để thử ngay).`
            )
          : h(
              'div',
              { class: 'hint' },
              'Giọng Read Aloud của Microsoft Edge, có mốc thời gian từng từ để highlight chính xác. Giọng "tự nhiên nhất" (Multilingual) là thế hệ mới, đọc như người thật; câu đầu tiên có thể mất vài giây để tải. Cần mạng.'
            )
        : h('div', { class: 'hint' }, 'Giọng cài sẵn trong máy/trình duyệt. Giọng "Natural"/"Online" nghe tự nhiên hơn; giọng Google trên Chrome chỉ highlight ước lượng.');

    // gemini
    const keyInput = h('input', {
      type: 'password',
      class: 'inp',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: gemini.hasKey ? `Đã lưu key ${gemini.keyHint} — dán key mới để thay` : 'Dán Gemini API key (AIza…)',
    });
    // Only models with a free tier; '' = always the newest free Flash model
    const modelSel = h('select', { 'aria-label': 'Model Gemini' });
    const fillModels = (models, newest) => {
      modelSel.replaceChildren(
        h('option', { value: '' }, `Tự động — mới nhất (${newest || models[0] || '…'})`),
        ...models.map((m) => h('option', { value: m }, m))
      );
      modelSel.value = gemini.model && models.includes(gemini.model) ? gemini.model : '';
    };
    fillModels(gemini.models || [], gemini.effective);
    const loadModels = async () => {
      const r = await send({ type: 'TR_GEMINI_MODELS' });
      if (r?.error) {
        status(r.error === 'NO_KEY' ? 'Lưu API key trước rồi mới tải được danh sách model' : `Gemini: ${r.error}`);
        return;
      }
      gemini.models = r.models;
      fillModels(r.models, r.models.find((m) => /-flash$/.test(m)) || r.models[0]);
      status(`${r.models.length} model miễn phí khả dụng với key này`);
    };
    const saveGemini = async (key) => {
      const r = await send({ type: 'TR_GEMINI_SET', key, model: modelSel.value });
      if (r?.error) {
        status(`Không lưu được: ${r.error}`);
        return;
      }
      gemini = r;
      status('Đã lưu cài đặt Gemini');
      renderSettings();
    };
    const clearCache = async () => {
      const r = await send({ type: 'TR_CLEAR_CACHE' });
      for (const m of [entries, viWord, viDict]) m.clear();
      neural.cache.clear();
      status(r?.error ? `Lỗi: ${r.error}` : `Đã xoá ${r.removed} mục cache`);
    };

    ui.settingsView.replaceChildren(
      h('h4', null, `Giọng đọc (${settings.accent === 'UK' ? 'Anh-Anh' : 'Anh-Mỹ'} — đổi bằng US/UK ở trên)`),
      h('div', { class: 'row' }, engineSel),
      h('div', { class: 'row' }, voiceSel),
      voiceHint,

      h('h4', null, 'Panel'),
      check('Đẩy nội dung trang sang trái để panel không che bài', 'pushPage', applyDock),

      h('h4', null, 'Gemini — tóm tắt đoạn văn'),
      h('div', { class: 'row' }, keyInput),
      h('div', { class: 'row' }, modelSel, h('button', { class: 'btn', onclick: loadModels }, 'Tải danh sách model')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => saveGemini(keyInput.value.trim() || undefined) }, 'Lưu'),
        gemini.hasKey ? h('button', { class: 'btn', onclick: () => saveGemini('') }, 'Xoá key') : null,
        link('https://aistudio.google.com/apikey', 'Lấy key miễn phí ↗')
      ),
      h('div', { class: 'hint' }, 'Key chỉ lưu trên máy này (chrome.storage.local), không đồng bộ, chỉ gửi tới Google Gemini API.'),

      h('h4', null, 'Nguồn dữ liệu'),
      h(
        'ul',
        { class: 'src-list' },
        h('li', null, h('b', null, 'Giọng tự nhiên: '), 'dịch vụ Read Aloud của Microsoft Edge (không chính thức — có thể thay đổi; khi lỗi tự chuyển sang giọng trình duyệt).'),
        h('li', null, h('b', null, 'Loại từ: '), 'thư viện compromise, chạy offline trên máy.'),
        h('li', null, h('b', null, 'IPA & nghĩa tiếng Anh ngắn: '), link('https://en.wiktionary.org', 'Wiktionary'), ' (CC BY-SA).'),
        h(
          'li',
          null,
          h('b', null, 'Nghĩa tiếng Việt: '),
          'bộ dịch có sẵn trong Chrome (dịch trên máy, miễn phí, không giới hạn — cần bật 1 lần). Dự phòng: Google Translate (không chính thức, có thể tạm chặn khi dùng nhiều) → Gemini (nếu có key) → MyMemory (~5.000 ký tự/ngày). Nghĩa theo loại từ lấy từ Google khi có thể.'
        ),
        h(
          'li',
          null,
          h('b', null, 'Từ điển đầy đủ: '),
          link('https://www.oxfordlearnersdictionaries.com', "Oxford Learner's"),
          ' và ',
          link('https://dictionary.cambridge.org/dictionary/english-vietnamese/', 'Cambridge Anh–Việt'),
          ' — mở trang gốc trong cửa sổ popup để bạn tự xem (extension không lấy dữ liệu từ các trang này).'
        ),
        h('li', null, h('b', null, 'Tóm tắt: '), 'Gemini API với key của bạn (gói miễn phí giới hạn số lần mỗi phút / ngày).')
      ),
      h(
        'div',
        { class: 'warn' },
        'Lưu ý: giọng đọc tự nhiên dùng dịch vụ Read Aloud của Microsoft Edge, không phải API công khai — có thể ngừng hoạt động bất cứ lúc nào. Chỉ dùng cho học tập cá nhân.'
      ),

      h('h4', null, 'Phím tắt trong panel'),
      h('div', { class: 'hint' }, 'Space: phát/tạm dừng · ← →: câu trước/sau · R: bật/tắt lặp câu · double-click một từ: đọc từ đó · Alt+Shift+E: đọc đoạn đang bôi đen'),

      h('h4', null, 'Cache'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: clearCache }, 'Xoá cache tra từ'),
        h('span', { class: 'hint' }, 'IPA, nghĩa và kết quả Oxford được lưu để tra nhanh hơn.')
      )
    );
  }

  // close the "Aa" menu on any click outside it (page or panel)
  function onDocPointerDown(e) {
    if (!ui.menu || ui.menu.hidden) return;
    const path = e.composedPath();
    if (!path.includes(ui.menu) && !path.includes(ui.aaBtn)) ui.menu.hidden = true;
  }
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('pointerdown', onTipOutside, true);
  document.addEventListener('keydown', onTipKey, true);
  document.addEventListener('click', onPageWordClick, true);
  document.addEventListener('mousemove', onPageHover, { capture: true, passive: true });
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKey, true);
  window.addEventListener('scroll', onPageScrollForSub, { capture: true, passive: true });
  window.addEventListener('scroll', hideTip, { capture: true, passive: true });

  // ---------------------------------------------------------------------------
  // Entry points
  // ---------------------------------------------------------------------------

  async function open(text, map) {
    await settingsReady;
    if (!ui.host?.isConnected) buildUI();
    setMinimized(false);
    stop();
    clearPageHighlights();
    hideTip();
    setLookupCursor(null);
    player.sentMarked = -1;
    player.cur = -1;
    player.finished = false;
    viSent = [];
    sumState = { state: 'idle', data: null, error: '' };
    cardTok = null; // the sheet keeps the open/closed state the user chose
    doc = analyze(text, map);
    if (settings.tab === 'sum') renderSummary();
    if (settings.tab === 'settings') setTab('read');
    if (!doc.tokens.length) {
      ui.readView.replaceChildren(h('div', { class: 'note' }, 'Không tìm thấy từ tiếng Anh nào trong đoạn đã chọn.'));
      showCard(null);
      status('');
      return;
    }
    renderRead();
    renderChips();
    updateTimeEstimate();
    setShadowPhase('idle');
    if (settings.tab === 'vocab') renderVocab();
    highlightPageSelection();
    applyPageTagHighlights();
    showCard(null);
    markCurrent(-1);
    status(docStats());
    lookupAll();
    translateAll();
  }

  function destroy() {
    try {
      stop();
      clearPageHighlights();
      setPush(0);
    } catch {}
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('pointerdown', onTipOutside, true);
    document.removeEventListener('keydown', onTipKey, true);
    document.removeEventListener('click', onPageWordClick, true);
    document.removeEventListener('mousemove', onPageHover, { capture: true });
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    window.removeEventListener('scroll', onPageScrollForSub, { capture: true });
    window.removeEventListener('scroll', hideTip, { capture: true });
    endPick();
    removeEventListener('resize', applyDock);
    ui.host?.remove();
  }

  if (!STANDALONE) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'TR_OPEN') return;
      // mode: 'selection' (context menu on a selection) | 'page' | 'pick' | 'auto' (selection, else whole page)
      //       | 'lookup' (card for the selected word / phrase, without the panel)
      const mode = msg.mode || 'selection';
      if (mode === 'lookup') {
        lookupSelection(msg.text || '').then((ok) => sendResponse({ ok }), () => sendResponse({ ok: false }));
        return true; // async response
      }
      if (mode === 'pick') {
        startPick();
        sendResponse({ ok: true });
        return;
      }
      let cap = mode === 'page' ? null : captureSelection();
      if (!cap && (mode === 'page' || mode === 'auto')) cap = capturePage();
      const text = cap?.text || (msg.text || '').trim();
      if (!text) {
        sendResponse({ ok: false });
        return;
      }
      // The native selection paints above custom highlights and would mute them;
      // we already have the char→DOM map, so drop it.
      if (cap) window.getSelection()?.removeAllRanges();
      open(text, cap ? cap.map : null);
      sendResponse({ ok: true });
    });
  }

  window.__tuyewnReader = {
    open,
    destroy,
    alive: () => {
      try {
        return !!chrome.runtime?.id;
      } catch {
        return false;
      }
    },
  };
})();
