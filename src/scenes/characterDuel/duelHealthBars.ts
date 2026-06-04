import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { AnimatedCharacterSceneRig } from '../../character/AnimatedCharacter.ts';

export interface DuelHealthBars {
  update(options: {
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer | WebGPURenderer;
    rigA: AnimatedCharacterSceneRig;
    rigB: AnimatedCharacterSceneRig;
    healthA: number;
    healthB: number;
  }): void;
  destroy(): void;
}

const BAR_WIDTH_PX = 72;
const BAR_HEIGHT_PX = 7;
const HEAD_OFFSET_Y = 0.42;

export function createDuelHealthBars(): DuelHealthBars {
  const layer = document.createElement('div');
  layer.className = 'duel-health-layer';
  layer.dataset.testid = 'duel-health-layer';

  const barA = createBar('duel-health-bar-a', 'Fighter A');
  const barB = createBar('duel-health-bar-b', 'Fighter B');
  layer.append(barA.root, barB.root);
  document.body.append(layer);

  const world = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const size = new THREE.Vector2();

  return {
    update({ camera, renderer, rigA, rigB, healthA, healthB }) {
      renderer.getSize(size);
      updateBar(barA, rigA, healthA, camera, size, world, ndc);
      updateBar(barB, rigB, healthB, camera, size, world, ndc);
    },
    destroy() {
      layer.remove();
    },
  };
}

function createBar(testId: string, label: string): {
  root: HTMLDivElement;
  fill: HTMLDivElement;
} {
  const root = document.createElement('div');
  root.className = 'duel-health-bar';
  root.dataset.testid = testId;
  root.title = label;

  const track = document.createElement('div');
  track.className = 'duel-health-bar__track';

  const fill = document.createElement('div');
  fill.className = 'duel-health-bar__fill';
  track.append(fill);
  root.append(track);
  return { root, fill };
}

function updateBar(
  bar: { root: HTMLDivElement; fill: HTMLDivElement },
  rig: AnimatedCharacterSceneRig,
  health: number,
  camera: THREE.Camera,
  size: THREE.Vector2,
  world: THREE.Vector3,
  ndc: THREE.Vector3,
): void {
  const anchors = rig.getCharacterAnchors();
  const anchor = anchors.neck ?? anchors.chest;
  if (!anchor) {
    bar.root.style.display = 'none';
    return;
  }

  world.copy(anchor);
  world.y += HEAD_OFFSET_Y;
  ndc.copy(world).project(camera);

  if (ndc.z < -1 || ndc.z > 1) {
    bar.root.style.display = 'none';
    return;
  }

  const x = (ndc.x * 0.5 + 0.5) * size.x;
  const y = (-ndc.y * 0.5 + 0.5) * size.y;
  bar.root.style.display = 'block';
  bar.root.style.left = `${x - BAR_WIDTH_PX * 0.5}px`;
  bar.root.style.top = `${y - BAR_HEIGHT_PX - 10}px`;
  bar.fill.style.width = `${Math.round(Math.max(0, Math.min(1, health)) * 100)}%`;
  bar.root.dataset.health = health.toFixed(3);
}
