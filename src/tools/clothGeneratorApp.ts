import GUI from 'lil-gui';
import { makeDraggableLilGui } from '../ui/draggableFloating.ts';
import {
  CLOTH_PATTERN_LABELS,
  CLOTH_PRESETS,
  colorToHex,
  defaultClothGeneratorOptions,
  downloadRgbaAsPng,
  generateClothMaps,
  parseHexColor,
  rgbaToCanvas,
  type ClothGeneratorOptions,
  type ClothMapKind,
} from '../textures/clothGenerator';

const previewCanvases: Record<ClothMapKind, HTMLCanvasElement> = {
  normal: document.querySelector('#preview-normal') as HTMLCanvasElement,
  albedo: document.querySelector('#preview-albedo') as HTMLCanvasElement,
  roughness: document.querySelector('#preview-roughness') as HTMLCanvasElement,
  height: document.querySelector('#preview-height') as HTMLCanvasElement,
};

const statusEl = document.querySelector('#generator-status') as HTMLElement;

const guiState = {
  preset: 'custom',
  pattern: 'plain' as ClothGeneratorOptions['pattern'],
  size: 512,
  cellsU: 8,
  cellsV: 8,
  bumpScale: 5,
  threadCover: 0.4,
  fiberStrength: 0.85,
  seed: 1,
  threadCover: 0.4,
  fiberStrength: 0.85,
  colorContrast: 0.85,
  roughnessBase: 0.78,
  roughnessRange: 0.14,
  warpColor: '#f2ebe0',
  weftColor: '#d1ccc6',
};

let latestMaps = generateClothMaps(buildOptions());

function refreshGuiDisplay(root: GUI): void {
  root.controllers.forEach((controller) => controller.updateDisplay());
  root.folders.forEach((folder) => refreshGuiDisplay(folder));
}

function buildOptions(): ClothGeneratorOptions {
  return {
    pattern: guiState.pattern,
    size: guiState.size,
    cellsU: guiState.cellsU,
    cellsV: guiState.cellsV,
    bumpScale: guiState.bumpScale,
    seed: guiState.seed,
    threadCover: guiState.threadCover,
    fiberStrength: guiState.fiberStrength,
    colorContrast: guiState.colorContrast,
    roughnessBase: guiState.roughnessBase,
    roughnessRange: guiState.roughnessRange,
    warpColor: parseHexColor(guiState.warpColor, { r: 0.95, g: 0.92, b: 0.88 }),
    weftColor: parseHexColor(guiState.weftColor, { r: 0.82, g: 0.8, b: 0.78 }),
  };
}

function applyPatternDefaults(pattern: ClothGeneratorOptions['pattern']): void {
  const defaults = defaultClothGeneratorOptions(pattern);
  guiState.cellsU = defaults.cellsU;
  guiState.cellsV = defaults.cellsV;
  guiState.bumpScale = defaults.bumpScale;
  guiState.threadCover = defaults.threadCover;
  guiState.fiberStrength = defaults.fiberStrength;
  guiState.roughnessBase = defaults.roughnessBase;
  guiState.roughnessRange = defaults.roughnessRange;
  guiState.warpColor = colorToHex(defaults.warpColor);
  guiState.weftColor = colorToHex(defaults.weftColor);
}

function regenerate(): void {
  latestMaps = generateClothMaps(buildOptions());
  const kinds: ClothMapKind[] = ['albedo', 'normal', 'roughness', 'height'];
  for (const kind of kinds) {
    rgbaToCanvas(latestMaps[kind], latestMaps.size, latestMaps.size, previewCanvases[kind]);
  }
  statusEl.textContent = `${CLOTH_PATTERN_LABELS[guiState.pattern]} · ${guiState.size}×${guiState.size} · tileable`;
}

function downloadAll(): void {
  const base = `${guiState.pattern}-${guiState.size}`;
  for (const kind of ['albedo', 'normal', 'roughness', 'height'] as const) {
    downloadRgbaAsPng(`${base}_${kind}.png`, latestMaps[kind], latestMaps.size, latestMaps.size);
  }
}

