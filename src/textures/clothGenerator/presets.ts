import type { ClothGeneratorOptions, ClothPreset } from './types.ts';
import { defaultClothGeneratorOptions } from './generateClothMaps.ts';

export const CLOTH_PATTERN_LABELS: Record<ClothGeneratorOptions['pattern'], string> = {
  plain: 'Plain weave',
  canvas: 'Canvas (coarse plain)',
  twill: 'Twill',
  herringbone: 'Herringbone',
  satin: 'Satin',
  basket: 'Basket weave',
  denim: 'Denim twill',
  rib: 'Rib / corduroy',
};

export const CLOTH_PRESETS: ClothPreset[] = [
  {
    id: 'cotton-flag-red',
    label: 'Flag cotton (red)',
    options: {
      ...defaultClothGeneratorOptions('plain'),
      size: 512,
      warpColor: { r: 0.95, g: 0.28, b: 0.34 },
      weftColor: { r: 0.82, g: 0.18, b: 0.24 },
      roughnessBase: 0.78,
      bumpScale: 6.5,
      fiberStrength: 0.9,
    },
  },
  {
    id: 'natural-canvas',
    label: 'Natural canvas',
    options: defaultClothGeneratorOptions('canvas'),
  },
  {
    id: 'navy-twill',
    label: 'Navy twill',
    options: {
      ...defaultClothGeneratorOptions('twill'),
      warpColor: { r: 0.1, g: 0.14, b: 0.28 },
      weftColor: { r: 0.14, g: 0.18, b: 0.34 },
    },
  },
  {
    id: 'wool-herringbone',
    label: 'Wool herringbone',
    options: {
      ...defaultClothGeneratorOptions('herringbone'),
      warpColor: { r: 0.55, g: 0.52, b: 0.5 },
      weftColor: { r: 0.42, g: 0.4, b: 0.38 },
      roughnessBase: 0.84,
    },
  },
  {
    id: 'silk-satin',
    label: 'Silk satin',
    options: {
      ...defaultClothGeneratorOptions('satin'),
      warpColor: { r: 0.92, g: 0.9, b: 0.88 },
      weftColor: { r: 0.78, g: 0.76, b: 0.74 },
      roughnessBase: 0.58,
      bumpScale: 2.8,
    },
  },
  {
    id: 'denim-indigo',
    label: 'Denim indigo',
    options: defaultClothGeneratorOptions('denim'),
  },
  {
    id: 'corduroy-rib',
    label: 'Corduroy rib',
    options: {
      ...defaultClothGeneratorOptions('rib'),
      warpColor: { r: 0.42, g: 0.24, b: 0.16 },
      weftColor: { r: 0.34, g: 0.18, b: 0.12 },
    },
  },
  {
    id: 'linen-basket',
    label: 'Linen basket',
    options: {
      ...defaultClothGeneratorOptions('basket'),
      warpColor: { r: 0.86, g: 0.82, b: 0.72 },
      weftColor: { r: 0.74, g: 0.7, b: 0.62 },
    },
  },
];

export function getClothPreset(id: string): ClothPreset | undefined {
  return CLOTH_PRESETS.find((preset) => preset.id === id);
}
