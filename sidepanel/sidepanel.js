import { dataUrlToBlob, prepareFullRegion, submitToLens } from '../lens/lens.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const el = {
  thumb: $('thumb'), loadText: $('loadText'), dims: $('dims'), sub: $('subText'), frameHost: $('frameHost'), banner: $('banner'),
  retry: $('retry'), openTab: $('openTab'), close: $('close'), back: $('back'),
  errTitle: $('errTitle'), errMsg: $('errMsg'), shortcut: $('shortcut')
};

// Each panel belongs to one tab (tabId comes from the URL set in background.js).
const TAB_ID = Number(new URLSearchParams(location.search).get('tabId'));
const KEY = `lensState:${TAB_ID}`;

let lastTs = 0, current = null, runId = 0, slowTimer = null, forceTimer = null, graceTimer = null;

const setView = (v) => { body.dataset.view = v; };
const setBusy = (b) => { if (b) body.dataset.busy = '1'; else delete body.dataset.busy; };
const clearTimers = () => { clearTimeout(slowTimer); clearTimeout(forceTimer); clearTimeout(graceTimer); };

function phase(text) {
  el.sub.textContent = text + '…';
  el.loadText.textContent = text;
}

function done(forced = false) {
  clearTimers();
  setBusy(false);
  el.sub.textContent = forced ? 'Taking long? Try “Open in a tab”.' : 'Results ready';
}

// Fresh iframe + unique name every search. Reusing one frame breaks because
// Google's page can rename its window, so the form target no longer matches.
let activeFrame = null, alive = false, loaded = false;
const GRACE_FALLBACK = 2200; // no watcher inside the Lens page: reveal shortly after it loads
const GRACE_WATCHED = 9000;  // watcher present: wait for its READY signal (this is only a safety cap)

function newFrame(token) {
  el.frameHost.replaceChildren();
  alive = false; loaded = false;
  const f = document.createElement('iframe');
  f.name = 'lensFrame-' + Date.now();
  el.frameHost.appendChild(f);
  activeFrame = f;
  f.addEventListener('load', () => {
    if (token !== runId || !body.dataset.busy) return;
    try { if (f.contentWindow.location.href === 'about:blank') return; } catch (e) { /* cross-origin = real page */ }
    loaded = true;
    clearTimeout(slowTimer);
    phase('Finding matches');
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => done(), alive ? GRACE_WATCHED : GRACE_FALLBACK);
  });
  return f;
}

// Signals from content/lens-watch.js running inside the Lens page
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'lens-side-search') return;
  if (!activeFrame || e.source !== activeFrame.contentWindow) return;
  if (d.type === 'LENS_ALIVE') {
    alive = true;
    if (loaded && body.dataset.busy) { clearTimeout(graceTimer); graceTimer = setTimeout(() => done(), GRACE_WATCHED); }
  } else if (d.type === 'LENS_READY' && body.dataset.busy) {
    clearTimeout(graceTimer);
    setTimeout(() => done(), 150); // let the first paint land, then fade the loader out
  }
});

async function runLens(s) {
  const token = ++runId;
  current = s;
  clearTimers();
  el.thumb.src = s.image;
  el.thumb.hidden = false;
  el.dims.textContent = s.dims ? `${s.dims.w} × ${s.dims.h}` : '';
  el.retry.hidden = false;
  el.openTab.hidden = false;
  el.banner.hidden = true;
  setView('result');
  setBusy(true);
  phase('Searching Google Lens');
  const f = newFrame(token);
  const blob = dataUrlToBlob(s.image);
  try { await prepareFullRegion(blob); } catch (e) { console.warn('region rule failed', e); }
  if (token !== runId) return; // a newer search took over
  submitToLens(blob, f.name);
  slowTimer = setTimeout(() => { phase('Still working'); }, 8000);
  forceTimer = setTimeout(() => done(true), 14000);
}

function showError(title, message) {
  clearTimers();
  runId++;
  setBusy(false);
  el.errTitle.textContent = title || 'Something went wrong';
  el.errMsg.textContent = message || 'Try selecting again.';
  el.back.hidden = !current;
  el.banner.hidden = true;
  setView('error');
}

function render(s) {
  if (!s) { setView(current ? 'result' : 'empty'); return; }
  switch (s.status) {
    case 'selecting':
      el.banner.hidden = !current;               // slim banner if a result is on screen
      setView(current ? 'result' : 'selecting');
      break;
    case 'capturing':                            // instant feedback while the area is captured
      runId++;
      clearTimers();
      el.frameHost.replaceChildren();
      el.thumb.hidden = true;
      el.dims.textContent = '';
      el.banner.hidden = true;
      phase('Capturing');
      setBusy(true);
      setView('result');
      break;
    case 'idle':
      el.banner.hidden = true;
      setView(current ? 'result' : 'empty');
      break;
    case 'error':
      showError(s.title, s.message);
      break;
    case 'ready':
      if (s.ts === lastTs) return;
      lastTs = s.ts;
      runLens(s);
      break;
  }
}

// show the real shortcut (user may have changed it)
function renderShortcut(text) {
  el.shortcut.replaceChildren();
  if (!text) { el.shortcut.textContent = 'Click the toolbar icon to start.'; return; }
  text.split('+').forEach((k, i, a) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    el.shortcut.appendChild(kbd);
    if (i < a.length - 1) el.shortcut.appendChild(document.createTextNode('+'));
  });
}
chrome.commands.getAll().then((cmds) => {
  renderShortcut(cmds.find((c) => c.name === '_execute_action')?.shortcut);
}).catch(() => renderShortcut(''));

el.retry.addEventListener('click', () => current && runLens(current));
el.openTab.addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`fallback/lens-tab.html?tabId=${TAB_ID}`) }));
el.back.addEventListener('click', () => setView('result'));
el.close.addEventListener('click', async () => {
  try {
    if (chrome.sidePanel.close) { await chrome.sidePanel.close({ tabId: TAB_ID }); return; }
  } catch (e) { /* fall through */ }
  window.close();
});

chrome.storage.session.get(KEY).then((r) => render(r[KEY]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[KEY]) render(changes[KEY].newValue);
});
