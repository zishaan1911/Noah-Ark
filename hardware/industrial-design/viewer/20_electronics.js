  // ---- electronics, built from the harness netlist (A.harness, from harness.json): every component at its datasheet size and
  // position, every wire along its routed path with its gauge, colour and connectors. Internal parts live in `inside` (shown by
  // "See inside", which slices the roof off); antennas, glands and the external cable tails live in `outer` (always shown).
  const HN = A.harness;
  // cutaway plane, parked far above the drone until "See inside" (the template moves it); declared first so async model loads can use it
  const roofCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3);
  renderer.localClippingEnabled = true;
  const inside = new THREE.Group(); ark.add(inside);
  const outer = new THREE.Group(); ark.add(outer);
  const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const std = (color, rough = 0.5, metal = 0, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    m.color.convertSRGBToLinear(); if (m.emissive) m.emissive.convertSRGBToLinear(); m.envMapIntensity = 0.6; return m;
  };
  const E = {
    gh: std(0xefe6cf, 0.55), nylon: std(0xf3f1ea, 0.5), xt: std(0xf1c40f, 0.45), housing: std(0x1b1c1e, 0.55),
    alu: std(0xb9bec3, 0.32, 0.9), aluDark: std(0x2a2d31, 0.38, 0.8), tin: std(0xd9dcdf, 0.25, 1), copper: std(0xc97a45, 0.3, 1),
    goldPin: std(0xd8ac45, 0.25, 1), brass: std(0xc8a24a, 0.35, 1), pcbG: std(0x1f5a3a, 0.55), pcbK: std(0x141619, 0.5),
    pcbB: std(0x1d3f7a, 0.5), pcbP: std(0x3a2a5e, 0.5), chip: std(0x101114, 0.4), smd: std(0x7a6a55, 0.5), solderMask: std(0x2b2f33, 0.6),
    heatsink: std(0x16171a, 0.42, 0.6), fan: std(0x0c0d0e, 0.45), rubber: std(0x231a1a, 0.85), foam: std(0x2b2b2b, 0.95),
    shrinkK: std(0x101112, 0.6), shrinkR: std(0x9e1f1f, 0.6), shrinkB: std(0x1d4fa8, 0.6), kapton: std(0xd48a1c, 0.35, 0, { transparent: true, opacity: 0.85 }),
    capSleeve: std(0x1a1a1c, 0.4), capTop: std(0xa9aeb2, 0.3, 1), standoff: std(0x18191b, 0.5), brassStandoff: std(0xb8953f, 0.35, 1),
    flex: std(0xd9c27a, 0.5), lens: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.55 }),
    simTray: std(0xb5b8bb, 0.35, 1), label: std(0xf4f4f0, 0.6),
  };
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const put = (g, o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); g.add(o); return o; };
  const bx = (g, sx, sy, sz, mat, x, y, z, r = 0) => put(g, mk(r > 0 ? new THREE.RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2, sy / 2, sz / 2)) : new THREE.BoxGeometry(sx, sy, sz), mat), x, y, z);
  const cyl = (g, r, h, mat, x, y, z, axis = 'z', seg = 20, r2 = r) => {
    const geo = new THREE.CylinderGeometry(r2, r, h, seg);
    if (axis === 'z') geo.rotateX(Math.PI / 2); else if (axis === 'x') geo.rotateZ(-Math.PI / 2);
    return put(g, mk(geo, mat), x, y, z);
  };
  // printed text on a part (canvas texture), lying on the +z face unless rotated by the caller
  const texCache = {};
  function labelMesh(text, w, h, { fg = '#e9ecee', bg = null, font = 600, align = 'center' } = {}) {
    const key = [text, w, h, fg, bg, font, align].join('|');
    if (!texCache[key]) {
      const cv = document.createElement('canvas'), px = 512, py = Math.max(16, Math.round(px * h / w));
      cv.width = px; cv.height = py; const cx = cv.getContext('2d');
      if (bg) { cx.fillStyle = bg; cx.fillRect(0, 0, px, py); }
      cx.fillStyle = fg; cx.textBaseline = 'middle'; cx.textAlign = align;
      let fs = py * 0.62; cx.font = `${font} ${fs}px Barlow, Arial, sans-serif`;
      while (cx.measureText(text).width > px * 0.92 && fs > 6) { fs *= 0.92; cx.font = `${font} ${fs}px Barlow, Arial, sans-serif`; }
      cx.fillText(text, align === 'center' ? px / 2 : px * 0.04, py / 2);
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
      texCache[key] = new THREE.MeshStandardMaterial({ map: t, transparent: !bg, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), texCache[key]);
  }
  const printOn = (g, text, w, h, x, y, z, opts = {}, rotZ = 0) => { const m = labelMesh(text, w, h, opts); m.rotation.z = rotZ; return put(g, m, x, y, z); };

  // small generic board details
  const chipOn = (g, w, l, h, x, y, z, mat = E.chip) => bx(g, w, l, h, mat, x, y, z + h / 2);
  function smdScatter(g, x0, x1, y0, y1, z, n, seed) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const big = rnd() > 0.8, w = big ? 0.0032 : 0.0016, l = big ? 0.0016 : 0.0008;
      chipOn(g, rnd() > 0.5 ? w : l, rnd() > 0.5 ? l : w, big ? 0.0012 : 0.0006, x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), z, rnd() > 0.6 ? E.smd : E.chip);
    }
  }
  const pcb = (g, sx, sy, mat, z, t = 0.0016) => bx(g, sx, sy, t, mat, 0, 0, z + t / 2, 0.0008);
  function screwHead(g, x, y, z, r = 0.0027) { cyl(g, r, 0.0018, E.alu, x, y, z + 0.0009, 'z', 16); bx(g, r * 1.2, 0.0006, 0.0006, E.aluDark, x, y, z + 0.0019); }
  function standoff(g, x, y, z0, h, mat = E.standoff, r = 0.0028) { cyl(g, r, h, mat, x, y, z0 + h / 2, 'z', 6); }

  // ---------------------------------------------------------------- component builders (local frame: centre of the box, x along length)
  const B = {};
  B.pack = (g, c) => {
    const [sx, sy, sz] = c.size, S = 12, Pn = Math.round(48 / S);
    const cellGeo = new THREE.CylinderGeometry(0.0107, 0.0107, 0.0705, 24); cellGeo.rotateX(Math.PI / 2);
    const cells = new THREE.InstancedMesh(cellGeo, M.cell, S * Pn), dm = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < S; i++) for (let j = 0; j < Pn; j++) { dm.position.set((i - (S - 1) / 2) * 0.0214, (j - (Pn - 1) / 2) * 0.0214, 0); dm.updateMatrix(); cells.setMatrixAt(k++, dm.matrix); }
    cells.castShadow = true; g.add(cells);
    [-1, 1].forEach(s => bx(g, sx - 0.004, sy - 0.002, 0.004, E.housing, 0, 0, s * 0.0372, 0.0015)); // printed cell holders
    for (let i = 0; i < S; i++) [-1, 1].forEach(s => bx(g, 0.0175, sy - 0.012, 0.00025, M.nickel, (i - (S - 1) / 2) * 0.0214, 0, s * (0.0395)));
    for (let i = 0; i < S; i++) bx(g, 0.0022, 0.0012, 0.0012, i % 2 ? E.shrinkR : E.housing, (i - (S - 1) / 2) * 0.0214, sy / 2 - 0.004, sz / 2 + 0.0006); // balance tap solder points
    bx(g, sx - 0.02, 0.012, 0.0012, E.kapton, 0.005, sy / 2 - 0.004, sz / 2 + 0.0004); // balance lead run, taped
    [-0.075, 0.075].forEach(x => { bx(g, 0.02, sy + 0.003, sz + 0.003, E.housing, x, 0, 0, 0.001); printOn(g, 'ARK  12S4P', 0.018, 0.005, x, 0, sz / 2 + 0.0017, { fg: '#c9ced2' }); }); // Velcro straps
    bx(g, 0.04, 0.03, 0.0004, E.label, 0.02, -0.02, sz / 2 + 0.0005);
    printOn(g, '12S4P 21700 · 864 Wh', 0.038, 0.007, 0.02, -0.016, sz / 2 + 0.0008, { fg: '#222', font: 700 });
    printOn(g, 'INR21700-50S × 48', 0.038, 0.006, 0.02, -0.026, sz / 2 + 0.0008, { fg: '#444' });
  };
  B.bms = (g, c) => {
    const [sx, sy, sz] = c.size;
    bx(g, 0.0016, sy, sz, E.pcbK, -sx / 2 + 0.006, 0, 0, 0.0006);
    bx(g, 0.004, sy - 0.006, sz - 0.008, E.alu, sx / 2 - 0.002, 0, 0, 0.0008); // heatsink plate on the MOSFETs (faces the pack)
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) bx(g, 0.0012, 0.0065, 0.0055, E.chip, -sx / 2 + 0.0075, -0.028 + i * 0.0112, -0.012 + j * 0.02);
    bx(g, 0.002, 0.012, 0.012, E.chip, -sx / 2 + 0.0078, 0.026, 0.018);
    bx(g, 0.0045, 0.03, 0.006, E.nylon, -sx / 2 + 0.003, 0.0, sz / 2 - 0.006); // XH balance housings
    bx(g, 0.0045, 0.009, 0.005, E.nylon, -sx / 2 + 0.003, 0.022, sz / 2 - 0.006);
    const t = labelMesh('JBD  SP16S020', 0.04, 0.007, { fg: '#e6e6e6' }); t.rotation.set(0, -Math.PI / 2, Math.PI / 2); put(g, t, -sx / 2 + 0.0047, 0, -0.022);
  };
  B.xt90 = (g, c) => { // mated XT90-S pair lying along y
    bx(g, 0.0109, 0.024, 0.0216, E.xt, 0, -0.0115, 0, 0.0015);
    bx(g, 0.0109, 0.024, 0.0216, E.xt, 0, 0.0115, 0, 0.0015);
    bx(g, 0.0115, 0.0012, 0.0222, E.housing, 0, 0, 0);
    [-1, 1].forEach(s => printOn(g, s > 0 ? 'XT90-S' : 'AMASS', 0.009, 0.0035, 0.0055, s * 0.012, 0, { fg: '#6a5200' }, Math.PI / 2).rotation.y = Math.PI / 2);
  };
  B.caps = (g, c) => {
    for (let i = 0; i < 4; i++) {
      const y = -0.024 + i * 0.016;
      cyl(g, 0.0079, 0.0245, E.capSleeve, 0, y, 0, 'x', 28);
      cyl(g, 0.0074, 0.0006, E.capTop, 0.0125, y, 0, 'x', 28);
      bx(g, 0.022, 0.0035, 0.0006, E.alu, 0, y + 0.0055, 0.0072); // minus stripe
    }
    [-0.004, 0.004].forEach(z => bx(g, 0.0016, 0.07, 0.003, E.tin, 0.0135, 0, z)); // tinned bus bars across the leads
    bx(g, 0.012, 0.07, 0.001, E.foam, 0, 0, -0.0085);
  };
  B.pm = (g, c) => {
    const [sx, sy] = c.size;
    pcb(g, sx, sy, E.pcbK, -0.004);
    bx(g, 0.012, 0.004, 0.0016, E.tin, 0, 0, -0.0014); // shunt
    chipOn(g, 0.003, 0.003, 0.0009, 0.006, 0.006, -0.0024); chipOn(g, 0.005, 0.005, 0.0012, -0.006, 0.007, -0.0024);
    chipOn(g, 0.004, 0.004, 0.0025, -0.008, -0.007, -0.0024, E.aluDark); // inductor
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(([a, b]) => bx(g, 0.006, 0.008, 0.0005, E.tin, a * (sx / 2 - 0.003), b * 0.006, -0.0021));
    bx(g, 0.0062, 0.006, 0.0045, E.nylon, 0.004, sy / 2 - 0.003, -0.0002); // CLIK-Mate
    bx(g, sx + 0.004, sy + 0.002, 0.007, E.shrinkB, 0, 0, -0.0005, 0.002).material = new THREE.MeshPhysicalMaterial({ color: 0x2a6fd6, roughness: 0.35, transparent: true, opacity: 0.35 });
    printOn(g, 'PM02D HV', 0.016, 0.004, -0.004, -0.006, 0.0031, { fg: '#cfe0ff' });
  };
  B.bec = (g, c, volts) => {
    const [sx, sy] = c.size;
    bx(g, sx + 0.003, sy + 0.002, 0.003, E.foam, 0, 0, -0.0035);
    pcb(g, sx, sy, E.pcbK, -0.002);
    chipOn(g, 0.008, 0.008, 0.004, 0.002, 0.0, -0.0004, E.aluDark); chipOn(g, 0.004, 0.003, 0.0012, -0.008, 0.004, -0.0004);
    for (let i = 0; i < 3; i++) chipOn(g, 0.0032, 0.0016, 0.0016, -0.011 + i * 0.004, -0.007, -0.0004, E.smd);
    [-1, 1].forEach(s => bx(g, 0.004, 0.006, 0.0005, E.tin, s * (sx / 2 - 0.0025), 0, -0.0002));
    printOn(g, `MATEK BEC12S-PRO  ${volts}`, 0.026, 0.004, 0.0, 0.0085, -0.0003, { fg: '#e8c76a' });
  };
  B.pdb = (g, c) => {
    const [sx, sy] = c.size;
    pcb(g, sx, sy, E.pcbK, -0.003, 0.002);
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { bx(g, 0.012, 0.007, 0.0006, E.goldPin, a * 0.0188, b * 0.0235, -0.0007); cyl(g, 0.0017, 0.0024, E.tin, a * 0.0153, b * 0.0153, -0.0004, 'z', 12); });
    bx(g, 0.01, 0.022, 0.0006, E.goldPin, -0.0215, 0, -0.0007); // battery pads
    chipOn(g, 0.007, 0.006, 0.0018, 0.005, 0.0, -0.001); chipOn(g, 0.006, 0.006, 0.0035, -0.008, 0.012, -0.001, E.aluDark); chipOn(g, 0.006, 0.006, 0.0035, -0.008, -0.012, -0.001, E.aluDark);
    smdScatter(g, -0.012, 0.012, -0.018, 0.018, -0.001, 26, 7);
    printOn(g, 'MATEK FCHUB-12S', 0.03, 0.004, 0.008, 0.011, -0.0009, { fg: '#e8c76a' });
  };
  B.fc = (g, c) => {
    const [sx, sy, sz] = c.size, zb = -sz / 2, hb = 0.0167;
    [[-0.042, 0.02], [-0.042, -0.02], [0.042, 0.02], [0.042, -0.02]].forEach(([x, y]) => {
      standoff(g, x, y, -0.0155 - 0.022 + 0.0, 0.0165, E.standoff, 0.0024); // 20 mm nylon standoffs (to the deck)
      put(g, mk(new THREE.SphereGeometry(0.0042, 14, 10), E.rubber), x, y, zb - 0.0015);
    });
    bx(g, sx, sy, hb, E.housing, 0, 0, zb + hb / 2, 0.003); // baseboard housing
    bx(g, sx - 0.004, sy - 0.004, 0.0008, E.solderMask, 0, 0, zb + hb + 0.0003, 0.002);
    const mod = bx(g, 0.0388, 0.0318, 0.0146, E.alu, -0.012, 0, zb + hb + 0.0073 - 0.0005, 0.002); // FMUv6X module
    for (let i = 0; i < 7; i++) bx(g, 0.034, 0.0011, 0.0009, E.aluDark, -0.012, -0.0132 + i * 0.0044, zb + hb + 0.0142);
    printOn(g, 'PIXHAWK 6X', 0.026, 0.005, -0.012, -0.0005, zb + hb + 0.0148, { fg: '#2a2d31', font: 700 });
    printOn(g, '▲', 0.008, 0.008, 0.026, 0, zb + hb + 0.0012, { fg: '#e8621c' });
    printOn(g, 'HOLYBRO', 0.022, 0.004, 0.03, 0.016, zb + hb + 0.0012, { fg: '#9aa0a6' });
    void mod;
  };
  B.rfd = (g, c) => {
    const [sx, sy, sz] = c.size;
    bx(g, sx, sy, sz * 0.55, E.alu, 0, 0, -sz * 0.225, 0.0015);
    for (let i = 0; i < 8; i++) bx(g, sx - 0.006, 0.0015, sz * 0.45, E.alu, 0, -0.0125 + i * 0.0036, sz * 0.27);
    [-0.0075, 0.0075].forEach(y => { cyl(g, 0.0032, 0.007, E.brass, -sx / 2 - 0.003, y, -0.0005, 'x', 6); cyl(g, 0.0021, 0.004, E.goldPin, -sx / 2 - 0.008, y, -0.0005, 'x', 14); });
    bx(g, 0.004, 0.02, 0.0045, E.housing, sx / 2 - 0.003, 0, -0.004);
    printOn(g, 'RFD900x', 0.02, 0.005, 0.012, 0, sz / 2 + 0.0002, { fg: '#20262b', font: 700 });
  };
  B.ftdi = (g, c) => {
    const [sx, sy] = c.size;
    pcb(g, sx, sy, E.pcbB, -0.006);
    chipOn(g, 0.008, 0.008, 0.001, -0.002, 0.002, -0.0044); chipOn(g, 0.005, 0.0032, 0.0012, 0.008, -0.004, -0.0044, E.alu);
    bx(g, 0.0078, 0.0078, 0.004, E.alu, sx / 2 - 0.004, 0.006, -0.0024); // USB mini-B
    for (let i = 0; i < 13; i++) [-1, 1].forEach(s => bx(g, 0.0024, 0.0024, 0.0025, E.housing, -sx / 2 + 0.003 + i * 0.00254 * 0.98, s * (sy / 2 - 0.0016), -0.0056));
    smdScatter(g, -0.012, 0.012, -0.008, 0.008, -0.0044, 14, 11);
    printOn(g, 'FT4232H MINI', 0.018, 0.0035, -0.004, -0.0065, -0.0043, { fg: '#e6eef8' });
  };
  B.rx = (g, c) => { const [sx, sy, sz] = c.size; bx(g, sx, sy, sz, E.shrinkK, 0, 0, 0, 0.0015); printOn(g, 'R-XSR', 0.01, 0.003, 0, 0, sz / 2 + 0.0002, { fg: '#bfc4c8' }); };
  B.rockblock = (g, c) => {
    const [sx, sy, sz] = c.size;
    pcb(g, sx, sy, E.pcbG, -sz / 2);
    bx(g, 0.032, 0.032, 0.0065, E.alu, -0.003, 0.0, -sz / 2 + 0.0016 + 0.00325, 0.0006); // 9603 module can
    bx(g, 0.025, 0.025, 0.004, E.label, -0.003, 0, -sz / 2 + 0.0016 + 0.0065 + 0.002, 0.0006);
    printOn(g, 'IRIDIUM 9603', 0.022, 0.004, -0.003, 0.003, -sz / 2 + 0.0124, { fg: '#2a2a2a', font: 700 });
    printOn(g, 'RockBLOCK', 0.02, 0.004, -0.003, -0.004, -sz / 2 + 0.0124, { fg: '#c0392b', font: 700 });
    bx(g, 0.004, 0.012, 0.004, E.nylon, sx / 2 - 0.003, 0.01, -sz / 2 + 0.0036);
    cyl(g, 0.0032, 0.007, E.brass, sx / 2 + 0.002, -0.012, -sz / 2 + 0.004, 'x', 6);
  };
  B.lte = (g, c) => {
    const [sx, sy, sz] = c.size;
    pcb(g, sx, sy, E.pcbK, -sz / 2);
    bx(g, 0.051, 0.03, 0.0012, E.pcbG, -0.004, 0, -sz / 2 + 0.0035); // EG25-G mPCIe card
    bx(g, 0.032, 0.024, 0.0022, E.alu, -0.006, 0, -sz / 2 + 0.0052, 0.0004);
    bx(g, 0.028, 0.02, 0.0002, E.label, -0.006, 0, -sz / 2 + 0.0064);
    printOn(g, 'QUECTEL EG25-G', 0.026, 0.0045, -0.006, 0.004, -sz / 2 + 0.0066, { fg: '#1b3a7a', font: 700 });
    printOn(g, 'LTE Cat 4', 0.016, 0.0035, -0.006, -0.004, -sz / 2 + 0.0066, { fg: '#555' });
    bx(g, 0.016, 0.014, 0.0014, E.simTray, 0.022, 0.0, -sz / 2 + 0.0025);
    [0.010, -0.010].forEach(y => cyl(g, 0.0012, 0.0012, E.goldPin, -0.012, y, -sz / 2 + 0.0068, 'z', 12));
  };
  B.jetson = (g, c) => {
    const [sx, sy, sz] = c.size, zb = -sz / 2, t = 0.0016;
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(([a, b]) => standoff(g, a * 0.034, b * 0.043, zb - 0.006, 0.006, E.brassStandoff, 0.0024));
    pcb(g, sx, sy, E.pcbG, zb);
    // under the carrier: M.2 NVMe (2280) and the empty Key-E slot (Wi-Fi card removed)
    bx(g, 0.022, 0.08, 0.0008, E.pcbK, 0.012, 0, zb - 0.0012); bx(g, 0.02, 0.05, 0.0002, E.label, 0.012, 0.004, zb - 0.0018);
    // module + heatsink + fan
    bx(g, 0.045, 0.0696, 0.0012, E.pcbG, 0.008, 0, zb + t + 0.004);
    bx(g, 0.045, 0.072, 0.003, E.heatsink, 0.008, 0, zb + t + 0.0065, 0.001);
    for (let i = 0; i < 15; i++) bx(g, 0.042, 0.0016, 0.016, E.heatsink, 0.008, -0.034 + i * 0.00485, zb + t + 0.016);
    const fanG = new THREE.Group(); fanG.position.set(0.008, 0, zb + t + 0.0255); g.add(fanG);
    bx(fanG, 0.04, 0.04, 0.007, E.fan, 0, 0, 0, 0.003);
    cyl(fanG, 0.0185, 0.0072, E.heatsink, 0, 0, 0.0002, 'z', 40);
    for (let i = 0; i < 7; i++) { const bl = bx(fanG, 0.011, 0.0055, 0.0008, E.heatsink, 0, 0, 0.0032); bl.geometry.translate(0.0115, 0, 0); bl.rotation.set(0, 0, i * Math.PI * 2 / 7); }
    cyl(fanG, 0.0065, 0.0074, E.fan, 0, 0, 0.0004, 'z', 24); printOn(fanG, 'NVIDIA', 0.011, 0.004, 0, 0, 0.0043, { fg: '#76b900', font: 700 });
    // port edge (rear, -x): DC jack, RJ45, 4 x USB-A, DisplayPort, USB-C
    const xe = -sx / 2;
    cyl(g, 0.0045, 0.013, E.housing, xe + 0.006, -0.040, zb + t + 0.0055, 'x', 18);
    bx(g, 0.021, 0.016, 0.0135, E.alu, xe + 0.0095, 0.030, zb + t + 0.0068, 0.0006);
    bx(g, 0.0012, 0.0115, 0.0085, E.housing, xe - 0.0008, 0.030, zb + t + 0.0064);
    [0.004, -0.020].forEach(y => bx(g, 0.017, 0.0145, 0.0155, E.alu, xe + 0.0085, y, zb + t + 0.0078, 0.0005)); // 2 x stacked USB-A
    bx(g, 0.009, 0.019, 0.005, E.alu, xe + 0.0045, -0.050 + 0.024, zb + t + 0.0028); // DP
    // 40-pin header along the -y edge
    for (let i = 0; i < 20; i++) [0, 1].forEach(r => bx(g, 0.0024, 0.0024, 0.0025, E.housing, -0.022 + i * 0.00254, -sy / 2 + 0.004 + r * 0.00254, zb + t + 0.00125));
    smdScatter(g, -0.035, 0.035, -0.045, 0.045, zb + t, 60, 3);
    printOn(g, 'JETSON ORIN NANO', 0.03, 0.004, 0.032, 0.042, zb + t + 0.0002, { fg: '#d8e3d0' });
  };
  B.fire = (g, c) => {
    const [sx, sy, sz] = c.size;
    pcb(g, sx, sy, E.pcbG, -sz / 2);
    for (let i = 0; i < 3; i++) for (let p = 0; p < 3; p++) bx(g, 0.0024, 0.0024, 0.0025, E.housing, -sx / 2 + 0.0015 + p * 0.00254, 0.006 - i * 0.006, -sz / 2 + 0.0029);
    for (let i = 0; i < 3; i++) { chipOn(g, 0.0029, 0.0016, 0.001, -0.004, 0.006 - i * 0.006, -sz / 2 + 0.0016); chipOn(g, 0.0016, 0.0008, 0.0005, 0.0, 0.006 - i * 0.006, -sz / 2 + 0.0016, E.smd); }
    [0.005, -0.005].forEach(y => bx(g, 0.007, 0.0076, 0.0085, std(0x2f8f4e, 0.5), sx / 2 - 0.0045, y, -sz / 2 + 0.006, 0.0005));
    bx(g, 0.007, 0.0076, 0.0085, std(0x2f8f4e, 0.5), -0.004, -sy / 2 + 0.0042, -sz / 2 + 0.006, 0.0005);
    printOn(g, 'ARK FIRE · ARM', 0.014, 0.003, 0.0045, 0.0085, -sz / 2 + 0.0018, { fg: '#ffffff' });
  };
  B.esc = (g, c, n) => {
    const [sx, sy, sz] = c.size;
    bx(g, sx - 0.008, sy, sz * 0.5, E.heatsink, 0, 0, -sz * 0.25, 0.003);
    for (let i = 0; i < 9; i++) bx(g, sx - 0.016, 0.0018, sz * 0.48, E.heatsink, 0, -0.0155 + i * 0.0039, sz * 0.23);
    [-1, 1].forEach(s => bx(g, 0.004, sy - 0.004, sz * 0.62, E.housing, s * (sx / 2 - 0.006), 0, -sz * 0.14, 0.0015)); // potted end caps
    bx(g, 0.03, 0.009, 0.0004, E.label, 0.0, 0, sz / 2 - 0.0004).material = std(0xc0262d, 0.5);
    printOn(g, `ALPHA 80A 12S  #${n}`, 0.03, 0.006, 0, 0, sz / 2 - 0.0001, { fg: '#ffffff', font: 700 });
  };
  B.led = (g, c, col, onHatch) => {
    const glow = std(col === 'red' ? 0xff2a1a : col === 'green' ? 0x2bd45a : 0xffffff, 0.3, 0, { emissive: col === 'red' ? 0xff2a1a : col === 'green' ? 0x1aa83f : 0xffffff, emissiveIntensity: 1.4 });
    const d = new THREE.Group(); g.add(d);
    if (onHatch) d.rotation.y = -Math.PI / 2; // board faces -x through the hatch
    cyl(d, 0.005, 0.0016, E.pcbK, 0, 0, -0.0007, 'z', 24); chipOn(d, 0.005, 0.005, 0.0016, 0, 0, 0.0001, E.nylon); chipOn(d, 0.0036, 0.0036, 0.0006, 0, 0, 0.0017, glow);
    return glow;
  };
  B.flexAnt = (g, c) => { const [sx, sy, sz] = c.size; bx(g, sx, 0.0008, sz, E.flex, 0, 0, 0, 0.0004); bx(g, sx - 0.006, 0.0002, sz - 0.006, E.copper, 0, 0.0005, 0, 0); bx(g, 0.02, 0.0012, sz + 0.004, E.nylon, -0.03, -0.0012, 0); bx(g, 0.02, 0.0012, sz + 0.004, E.nylon, 0.03, -0.0012, 0); printOn(g, 'TAOGLAS FXUB63', 0.03, 0.004, 0.012, 0.0009, 0.0, { fg: '#5a4a10' }).rotation.x = Math.PI / 2; };
  B.rxAnt = (g, c) => { cyl(g, 0.0004, c.size[0], E.goldPin, 0, 0, 0, 'x', 6); cyl(g, 0.0009, 0.004, E.shrinkK, -c.size[0] / 2, 0, 0, 'x', 8); };
  B.gland = (g, c) => { // nylon IP68 gland or brass SMA bulkhead; axis = wall normal (x for the leg glands, z elsewhere)
    const leg = Math.abs(c.pos[2] + 0.52) < 0.01, sma = /SMA/.test(c.name), out = leg ? 1 : (c.pos[2] > 0 ? 1 : -1), ax = leg ? 'x' : 'z';
    const at = (d) => (leg ? [d, 0, 0] : [0, 0, d]);
    cyl(g, sma ? 0.0045 : 0.0068, 0.003, sma ? E.brass : E.nylon, ...at(out * 0.0025), ax, 6);
    cyl(g, sma ? 0.0032 : 0.0052, 0.005, sma ? E.goldPin : E.nylon, ...at(out * 0.0063), ax, 16, sma ? 0.0032 : 0.0036);
  };
  B.iridium = (g, c) => {
    const [, , sz] = c.size;
    cyl(g, 0.0065, 0.012, E.brass, 0, 0, -sz / 2 + 0.006, 'z', 6);
    cyl(g, 0.011, sz - 0.02, E.housing, 0, 0, 0.004, 'z', 32, 0.0095);
    put(g, mk(new THREE.SphereGeometry(0.0095, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), E.housing), 0, 0, sz / 2 - 0.012);
    printOn(g, 'Iridium', 0.016, 0.004, 0, -0.0112, 0.0, { fg: '#bbbbbb' }).rotation.set(Math.PI / 2, 0, 0);
  };

  // ---------------------------------------------------------------- place components
  const byId = {}; HN.components.forEach(c => { byId[c.id] = c; });
  const fmt = (c) => `${c.size.map(v => (v * 1000).toFixed(1)).join(' × ')} mm${c.mass_g ? ', ' + c.mass_g + ' g' : ''}${c.estimated && c.estimated.length ? ' (est.)' : ''}`;
  const parts = {};
  HN.components.forEach(c => {
    if (c.drawn_by) return;
    const g = new THREE.Group(); g.position.set(...c.pos); g.rotation.z = c.yaw_deg * Math.PI / 180;
    const id = c.id;
    if (id === 'pack') B.pack(g, c);
    else if (id === 'bms') B.bms(g, c);
    else if (id === 'xt90') B.xt90(g, c);
    else if (id === 'caps') B.caps(g, c);
    else if (id === 'pm') B.pm(g, c);
    else if (id.startsWith('bec')) B.bec(g, c, id === 'bec_jet' ? '12V' : '5.2V');
    else if (id === 'pdb') B.pdb(g, c);
    else if (id === 'fc') B.fc(g, c);
    else if (id === 'rfd') B.rfd(g, c);
    else if (id === 'ftdi') B.ftdi(g, c);
    else if (id === 'rx') B.rx(g, c);
    else if (id === 'rockblock') B.rockblock(g, c);
    else if (id === 'lte') B.lte(g, c);
    else if (id === 'jetson') B.jetson(g, c);
    else if (id === 'fire') B.fire(g, c);
    else if (id.startsWith('esc')) B.esc(g, c, id.slice(3));
    else if (id.startsWith('nav_')) B.led(g, c, /red/.test(c.name) ? 'red' : 'green', false);
    else if (id === 'status_led') B.led(g, c, 'green', true);
    else if (id.startsWith('lte_ant')) B.flexAnt(g, c);
    else if (id.startsWith('rx_ant')) B.rxAnt(g, c);
    else if (c.passthrough) B.gland(g, c);
    else if (id === 'iridium_ant') B.iridium(g, c);
    else if (id.startsWith('rfd_ant')) { parts[id] = g; } // glTF model, loaded below
    tag(g, c.name, `${c.role}. ${fmt(c)}`);
    (c.location === 'internal' ? inside : outer).add(g);
    parts[id] = g;
  });
  // clear windows in the arm floors over the nav lights
  HN.components.filter(c => c.id.startsWith('nav_')).forEach(c => {
    const l = put(outer, mk(new THREE.CylinderGeometry(0.0065, 0.0065, 0.0012, 24).rotateX(Math.PI / 2), E.lens), c.pos[0], c.pos[1], c.pos[2] - 0.0052);
    tag(l, 'Nav light window', 'Clear polycarbonate window over the NeoPixel in the arm floor');
  });

  // RFD900x dipoles: Sketchfab model (parts/antenna_sma_90.glb, CC-BY, see parts/SOURCES.md), stored in the drone frame
  if (A.models && A.models.antenna_sma_90 && THREE.GLTFLoader) {
    const bin = atob(A.models.antenna_sma_90), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(u8.buffer, '', gl => {
      ['rfd_ant_L', 'rfd_ant_R'].forEach((id, k) => {
        const m = gl.scene.clone(true);
        m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.clippingPlanes = [roofCut]; } });
        m.rotation.z = k ? Math.PI / 4 : -Math.PI / 4;
        parts[id].add(m); tag(parts[id], byId[id].name, `${byId[id].role}. ${fmt(byId[id])}`);
      });
    }, () => {});
  }

  // ---------------------------------------------------------------- deck, tray, hatch and mounting hardware
  const S = HN.structure;
  function plate(p, mat) {
    const [x0, x1] = p.x_m, [y0, y1] = p.y_m, r = p.corner_r_m, sh = new THREE.Shape();
    sh.moveTo(x0 + r, y0); sh.lineTo(x1 - r, y0); sh.quadraticCurveTo(x1, y0, x1, y0 + r); sh.lineTo(x1, y1 - r); sh.quadraticCurveTo(x1, y1, x1 - r, y1);
    sh.lineTo(x0 + r, y1); sh.quadraticCurveTo(x0, y1, x0, y1 - r); sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
    const m = mk(new THREE.ExtrudeGeometry(sh, { depth: p.thickness_m, bevelEnabled: false, curveSegments: 12 }), mat); m.position.z = p.z_bottom_m; return m;
  }
  const deck = tag(plate(S.deck, M.carbon), S.deck.name, '300 × 230 mm, carries the power stack, flight controller, radios and Jetson');
  inside.add(deck);
  const dTop = S.deck.z_bottom_m + S.deck.thickness_m;
  [[-0.14, 0.105], [-0.14, -0.105], [0.14, 0.105], [0.14, -0.105]].forEach(([x, y]) => { cyl(inside, 0.004, 0.0025, E.housing, x, y, S.deck.z_bottom_m - 0.00125, 'z', 16); screwHead(inside, x, y, dTop); });
  [[-0.042, 0.02], [-0.042, -0.02], [0.042, 0.02], [0.042, -0.02]].forEach(([x, y]) => screwHead(inside, byId.fc.pos[0] + x, y, dTop - 0.0012)); // FC standoff screws
  const tray = tag(plate(S.tray, M.carbon), S.tray.name, 'RockBLOCK 9603 and LTE modem above the power module');
  inside.add(tray);
  const tTop = S.tray.z_bottom_m + S.tray.thickness_m;
  [[S.tray.x_m[0] + 0.006, S.tray.y_m[0] + 0.006], [S.tray.x_m[0] + 0.006, S.tray.y_m[1] - 0.006], [S.tray.x_m[1] - 0.006, S.tray.y_m[0] + 0.006], [S.tray.x_m[1] - 0.006, S.tray.y_m[1] - 0.006]]
    .forEach(([x, y]) => { standoff(inside, x, y, dTop, S.tray.z_bottom_m - dTop, E.alu, 0.0025); screwHead(inside, x, y, tTop); });
  ['rockblock', 'lte'].forEach(id => { const c = byId[id]; bx(inside, (c.yaw_deg ? c.size[1] : c.size[0]) * 0.6, 0.012, 0.0012, E.housing, c.pos[0], c.pos[1], tTop + 0.0006); }); // Velcro
  ['rfd', 'ftdi', 'rx', 'bec_jet', 'bec_fc', 'fire'].forEach(id => { const c = byId[id]; bx(inside, c.size[0] * 0.7, c.size[1] * 0.7, 0.0012, E.housing, c.pos[0], c.pos[1], dTop + 0.0006); }); // 3M Dual Lock pads
  const H_ = S.hatch;
  const hatch = bx(outer, H_.x_m[1] - H_.x_m[0], H_.y_m[1] - H_.y_m[0], H_.z_m[1] - H_.z_m[0], M.shell, (H_.x_m[0] + H_.x_m[1]) / 2, (H_.y_m[0] + H_.y_m[1]) / 2, (H_.z_m[0] + H_.z_m[1]) / 2, 0.01);
  tag(shadowed(hatch), H_.name, 'Two quarter-turn fasteners; behind it the XT90-S arming plug');
  [-0.05, 0.05].forEach(y => { cyl(outer, 0.0045, 0.0015, E.aluDark, H_.x_m[0] - 0.0004, y, -0.18, 'x', 20); bx(outer, 0.0006, 0.006, 0.0012, E.alu, H_.x_m[0] - 0.0012, y, -0.18); });
  // the model's status light sat on the old external battery: move it onto the hatch, in front of the status NeoPixel
  ark.children.forEach(o => { if (o.userData.part && o.userData.part.name === 'Status light') { o.geometry.computeBoundingBox(); o.position.x += H_.x_m[0] - 0.0004 - o.geometry.boundingBox.max.x; } });

  // ---------------------------------------------------------------- wires
  const wireMats = {};
  const wmat = (hex) => wireMats[hex] || (wireMats[hex] = std(new THREE.Color(hex).getHex(), 0.42, 0, { }));
  const odOf = (w) => (w.cable ? HN.cables[w.cable].od_mm : HN.insulated_od_mm[String(w.awg)]) / 1000;
  // polyline with rounded corners, sampled every ~2 mm
  function smoothPath(route, rmax = 0.01) {
    const P = route.map(V3), out = [P[0].clone()];
    const seg = (a, b) => { const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.002)); for (let i = 1; i <= n; i++) out.push(a.clone().lerp(b, i / n)); };
    let cur = P[0];
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1], d = Math.min(rmax, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
      const p0 = b.clone().add(a.clone().sub(b).setLength(d)), p1 = b.clone().add(c.clone().sub(b).setLength(d));
      seg(cur, p0);
      const q = new THREE.QuadraticBezierCurve3(p0, b, p1);
      for (let k = 1; k <= 6; k++) out.push(q.getPoint(k / 6));
      cur = p1;
    }
    seg(cur, P[P.length - 1]);
    return out.filter((p, i) => i === 0 || p.distanceToSquared(out[i - 1]) > 1e-10);
  }
  // parallel-transport frames along a point list
  function frames(pts) {
    const T = pts.map((p, i) => pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize());
    const N = [], Bn = [];
    let n = new THREE.Vector3(0, 0, 1); if (Math.abs(n.dot(T[0])) > 0.9) n.set(0, 1, 0);
    n.sub(T[0].clone().multiplyScalar(n.dot(T[0]))).normalize();
    T.forEach((t, i) => { if (i) n.sub(t.clone().multiplyScalar(n.dot(t))).normalize(); N.push(n.clone()); Bn.push(t.clone().cross(n).normalize()); });
    return { T, N, B: Bn };
  }
  function tube(pts, r, seg = 7) {
    const { N, B: Bv } = frames(pts), pos = [], nor = [], idx = [];
    pts.forEach((p, i) => { for (let j = 0; j <= seg; j++) { const a = j / seg * Math.PI * 2, d = N[i].clone().multiplyScalar(Math.cos(a)).add(Bv[i].clone().multiplyScalar(Math.sin(a))); nor.push(d.x, d.y, d.z); pos.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r); } });
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
  }
  const glandPts = HN.components.filter(c => c.passthrough).map(c => V3(c.pos));
  const extPortComps = new Set(HN.components.filter(c => c.location === 'external').map(c => c.id));
  const portOf = (ref) => { const [cid, pid] = ref.split('.'); return byId[cid].ports.find(p => p.id === pid); };
  const lengthOf = (pts) => pts.reduce((s, p, i) => s + (i ? p.distanceTo(pts[i - 1]) : 0), 0);

  // connector body at a wire end: placed so its mating face is at the port, axis along the wire's end direction
  function endConnector(g, con, pins, at, dir, w) {
    const grp = new THREE.Group(); grp.position.copy(at);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); g.add(grp);
    const n = Math.max(pins.length, 1), body = (sx, sy, sz, mat, r = 0.0004) => bx(grp, sx, sy, sz, mat, sx / 2, 0, 0, r);
    const od = odOf(w);
    if (/XT60/.test(con)) body(0.016, 0.0079, 0.0082, E.xt, 0.001);
    else if (/bullet/.test(con)) { cyl(grp, 0.0021, 0.009, E.goldPin, 0.0045, 0, 0, 'x', 12); cyl(grp, 0.0028, 0.016, E.shrinkK, 0.012, 0, 0, 'x', 12); }
    else if (/CLIK-Mate/.test(con)) body(0.0055, 0.002 * n + 0.003, 0.0045, E.nylon);
    else if (/JST-GH/.test(con)) body(0.006, 0.00125 * n + 0.003, 0.0042, E.gh);
    else if (/JST-SH/.test(con)) body(0.0045, 0.001 * n + 0.002, 0.003, E.gh);
    else if (/JST-PH|JST-XH|PicoBlade|JST-ZH/.test(con)) body(0.006, (/XH/.test(con) ? 0.0025 : /PH/.test(con) ? 0.002 : 0.00125) * Math.min(n, 7) + 0.003, 0.0045, E.nylon);
    else if (/servo|JR 3-pin|2.54 mm/.test(con)) body(0.014, 0.00254 * Math.min(n, 3) + 0.0005, 0.0026, E.housing);
    else if (/U\.FL|IPEX/.test(con)) cyl(grp, 0.0012, 0.0015, E.goldPin, 0.0007, 0, 0, 'x', 12);
    else if (/SMA/.test(con)) { cyl(grp, 0.0042, 0.006, E.brass, 0.003, 0, 0, 'x', 6); cyl(grp, 0.0028, 0.012, E.goldPin, 0.012, 0, 0, 'x', 14); cyl(grp, 0.0018, 0.012, E.shrinkK, 0.022, 0, 0, 'x', 10); }
    else if (/USB/.test(con)) { body(0.012, 0.012, 0.0045, E.alu); bx(grp, 0.016, 0.015, 0.0075, E.housing, 0.02, 0, 0, 0.0015); }
    else if (/RJ45/.test(con)) { body(0.021, 0.0117, 0.0082, E.lens); bx(grp, 0.012, 0.0105, 0.0075, E.shrinkB, 0.026, 0, 0, 0.002); }
    else if (/barrel/.test(con)) { cyl(grp, 0.0028, 0.009, E.alu, 0.0045, 0, 0, 'x', 14); cyl(grp, 0.0045, 0.02, E.housing, 0.019, 0, 0, 'x', 18); }
    else if (/Deutsch/.test(con)) body(0.024, 0.013, 0.0095, std(0x5c6166, 0.6), 0.002);
    else if (/XT90/.test(con) || /solder|pad|terminal|taps|NTC/.test(con)) {
      cyl(grp, od * 0.42, 0.003, E.tin, 0.0015, 0, 0, 'x', 10);
      if (od > 0.002) cyl(grp, od * 0.62, 0.014, w.colour === '#c0262d' ? E.shrinkR : E.shrinkK, 0.009, 0, 0, 'x', 14);
    }
    return grp;
  }

  const wireGroup = new THREE.Group(); inside.add(wireGroup);
  HN.wires.forEach(w => {
    const pts = smoothPath(w.route), od = odOf(w), n = w.conductors || 1, len = lengthOf(pts);
    const fromP = portOf(w.from), toP = portOf(w.to);
    const info = `${w.awg ? w.awg + ' AWG' : w.cable}${n > 1 ? ' × ' + n : ''} · ${(len * 1000).toFixed(0)} mm · ${w.from} → ${w.to}`;
    // split off the outside tail (beyond the gland) so it shows without the cutaway
    const near = (p) => glandPts.some(gp => gp.distanceTo(p) < 0.003);
    let pieces = [[pts, wireGroup]];
    if (extPortComps.has(w.to.split('.')[0])) {
      const gi = pts.findIndex(near);
      if (gi > 0) pieces = [[pts.slice(0, gi + 1), wireGroup], [pts.slice(gi), outer]];
    } else if (extPortComps.has(w.from.split('.')[0])) {
      let gi = -1; pts.forEach((p, i) => { if (near(p)) gi = i; });
      if (gi > 0) pieces = [[pts.slice(0, gi + 1), outer], [pts.slice(gi), wireGroup]];
    }
    pieces.filter(([seg]) => seg.length > 1).forEach(([seg, grp]) => {
      const holder = new THREE.Group(); grp.add(holder);
      if (n === 1) holder.add(mk(tube(seg, od / 2, w.cable ? 10 : 8), wmat(w.colour)));
      else { // loose twisted conductors, as on JST-GH / servo / power pair leads
        const rc = HN.insulated_od_mm[String(w.awg)] / 2000, hr = n === 2 ? rc : rc / Math.sin(Math.PI / n), { N, B: Bv } = frames(seg);
        let s = 0;
        const off = seg.map((p, i) => { if (i) s += p.distanceTo(seg[i - 1]); return s; });
        for (let k = 0; k < n; k++) {
          const cp = seg.map((p, i) => { const a = off[i] / 0.03 * Math.PI * 2 + k * Math.PI * 2 / n; return p.clone().add(N[i].clone().multiplyScalar(Math.cos(a) * hr)).add(Bv[i].clone().multiplyScalar(Math.sin(a) * hr)); });
          holder.add(mk(tube(cp, rc, 6), wmat((w.colours || [w.colour])[k % (w.colours || [w.colour]).length])));
        }
      }
      tag(holder, w.function, info);
    });
    // connectors at both ends
    [[w.from, fromP, pts[0], pts[Math.min(3, pts.length - 1)]], [w.to, toP, pts[pts.length - 1], pts[Math.max(pts.length - 4, 0)]]].forEach(([ref, p, a, b]) => {
      const ext = extPortComps.has(ref.split('.')[0]);
      if (/30_pontoons/.test(byId[ref.split('.')[0]].drawn_by || '')) return; // the pontoon module draws the inflator head's connector
      const grp = endConnector(ext ? outer : wireGroup, p.connector, p.pins, a, b.clone().sub(a).normalize(), w);
      tag(grp, `${p.connector}`, `${ref} · ${p.pins.join(', ')}`);
    });
    // cable ties on the heavy and the multi-conductor runs, every ~70 mm
    if ((w.awg && w.awg <= 12) || n >= 4) {
      for (let s = 0.05, i = 0, acc = 0; i < pts.length - 1; i++) {
        acc += pts[i + 1].distanceTo(pts[i]);
        if (acc >= s && acc < len - 0.03) {
          const t = mk(new THREE.TorusGeometry(od * (n > 1 ? 0.9 : 0.62) + 0.0006, 0.0007, 6, 16), E.housing);
          t.position.copy(pts[i]); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pts[i + 1].clone().sub(pts[i]).normalize());
          wireGroup.add(tag(t, 'Cable tie', '2.5 mm nylon tie'));
          s += 0.07;
        }
      }
    }
  });

  // cutaway: "See inside" slices off everything above the cut height (shell roof, arm tops, decals, mast) and shows
  // the shell's inner wall. Off = the plane parked far above the drone, so nothing is clipped.
  M.shell.clippingPlanes = [roofCut]; M.shell.clipShadows = true;
  const clipAll = o => o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.clippingPlanes = [roofCut]; m.material.clipShadows = true; } });
  [...decals, mast, puck, inside, outer].forEach(clipAll);
  inside.visible = false;
