// Service worker: trigger -> per-tab panel -> selection -> capture -> crop -> store -> panel searches Lens.

const GOOGLE_DOMAINS = ['google.com', 'google.com.pk'];
const MAX_SIDE = 1600;      // downscale big selections before upload
const USE_MOBILE_UA = true; // ask Google for its mobile layout (works in narrow panels). Set false to disable.
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// ---- network rules (only touch Google sub-frames) ----
async function installRules() {
  const condition = {
    requestDomains: GOOGLE_DOMAINS,
    initiatorDomains: [chrome.runtime.id, ...GOOGLE_DOMAINS],
    resourceTypes: ['sub_frame']
  };
  // 1) let Google load inside our iframe
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1, priority: 10, condition,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' }
        ]
      }
    }]
  });
  // 2) mobile layout (separate so a failure here can't break rule 1)
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [2],
      addRules: USE_MOBILE_UA ? [{
        id: 2, priority: 10, condition,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'user-agent', operation: 'set', value: MOBILE_UA }]
        }
      }] : []
    });
  } catch (e) { console.warn('mobile UA rule failed', e); }
}
chrome.runtime.onInstalled.addListener(installRules);
chrome.runtime.onStartup.addListener(installRules);
installRules().catch((e) => console.error('installRules', e)); // also on every worker start
// NOTE: priority 10 must stay ABOVE the session 'allow' rule (5) in lens.js, or header edits get ignored.

// No global panel: it only exists on tabs where the user opened it.
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});

// ---- per-tab state ----
const key = (tabId) => `lensState:${tabId}`;
const setState = (tabId, s) => chrome.storage.session.set({ [key(tabId)]: { ...s, ts: Date.now() } });
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));

// Toolbar click AND Ctrl+Shift+X (_execute_action) both land here.
chrome.action.onClicked.addListener((tab) => {
  // Keep these two calls first and un-awaited: open() needs the user gesture.
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: `sidepanel/sidepanel.html?tabId=${tab.id}`,
    enabled: true
  }).catch((e) => console.error('setOptions', e));
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('open', e));
  startSelection(tab);
});

async function startSelection(tab) {
  await setState(tab.id, { status: 'selecting' });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/selection.js'] });
  } catch (e) {
    await setState(tab.id, {
      status: 'error',
      title: "Can't select on this page",
      message: 'Browser pages and the web store block extensions. Open a normal website and try again.'
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  if (!tab) return;
  if (msg?.type === 'SELECTION_COMPLETE') {
    handleSelection(msg, tab)
      .then(() => sendResponse({ ok: true }))
      .catch(async (e) => {
        console.error(e);
        await setState(tab.id, { status: 'error', title: "Couldn't capture the area", message: String(e?.message || e) + '. Try selecting again.' });
        sendResponse({ ok: false });
      });
    return true; // async response
  }
  if (msg?.type === 'SELECTION_CANCELLED') setState(tab.id, { status: 'idle' });
});

async function handleSelection(msg, tab) {
  const { rect, viewportWidth } = msg;
  await setState(tab.id, { status: 'capturing' }); // panel shows loading right away
  const shotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const shot = await (await fetch(shotUrl)).blob();
  const bmp = await createImageBitmap(shot);

  // Real scale = screenshot pixels / CSS pixels. Handles zoom + devicePixelRatio together.
  const scale = bmp.width / viewportWidth;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bmp.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(bmp.height - sy, Math.round(rect.height * scale));
  if (sw < 2 || sh < 2) throw new Error('Selection outside visible area');

  const down = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * down));
  const dh = Math.max(1, Math.round(sh * down));

  const canvas = new OffscreenCanvas(dw, dh);
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });

  await setState(tab.id, {
    status: 'ready',
    image: toDataUrl(await out.arrayBuffer(), 'image/jpeg'),
    dims: { w: Math.round(rect.width), h: Math.round(rect.height) }
  });
}

function toDataUrl(buf, mime) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
