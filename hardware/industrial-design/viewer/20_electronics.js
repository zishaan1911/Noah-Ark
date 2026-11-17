  // ---- electronics, built: pack in the belly well, avionics deck above it, ESCs in the arm roots, full harness
  // (always present; "See inside" cuts the roof off the shell to show them)
  const inside = new THREE.Group(); ark.add(inside);
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const add = (g, o, x, y, z) => { o.position.set(x, y, z); g.add(o); return o; };
  const plastic = new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: 0.6 });  // JST-GH housings
  const rubberIso = new THREE.MeshStandardMaterial({ color: 0x2a1d1d, roughness: 0.85 });
  const xt90 = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });
  const fan = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.4 });
  const ssd = new THREE.MeshStandardMaterial({ color: 0x1e3a6b, roughness: 0.5 });
  [plastic, rubberIso, xt90, fan, ssd].forEach(m => { m.color.convertSRGBToLinear(); m.envMapIntensity = 0.55; });
  const chip = (g, w, l, h, x, y, z, mat = M.black) => add(g, mk(new THREE.BoxGeometry(w, l, h), mat), x, y, z + h / 2);

  // battery: 12S x P cells upright, holders top and bottom, nickel strips per series group, BMS on the +x end, straps
  const B = R.battery, [bcx, bcy, bcz] = B.pack_centre_m, [bsx, bsy, bsz] = B.pack_size_m, S_ = B.grid[0];
  const pack = new THREE.Group(); pack.position.set(bcx, bcy, bcz); inside.add(pack);
  const cellGeo = new THREE.CylinderGeometry(0.0107, 0.0107, 0.0705, 20); cellGeo.rotateX(Math.PI / 2);
  const cells = new THREE.InstancedMesh(cellGeo, M.cell, S_ * P), dm = new THREE.Object3D();
  let ci = 0;
  for (let i = 0; i < S_; i++) for (let j = 0; j < P; j++) { dm.position.set((i - (S_ - 1) / 2) * 0.0214, (j - (P - 1) / 2) * 0.0214, 0); dm.updateMatrix(); cells.setMatrixAt(ci++, dm.matrix); }
  pack.add(cells);
  [-1, 1].forEach(s => add(pack, mk(new THREE.BoxGeometry(bsx - 0.006, bsy - 0.004, 0.004), M.black), 0, 0, s * 0.0375));
  for (let i = 0; i < S_; i++) [-1, 1].forEach(s => add(pack, mk(new THREE.BoxGeometry(0.008, bsy - 0.012, 0.0006), M.nickel), (i - (S_ - 1) / 2) * 0.0214, 0, s * 0.0398));
  const bms = add(pack, mk(new THREE.BoxGeometry(0.0016, bsy - 0.01, 0.062), M.pcbG), bsx / 2 + 0.001, 0, 0);
  for (let k = 0; k < 6; k++) chip(pack, 0.003, 0.008, 0.012, bsx / 2 + 0.0025, -0.03 + k * 0.012, -0.006);
  [-0.07, 0.07].forEach(x => add(pack, mk(new THREE.BoxGeometry(0.02, bsy + 0.003, bsz + 0.003), M.black), x, 0, 0));
  tag(pack, 'Battery ' + C.pack, `${S_ * P} × Samsung INR21700-50S in the belly well, ${C.pack_kwh.toFixed(2)} kWh; BMS on the front end`);

  // avionics deck: carbon plate on shelf bosses, with a window over the pack
  const dz = R.deck_z_m;
  const deckShape = new THREE.Shape();
  const dW = 0.15, dH = 0.115, rr = 0.012;
  deckShape.moveTo(-dW + rr, -dH); deckShape.lineTo(dW - rr, -dH); deckShape.quadraticCurveTo(dW, -dH, dW, -dH + rr); deckShape.lineTo(dW, dH - rr);
  deckShape.quadraticCurveTo(dW, dH, dW - rr, dH); deckShape.lineTo(-dW + rr, dH); deckShape.quadraticCurveTo(-dW, dH, -dW, dH - rr); deckShape.lineTo(-dW, -dH + rr); deckShape.quadraticCurveTo(-dW, -dH, -dW + rr, -dH);
  const win = new THREE.Path(); win.moveTo(-0.13, -0.035); win.lineTo(-0.075, -0.035); win.lineTo(-0.075, 0.035); win.lineTo(-0.13, 0.035); win.lineTo(-0.13, -0.035);
  deckShape.holes.push(win);
  [[-0.05, 0.07], [-0.05, -0.07], [0.06, 0.07], [0.06, -0.07]].forEach(([x, y]) => { const h = new THREE.Path(); h.absarc(x, y, 0.012, 0, Math.PI * 2, true); deckShape.holes.push(h); });
  const deckM = add(inside, mk(new THREE.ExtrudeGeometry(deckShape, { depth: 0.002, bevelEnabled: false, curveSegments: 24 }), M.carbon), 0.0, 0, dz);
  tag(deckM, 'Avionics deck', '2 mm carbon plate on shelf bosses, lightened, with a window over the pack');
  [[-0.14, 0.105], [-0.14, -0.105], [0.14, 0.105], [0.14, -0.105]].forEach(([x, y]) => add(inside, mk(new THREE.CylinderGeometry(0.003, 0.003, 0.006, 12).rotateX(Math.PI / 2), M.steel), x, y, dz - 0.003));

  // Holybro Pixhawk 6X: standard baseboard on 4 rubber isolators, JST-GH rows on both long sides, FC module on top
  const fc = new THREE.Group(); fc.position.set(-0.005, 0, dz + 0.002); inside.add(fc);
  [[-0.04, 0.02], [-0.04, -0.02], [0.04, 0.02], [0.04, -0.02]].forEach(([x, y]) => add(fc, mk(new THREE.SphereGeometry(0.0045, 14, 10), rubberIso), x, y, 0.0045));
  add(fc, box(0.1034, 0.0524, 0.0167, M.anod, 0, 0, 0.009 + 0.0083, 0.003));
  for (let k = 0; k < 9; k++) [-1, 1].forEach(s => chip(fc, 0.007, 0.004, 0.005, -0.04 + k * 0.01, s * 0.0242, 0.0225, plastic));
  const mod = add(fc, box(0.0388, 0.0318, 0.0146, M.steel, -0.012, 0, 0.0257 + 0.0073, 0.002));
  for (let k = 0; k < 6; k++) chip(fc, 0.0388, 0.0016, 0.0015, -0.012, -0.012 + k * 0.0048, 0.0403, M.steel);
  chip(fc, 0.012, 0.006, 0.0006, 0.03, 0, 0.0257, M.white); // forward arrow plate
  tag(fc, 'Holybro Pixhawk 6X', 'Standard baseboard 103.4 × 52.4 × 16.7 mm on rubber isolators; FC module 38.8 × 31.8 × 14.6 mm');

  // NVIDIA Jetson Orin Nano: module + heatsink + fan on a carrier, M.2 SSD and LTE card underneath, port row at the back
  const jet = new THREE.Group(); jet.position.set(0.105, 0, dz + 0.002); inside.add(jet);
  [[-0.045, 0.035], [-0.045, -0.035], [0.045, 0.035], [0.045, -0.035]].forEach(([x, y]) => add(jet, mk(new THREE.CylinderGeometry(0.0025, 0.0025, 0.006, 10).rotateX(Math.PI / 2), M.steel), x, y, 0.003));
  add(jet, box(0.1, 0.079, 0.0016, M.pcbG, 0, 0, 0.0068, 0.001));
  chip(jet, 0.0696, 0.045, 0.004, 0.0, 0.0, 0.0076, M.pcbG);
  for (let k = 0; k < 15; k++) chip(jet, 0.0018, 0.05, 0.016, -0.031 + k * 0.0044, 0, 0.0116, M.anod);
  add(jet, mk(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 32).rotateX(Math.PI / 2), fan), 0, 0, 0.0306);
  chip(jet, 0.042, 0.022, 0.0025, 0.0, -0.03, 0.0028, ssd);
  chip(jet, 0.051, 0.03, 0.002, 0.0, 0.026, 0.0028, M.pcbG);
  chip(jet, 0.016, 0.014, 0.007, -0.05, 0.02, 0.0076, M.steel); chip(jet, 0.016, 0.014, 0.007, -0.05, -0.005, 0.0076, M.steel); chip(jet, 0.015, 0.016, 0.012, -0.05, -0.028, 0.0076, M.steel);
  tag(jet, 'NVIDIA Jetson Orin Nano', 'Module 69.6 × 45 mm with heatsink and fan on a 100 × 79 mm carrier; NVMe SSD and LTE modem underneath');

  // power distribution: bulk capacitors, XT90 from the pack, solder pads for the four ESC pairs
  const pdb = new THREE.Group(); pdb.position.set(-0.105, 0.06, dz + 0.002); inside.add(pdb);
  add(pdb, box(0.06, 0.05, 0.0016, M.pcbB, 0, 0, 0.004, 0.002));
  [-0.016, 0.0].forEach(x => add(pdb, mk(new THREE.CylinderGeometry(0.0063, 0.0063, 0.02, 20).rotateX(Math.PI / 2), M.steel), x, 0.012, 0.015));
  add(pdb, box(0.021, 0.016, 0.02, xt90, 0.012, -0.012, 0.0148, 0.002));
  for (let k = 0; k < 8; k++) chip(pdb, 0.005, 0.004, 0.0008, -0.024 + k * 0.0068, -0.02, 0.0048, M.copper);
  tag(pdb, 'Power distribution board', '12S bus: XT90 from the pack, bulk capacitors, four ESC feeds, 5 V/12 V regulators');

  // radios: RFD900x with two SMA leads, RockBLOCK 9603 under the roof (patch antenna up through the shell)
  const rfd = new THREE.Group(); rfd.position.set(-0.105, -0.06, dz + 0.002); inside.add(rfd);
  add(rfd, box(0.057, 0.03, 0.013, M.anod, 0, 0, 0.0065, 0.002));
  [-0.01, 0.01].forEach(y => add(rfd, mk(new THREE.CylinderGeometry(0.0032, 0.0032, 0.008, 12).rotateZ(Math.PI / 2), M.gold), -0.032, y, 0.006));
  tag(rfd, 'RFD900x telemetry radio', '900 MHz long-range link to the ground station');
  const rb = new THREE.Group(); rb.position.set(0.02, 0, R.mounts.hub_top_z_m - 0.03); inside.add(rb);
  add(rb, box(0.045, 0.045, 0.015, M.pcbG, 0, 0, 0, 0.002)); chip(rb, 0.025, 0.025, 0.004, 0, 0, 0.0075, M.white);
  tag(rb, 'RockBLOCK 9603', 'Iridium satellite modem, 45 × 45 × 15 mm, patch antenna up');

  // ESCs in the arm roots: finned housing, power pair in from the PDB, three phase leads out to the motor
  const escs = [];
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => {
    const a = Math.atan2(sy, sx), r = 0.225, e = new THREE.Group();
    e.position.set(Math.cos(a) * r, Math.sin(a) * r, -0.085); e.rotation.z = a; inside.add(e);
    add(e, box(0.0885, 0.0366, 0.012, M.pcbB, 0, 0, 0, 0.003));
    for (let k = 0; k < 7; k++) chip(e, 0.075, 0.0022, 0.007, 0, -0.0147 + k * 0.0049, 0.006, M.anod);
    tag(e, 'T-Motor ALPHA 80A 12S ESC', '88.5 × 36.6 × 19 mm, 110 g, FOC, in the arm root');
    escs.push({ a, r });
  });

  // harness: TubeGeometry along routed paths
  const wireMats = { red: M.red, black: M.black, blue: new THREE.MeshStandardMaterial({ color: 0x2b59c3, roughness: 0.5 }), white: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }) };
  wireMats.blue.color.convertSRGBToLinear(); wireMats.white.color.convertSRGBToLinear();
  const harness = new THREE.Group(); inside.add(harness);
  const wire = (pts, r, mat) => harness.add(mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 48, r, 8), mat));
  const px = bcx + bsx / 2;
  wire([[px, 0.02, bcz + 0.02], [px + 0.01, 0.04, dz - 0.01], [-0.1, 0.048, dz + 0.012], [-0.093, 0.048, dz + 0.016]], 0.0034, M.red);   // 8 AWG pack +
  wire([[px, 0.035, bcz + 0.02], [px + 0.012, 0.055, dz - 0.008], [-0.1, 0.052, dz + 0.012], [-0.093, 0.052, dz + 0.02]], 0.0034, M.black); // 8 AWG pack -
  escs.forEach(({ a, r }, i) => {
    const ex = Math.cos(a) * (r - 0.044), ey = Math.sin(a) * (r - 0.044), ox = Math.cos(a) * (r + 0.044), oy = Math.sin(a) * (r + 0.044);
    [[M.red, 0.002], [M.black, -0.002]].forEach(([m, off]) => wire([[-0.1 + off, 0.04, dz + 0.006], [ex * 0.5, ey * 0.5 + off, dz + 0.012], [ex, ey + off, -0.085]], 0.0019, m)); // 12 AWG feeds
    [-0.004, 0, 0.004].forEach((off, k) => wire([[ox, oy + off, -0.085], [Math.cos(a) * 0.32, Math.sin(a) * 0.32 + off, -0.07], [Math.cos(a) * 0.5, Math.sin(a) * 0.5 + off, -0.055]], 0.0016, k === 1 ? M.black : M.anod)); // phase leads
    wire([[-0.03, (i < 2 ? 1 : -1) * 0.022, dz + 0.02], [ex * 0.6, ey * 0.6, dz + 0.015], [ex, ey, -0.08]], 0.0009, wireMats.white); // DShot signal
  });
  wire([[-0.02, 0.0, dz + 0.035], [-0.05, 0.0, -0.02], [-0.06, 0.0, R.mounts.hub_top_z_m]], 0.0016, M.black);             // GPS up the mast
  wire([[-0.05, -0.02, dz + 0.02], [-0.1, -0.03, -0.18], [-0.11, 0.0, R.mounts.radar_z_m + 0.005]], 0.0014, wireMats.blue); // radar
  wire([[0.03, -0.02, dz + 0.02], [0.08, -0.06, -0.19], [0.04, 0.0, under + 0.004]], 0.0012, wireMats.white);               // cargo latch + contacts
  wire([[-0.105, -0.075, dz + 0.01], [-0.12, -0.075, -0.2], [-0.13, -0.07, under + 0.01]], 0.0014, M.black);               // RFD antenna leads
  wire([[0.0, 0.02, dz + 0.035], [0.02, 0.02, -0.06], [0.02, 0.0, R.mounts.hub_top_z_m - 0.04]], 0.0012, M.black);          // RockBLOCK
  tag(harness, 'Wiring harness', '8 AWG pack leads, 12 AWG ESC feeds, phase leads up the arms, DShot signal, GPS, radar, cargo and radio cables');

  // cutaway: "See inside" slices off everything above the cut height (shell roof, arm tops, decals, mast) and shows
  // the shell's inner wall. Off = the plane parked far above the drone, so nothing is clipped.
  const roofCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3);
  renderer.localClippingEnabled = true;
  M.shell.clippingPlanes = [roofCut]; M.shell.clipShadows = true;
  const clipAll = o => o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.clippingPlanes = [roofCut]; m.material.clipShadows = true; } });
  [...decals, mast, puck, inside].forEach(clipAll);
  inside.visible = false;
