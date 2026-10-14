import type { Grid } from '@naqsh/core';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Btn } from '../panels/common';

/** Max vertices per side in the 3D preview (the full grid can be millions of cells). */
const MAX_SIDE = 400;

/** Builds a lit, shaded mesh of the relief surface (world mm, Z up). */
function reliefGeometry(g: Grid): THREE.BufferGeometry {
  const step = Math.max(1, Math.ceil(Math.max(g.cols, g.rows) / MAX_SIDE));
  const nc = Math.floor((g.cols - 1) / step) + 1;
  const nr = Math.floor((g.rows - 1) / step) + 1;
  const pos = new Float32Array(nc * nr * 3);
  for (let j = 0; j < nr; j++)
    for (let i = 0; i < nc; i++) {
      const c = i * step;
      const r = j * step;
      const o = (j * nc + i) * 3;
      pos[o] = (c + 0.5) * g.resolution;
      pos[o + 1] = (r + 0.5) * g.resolution;
      pos[o + 2] = g.z[r * g.cols + c] as number;
    }
  const idx: number[] = [];
  for (let j = 0; j < nr - 1; j++)
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i;
      idx.push(a, a + 1, a + nc + 1, a, a + nc + 1, a + nc);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function Relief3D({ grid, onClose }: { grid: Grid; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<
    { scene: THREE.Scene; mesh?: THREE.Mesh; render: () => void } | undefined
  >(undefined);

  // Scene, camera, lights and controls: created once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(
      getComputedStyle(el).getPropertyValue('--canvas-bg').trim() || '#e6e9ee',
    );
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 100_000);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-1, -1.5, 2);
    scene.add(sun);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    sceneRef.current = { scene, render };

    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // Look at the relief from the front, slightly above.
    const box = (el.dataset.box ?? '0,0,100,100').split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const span = Math.max(box[2] - box[0], box[3] - box[1]);
    camera.position.set(cx, cy - span * 1.1, span * 0.9);
    controls.target.set(cx, cy, 0);
    controls.update();
    fit();
    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = undefined;
    };
  }, []);

  // Mesh: rebuilt when the relief changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (s.mesh) {
      s.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(
      reliefGeometry(grid),
      new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.85, metalness: 0 }),
    );
    s.scene.add(mesh);
    s.mesh = mesh;
    s.render();
  }, [grid]);

  return (
    <div className="relief-3d" data-testid="relief-3d-view">
      <div
        ref={host}
        className="relief-3d-host"
        data-box={`0,0,${grid.cols * grid.resolution},${grid.rows * grid.resolution}`}
      />
      <div className="float relief-3d-bar">
        <span className="muted">Drag to rotate · right-drag to pan · scroll to zoom</span>
        <Btn icon={X} label="Close 3D" variant="ghost" onClick={onClose} />
      </div>
    </div>
  );
}
