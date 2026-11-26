// Injected into every page: captions, chapter chip, highlight rings, a visible cursor. window.__ov drives it.
(() => {
  if (window.top !== window) return;
  const css = `
  :host{all:initial}
  .root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Inter,"SF Pro Display","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .chip{position:absolute;left:28px;bottom:182px;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border-radius:999px;
    background:rgba(10,14,22,.82);color:#fff;font-size:15px;font-weight:600;letter-spacing:.02em;backdrop-filter:blur(12px);
    box-shadow:0 6px 24px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:all .5s cubic-bezier(.2,.8,.2,1)}
  .chip b{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#ff6a13;font-size:14px}
  .chip.on{opacity:1;transform:none}
  .cap{position:absolute;left:50%;bottom:40px;transform:translate(-50%,14px);max-width:1280px;width:max-content;padding:18px 30px 20px;
    border-radius:22px;background:rgba(10,14,22,.86);color:#fff;backdrop-filter:blur(14px);box-shadow:0 12px 40px rgba(0,0,0,.35);
    opacity:0;transition:opacity .45s, transform .55s cubic-bezier(.2,.8,.2,1);text-align:center}
  .cap.on{opacity:1;transform:translate(-50%,0)}
  .cap .tag{display:inline-block;margin-bottom:8px;padding:4px 12px;border-radius:999px;background:#ff6a13;color:#fff;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .cap .t{font-size:30px;font-weight:650;line-height:1.25;letter-spacing:-.01em}
  .cap .s{margin-top:6px;font-size:20px;color:#c9d3e0;line-height:1.35}
  .ring{position:absolute;border:4px solid #ff6a13;border-radius:16px;box-shadow:0 0 0 9999px rgba(5,8,14,.38),0 0 28px rgba(255,106,19,.8);
    opacity:0;transition:all .5s cubic-bezier(.2,.8,.2,1)}
  .ring.on{opacity:1}
  .ring::after{content:"";position:absolute;inset:-4px;border-radius:16px;border:4px solid #ff6a13;animation:p 1.6s infinite}
  @keyframes p{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.08)}}
  .lbl{position:absolute;padding:10px 16px;border-radius:12px;background:#ff6a13;color:#fff;font-size:19px;font-weight:650;max-width:440px;line-height:1.3;
    box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:opacity .4s}
  .lbl.on{opacity:1}
  .cur{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid #ff6a13;
    box-shadow:0 2px 10px rgba(0,0,0,.4);transition:transform .12s;left:-50px;top:-50px}
  .cur.down{transform:scale(.7)}
  .rip{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #ff6a13;animation:r .6s ease-out forwards}
  @keyframes r{to{transform:scale(4);opacity:0}}
  .card{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#13233b,#05080e 70%);color:#fff;
    opacity:0;transition:opacity .7s;text-align:center}
  .card.on{opacity:1}
  .card h1{margin:0;font-size:86px;letter-spacing:-.03em;font-weight:750}
  .card h1 span{color:#ff6a13}
  .card p{margin:18px auto 0;font-size:28px;color:#c9d3e0;max-width:1200px;line-height:1.4}
  .card .k{margin-top:34px;font-size:18px;color:#8fa1b8;letter-spacing:.12em;text-transform:uppercase}
  `;
  const mount = () => {
    if (document.getElementById('__ovhost')) return;
    const host = document.createElement('div');
    host.id = '__ovhost';
    const sh = host.attachShadow({ mode: 'open' });
    // DOM APIs, not innerHTML: some pages (PartyRock) enforce Trusted Types.
    const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; parent.appendChild(e); return e; };
    const st = el('style', '', sh); st.textContent = css;
    const root = el('div', 'root', sh);
    el('div', 'card', root); el('div', 'ring', root); el('div', 'lbl', root);
    const ch = el('div', 'chip', root); el('b', '', ch); el('span', '', ch);
    const cp = el('div', 'cap', root); el('div', 'tag', cp); el('div', 't', cp); el('div', 's', cp);
    el('div', 'cur', root);
    // a page zoomed out by the browser profile still gets 1920-wide captions
    const Z = () => innerWidth / 1920;
    root.style.zoom = Z(); addEventListener('resize', () => (root.style.zoom = Z()));
    document.documentElement.appendChild(host);
    const $ = (s) => sh.querySelector(s);
    const cur = $('.cur');
    addEventListener('mousemove', (e) => { cur.style.display = ''; cur.style.left = e.clientX / Z() + 'px'; cur.style.top = e.clientY / Z() + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      cur.classList.add('down');
      const r = document.createElement('div'); r.className = 'rip'; r.style.left = e.clientX / Z() + 'px'; r.style.top = e.clientY / Z() + 'px';
      $('.root').appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
    window.__ov = {
      chip(n, text) { const c = $('.chip'); if (!text) return c.classList.remove('on'); c.querySelector('b').textContent = n; c.querySelector('span').textContent = text; c.classList.add('on'); },
      cap(t, s = '', tag = '') {
        const c = $('.cap');
        if (!t) return c.classList.remove('on');
        c.querySelector('.t').textContent = t; c.querySelector('.s').textContent = s; c.querySelector('.s').style.display = s ? '' : 'none';
        const g = c.querySelector('.tag'); g.textContent = tag; g.style.display = tag ? '' : 'none';
        c.classList.add('on');
      },
      ring(r, label = '', side = 'right') {
        const g = $('.ring'), l = $('.lbl');
        if (!r) { g.classList.remove('on'); l.classList.remove('on'); return; }
        const z = Z(); r = { x: r.x / z, y: r.y / z, width: r.width / z, height: r.height / z };
        const p = 8;
        Object.assign(g.style, { left: r.x - p + 'px', top: r.y - p + 'px', width: r.width + 2 * p + 'px', height: r.height + 2 * p + 'px' });
        g.classList.add('on');
        if (!label) return l.classList.remove('on');
        l.textContent = label;
        const W = 1920;
        let x = side === 'left' ? r.x - p - 460 : side === 'below' || side === 'above' ? r.x : r.x + r.width + p + 20;
        let y = side === 'below' ? r.y + r.height + p + 16 : side === 'above' ? r.y - p - 70 : r.y;
        x = Math.max(20, Math.min(x, W - 470)); y = Math.max(20, y);
        Object.assign(l.style, { left: x + 'px', top: y + 'px' }); l.classList.add('on');
      },
      card(h) { const c = $('.card'); if (!h) return c.classList.remove('on'); c.innerHTML = h; c.classList.add('on'); },
      cursor(on) { cur.style.display = on ? '' : 'none'; },
      clear() { this.cap(''); this.ring(null); },
    };
  };
  if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount);
  new MutationObserver(() => { if (!document.getElementById('__ovhost') && document.documentElement) mount(); }).observe(document, { childList: true, subtree: false });
})();
