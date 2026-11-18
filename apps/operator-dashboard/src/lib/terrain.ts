// AWS Terrain Tiles (Mapzen terrarium, z12). Same data and zoom the drone simulation uses, so the clearance we
// plan matches the ground the simulator flies over.
const ZOOM = 12;
const TILE_PX = 256;
const WORLD_PX = TILE_PX * 2 ** ZOOM;
const tileUrl = (x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;

const tiles = new Map<string, Promise<Uint8ClampedArray>>();

async function fetchTile(x: number, y: number): Promise<Uint8ClampedArray> {
  const res = await fetch(tileUrl(x, y), { mode: 'cors' });
  if (!res.ok) throw new Error(`Terrain tile ${ZOOM}/${x}/${y} failed (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas for terrain decoding');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
}

function getTile(x: number, y: number): Promise<Uint8ClampedArray> {
  const key = `${x}/${y}`;
  let tile = tiles.get(key);
  if (!tile) {
    tile = fetchTile(x, y);
    tiles.set(key, tile);
    tile.catch(() => tiles.delete(key)); // let a later call retry
  }
  return tile;
}

/** Elevation in metres of one global pixel at z12 (terrarium: R*256 + G + B/256 - 32768). */
async function pixelHeight(gx: number, gy: number): Promise<number> {
  const cx = Math.min(WORLD_PX - 1, Math.max(0, gx));
  const cy = Math.min(WORLD_PX - 1, Math.max(0, gy));
  const data = await getTile(Math.floor(cx / TILE_PX), Math.floor(cy / TILE_PX));
  const i = ((cy % TILE_PX) * TILE_PX + (cx % TILE_PX)) * 4;
  return (data[i] ?? 0) * 256 + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) / 256 - 32768;
}

/** Ground elevation in metres AMSL at a point, sampled bilinearly from the z12 terrain tiles. */
export async function elevationAt(lat: number, lon: number): Promise<number> {
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  const x = ((lon + 180) / 360) * WORLD_PX - 0.5;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD_PX - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const [h00, h10, h01, h11] = await Promise.all([
    pixelHeight(x0, y0),
    pixelHeight(x0 + 1, y0),
    pixelHeight(x0, y0 + 1),
    pixelHeight(x0 + 1, y0 + 1),
  ]);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}
