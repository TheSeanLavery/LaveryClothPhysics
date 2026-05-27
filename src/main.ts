import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { InextensibleFlagSimulation } from './sim/InextensibleFlagSimulation';
import { createInextensibleFlagControls } from './ui/InextensibleFlagControls';

async function bootstrap(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('[data-testid="sim-status"]');
  const backendEl = document.querySelector<HTMLElement>('[data-testid="sim-backend"]');
  const particlesEl = document.querySelector<HTMLElement>('[data-testid="sim-particles"]');

  if (!statusEl || !backendEl || !particlesEl) {
    throw new Error('Missing simulation status elements');
  }

  if (!WebGPU.isAvailable()) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'error: WebGPU unavailable';
    document.body.appendChild(WebGPU.getErrorMessage());
    return;
  }

  const sim = new InextensibleFlagSimulation(document.body, statusEl, backendEl, particlesEl);
  await sim.init();
  window.__flagSimRefreshHealth = () => sim.refreshHealthFromGpu();
  createInextensibleFlagControls(sim);

  window.addEventListener('resize', () => sim.resize());

  sim.renderer.setAnimationLoop(() => {
    sim.update();
    sim.render();
  });
}

bootstrap().catch((error: unknown) => {
  const statusEl = document.querySelector<HTMLElement>('[data-testid="sim-status"]');
  if (statusEl) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
