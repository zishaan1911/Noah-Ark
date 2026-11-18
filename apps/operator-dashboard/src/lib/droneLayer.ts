import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type MapLibreMap,
} from 'maplibre-gl';
import { prefersReducedMotion } from './prefs';
import type { Pose } from './types';

export type ModelStatus = 'loading' | 'ready' | 'error';

export interface DroneLayer extends CustomLayerInterface {
  setPose(pose: Pose): void;
  setVisible(visible: boolean): void;
  setArmed(armed: boolean): void;
}

const MODEL_URL = '/models/ark1.glb';
const PROP_RAD_PER_S = 70;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Renders /models/ark1.glb into MapLibre's GL context with three.js (the standard MapLibre + three.js pattern).
 * glb convention: metres, +Y up, nose toward -Z, origin at ground contact, nodes prop_1..prop_4 with extras.dir ±1.
 * If the model fails to load nothing is drawn; there is no stand-in primitive.
 */
export function createDroneLayer(onStatus: (status: ModelStatus) => void): DroneLayer {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  // The model -> mercator basis below is mirrored (mercator y points south). three.js picks the face winding from
  // the object's determinant, so the pivot carries a mirror F and the camera matrix carries F again (F * F = I).
  const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
  const pivot = new THREE.Group();
  pivot.matrixAutoUpdate = false;
  pivot.matrix.copy(MIRROR);
  scene.add(pivot);

  // The scene is in the model's own frame (metres, +Y up); its pose in mercator space is folded into the camera
  // matrix each frame, so lights are in model axes too: sky above, sun high from one side.
  const hemi = new THREE.HemisphereLight(0xdde8ff, 0x556040, 1.6);
  hemi.position.set(0, 1, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.5, 1, 0.3);
  scene.add(hemi, sun);

  const props: { node: THREE.Object3D; dir: number }[] = [];
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MapLibreMap | null = null;
  let loaded = false;
  let visible = false;
  let armed = false;
  let pose: Pose | null = null;
  let lastMs = 0;
  const reducedMotion = prefersReducedMotion();

  const model = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const rx = new THREE.Matrix4();
  const rz = new THREE.Matrix4();

  const layer: DroneLayer = {
    id: 'ark-drone',
    type: 'custom',
    renderingMode: '3d',

    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      onStatus('loading');
      new GLTFLoader().load(
        MODEL_URL,
        (gltf) => {
          gltf.scene.traverse((o) => {
            o.frustumCulled = false;
            if (/^prop_[1-4]$/.test(o.name)) {
              const dir = Number(o.userData.extras?.dir ?? o.userData.dir ?? 1);
              props.push({ node: o, dir: dir < 0 ? -1 : 1 });
            }
          });
          pivot.add(gltf.scene);
          loaded = true;
          onStatus('ready');
          m.triggerRepaint();
        },
        undefined,
        () => onStatus('error'),
      );
    },

    onRemove() {
      renderer?.dispose();
      renderer = null;
      map = null;
    },

    render(_gl, args: CustomRenderMethodInput) {
      if (!renderer || !loaded || !visible || !pose) return;
      const s = MercatorCoordinate.fromLngLat([pose.lon, pose.lat], pose.altAmslM);
      const k = s.meterInMercatorCoordinateUnits();
      const h = rad(pose.headingDeg);

      // Model axes in mercator space: up -> +z, nose (-Z) -> heading, right -> heading + 90 degrees.
      // Mercator y points south, so north is -y.
      basis.makeBasis(
        new THREE.Vector3(k * Math.cos(h), k * Math.sin(h), 0),
        new THREE.Vector3(0, 0, k),
        new THREE.Vector3(-k * Math.sin(h), k * Math.cos(h), 0),
      );
      // Nose-up pitch is a turn about the right wing (+X); right-wing-down roll is a turn about the nose axis.
      local.copy(rz.makeRotationZ(-rad(pose.rollDeg))).multiply(rx.makeRotationX(rad(pose.pitchDeg)));
      model.copy(basis).multiply(local).setPosition(s.x, s.y, s.z).multiply(MIRROR);
      // Fold projection x model on the CPU in float64: a 1.5 m drone at mercator ~0.5 loses its shape in GPU float32.
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(model);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      const now = performance.now();
      const dt = lastMs ? Math.min(0.1, (now - lastMs) / 1000) : 0;
      lastMs = now;
      if (armed && !reducedMotion) for (const p of props) p.node.rotation.y += p.dir * PROP_RAD_PER_S * dt;

      renderer.resetState();
      // The chase subject always sits in front of the camera: drop the terrain depth so only the model occludes itself.
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (armed && !reducedMotion) map?.triggerRepaint();
    },

    setPose(p) {
      pose = p;
      if (visible) map?.triggerRepaint();
    },
    setVisible(v) {
      visible = v;
      map?.triggerRepaint();
    },
    setArmed(a) {
      armed = a;
    },
  };
  return layer;
}
