// Standalone reader window — used when the reader can't be injected into the page
// (PDF viewer, chrome:// pages, Chrome Web Store, cross-origin iframes…)
chrome.storage.session.get('pendingText').then(({ pendingText }) => {
  chrome.storage.session.remove('pendingText');
  window.__tuyewnReader.open(pendingText || 'Select some English text on a page, right-click and choose Tuyewn Reader.', null);
});
