// Offscreen document: synthesizes natural speech with Edge neural voices (edge-tts.js).
// It runs here, not in the service worker, because the declarativeNetRequest header rule
// (rules.json) applies to extension pages but not to service-worker requests.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'OFF_TTS') return;
  edgeTts(String(msg.text || ''), String(msg.voice || ''), Number(msg.rate) || 1).then(sendResponse, (err) =>
    sendResponse({ error: err.message })
  );
  return true;
});
