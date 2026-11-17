  // ---- GNSS mast, radar altimeter, cargo connector + pod
  const top = R.mounts.hub_top_z_m, under = R.mounts.hub_bottom_z_m;
  const mast = ark.add(tag(shadowed(cylZ(0.005, 0.07, M.carbon, -0.06, 0, top + 0.03)), 'GNSS mast', 'Carbon, lifts the antenna clear of the motors')).children.at(-1);
  const puck = new THREE.Group(); puck.position.set(-0.06, 0, top + 0.07);
  puck.add(cylZ(0.025, 0.012, M.white, 0, 0, 0, 48), cylZ(0.021, 0.004, M.black, 0, 0, 0.007, 48));
  ark.add(tag(shadowed(puck), 'Holybro M10 GPS', 'GNSS + compass'));
  const rad = new THREE.Group(); rad.position.set(-0.11, 0, R.mounts.radar_z_m - 0.012);
  rad.add(box(0.079, 0.108, 0.02, M.radome, 0, 0, 0, 0.004));
  ark.add(tag(shadowed(rad), 'Ainstein US-D1 radar altimeter', '108 × 79 × 20 mm, 110 g; sees the water surface through rain'));
  const conn = new THREE.Group(); conn.position.set(0.04, 0, under);
  conn.add(cylZ(0.03, 0.014, M.anod, 0, 0, -0.007, 48), cylZ(0.032, 0.004, M.orange, 0, 0, -0.016, 48), cylZ(0.022, 0.012, M.black, 0, 0, -0.022, 40));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; conn.add(cylZ(0.0018, 0.006, M.gold, Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.029, 10)); }
  conn.add(box(0.008, 0.02, 0.012, M.steel, 0.0, 0, -0.033, 0.002));
  ark.add(tag(shadowed(conn), 'Cargo connector', 'Servo latch + 4 pogo contacts for smart cargo (ID, sensors, release confirm)'));
  const cargo = new THREE.Group(); cargo.position.set(0.04, 0, under - 0.04 - 0.05);
  cargo.add(box(0.25, 0.16, 0.1, M.white, 0, 0, 0, 0.018));
  cargo.add(box(0.03, 0.163, 0.103, M.orange, -0.07, 0, 0, 0.004), box(0.03, 0.163, 0.103, M.orange, 0.07, 0, 0, 0.004));
  cargo.add(cylZ(0.02, 0.02, M.anod, 0, 0, 0.06, 32));
  ark.add(tag(shadowed(cargo), 'Cargo pod, 2 kg', '250 × 160 × 100 mm; clips to the connector, released by the flight controller'));
