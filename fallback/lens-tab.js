import { dataUrlToBlob, prepareFullRegion, submitToLens } from '../lens/lens.js';

const KEY = `lensState:${new URLSearchParams(location.search).get('tabId')}`;
const lensState = (await chrome.storage.session.get(KEY))[KEY];
if (lensState?.image) {
  const blob = dataUrlToBlob(lensState.image);
  try { await prepareFullRegion(blob); } catch (e) { console.warn(e); }
  submitToLens(blob, '_self');
} else {
  document.body.textContent = 'No image yet. Select an area first.';
}
