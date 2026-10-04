// Runs inside Google pages, but does nothing unless the page is the Lens frame embedded in
// THIS extension's side panel. Tells the panel when results have actually rendered,
// so the loading animation can last exactly as long as needed.
(() => {
  if (window.top === window) return;                       // normal tabs: bail out immediately
  const anc = location.ancestorOrigins;
  if (!anc || anc.length !== 1 || anc[0] !== 'chrome-extension://' + chrome.runtime.id) return;

  const target = anc[0];
  const send = (type, why) => window.parent.postMessage({ source: 'lens-side-search', type, why }, target);
  send('LENS_ALIVE');

  let notified = false, lastMutation = Date.now();
  const mo = new MutationObserver(() => { lastMutation = Date.now(); });
  mo.observe(document, { childList: true, subtree: true, attributes: true });

  const timer = setInterval(() => {
    if (notified || !document.body) return;
    const quiet = Date.now() - lastMutation;
    const images = [...document.images].filter((i) => i.complete && i.naturalWidth > 60 && i.naturalHeight > 60).length;
    const nodes = document.getElementsByTagName('*').length;
    let why = null;
    if (images >= 4 && quiet > 250) why = 'images';        // result thumbnails are on screen
    else if (nodes > 400 && quiet > 1500) why = 'settled'; // text-style results: page stopped changing
    if (why) {
      notified = true;
      clearInterval(timer);
      mo.disconnect();
      send('LENS_READY', why);
    }
  }, 150);
})();
