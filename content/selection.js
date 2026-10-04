// Injected on demand. Draws the overlay, lets the user drag a rectangle, reports it.
(() => {
  if (window.__lensSideSearchCancel) window.__lensSideSearchCancel(false);

  const MIN = 10;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      #ov{position:fixed;inset:0;cursor:crosshair;background:rgba(10,12,16,.5);
          touch-action:none;user-select:none;animation:in .14s ease-out}
      #ov.drag{background:transparent}
      #box{position:fixed;display:none;border:1.5px solid rgba(255,255,255,.95);
           box-shadow:0 0 0 100vmax rgba(10,12,16,.55)}
      .c{position:absolute;width:16px;height:16px;border:0 solid #7aa2ff}
      .tl{left:-3px;top:-3px;border-top-width:3px;border-left-width:3px;border-top-left-radius:4px}
      .tr{right:-3px;top:-3px;border-top-width:3px;border-right-width:3px;border-top-right-radius:4px}
      .bl{left:-3px;bottom:-3px;border-bottom-width:3px;border-left-width:3px;border-bottom-left-radius:4px}
      .br{right:-3px;bottom:-3px;border-bottom-width:3px;border-right-width:3px;border-bottom-right-radius:4px}
      #dim{position:fixed;display:none;padding:3px 8px;border-radius:6px;background:#16181d;color:#fff;
           font:500 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;
           box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap}
      #tip{position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;
           padding:9px 14px;border-radius:999px;background:rgba(22,24,29,.9);-webkit-backdrop-filter:blur(10px);
           backdrop-filter:blur(10px);color:#fff;font:13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
           pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .15s}
      #tip.hide{opacity:0}
      kbd{padding:2px 6px;border-radius:5px;background:rgba(255,255,255,.16);font:600 11px/1.3 inherit}
      @keyframes in{from{opacity:0}to{opacity:1}}
      @media (prefers-reduced-motion:reduce){#ov{animation:none}#tip{transition:none}}
    </style>
    <div id="ov"></div>
    <div id="box"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></div>
    <div id="dim"></div>
    <div id="tip">Drag to select an area <kbd>Esc</kbd> to cancel</div>`;
  const ov = root.getElementById('ov');
  const box = root.getElementById('box');
  const dim = root.getElementById('dim');
  const tip = root.getElementById('tip');
  document.documentElement.appendChild(host);

  let sx = 0, sy = 0, dragging = false, rect = null;
  const clampX = (v) => Math.min(Math.max(v, 0), window.innerWidth);
  const clampY = (v) => Math.min(Math.max(v, 0), window.innerHeight);

  function placeBadge(r) {
    dim.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    dim.style.display = 'block';
    const bw = dim.offsetWidth, bh = dim.offsetHeight;
    let top = r.y + r.height + 8;
    if (top + bh > window.innerHeight - 4) top = r.y - bh - 8;          // flip above
    if (top < 4) top = Math.max(4, r.y + r.height - bh - 8);            // else sit inside
    const left = Math.min(Math.max(4, r.x), window.innerWidth - bw - 4);
    dim.style.top = top + 'px';
    dim.style.left = left + 'px';
  }

  function draw(x, y) {
    const l = Math.min(sx, x), t = Math.min(sy, y);
    rect = { x: l, y: t, width: Math.abs(x - sx), height: Math.abs(y - sy) };
    Object.assign(box.style, {
      display: 'block', left: l + 'px', top: t + 'px',
      width: rect.width + 'px', height: rect.height + 'px'
    });
    placeBadge(rect);
  }

  function reset() {
    dragging = false; rect = null;
    box.style.display = 'none';
    dim.style.display = 'none';
    ov.classList.remove('drag');
    tip.classList.remove('hide');
  }

  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ov.setPointerCapture(e.pointerId);
    dragging = true;
    sx = clampX(e.clientX); sy = clampY(e.clientY);
    ov.classList.add('drag');
    tip.classList.add('hide');
    draw(sx, sy);
  });
  ov.addEventListener('pointermove', (e) => {
    if (dragging) draw(clampX(e.clientX), clampY(e.clientY));
  });
  ov.addEventListener('pointerup', async (e) => {
    if (!dragging) return;
    draw(clampX(e.clientX), clampY(e.clientY));
    const r = rect;
    if (r.width < MIN || r.height < MIN) { reset(); return; } // tiny/click: stay in select mode
    cleanup();
    // let the page repaint without the overlay so it isn't in the screenshot
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    await new Promise((res) => setTimeout(res, 80));
    chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETE', rect: r, viewportWidth: window.innerWidth });
  });
  ov.addEventListener('pointercancel', reset);

  // block page scrolling while selecting
  ov.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  ov.addEventListener('contextmenu', (e) => e.preventDefault());

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      cancel(true);
    }
  }
  window.addEventListener('keydown', onKey, true);

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    delete window.__lensSideSearchCancel;
  }
  function cancel(notify) {
    cleanup();
    if (notify) chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
  }
  window.__lensSideSearchCancel = cancel;
})();
