  // ---- markings projected onto the shell (decals)
  function decalTexture(draw, w = 1024, h = 256) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    const redraw = () => { const g = cv.getContext('2d'); g.clearRect(0, 0, w, h); draw(g); t.needsUpdate = true; };
    redraw();
    if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('700 150px "Barlow Condensed"'), document.fonts.load('500 34px "JetBrains Mono"')]).then(redraw, () => {});
    return t;
  }
  const nameTex = decalTexture(g => {
    g.fillStyle = '#2a2e31'; g.font = '700 160px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('ARK-1', 70, 165);
    g.fillStyle = '#e8621c'; g.fillRect(74, 190, 560, 8);
    g.fillStyle = '#7b8286'; g.font = '500 34px "JetBrains Mono", monospace'; g.fillText("NOAH'S ARK · AMPHIBIOUS", 74, 240);
  });
  const stripeTex = decalTexture(g => { g.fillStyle = '#e8621c'; g.fillRect(0, 60, 1024, 50); g.fillStyle = '#2a2e31'; g.fillRect(0, 140, 1024, 18); }, 1024, 256);
  // Seventh Axis mark: the exact path from SlipStream (Gannet SX-01 livery)
  const SEVENTH_AXIS = new Path2D('M11.1 8H52.9L22.2 56H16L43.1 13.7H11.1ZM17.7 34.2a14.4 14.4 0 1 0 28.8 0a14.4 14.4 0 1 0-28.8 0Z');
  const axisTex = decalTexture(g => {
    g.save(); g.translate(48, 16); g.scale(176 / 64, 176 / 64); g.fillStyle = '#15171a'; g.fill(SEVENTH_AXIS, 'evenodd'); g.restore();
    g.fillStyle = '#15171a'; g.font = '600 26px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText('SEVENTH AXIS', 136, 236);
  }, 272, 256);
  // downloaded artwork (industrial-design/livery/SOURCES.md): flag of Malaysia, AWS and GDEX logos
  const imgTex = uri => { const t = new THREE.Texture(), im = new Image(); im.onload = () => { t.image = im; t.needsUpdate = true; }; im.src = uri; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
  const flagTex = imgTex(A.livery['flag-of-malaysia']), awsTex = imgTex(A.livery['aws-logo']), gdexTex = imgTex(A.livery['gdex-logo']);
  const decals = [];
  const decalMat = t =>new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
  if (body && THREE.DecalGeometry) {
    ark.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), dummy = new THREE.Object3D();
    const W3 = (x, y, z) => new THREE.Vector3(x, y, z);
    // Shoot a ray from `o` along `dir` (drone frame) onto the shell and project a shallow decal there, facing back up
    // the ray, with its 'up' along `up` (drone frame).
    const place = (o, dir, up, w, h, mat) => {
      const from = ark.localToWorld(W3(...o)), wd = W3(...dir).normalize().transformDirection(ark.matrixWorld);
      ray.set(from, wd);
      const hit = ray.intersectObject(body)[0];
      if (!hit) return;
      dummy.position.copy(hit.point); dummy.up.copy(W3(...up).transformDirection(ark.matrixWorld));
      dummy.lookAt(hit.point.clone().sub(wd));
      const dmesh = new THREE.Mesh(new THREE.DecalGeometry(body, hit.point, dummy.rotation.clone(), W3(w, h, 0.04)), mat);
      scene.add(dmesh); decals.push(dmesh);
    };
    // name across the hub, read from behind; flags on both flanks
    place([0.08, 0, 0.5], [0, 0, -1], [1, 0, 0], 0.36, 0.09, decalMat(nameTex));
    // flanks, nose to tail: flag, GDEX, AWS
    [1, -1].forEach(s => {
      place([0.1, s * 0.6, -0.09], [0, -s, 0], [0, 0, 1], 0.09, 0.045, decalMat(flagTex));
      place([0.0, s * 0.6, -0.09], [0, -s, 0], [0, 0, 1], 0.09, 0.039, decalMat(gdexTex));
      place([-0.1, s * 0.6, -0.09], [0, -s, 0], [0, 0, 1], 0.075, 0.045, decalMat(awsTex));
    });
    // arms: stripe at the root, then the Seventh Axis mark (front arms) or the flag (rear arms) toward the motor
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => {
      const u = [sx / Math.SQRT2, sy / Math.SQRT2, 0];
      place([sx * 0.2, sy * 0.2, 0.5], [0, 0, -1], u, 0.16, 0.045, decalMat(stripeTex));
      if (sx > 0) place([sx * 0.275, sy * 0.275, 0.5], [0, 0, -1], u, 0.085, 0.08, decalMat(axisTex));
      else place([sx * 0.27, sy * 0.27, 0.5], [0, 0, -1], [-u[1], u[0], 0], 0.08, 0.04, decalMat(flagTex));
    });
  }
