  // ---- inflatable pontoons: packed float kit on each skid runner, CO2 inflation, water-landing sequence
  // Engineering numbers come from pontoon_system.json (A.pontoon_system), built by pontoon_system.py.
  const W = R.pontoons; // the template's water plane reads W.waterline_z_m
  { // everything else is block-scoped: the viewer modules share one function scope
  const PS = A.pontoon_system || null;
  const PSG = PS ? PS.geometry : { tube_centre_y_m: W.skid_y_m + 0.004 + PT.d_m / 2 };
  const NOM = PS ? PS.inflation.cases.nominal.times_s : { full_volume_s: 2.7, pressure_ok_s: 3.1, relief_opens_s: 4.1 };
  const CURVE = PS ? PS.inflation.curve.t_s_vol_gauge_kpa_gas_c : [[0, 0, 0, 30], [2.7, 1, 1.5, 0], [3.1, 1, 12, 0], [4.1, 1, 35, 5]];
  const ACT = PS ? PS.inflation.actuation_s : 0.15;
  const P_WORK = PS ? PS.gas.working_gauge_kpa : 25, P_OK = PS ? PS.gas.switch_gauge_kpa : 12, P_REL = PS ? PS.gas.relief_gauge_kpa : 35;
  const T_FULL = ACT + NOM.full_volume_s, T_OK = ACT + NOM.pressure_ok_s, T_END = ACT + NOM.relief_opens_s + 0.6;
  const TR = PS ? PS.trigger : { land_speed_mps: 0.5, fire_alt_m: 6 };
  const part = role => (PS ? PS.mass.parts.find(p => p.role === role) : null) || { product: role, size_mm: '', mass_kg: 0 };
  const grams = p => `${Math.round(p.mass_kg * 1000)} g${p.mass_note && p.mass_note.startsWith('est') ? ' est.' : ''}`;

  const r = PT.d_m / 2, L = PT.length_m, yo = W.skid_y_m, zb = R.mounts.skid_bottom_z_m;
  const TY = PSG.tube_centre_y_m, TZ = W.tube_centre_z_m;
  // pack: tray (bottom + inboard wall) against the runner's outboard face, lid (top + outboard + ends) hinged at the top-inboard edge
  const PK = { x0: -0.18, x1: 0.18, yIn: yo + 0.0015, w: 0.047, z0: zb + 0.002, h: 0.05 };
  const PCY = PK.yIn + PK.w / 2, PCZ = PK.z0 + PK.h / 2, A0 = 0.017, B0 = 0.02;
  const INF = { x: 0.24, y: yo - 0.03, z: zb + 0.045 }; // electrical interface point shared with the harness

  const mat = (color, o = {}) => { const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o)); m.color.convertSRGBToLinear(); m.envMapIntensity = 0.55; return m; };
  const MP = {
    cordura: mat(0xd9561c, { roughness: 0.88 }), cordDark: mat(0xa8400f, { roughness: 0.9 }), loop: mat(0x2a2b2d, { roughness: 1 }),
    web: mat(0x1c1d1f, { roughness: 0.95 }), tan: mat(0xbfa274, { roughness: 0.5 }), hose: mat(0x1e2023, { roughness: 0.32 }),
    brass: mat(0xb48e55, { roughness: 0.3, metalness: 1 }), cyl: mat(0xd8dadc, { roughness: 0.22, metalness: 1 }), red: mat(0xc0281c, { roughness: 0.45 }),
    tube: new THREE.MeshPhysicalMaterial({ color: 0xf2b21b, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    patch: mat(0xe8621c, { roughness: 0.6 }),
  };
  MP.tube.color.convertSRGBToLinear(); MP.tube.envMapIntensity = 0.6;
  const yx = (s, y) => s * y; // mirror helper: s = +1 left, -1 right
  function labelTex(text) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.font = '600 50px "Barlow Condensed", Arial Narrow, sans-serif';
    g.textBaseline = 'middle'; g.fillText(text, 18, 50);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  const kitLabel = labelTex('ARK FLOAT KIT  ·  CO₂  ·  KEEP CLEAR');

  // bladder surface: capsule profile (front cap, body, rear cap); stations s = 0 at the inflator (front) .. 1 at the rear
  const NC = 10, NB = 44, NT = 48, prof = [];
  for (let i = 0; i <= NC; i++) { const a = (i / NC) * Math.PI / 2; prof.push([L / 2 - r + r * Math.cos(a), Math.sin(a)]); }
  for (let i = 1; i < NB; i++) prof.push([L / 2 - r - (L - 2 * r) * i / NB, 1]);
  for (let i = 0; i <= NC; i++) { const a = (1 - i / NC) * Math.PI / 2; prof.push([-(L / 2 - r) - r * Math.cos(a), Math.sin(a)]); }
  const NP = prof.length;
  const clamp01 = v => Math.min(1, Math.max(0, v)), lerp = (a, b, t) => a + (b - a) * t, smooth = t => t * t * (3 - 2 * t);

  // the inflation state is a pure function of the inflation clock tau (s since FIRE): frozen frames and reverse play just work
  function curveAt(t) {
    if (t <= 0) return [0, 0];
    let i = 1; while (i < CURVE.length && CURVE[i][0] < t) i++;
    if (i >= CURVE.length) { const c = CURVE[CURVE.length - 1]; return [c[1], c[2]]; }
    const a = CURVE[i - 1], b = CURVE[i], k = clamp01((t - a[0]) / (b[0] - a[0]));
    return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }
  function stateAt(tau) {
    const [vol, gauge] = curveAt(tau - ACT);
    const u = tau - T_FULL, ov = u > 0 ? 0.022 * Math.exp(-u / 0.32) * Math.sin(u * 2 * Math.PI / 0.55) : 0;
    const lu = tau - ACT - 0.08; // the bag pushes the hook-and-loop seam open just after the gas arrives
    const lid = lu <= 0 ? 0 : 1 - Math.exp(-lu / 0.08) * Math.cos(lu * 10);
    const lever = clamp01(tau / 0.1);
    return { tau, vol: tau <= ACT ? 0 : vol, gauge: tau <= ACT ? 0 : gauge, pr: clamp01(gauge / P_WORK), ov, lid, lever };
  }
  function surf(xf, rf, th, st, s, out) {
    const sn = (L / 2 - xf) / L;
    const f = st.vol >= 0.999 ? 1 : smooth(clamp01((st.vol * 1.3 - sn) / 0.3));
    const g = Math.sqrt(f);
    const cy = lerp(PCY, TY, g), cz = lerp(PCZ, TZ, g);
    const xp = PK.x1 - 0.012 - sn * (PK.x1 - PK.x0 - 0.024);
    const x = lerp(xp, xf * (1 + 0.25 * st.ov), g);
    const rfe = lerp(Math.pow(rf, 0.3), rf, f);
    const a = (A0 + (r - A0) * Math.pow(f, 0.6)) * rfe * (1 + st.ov), b = (B0 + (r - B0) * Math.pow(f, 1.4)) * rfe * (1 + st.ov);
    // creases: a few sharp lengthwise folds + the transverse fold lines from packing; pressure irons them out
    const wr = 0.11 * Math.pow(1 - st.pr, 1.5) + 0.07 * (1 - f);
    const lon = Math.pow(1 - Math.abs(Math.sin(3 * th + 0.5 * Math.sin(9 * sn + s))), 7);
    const tra = Math.pow(1 - Math.abs(Math.sin(Math.PI * 13 * sn + 0.35 * Math.sin(2 * th + s))), 9);
    const pat = 0.6 * lon + 0.5 * tra;
    const k = 1 - wr * pat;
    out[0] = x; out[1] = s * (cy + a * Math.cos(th) * k); out[2] = cz + b * Math.sin(th) * k;
    return f;
  }
  const sides = [];
  [1, -1].forEach(s => {
    const kit = new THREE.Group(); ark.add(kit);
    // tray
    const tray = new THREE.Group();
    tray.add(box(PK.x1 - PK.x0, PK.w, 0.003, MP.cordura, 0, yx(s, PCY), PK.z0 + 0.0015, 0.0012));
    tray.add(box(PK.x1 - PK.x0, 0.003, PK.h, MP.cordura, 0, yx(s, PK.yIn + 0.0015), PCZ, 0.0012));
    tray.add(box(PK.x1 - PK.x0 - 0.01, 0.004, 0.008, MP.loop, 0, yx(s, PK.yIn + PK.w - 0.001), PK.z0 + 0.006, 0.001)); // loop half of the seam
    kit.add(tag(shadowed(tray), 'Float pack tray', '500D TPU-coated Cordura, strapped to the skid runner; the bladder is welded to it'));
    // lid on a hinge along the top-inboard edge (x axis)
    const hinge = new THREE.Group(); hinge.position.set(0, yx(s, PK.yIn), PK.z0 + PK.h); kit.add(hinge);
    const lid = new THREE.Group(); hinge.add(lid);
    lid.add(box(PK.x1 - PK.x0, PK.w, 0.003, MP.cordura, 0, yx(s, PK.w / 2), 0.0015, 0.0012));
    lid.add(box(PK.x1 - PK.x0, 0.003, PK.h, MP.cordura, 0, yx(s, PK.w - 0.0015), -PK.h / 2 + 0.003, 0.0012));
    [-1, 1].forEach(e => lid.add(box(0.003, PK.w, PK.h, MP.cordura, e * (PK.x1 - PK.x0 - 0.003) / 2, yx(s, PK.w / 2), -PK.h / 2 + 0.003, 0.0012)));
    lid.add(box(PK.x1 - PK.x0 - 0.01, 0.0045, 0.009, MP.cordDark, 0, yx(s, PK.w + 0.0005), -PK.h + 0.009, 0.001)); // hook half: the tear seam
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.028), new THREE.MeshBasicMaterial({ map: kitLabel, transparent: true, depthWrite: false }));
    lbl.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, s, 0)));
    lbl.position.set(0, yx(s, PK.w + 0.0012), -PK.h / 2 + 0.006); lid.add(lbl);
    tag(shadowed(lid), 'Float pack lid (tear seam)', 'Hook-and-loop seam along the lower outboard edge: the bladder pushes it open in about 0.1 s and the lid folds back over the runner');

    // straps: over the runner top, down its inboard face, under runner + tray, buckle at the tray's outboard corner
    const straps = new THREE.Group();
    [-0.075, 0, 0.075].forEach(x => { // clear of the rubber skid feet at |x| 0.12-0.15
      straps.add(box(0.025, 0.054, 0.0018, MP.web, x, yx(s, (0.2295 + PK.yIn) / 2), -0.5295, 0.0008));
      straps.add(box(0.025, 0.0018, 0.053, MP.web, x, yx(s, 0.2297), (-0.5815 - 0.529) / 2, 0.0008));
      straps.add(box(0.025, PK.yIn + PK.w - 0.229 + 0.003, 0.0018, MP.web, x, yx(s, (0.229 + PK.yIn + PK.w + 0.003) / 2), -0.5815, 0.0008));
      straps.add(box(0.03, 0.006, 0.012, MP.black, x, yx(s, PK.yIn + PK.w + 0.004), PK.z0 + 0.004, 0.002));
    });
    kit.add(tag(shadowed(straps), 'Tie-down straps ×3', '25 mm nylon webbing round the skid runner, side-release buckles; the tube D-rings clip to the buckles'));

    // inflator assembly at the front leg: connector (harness interface), actuator, inflator head, CO2 cylinder, pressure switch, hose
    const iy = yx(s, INF.y), ax = new THREE.Group(); kit.add(ax);
    const bracket = box(0.003, 0.036, 0.25, M.anod, 0.2418, iy, -0.43, 0.001);
    ax.add(tag(shadowed(bracket), 'Inflator bracket', '3 mm 6061-T6 plate, clamped to the front leg'));
    const conn = cylZ(0.0065, 0.009, M.black, 0, 0, 0, 24); conn.rotation.set(0, Math.PI / 2, 0); conn.position.set(INF.x + 0.001, iy, INF.z);
    ax.add(tag(shadowed(conn), `Firing + pressure connector (${s > 0 ? 'L' : 'R'})`, `4-pin sealed: inflator_${s > 0 ? 'L' : 'R'}.fire (2 wires) + pontoon_${s > 0 ? 'L' : 'R'}.pressure_ok (2 wires)`));
    const actu = new THREE.Group();
    actu.add(box(0.03, 0.032, 0.048, M.black, 0.2595, iy, INF.z - 0.002, 0.004));
    const lever = new THREE.Group(); lever.position.set(0.2755, iy, -0.506);
    lever.add(box(0.004, 0.01, 0.026, MP.red, 0.002, 0, -0.012, 0.001)); actu.add(lever);
    const pa = part('Firing actuator');
    ax.add(tag(shadowed(actu), 'Firing actuator', `${pa.product}; 12 V, ${PS ? PS.firing.current_a : 0.5} A × ${PS ? PS.firing.pulse_s * 1000 : 300} ms (${PS ? PS.firing.energy_j : 1.8} J); ${grams(pa)}`));
    const ph = part('Inflator head'), head = new THREE.Group();
    head.add(box(0.028, 0.03, 0.03, MP.tan, 0.2595, iy, -0.4915, 0.005));
    const port = cylZ(0.004, 0.012, MP.brass, 0, 0, 0, 16); port.rotation.set(Math.PI / 2, 0, 0); port.position.set(0.2595, yx(s, INF.y + 0.018), -0.494); head.add(port);
    ax.add(tag(shadowed(head), 'Inflator head', `${ph.product}; ${grams(ph)}`));
    const pc = part('CO2 cylinder'), cyl = new THREE.Group();
    cyl.add(cylZ(0.016, 0.15, MP.cyl, 0.2595, iy, -0.4765 + 0.075, 40));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.016, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), MP.cyl); dome.rotation.x = Math.PI / 2; dome.position.set(0.2595, iy, -0.3265); cyl.add(dome);
    cyl.add(cylZ(0.0163, 0.03, M.white, 0.2595, iy, -0.43, 40));
    cyl.add(cylZ(0.0065, 0.01, MP.cyl, 0.2595, iy, -0.4815, 20));
    const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.0172, 0.0018, 8, 40), M.anod); clamp.position.set(0.2595, iy, -0.37); cyl.add(clamp);
    ax.add(tag(shadowed(cyl), 'CO₂ cylinder', `${pc.product}; ${PS ? PS.gas.cartridge_g : 60} g for ${PS ? PS.gas.required_g : 41} g needed (×${PS ? PS.gas.cartridge_margin : 1.47}); ${pc.size_mm}; ${grams(pc)}`));
    const sw = part('Pressure switch'), psw = new THREE.Group();
    const swb = cylZ(0.011, 0.016, M.anod, 0, 0, 0, 6); swb.rotation.set(0, Math.PI / 2, 0); swb.position.set(0.2815, iy, -0.4915); psw.add(swb);
    const swc = cylZ(0.0125, 0.012, M.black, 0, 0, 0, 32); swc.rotation.set(0, Math.PI / 2, 0); swc.position.set(0.2955, iy, -0.4915); psw.add(swc);
    ax.add(tag(shadowed(psw), 'Pressure switch', `${sw.product}; closes at ${P_OK} kPa = side inflated (pontoon_${s > 0 ? 'L' : 'R'}.pressure_ok)`));
    const hosePath = new THREE.CatmullRomCurve3([[0.2595, INF.y + 0.024, -0.494], [0.259, 0.283, -0.515], [0.232, 0.297, -0.55], [0.19, 0.3, -0.556], [0.176, 0.302, -0.556]]
      .map(p => new THREE.Vector3(p[0], s * p[1], p[2])));
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hosePath, 40, 0.0035, 12, false), MP.hose);
    ax.add(tag(shadowed(hose), 'Fill hose', `${part('Hose + inlet valve').product}`));
    shadowed(ax);

    // bladder (deformable mesh)
    const pos = new Float32Array(NP * (NT + 1) * 3), idx = [];
    for (let i = 0; i < NP - 1; i++) for (let j = 0; j < NT; j++) {
      const a = i * (NT + 1) + j, b = a + NT + 1, c = b + 1, d = a + 1;
      if (s > 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const tube = new THREE.Mesh(geo, MP.tube); tube.castShadow = true; tube.receiveShadow = true; tube.visible = false; kit.add(tube);
    // bladder fittings that ride on the surface
    const rv = new THREE.Group(); rv.add(cylZ(0.014, 0.008, M.black, 0, 0, 0.004, 32), cylZ(0.009, 0.006, M.anod, 0, 0, 0.011, 24));
    kit.add(tag(shadowed(rv), 'Pressure relief valve', `${part('Relief valve').product}; vents the surplus CO₂ and sun heating (min. flow port Ø${PS ? PS.gas.relief_port_min_mm : 10} mm)`));
    const inlet = cylZ(0.008, 0.012, MP.brass, 0, 0, 0, 20); inlet.rotation.set(0, Math.PI / 2, 0); inlet.position.set(0.178, yx(s, 0.302), -0.556);
    kit.add(tag(shadowed(inlet), 'Bladder inlet check valve', 'Welded to the bladder at the front of the pack; gas enters here and the tube unrolls rearwards'));
    const rings = [-0.075, 0, 0.075].map(x => {
      const g = new THREE.Group();
      g.add(box(0.05, 0.03, 0.002, MP.patch, 0, 0, 0.001, 0.001));
      const d = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0018, 8, 20, Math.PI), M.steel); d.rotation.x = Math.PI / 2; d.position.z = 0.003; g.add(d);
      kit.add(tag(shadowed(g), 'D-ring patch', 'Welded patch + stainless D-ring; clips the tube to the strap buckle'));
      return { g, x };
    });
    sides.push({ s, kit, hinge, lid, tube, geo, pos, rv, rings, lever, last: -1 });
  });
  const PB = part('Bladder');
  sides.forEach(sd => tag(sd.tube, 'Pontoon bladder', `${W.volume_l_each.toFixed(1)} L, Ø${PT.d_m * 1000} × ${PT.length_m * 1000} mm; ${PB.product.split(',')[0]}, TPU-coated, welded; ${P_WORK} kPa working, relief ${P_REL} kPa${PS ? `, seam safety ×${PS.bladder.safety_factor_seam}` : ''}; ${grams(PB)}`));

  const tmp = [0, 0, 0];
  function pose(st) {
    sides.forEach(sd => {
      const s = sd.s;
      sd.hinge.rotation.x = s * 2.18 * st.lid;
      sd.lever.rotation.y = -0.7 * st.lever;
      sd.tube.visible = st.lid > 0.02;
      if (!sd.tube.visible) { sd.rv.visible = false; sd.rings.forEach(q => { q.g.visible = false; }); return; }
      const key = st.tau.toFixed(3);
      if (sd.last !== key) {
        sd.last = key;
        for (let i = 0; i < NP; i++) for (let j = 0; j <= NT; j++) {
          const th = (j / NT) * Math.PI * 2;
          surf(prof[i][0], prof[i][1], th, st, s, tmp);
          const o = (i * (NT + 1) + j) * 3; sd.pos[o] = tmp[0]; sd.pos[o + 1] = tmp[1]; sd.pos[o + 2] = tmp[2];
        }
        sd.geo.attributes.position.needsUpdate = true; sd.geo.computeVertexNormals(); sd.geo.computeBoundingSphere();
      }
      const place = (obj, x, th, lift) => {
        const f = surf(x, 1, th, st, s, tmp), n = new THREE.Vector3(0, s * Math.cos(th), Math.sin(th));
        obj.position.set(tmp[0], tmp[1], tmp[2]).addScaledVector(n, lift);
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        obj.visible = f > 0.9;
      };
      place(sd.rv, -0.21, 1.05, -0.001);
      sd.rings.forEach(q => place(q.g, q.x, -2.25, -0.001));
    });
  }

  // ---- inflation clock: tau runs 0 -> T_END on inflate, back at 3x on deflate (repack), or is pinned by a hash / the landing
  let tau = 0, dir = 0, pinned = false;
  hooks.setInflate = (on, instant) => {
    if (landing) stopLanding(false);
    dir = on ? 1 : -1; pinned = false;
    if (instant || reduce) tau = on ? T_END : 0;
  };
  hooks.inflateNow = () => { if (landing) stopLanding(false); dir = 1; pinned = false; tau = T_END; };

  // ---- HUD + 'Water landing' button
  const stageEl = document.querySelector('.stage'), barEl = document.querySelector('.bar');
  const hud = document.createElement('div');
  hud.setAttribute('role', 'status'); hud.hidden = true;
  hud.style.cssText = 'position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);background:rgba(12,14,15,.84);color:#e9eded;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:9px 11px;font:12px/1.5 var(--mono);pointer-events:none;font-variant-numeric:tabular-nums';
  stageEl.appendChild(hud);
  const landBtn = document.createElement('button');
  landBtn.id = 't-land'; landBtn.textContent = 'Water landing'; landBtn.setAttribute('aria-pressed', 'false');
  barEl.insertBefore(landBtn, document.getElementById('t-cargo'));
  const chip = (txt, on, ok) => `<span style="display:inline-block;margin:2px 4px 0 0;padding:0 6px;border-radius:3px;border:1px solid ${on ? (ok ? '#2bd45a' : '#ff7a33') : '#3a4245'};color:${on ? '#fff' : '#6f7b80'};background:${on ? (ok ? '#13301c' : '#2b2017') : 'transparent'}">${txt}</span>`;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#97a2a6">${k}</span><span>${v}</span></div>`;
  const title = t => `<div style="font:600 13px var(--display);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${t}</div>`;

  // ---- water landing: the drone stays put and the water rises to it (camera follows the drone)
  const LV = TR.land_speed_mps, HF = TR.fire_alt_m, H0 = HF + 1.0, T_FIRE = (H0 - HF) / LV, T_TD = H0 / LV, T_STOP = T_TD + 1.2;
  let landing = null, propW = 0, clockT = 0, landGloss = null;
  const radarBeam = (() => {
    const g = new THREE.ConeGeometry(1, 1, 32, 1, true); g.translate(0, -0.5, 0); g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.set(-0.11, 0, R.mounts.radar_z_m - 0.022); m.visible = false; ark.add(m); return m;
  })();
  const ripples = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: 0xe6f4f4, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; ark.add(m); return m;
  });
  function settle(u) { return u <= 0 ? 0 : 1 - Math.exp(-u / 0.28) * Math.cos(u * 2 * Math.PI / 1.3); }
  function landingAt(T) {
    const h = Math.max(H0 - LV * T, 0), td = T >= T_TD;
    const st = stateAt(T - T_FIRE);
    const sink = td ? W.draft_m * settle(T - T_TD) : 0;
    return { T, h, td, st, waterZ: zb - h + sink };
  }
  function startLanding(T0, freeze) {
    landing = { T: T0 || 0, frozen: !!freeze };
    dir = 0; pinned = true;
    landBtn.setAttribute('aria-pressed', 'true');
    water.visible = true; ground.visible = false; water.scale.setScalar(6);
    if (!landGloss) landGloss = [water.material.roughness, water.material.clearcoatRoughness];
    water.material.roughness = 0.32; water.material.clearcoatRoughness = 0.45; // soften the key-light glint seen from the chase camera
    set('t-water', true); set('t-float', false);
    camera.position.set(1.75, 0.55, 2.55); controls.target.set(-0.42, -0.2, 0.05); controls.update();
    if (reduce) landing.T = T_TD + 6;
  }
  function stopLanding(reset) {
    landing = null; pinned = false; radarBeam.visible = false; ripples.forEach(m => { m.visible = false; });
    water.scale.setScalar(1); water.position.z = W.waterline_z_m;
    if (landGloss) { [water.material.roughness, water.material.clearcoatRoughness] = landGloss; landGloss = null; }
    landBtn.setAttribute('aria-pressed', 'false'); hud.hidden = true;
    if (reset) { tau = 0; dir = 0; set('t-water', false); set('t-float', false); water.visible = false; ground.visible = true; setView('hero'); }
  }
  landBtn.addEventListener('click', () => { if (landing || landBtn.getAttribute('aria-pressed') === 'true') stopLanding(true); else startLanding(0, false); });

  function hudLanding(F) {
    const T = F.T, st = F.st, fired = T >= T_FIRE, ok = st.tau >= T_OK, okR = st.tau >= T_OK + 0.06;
    const msg = F.td ? (T >= T_STOP ? `Floating at ${Math.round(W.draft_m * 1000)} mm draft · motors off` : 'Touchdown · land detector')
      : ok && okR ? 'PONT: L + R pressure OK · landing continues'
        : fired ? `PONT: FIRE at ${HF.toFixed(1)} m (radar), ${LV.toFixed(1)} m/s down`
          : 'PONT: ARMED · planned water landing';
    hud.innerHTML = title('Water landing · LAND mode')
      + row('Radar, skid → water', F.td ? '0.00 m' : `${F.h.toFixed(2)} m`)
      + row('Descent', F.td ? '0.00 m/s' : `${LV.toFixed(2)} m/s`)
      + row('Fire height', `${HF.toFixed(1)} m`)
      + row('Bag pressure', fired ? `${st.gauge.toFixed(1)} kPa · ${Math.round(st.vol * 100)} %` : '–')
      + `<div style="margin-top:4px">${chip('ARMED', true)}${chip('FIRE', fired)}${chip('L OK', ok, true)}${chip('R OK', okR, true)}${chip('TOUCHDOWN', F.td, true)}${chip('FLOATING', T >= T_STOP + 0.8, true)}</div>`
      + `<div style="margin-top:5px;color:#c9d2d4">${msg}</div>`;
  }
  function hudInflate(st) {
    hud.innerHTML = title('Pontoon inflation')
      + row('Time since FIRE', `${st.tau.toFixed(2)} s`)
      + row('Bag volume', `${Math.round(st.vol * 100)} %`)
      + row('Bag pressure', `${st.gauge.toFixed(1)} kPa`)
      + `<div style="margin-top:4px">${chip('FIRE', st.tau > 0)}${chip('FULL VOLUME', st.tau >= T_FULL, true)}${chip('PRESSURE OK', st.tau >= T_OK, true)}${chip('RELIEF', st.gauge >= P_REL - 0.5, true)}</div>`;
  }

  // ---- hashes for checking frames: #inflate-0.4 freezes the inflation at 40 % of its run (-close / -side / -under ... picks the camera), #landing-7.5 freezes the landing at 7.5 s
  function closeUp() { camera.position.set(0.95, -0.12, 0.98); controls.target.set(0.08, -0.53, 0.3); controls.update(); }
  function pontoonHash() {
    const h = location.hash.slice(1);
    let m = h.match(/^inflate-([\d.]+)(?:-(close|hero|side|top|under))?$/);
    if (m) {
      if (landing) stopLanding(false);
      tau = Math.min(1, Number(m[1])) * T_END; dir = 0; pinned = true; set('t-float', true);
      if (m[2] === 'close') closeUp(); else if (m[2]) setView(m[2]);
      return;
    }
    m = h.match(/^landing-([\d.]+)$/);
    if (m) { startLanding(Number(m[1]), true); return; }
    if (h === 'landing') startLanding(0, false);
    if (h === 'stowed-close') closeUp();
  }
  window.addEventListener('hashchange', pontoonHash);
  let first = true;

  hooks.frame.push(dt => {
    if (first) { first = false; pontoonHash(); }
    clockT += dt;
    let st;
    if (landing) {
      if (!landing.frozen && !reduce) landing.T += dt;
      const F = landingAt(landing.T); st = F.st;
      const bob = F.td && !reduce ? Math.min(1, (landing.T - T_TD) / 2) * (0.004 * Math.sin(clockT * 2.2) + 0.002 * Math.sin(clockT * 3.7 + 1)) : 0;
      water.position.z = F.waterZ + bob;
      // props: hover speed until the land detector disarms, then spin down
      propW = landing.T < T_STOP ? 32 : 32 * Math.exp(-(landing.T - T_STOP) / 0.45);
      if (!landing.frozen && !reduce) props.forEach(p => { p.rotation.z += propW * dt * p.userData.dir; });
      else if (landing.frozen && propW > 1) props.forEach((p, i) => { p.rotation.z = i * 0.7; });
      radarBeam.visible = !F.td;
      const beam = Math.max(0.01, R.mounts.radar_z_m - 0.022 - water.position.z);
      radarBeam.scale.set(0.12 * beam, 0.12 * beam, beam);
      const wash = landing.T < T_STOP ? clamp01(1 - F.h / 3) : clamp01(1 - (landing.T - T_STOP) / 1.5);
      ripples.forEach((m, k) => {
        const ph = ((clockT / 1.4) + k / 3) % 1;
        m.visible = wash > 0.01; m.position.set(0.02, 0, water.position.z + 0.003); m.scale.setScalar(0.45 + 1.5 * ph);
        m.material.opacity = 0.32 * wash * (1 - ph) * Math.min(1, ph * 6);
      });
      if (st.tau >= T_OK) set('t-float', true);
      hud.hidden = false; hudLanding(F);
    } else {
      if (!pinned && dir) { tau = Math.min(T_END, Math.max(0, tau + dt * (dir > 0 ? 1 : 3) * dir)); if (tau === 0 || tau === T_END) dir = 0; }
      st = stateAt(tau);
      if (water.visible && tau >= T_END && !reduce) water.position.z = W.waterline_z_m + 0.004 * Math.sin(clockT * 2.2) + 0.002 * Math.sin(clockT * 3.7 + 1);
      const showHud = tau > 0 && (dir !== 0 || pinned);
      hud.hidden = !showHud; if (showHud) hudInflate(st);
    }
    pose(st);
  });
  }
