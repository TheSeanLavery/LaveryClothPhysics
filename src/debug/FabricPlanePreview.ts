import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import type { WebGPURenderer } from 'three/webgpu';
import { normalFlat, uniform } from 'three/tsl';
import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from '../sim/InextensibleFlagSettings';
import {
  configureFabricPlaneMaterial,
  setFabricPlaneDebugView,
  updateFabricPlaneMaterial,
} from '../shaders/FabricPlaneMaterial';

const PLANE_WIDTH = 1.6;
const PLANE_HEIGHT = 0.9;

export class FabricPlanePreview {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly settings: InextensibleFlagSettings;
  readonly material: THREE.MeshPhysicalNodeMaterial;
  private readonly flatShadingUniform = uniform(0);
  private readonly statusEl: HTMLElement;
  private readonly backendEl: HTMLElement;
  private readonly particlesEl: HTMLElement;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly backLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;

  constructor(
    container: HTMLElement,
    statusEl: HTMLElement,
    backendEl: HTMLElement,
    particlesEl: HTMLElement,
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.settings = defaultInextensibleFlagSettings();

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2438);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 30);
    this.camera.position.set(0, 0, 2.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 6;
    this.controls.update();

    this.ambientLight = new THREE.AmbientLight(0xffffff, this.settings.ambientIntensity);
    this.hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x2a3348, this.settings.hemiIntensity);
    this.keyLight = new THREE.DirectionalLight(0xfff4e8, this.settings.keyLightIntensity);
    this.keyLight.position.set(4, 6, 3);
    this.fillLight = new THREE.DirectionalLight(0xc8d8ff, this.settings.fillLightIntensity);
    this.fillLight.position.set(-5, 2, 4);
    this.backLight = new THREE.DirectionalLight(0xffd4c8, this.settings.backLightIntensity);
    this.backLight.position.set(2, 3, -5);
    this.rimLight = new THREE.DirectionalLight(0xffffff, this.settings.rimLightIntensity);
    this.rimLight.position.set(-3, 5, -2);
    this.scene.add(
      this.ambientLight,
      this.hemiLight,
      this.keyLight,
      this.fillLight,
      this.backLight,
      this.rimLight,
    );

    this.material = new THREE.MeshPhysicalNodeMaterial({
      color: new THREE.Color(this.settings.flagColor),
      side: THREE.FrontSide,
      roughness: this.settings.roughness,
      sheen: this.settings.sheen,
      sheenRoughness: this.settings.sheenRoughness,
      sheenColor: new THREE.Color(this.settings.flagColor),
      emissive: new THREE.Color(this.settings.flagColor),
      emissiveIntensity: this.settings.emissiveIntensity,
      envMapIntensity: 1.2,
    });

    configureFabricPlaneMaterial(this.material, {
      settings: this.settings,
      planeWidth: PLANE_WIDTH,
      planeHeight: PLANE_HEIGHT,
      flatShadingUniform: this.flatShadingUniform,
      normalFlat,
    });

    const mesh = new THREE.Mesh(this.createPlaneGeometry(), this.material);
    mesh.name = 'fabric-plane-preview';
    this.scene.add(mesh);

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT)),
      new THREE.LineBasicNodeMaterial({ color: 0x66aaff, transparent: true, opacity: 0.35 }),
    );
    this.scene.add(frame);

    this.particlesEl.textContent = `plane: ${PLANE_WIDTH}×${PLANE_HEIGHT}m, built-in UV × meters`;
    this.applySettings();
  }

  private createPlaneGeometry(): THREE.PlaneGeometry {
    return new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT, 128, 72);
  }

  async init(): Promise<void> {
    await this.renderer.init();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name} (plane preview)`;
    await this.renderer.compileAsync(this.scene, this.camera);

    this.statusEl.dataset.state = 'running';
    this.statusEl.textContent = 'running (fabric plane)';
  }

  applySettings(): void {
    const s = this.settings;

    this.flatShadingUniform.value = s.flatShading ? 1 : 0;
    this.renderer.toneMappingExposure = s.exposure;
    this.ambientLight.intensity = s.ambientIntensity;
    this.hemiLight.intensity = s.hemiIntensity;
    this.keyLight.intensity = s.keyLightIntensity;
    this.fillLight.intensity = s.fillLightIntensity;
    this.backLight.intensity = s.backLightIntensity;
    this.rimLight.intensity = s.rimLightIntensity;

    updateFabricPlaneMaterial(this.material, s);
  }

  setDebugView(mode: 'shaded' | 'uv' | 'normalMap' | 'albedo'): void {
    const modeIndex =
      mode === 'uv' ? 1 : mode === 'normalMap' ? 2 : mode === 'albedo' ? 3 : 0;
    setFabricPlaneDebugView(this.material, modeIndex);
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

export function createFabricPlaneControls(preview: FabricPlanePreview): GUI {
  const gui = new GUI({ title: 'Fabric Plane', width: 320 });
  gui.domElement.setAttribute('data-testid', 'flag-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  gui.domElement.style.right = '12px';
  gui.domElement.style.zIndex = '20';

  const settings = preview.settings;
  const sync = () => preview.applySettings();

  const debugViews = {
    view: 'shaded' as 'shaded' | 'uv' | 'normalMap' | 'albedo',
    applyView() {
      preview.setDebugView(debugViews.view);
    },
  };

  const fabricFolder = gui.addFolder('Fabric weave');
  fabricFolder.add(settings, 'fabricNormalStrength', 0, 2, 0.01).name('Weave strength').onChange(sync);
  fabricFolder.add(settings, 'fabricNormalScale', 0, 2, 0.01).name('Weave scale').onChange(sync);
  fabricFolder.add(settings, 'fabricTiling', 1, 24, 0.5).name('Weave tiling').onChange(sync);
  fabricFolder.addColor(settings, 'flagColor').name('Base color').onChange(sync);
  fabricFolder
    .add(debugViews, 'view', ['shaded', 'uv', 'normalMap', 'albedo'])
    .name('Debug view')
    .onChange(() => debugViews.applyView());
  fabricFolder.open();

  const materialFolder = gui.addFolder('Material');
  materialFolder.add(settings, 'roughness', 0, 1, 0.01).name('Roughness').onChange(sync);
  materialFolder.add(settings, 'sheen', 0, 1, 0.01).name('Sheen').onChange(sync);
  materialFolder.add(settings, 'sheenRoughness', 0, 1, 0.01).name('Sheen rough').onChange(sync);

  const lightingFolder = gui.addFolder('Lighting');
  lightingFolder.add(settings, 'exposure', 0.1, 6, 0.01).name('Exposure').onChange(sync);
  lightingFolder.add(settings, 'keyLightIntensity', 0, 10, 0.01).name('Key light').onChange(sync);
  lightingFolder.add(settings, 'fillLightIntensity', 0, 10, 0.01).name('Fill light').onChange(sync);

  return gui;
}
