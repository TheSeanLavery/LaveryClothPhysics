export type {
  ClothPatternId,
  ClothColor,
  ClothGeneratorOptions,
  ClothMapSet,
  ClothMapKind,
  ClothPreset,
} from './types.ts';

export {
  generateClothMaps,
  defaultClothGeneratorOptions,
  parseHexColor,
  colorToHex,
} from './generateClothMaps.ts';

export {
  createHeightSampler,
  sampleHeightField,
  plainWeaveHeight,
} from './heightFields.ts';

export { CLOTH_PRESETS, CLOTH_PATTERN_LABELS, getClothPreset } from './presets.ts';

export { rgbaToCanvas, downloadCanvasPng, downloadRgbaAsPng } from './encodePng.ts';
