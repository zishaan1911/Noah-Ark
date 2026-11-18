import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 finds its worker next to its own module; Vite's dep bundling moves that, so bundle the worker ourselves.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './index.css';
import { GdexOps } from './pages/GdexOps';

setWorkerUrl(maplibreWorkerUrl);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <GdexOps />
  </StrictMode>,
);
