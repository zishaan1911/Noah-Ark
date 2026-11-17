  // ---- inflatable pontoons: stowed packs on the skids, inflated tubes for a water landing
  function capsuleGeo(r, len, seg = 48) {
    const pts = [], half = len / 2 - r;
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, -half + Math.sin(a) * r)); }
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, half + Math.sin(a) * r)); }
    const g = new THREE.LatheGeometry(pts, seg); g.rotateZ(Math.PI / 2); return g; // axis along x
  }
  const W = R.pontoons, floats = [];
  [1, -1].forEach(s => {
    const y = s * W.skid_y_m;
    const stowed = new THREE.Group(); stowed.position.set(0, y - s * 0.03, R.mounts.skid_bottom_z_m + 0.045);
    stowed.add(mesh(capsuleGeo(PT.stowed_d_m / 2, PT.stowed_length_m), M.orange));
    [-0.12, 0, 0.12].forEach(x => { const st = cylZ(PT.stowed_d_m / 2 + 0.002, 0.012, M.black, x, 0, 0, 32); st.rotation.set(0, Math.PI / 2, 0); stowed.add(st); });
    const co2 = cylZ(0.011, 0.09, M.steel, 0.24, 0, 0.0, 24); co2.rotation.set(0, Math.PI / 2, 0); stowed.add(co2);
    ark.add(tag(shadowed(stowed), 'Pontoon pack (stowed)', 'Folded tube + 60 g CO2 cartridge; the flight controller fires it before a water touchdown'));
    const tube = new THREE.Group(); tube.position.set(0, y, W.tube_centre_z_m);
    tube.add(mesh(capsuleGeo(PT.d_m / 2, PT.length_m), M.yellow));
    [-0.2, 0, 0.2].forEach(x => { const sm = new THREE.Mesh(new THREE.TorusGeometry(PT.d_m / 2 + 0.001, 0.0025, 8, 64), M.orange); sm.position.x = x; sm.rotation.y = Math.PI / 2; tube.add(sm); });
    tube.add(box(PT.length_m * 0.7, 0.02, 0.006, M.orange, 0, 0, PT.d_m / 2 - 0.002, 0.002));
    tube.scale.setScalar(0.001); tube.visible = false;
    ark.add(tag(shadowed(tube), 'Inflated pontoon', `${W.volume_l_each.toFixed(1)} L, Ø${PT.d_m * 1000} × ${PT.length_m * 1000} mm, TPU-coated nylon`));
    floats.push({ stowed, tube });
  });

  // inflation: eased toward the target each frame (placeholder motion; the pontoon module owns this)
  let inflate = 0, inflateTarget = 0;
  hooks.setInflate = (on, instant) => { inflateTarget = on ? 1 : 0; if (instant) inflate = inflateTarget; };
  hooks.inflateNow = () => { inflateTarget = 1; inflate = 1; };
  hooks.frame.push(() => {
    inflate += (inflateTarget - inflate) * 0.08;
    if (Math.abs(inflate - inflateTarget) < 0.002) inflate = inflateTarget;
    floats.forEach(f => {
      const k = Math.max(inflate, 0.001);
      f.tube.visible = inflate > 0.01; f.tube.scale.set(0.35 + 0.65 * k, k, k); f.stowed.visible = inflate < 0.5;
    });
  });
