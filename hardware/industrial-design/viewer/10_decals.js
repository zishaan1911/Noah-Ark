  // ---- livery: printed markings conformed to the shell
  // Each marking is cut from the shell's own triangles, not boxed out by a fixed projector: find the surface, average
  // its normal over a patch, sample the surface heights under the marking, keep only the triangles that lie on that
  // surface, and lay the artwork out by arc length along the reading direction, so it wraps the curved hub sides and
  // arm tops like a vinyl sheet instead of stretching.
  const decals = [];
  { // block scope: the modules share one function scope
  const INK = '#1d2226', GREY = '#5f676c', ORANGE = '#e8621c', LIGHT = '#f4f3ef';
  const COND = '"Barlow Condensed", "Arial Narrow", sans-serif', MONO = '"JetBrains Mono", Consolas, monospace';
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const redraws = [];
  const redrawAll = () => redraws.forEach(f => f());

  // Artwork canvas laid out in millimetres of the finished marking; ~2048 px on the long side so text stays crisp.
  function artwork(wMm, hMm, draw, px = 2048) {
    const k = px / Math.max(wMm, hMm), cv = document.createElement('canvas');
    cv.width = Math.round(wMm * k); cv.height = Math.round(hMm * k);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
    const f = () => { const g = cv.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, wMm, hMm); draw(g); t.needsUpdate = true; };
    f(); redraws.push(f);
    return t;
  }
  if (document.fonts && document.fonts.load) {
    Promise.all([`700 40px ${COND}`, `600 40px ${COND}`, `500 40px ${MONO}`].map(s => document.fonts.load(s))).then(redrawAll, () => {});
  }
  // downloaded artwork (industrial-design/livery/SOURCES.md), drawn at its true aspect read from the PNG header
  const logo = {};
  for (const [k, uri] of Object.entries(A.livery || {})) {
    const b = atob(uri.slice(uri.indexOf(',') + 1, uri.indexOf(',') + 45));
    const u32 = o => ((b.charCodeAt(o) << 24) | (b.charCodeAt(o + 1) << 16) | (b.charCodeAt(o + 2) << 8) | b.charCodeAt(o + 3)) >>> 0;
    const im = new Image(); im.onload = redrawAll; im.src = uri;
    logo[k] = { im, aspect: u32(16) / u32(20) };
  }
  const drawLogo = (g, k, x, y, h) => { const l = logo[k]; if (!l) return 0; if (l.im.complete && l.im.naturalWidth) g.drawImage(l.im, x, y, h * l.aspect, h); return h * l.aspect; };
  const logoW = (k, h) => (logo[k] ? h * logo[k].aspect : 0);
  // Seventh Axis mark: the exact path from SlipStream (Gannet SX-01 livery), drawn in a 64-unit box
  const SEVENTH_AXIS = new Path2D('M11.1 8H52.9L22.2 56H16L43.1 13.7H11.1ZM17.7 34.2a14.4 14.4 0 1 0 28.8 0a14.4 14.4 0 1 0-28.8 0Z');
  const drawAxis = (g, x, y, size, col) => { g.save(); g.translate(x, y); g.scale(size / 64, size / 64); g.fillStyle = col; g.fill(SEVENTH_AXIS, 'evenodd'); g.restore(); };
  const text = (g, s, x, y, font, col, align = 'left', track = 0) => {
    g.font = font; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = track + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  // speed stripe: a bar with raked ends
  const stripe = (g, x0, x1, y, h, col, rake = h) => { g.fillStyle = col; g.beginPath(); g.moveTo(x0 + rake, y); g.lineTo(x1, y); g.lineTo(x1 - rake, y + h); g.lineTo(x0, y + h); g.closePath(); g.fill(); };
  const hazard = (g, x, y, s) => { // ISO 7010 style warning triangle
    g.fillStyle = '#f2b21b'; g.strokeStyle = INK; g.lineWidth = s * 0.09; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x + s / 2, y); g.lineTo(x + s, y + s * 0.88); g.lineTo(x, y + s * 0.88); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = INK; g.fillRect(x + s * 0.46, y + s * 0.3, s * 0.08, s * 0.32); g.fillRect(x + s * 0.46, y + s * 0.68, s * 0.08, s * 0.08);
  };
  const REG = 'ARK-001';
  const pack = (A.chosen && A.chosen.pack) || '12S4P';
  const kwh = A.chosen && A.chosen.pack_kwh ? `  ·  ${A.chosen.pack_kwh.toFixed(2)} kWh` : '';

  // ---- artwork
  // hub flanks (280 x 70 mm): flag, registration and model, maker's mark, orange belt line
  const flankTex = artwork(280, 70, g => {
    const fw = logoW('flag-of-malaysia', 22);
    drawLogo(g, 'flag-of-malaysia', 12, 13, 22);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(12, 13, fw, 0.4); g.fillRect(12, 34.6, fw, 0.4);
    text(g, REG, 12 + fw + 7, 35, `700 33px ${COND}`, INK, 'left', 0.8);
    text(g, 'ARK-1  ·  AMPHIBIOUS DELIVERY', 12, 47, `600 9px ${COND}`, GREY, 'left', 1.2);
    drawAxis(g, 214, 3, 48, INK);
    stripe(g, 0, 280, 53, 7, ORANGE, 7);
    stripe(g, 20, 262, 63, 1.6, INK, 1.6);
  });
  // nose (230 x 70 mm): operator and cloud partner
  const noseTex = artwork(230, 70, g => {
    const gw = logoW('gdex-logo', 30), aw = logoW('aws-logo', 27), gap = 22, x0 = (230 - gw - aw - 2 * gap) / 2;
    drawLogo(g, 'gdex-logo', x0, 12, 30);
    g.fillStyle = 'rgba(29,34,38,0.35)'; g.fillRect(x0 + gw + gap - 0.4, 13, 0.8, 28);
    drawLogo(g, 'aws-logo', x0 + gw + 2 * gap, 13, 27);
    stripe(g, 0, 230, 57, 7, ORANGE, 7);
    stripe(g, 18, 212, 66, 1.6, INK, 1.6);
  });
  // tail (200 x 34 mm, the strip above the battery bay): registration and the bay's caution label
  const tailTex = artwork(200, 34, g => {
    text(g, REG, 10, 24, `700 23px ${COND}`, INK, 'left', 0.6);
    stripe(g, 10, 96, 28.5, 3, ORANGE, 3);
    const x = 108, y = 3.5, w = 84, h = 28.5;
    g.fillStyle = LIGHT; g.fillRect(x, y, w, h);
    g.fillStyle = '#f2b21b'; g.fillRect(x, y, w, 9);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    hazard(g, x + 3, y + 1.3, 7);
    text(g, 'CAUTION  ·  BATTERY BAY', x + 13, y + 7.2, `700 6.4px ${COND}`, INK, 'left', 0.4);
    text(g, `Li-ion ${pack}  ·  44.4 V${kwh}`, x + 3.5, y + 17, `600 6px ${COND}`, INK);
    text(g, 'DISARM BEFORE OPENING', x + 3.5, y + 24.5, `500 4.3px ${MONO}`, INK, 'left', 0.1);
  });
  // hub roof (190 x 70 mm): the maker's lockup
  const roofTex = artwork(190, 70, g => {
    drawAxis(g, 4, 6, 58, INK);
    text(g, 'ARK-1', 66, 42, `700 44px ${COND}`, INK, 'left', 1);
    stripe(g, 67, 186, 49, 3.2, ORANGE, 3.2);
    text(g, 'SEVENTH AXIS', 67, 62, `600 9.5px ${COND}`, GREY, 'left', 2.4);
  });
  // arm tip bands (140 x 36 mm, wrap across the arm): motor number and spin direction, read from the motor end
  const bandTex = (n, ccw) => artwork(140, 36, g => {
    g.fillStyle = ORANGE; g.fillRect(0, 0, 140, 36);
    g.fillStyle = INK; g.fillRect(0, 0, 140, 1.6); g.fillRect(0, 34.4, 140, 1.6);
    text(g, 'M' + n, 64, 27, `700 22px ${COND}`, INK, 'right', 0.5);
    // rotation arrow, as seen from above
    const cx = 80, cy = 18, r = 8.5;
    g.strokeStyle = INK; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r, ccw ? -0.2 : Math.PI + 0.2, ccw ? Math.PI * 1.25 : -Math.PI * 0.25, !ccw); g.stroke();
    const a = ccw ? Math.PI * 1.25 : -Math.PI * 0.25, tx = cx + r * Math.cos(a), ty = cy + r * Math.sin(a);
    const d = ccw ? a - Math.PI / 2 : a + Math.PI / 2; // tangent along travel
    g.fillStyle = INK; g.beginPath();
    g.moveTo(tx + 5 * Math.cos(d), ty + 5 * Math.sin(d));
    g.lineTo(tx + 4 * Math.cos(d + 2.3), ty + 4 * Math.sin(d + 2.3));
    g.lineTo(tx + 4 * Math.cos(d - 2.3), ty + 4 * Math.sin(d - 2.3)); g.closePath(); g.fill();
    text(g, ccw ? 'CCW' : 'CW', 93, 22, `600 8px ${COND}`, INK, 'left', 0.6);
  }, 1024);
  // arm safety strip (120 x 20 mm), reads from the hub out
  const keepClearTex = artwork(120, 20, g => {
    hazard(g, 2, 3, 13);
    text(g, 'PROPELLER DANGER', 19, 10.5, `700 8.6px ${COND}`, INK, 'left', 0.5);
    text(g, 'KEEP CLEAR WHEN ARMED', 19, 17.4, `500 4.6px ${MONO}`, GREY, 'left', 0.2);
  }, 1024);

  // ---- fitting
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const P = body && body.geometry.attributes.position.array, NR = body && body.geometry.attributes.normal.array;
  const IX = body && (body.geometry.index ? body.geometry.index.array : null);
  const triCount = body ? (IX ? IX.length : P.length / 3) / 3 : 0;
  const vi = (t, k) => (IX ? IX[t * 3 + k] : t * 3 + k);
  const vtx = i => V(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const _ray = new THREE.Ray(), _hit = new THREE.Vector3();
  // nearest hit of a drone-frame ray on a triangle list -> { p, n (face normal), t }
  function castOn(tris, o, d) {
    _ray.set(o, d); let best = null;
    for (const [a, b, c] of tris) {
      if (!_ray.intersectTriangle(a, b, c, true, _hit)) continue;
      const t = _hit.distanceTo(o);
      if (!best || t < best.t) best = { t, p: _hit.clone(), n: V().subVectors(c, b).cross(V().subVectors(a, b)).normalize() };
    }
    if (best && best.n.dot(d) > 0) best.n.negate();
    return best;
  }
  // triangles with a vertex within r of p (drone frame)
  function near(p, r) {
    const out = [], r2 = r * r;
    for (let t = 0; t < triCount; t++) {
      const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
      const d2 = i => (P[i * 3] - p.x) ** 2 + (P[i * 3 + 1] - p.y) ** 2 + (P[i * 3 + 2] - p.z) ** 2;
      if (d2(a) < r2 || d2(b) < r2 || d2(c) < r2) out.push([vtx(a), vtx(b), vtx(c), t]);
    }
    return out;
  }
  // Clip a polygon of {u, v, p, n} to u*s <= lim along axis 'u' or 'v'.
  function clip(poly, ax, s, lim) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const A0 = poly[i], B0 = poly[(i + 1) % poly.length], da = A0[ax] * s - lim, db = B0[ax] * s - lim;
      if (da <= 0) out.push(A0);
      if ((da < 0) !== (db < 0) && da !== db) {
        const k = da / (da - db);
        out.push({ u: A0.u + (B0.u - A0.u) * k, v: A0.v + (B0.v - A0.v) * k, p: A0.p.clone().lerp(B0.p, k), n: A0.n.clone().lerp(B0.n, k) });
      }
    }
    return out;
  }
  const decalMat = tex => {
    const m = new THREE.MeshPhysicalMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    m.envMapIntensity = 0.8;
    return m;
  };
  /**
   * Conform a marking to the shell.
   * from/dir: a point off the surface and the direction to approach it (drone frame); up: which way is 'up' on the
   * artwork; w/h: finished size in metres; wrap: lay out by arc length along the reading direction (curved faces).
   */
  function apply({ from, dir, up, w, h, tex, wrap = true, name }) {
    const d0 = V(...dir).normalize();
    const all = near(V(...from).addScaledVector(d0, 0.1), 0.35);
    const h0 = castOn(all, V(...from), d0);
    if (!h0) { console.warn('livery: missed the shell', name); return; }
    const R0 = 0.5 * Math.hypot(w, h) + 0.03;
    const tris = all.filter(([a, b, c]) => a.distanceTo(h0.p) < R0 || b.distanceTo(h0.p) < R0 || c.distanceTo(h0.p) < R0);
    // surface normal averaged over a patch around the centre
    const e1 = V().crossVectors(d0, Math.abs(d0.z) < 0.9 ? V(0, 0, 1) : V(1, 0, 0)).normalize(), e2 = V().crossVectors(d0, e1);
    const N = V(), pr = Math.min(w, h) * 0.3;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const o = h0.p.clone().addScaledVector(e1, (i / 2) * pr).addScaledVector(e2, (j / 2) * pr).addScaledVector(d0, -0.05);
      const hit = castOn(tris, o, d0); if (hit) N.add(hit.n);
    }
    N.normalize();
    const c0 = castOn(tris, h0.p.clone().addScaledVector(N, 0.05), N.clone().negate());
    const C = c0 ? c0.p : h0.p;
    const T = V().crossVectors(V(...up), N).normalize(), B = V().crossVectors(N, T);
    // heights of the surface under the marking, along -N
    const m = 0.012, ns = Math.ceil((w + 2 * m) / 0.003), nv = Math.ceil((h + 2 * m) / 0.003);
    const s0 = -w / 2 - m, v0 = -h / 2 - m, ds = (w + 2 * m) / ns, dv = (h + 2 * m) / nv;
    const H = new Float32Array((ns + 1) * (nv + 1)).fill(NaN), down = N.clone().negate();
    // bin the triangles by their footprint in the marking's plane so each ray only tests what it can hit
    const CELL = 0.01, bins = new Map(), key = (i, j) => i * 4096 + j;
    for (const tri of tris) {
      const ss = tri.slice(0, 3).map(p => p.clone().sub(C).dot(T)), vv = tri.slice(0, 3).map(p => p.clone().sub(C).dot(B));
      for (let i = Math.floor(Math.min(...ss) / CELL); i <= Math.floor(Math.max(...ss) / CELL); i++)
        for (let j = Math.floor(Math.min(...vv) / CELL); j <= Math.floor(Math.max(...vv) / CELL); j++) {
          const k = key(i, j); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(tri);
        }
    }
    for (let i = 0; i <= ns; i++) for (let j = 0; j <= nv; j++) {
      const s = s0 + i * ds, v = v0 + j * dv;
      const o = C.clone().addScaledVector(T, s).addScaledVector(B, v).addScaledVector(N, 0.06);
      const hit = castOn(bins.get(key(Math.floor(s / CELL), Math.floor(v / CELL))) || [], o, down);
      if (hit && hit.n.dot(N) > 0.15) H[i * (nv + 1) + j] = hit.p.clone().sub(C).dot(N);
    }
    const hAt = (s, v) => {
      const i = Math.round((Math.min(Math.max(s, s0), -s0) - s0) / ds), j = Math.round((Math.min(Math.max(v, v0), -v0) - v0) / dv);
      return H[i * (nv + 1) + j];
    };
    // arc length along the reading direction on the centre line
    const jc = Math.round(-v0 / dv), arc = new Float32Array(ns + 1), ic = Math.round(-s0 / ds);
    for (let i = ic + 1; i <= ns; i++) { const a = H[(i - 1) * (nv + 1) + jc], b = H[i * (nv + 1) + jc]; arc[i] = arc[i - 1] + (wrap && a === a && b === b ? Math.hypot(ds, b - a) : ds); }
    for (let i = ic - 1; i >= 0; i--) { const a = H[(i + 1) * (nv + 1) + jc], b = H[i * (nv + 1) + jc]; arc[i] = arc[i + 1] - (wrap && a === a && b === b ? Math.hypot(ds, b - a) : ds); }
    const uOf = s => { const f = (s - s0) / ds, i = Math.min(Math.max(Math.floor(f), 0), ns - 1), k = f - i; return arc[i] + (arc[i + 1] - arc[i]) * k - arc[ic]; };
    // keep the triangles that lie on the sampled surface, map and clip them
    const pos = [], nor = [], uv = [], tol = 0.004;
    for (const [a, b, c, t] of tris) {
      const fn = V().subVectors(c, b).cross(V().subVectors(a, b)).normalize();
      if (fn.dot(N) < (wrap ? 0.2 : 0.5)) continue;
      const poly = [];
      let ok = true;
      [a, b, c].forEach((p, k) => {
        const r = p.clone().sub(C), s = r.dot(T), v = r.dot(B), hs = hAt(s, v);
        if (!(Math.abs(r.dot(N) - hs) < tol)) ok = false;
        const ii = vi(t, k);
        poly.push({ u: uOf(s), v, p: p.clone(), n: V(NR[ii * 3], NR[ii * 3 + 1], NR[ii * 3 + 2]) });
      });
      if (!ok) continue;
      let q = clip(poly, 'u', 1, w / 2); q = clip(q, 'u', -1, w / 2); q = clip(q, 'v', 1, h / 2); q = clip(q, 'v', -1, h / 2);
      for (let k = 1; k + 1 < q.length; k++) for (const pt of [q[0], q[k], q[k + 1]]) {
        const n = pt.n.clone().normalize();
        pos.push(...pt.p.clone().addScaledVector(n, 0.0005).toArray()); nor.push(...n.toArray());
        uv.push(pt.u / w + 0.5, pt.v / h + 0.5);
      }
    }
    if (!pos.length) { console.warn('livery: no surface under', name); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const dm = new THREE.Mesh(g, decalMat(tex));
    dm.name = 'livery-' + name; dm.renderOrder = 2; dm.receiveShadow = true; dm.castShadow = false;
    ark.add(dm); decals.push(dm);
  }

  if (body) {
    const zMid = -0.085; // middle of the flat vertical band on all four hub faces (z -0.125 .. -0.045)
    // hub faces: flanks read nose-ward on the right and tail-ward on the left, never mirrored
    [1, -1].forEach(s => apply({ name: s > 0 ? 'flank-left' : 'flank-right', from: [0, s * 0.45, zMid], dir: [0, -s, 0], up: [0, 0, 1], w: 0.28, h: 0.07, tex: flankTex }));
    apply({ name: 'nose', from: [0.45, 0, zMid], dir: [-1, 0, 0], up: [0, 0, 1], w: 0.23, h: 0.07, tex: noseTex });
    // tail: only the strip between the roof edge and the battery bay opening (z -0.082 .. -0.045)
    apply({ name: 'tail', from: [-0.45, 0, -0.0635], dir: [1, 0, 0], up: [0, 0, 1], w: 0.2, h: 0.034, tex: tailTex });
    // roof: forward of the GNSS mast, read from the right side (the hero and side views). A roof mark reads upside
    // down from one side whichever way it faces; the hero wins, so from behind it reads sideways (by design).
    apply({ name: 'roof', from: [0.058, 0, 0.3], dir: [0, 0, -1], up: [0, 1, 0], w: 0.19, h: 0.07, tex: roofTex });
    // arms, ArduPilot quad-X numbering: M1 front-right CCW, M2 rear-left CCW, M3 front-left CW, M4 rear-right CW
    [[1, -1, 1, true], [-1, 1, 2, true], [1, 1, 3, false], [-1, -1, 4, false]].forEach(([sx, sy, n, ccw]) => {
      const a = [sx / Math.SQRT2, sy / Math.SQRT2, 0], at = r => [a[0] * r, a[1] * r, 0.3];
      apply({ name: 'band-M' + n, from: at(0.452), dir: [0, 0, -1], up: [-a[0], -a[1], 0], w: 0.14, h: 0.036, tex: bandTex(n, ccw) });
      apply({ name: 'keep-clear-M' + n, from: at(0.355), dir: [0, 0, -1], up: [-a[1], a[0], 0], w: 0.12, h: 0.02, tex: keepClearTex, wrap: false });
    });
  }

  // ---- livery check: #livery-check renders close-ups of every marking into one full-window sheet (dev aid)
  if (location.hash === '#livery-check') {
    const shots = [ // [camera, target] in the drone frame
      [[0.02, -0.75, -0.06], [0.0, -0.21, -0.085]], [[0.02, 0.75, -0.06], [0.0, 0.21, -0.085]],
      [[0.55, -0.0, -0.06], [0.2, 0, -0.085]], [[-0.55, 0.0, -0.05], [-0.2, 0, -0.07]],
      [[0.06, -0.25, 0.7], [0.06, 0, 0.0]], [[0.75, -0.75, 0.35], [0.3, -0.3, -0.06]],
      [[0.15, 0.15, 0.4], [0.3, 0.3, -0.06]], [[0.15, -0.15, 0.4], [0.3, -0.3, -0.06]],
      [[-0.15, -0.15, 0.4], [-0.3, -0.3, -0.06]],
    ];
    Object.assign(canvas.style, { position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', zIndex: 50 });
    setTimeout(() => {
      const cols = 3, rows = Math.ceil(shots.length / cols), W = canvas.width, H = canvas.height;
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const g = out.getContext('2d'), tw = W / cols, th = H / rows;
      const save = [camera.position.clone(), camera.quaternion.clone(), camera.aspect];
      camera.aspect = tw / th; camera.updateProjectionMatrix();
      shots.forEach(([p, t], i) => {
        camera.position.copy(ark.localToWorld(V(...p))); camera.lookAt(ark.localToWorld(V(...t)));
        renderer.render(scene, camera);
        g.drawImage(renderer.domElement, 0, (H - (W * th / tw)) / 2 > 0 ? 0 : 0, W, H, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
      });
      camera.position.copy(save[0]); camera.quaternion.copy(save[1]); camera.aspect = save[2]; camera.updateProjectionMatrix();
      Object.assign(out.style, { position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', zIndex: 60 });
      document.body.appendChild(out); console.log('livery-check ready', decals.length, 'markings');
    }, 4000);
  }
  }
