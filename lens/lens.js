// Lens request layer. If Google changes things, this is the ONLY file to fix.
// Upload = multipart POST with the image in field "encoded_image".
export const LENS_UPLOAD_URL = 'https://lens.google.com/v3/upload';

// Lens normally auto-picks one object inside the image. When true, we rewrite the
// result URL so the search region is the WHOLE selected area. EXPERIMENTAL, off by default.
export const SEARCH_FULL_AREA = false;

const GOOGLE_DOMAINS = ['google.com', 'google.com.pk'];

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---- "whole image" region, encoded the way Lens result URLs (param vsint) encode it ----
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return o; };
const f32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...b]; };
const tag = (field, wire) => varint((field << 3) | wire);
const lenField = (field, bytes) => [...tag(field, 2), ...varint(bytes.length), ...bytes];

export function buildFullRegionParam(w, h) {
  // box = center x, center y, width, height (all normalised): 0.5, 0.5, 1, 1 = entire image
  const box = [...tag(1, 5), ...f32(0.5), ...tag(2, 5), ...f32(0.5), ...tag(3, 5), ...f32(1), ...tag(4, 5), ...f32(1), ...tag(6, 0), ...varint(1)];
  const inner = [...lenField(1, box), ...tag(2, 0), ...varint(w), ...tag(3, 0), ...varint(h), ...tag(4, 5), ...f32(1)];
  const header = [8, 2, 42, 12, 10, 2, 8, 7, 18, 2, 8, 10, 24, 1, 32, 1];
  const bytes = [...header, ...lenField(7, inner)];
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Redirect rule: only for requests started by THIS extension, only URLs that carry a Lens session id.
// The "allow" rule on lsfull=1 stops the redirect from looping.
export async function prepareFullRegion(blob) {
  const remove = [3, 4];
  if (!SEARCH_FULL_AREA) { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: remove }); return; }
  const bmp = await createImageBitmap(blob);
  const vsint = buildFullRegionParam(bmp.width, bmp.height);
  const base = {
    requestDomains: GOOGLE_DOMAINS,
    initiatorDomains: [chrome.runtime.id],
    resourceTypes: ['sub_frame', 'main_frame']
  };
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: remove,
    addRules: [
      { id: 4, priority: 5, action: { type: 'allow' }, condition: { ...base, urlFilter: 'lsfull=1' } },
      {
        id: 3, priority: 1,
        action: { type: 'redirect', redirect: { transform: { queryTransform: { addOrReplaceParams: [
          { key: 'vsint', value: vsint }, { key: 'lsfull', value: '1' }
        ] } } } },
        condition: { ...base, urlFilter: 'vsrid=' }
      }
    ]
  });
}

// target: iframe name (side panel) or "_self" (fallback tab)
export function submitToLens(blob, target) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = `${LENS_UPLOAD_URL}?hl=en&re=df&st=${Date.now()}&ep=ccm`;
  form.target = target;
  form.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'encoded_image';
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' }));
  input.files = dt.files;

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