function downloadOne(kind: ClothMapKind): void {
  downloadRgbaAsPng(
    `${guiState.pattern}-${guiState.size}_${kind}.png`,
    latestMaps[kind],
    latestMaps.size,
    latestMaps.size,
  );
}

const gui = new GUI({ title: 'Cloth Generator', width: 340 });
gui.domElement.style.position = 'fixed';
gui.domElement.style.top = '12px';
gui.domElement.style.right = '12px';
makeDraggableLilGui(gui);

const presetOptions = Object.fromEntries([
  ['Custom', 'custom'],
  ...CLOTH_PRESETS.map((preset) => [preset.label, preset.id]),
]);

gui
  .add(guiState, 'preset', presetOptions)
  .name('Preset')
  .onChange((presetId: string) => {
    if (presetId === 'custom') {
      return;
    }
    const preset = CLOTH_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }
    guiState.pattern = preset.options.pattern;
    guiState.size = preset.options.size;
    guiState.cellsU = preset.options.cellsU;
    guiState.cellsV = preset.options.cellsV;
    guiState.bumpScale = preset.options.bumpScale;
    guiState.seed = preset.options.seed;
    guiState.threadCover = preset.options.threadCover;
    guiState.fiberStrength = preset.options.fiberStrength;
    guiState.colorContrast = preset.options.colorContrast;
    guiState.roughnessBase = preset.options.roughnessBase;
    guiState.roughnessRange = preset.options.roughnessRange;
    guiState.warpColor = colorToHex(preset.options.warpColor);
    guiState.weftColor = colorToHex(preset.options.weftColor);
    refreshGuiDisplay(gui);
    regenerate();
  });

gui
  .add(guiState, 'pattern', CLOTH_PATTERN_LABELS)
  .name('Pattern')
  .onChange((pattern: ClothGeneratorOptions['pattern']) => {
    applyPatternDefaults(pattern);
    guiState.preset = 'custom';
    refreshGuiDisplay(gui);
    regenerate();
  });

const weaveFolder = gui.addFolder('Weave');
weaveFolder.add(guiState, 'size', [256, 512, 1024]).name('Size').onChange(regenerate);
weaveFolder.add(guiState, 'cellsU', 2, 32, 1).name('Threads U').onChange(regenerate);
weaveFolder.add(guiState, 'cellsV', 2, 32, 1).name('Threads V').onChange(regenerate);
weaveFolder.add(guiState, 'bumpScale', 0.5, 12, 0.1).name('Bump scale').onChange(regenerate);
weaveFolder.add(guiState, 'threadCover', 0.28, 0.48, 0.01).name('Thread width').onChange(regenerate);
weaveFolder.add(guiState, 'fiberStrength', 0, 1.5, 0.01).name('Fiber detail').onChange(regenerate);
weaveFolder.add(guiState, 'seed', 0, 999, 1).name('Seed').onChange(regenerate);
weaveFolder.open();

const materialFolder = gui.addFolder('Material');
materialFolder.addColor(guiState, 'warpColor').name('Warp').onChange(regenerate);
materialFolder.addColor(guiState, 'weftColor').name('Weft').onChange(regenerate);
materialFolder.add(guiState, 'colorContrast', 0, 1.5, 0.01).name('Contrast').onChange(regenerate);
materialFolder.add(guiState, 'roughnessBase', 0.2, 1, 0.01).name('Rough base').onChange(regenerate);
materialFolder.add(guiState, 'roughnessRange', 0, 0.4, 0.01).name('Rough range').onChange(regenerate);

const exportFolder = gui.addFolder('Export PNG');
exportFolder.add({ downloadAll }, 'downloadAll').name('Download all maps');
exportFolder.add({ normal: () => downloadOne('normal') }, 'normal').name('Normal only');
exportFolder.add({ albedo: () => downloadOne('albedo') }, 'albedo').name('Albedo only');
exportFolder.add({ roughness: () => downloadOne('roughness') }, 'roughness').name('Roughness only');
exportFolder.add({ height: () => downloadOne('height') }, 'height').name('Height only');
exportFolder.open();

document.querySelectorAll<HTMLButtonElement>('[data-download]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.download as ClothMapKind;
    downloadOne(kind);
  });
});

applyPatternDefaults(guiState.pattern);
regenerate();
