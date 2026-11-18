import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 finds its worker next to its own module; Vite's dep bundling moves that, so bundle the worker ourselves.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './index.css';
import { FleetOps } from './pages/FleetOps';
import { GdexOps } from './pages/GdexOps';

setWorkerUrl(maplibreWorkerUrl);

/** Two pages, picked by the URL hash; no router library. */
function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash === '#/fleet' ? <FleetOps /> : <GdexOps />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
