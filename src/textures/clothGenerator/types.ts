export type ClothPatternId =
  | 'plain'
  | 'canvas'
  | 'twill'
  | 'herringbone'
  | 'satin'
  | 'basket'
  | 'denim'
  | 'rib';

export interface ClothColor {
  r: number;
  g: number;
  b: number;
}

export interface ClothGeneratorOptions {
  pattern: ClothPatternId;
  size: number;
  cellsU: number;
  cellsV: number;
  /** Normal map intensity from height gradients. */
  bumpScale: number;
  warpColor: ClothColor;
  weftColor: ClothColor;
  /** Base roughness (0–1) for thread crowns. */
  roughnessBase: number;
  /** Extra roughness added in grooves and under threads. */
  roughnessRange: number;
  /** 0–1 blend between warp and weft in albedo. */
  colorContrast: number;
  /** Optional seed for subtle thread-to-thread variation. */
  seed: number;
  /** Yarn half-width in cell units (0.28–0.48). */
  threadCover: number;
  /** Axial fiber striation strength (0–1). */
  fiberStrength: number;
}

export interface ClothMapSet {
  size: number;
  pattern: ClothPatternId;
  normal: Uint8Array;
  albedo: Uint8Array;
  roughness: Uint8Array;
  height: Uint8Array;
}

export type ClothMapKind = keyof Pick<ClothMapSet, 'normal' | 'albedo' | 'roughness' | 'height'>;

export interface ClothPreset {
  id: string;
  label: string;
  options: ClothGeneratorOptions;
}
