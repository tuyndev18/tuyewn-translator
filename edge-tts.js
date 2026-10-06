// Microsoft Edge "Read aloud" neural TTS client — runs in the offscreen document.
// (declarativeNetRequest header rules apply to extension pages, not to the service worker.)

const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_GEC_VERSION = '1-140.0.3485.14';

async function edgeGec() {
  let ticks = Date.now() / 1000 + 11644473600; // Windows file-time epoch, seconds
  ticks -= ticks % 300; // rounded down to 5 minutes
  ticks *= 1e7; // 100 ns units
  const data = new TextEncoder().encode(`${ticks.toFixed(0)}${EDGE_TTS_TOKEN}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function edgeTts(text, voice, rate) {
  text = text.replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!text) throw new Error('empty text');
  if (!/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(voice)) throw new Error('bad voice');
  const lang = voice.slice(0, 5);
  const pct = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  const id = crypto.randomUUID().replace(/-/g, '');
  const url = `${EDGE_TTS_URL}?TrustedClientToken=${EDGE_TTS_TOKEN}&Sec-MS-GEC=${await edgeGec()}&Sec-MS-GEC-Version=${EDGE_GEC_VERSION}&ConnectionId=${id}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const parts = [];
    const words = [];
    const timer = setTimeout(() => fail(new Error('Edge TTS timeout')), 20000);
    function fail(err) {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(err);
    }
    ws.onopen = () => {
      const date = new Date().toString();
      ws.send(
        `X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}'
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
        `<voice name='${voice}'><prosody pitch='+0Hz' rate='${pct >= 0 ? '+' : ''}${pct}%' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data.includes('Path:audio.metadata')) {
          const meta = JSON.parse(e.data.slice(e.data.indexOf('\r\n\r\n') + 4));
          for (const m of meta.Metadata || []) {
            if (m.Type === 'WordBoundary') words.push({ text: m.Data.text.Text, at: m.Data.Offset / 1e4, dur: m.Data.Duration / 1e4 });
          }
        } else if (e.data.includes('Path:turn.end')) {
          clearTimeout(timer);
          ws.close();
          const total = parts.reduce((n, p) => n + p.length, 0);
          if (!total) return reject(new Error('Edge TTS: no audio'));
          const all = new Uint8Array(total);
          let off = 0;
          for (const p of parts) {
            all.set(p, off);
            off += p.length;
          }
          resolve({ audio: toBase64(all), words });
        }
      } else {
        const view = new DataView(e.data);
        const headLen = view.getUint16(0);
        parts.push(new Uint8Array(e.data, 2 + headLen));
      }
    };
    ws.onerror = () => fail(new Error('Edge TTS: không kết nối được (mạng hoặc dịch vụ thay đổi)'));
    ws.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 1005) fail(new Error(`Edge TTS closed (${e.code})`));
    };
  });
}
