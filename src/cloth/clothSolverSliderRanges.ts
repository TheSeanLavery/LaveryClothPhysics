/** lil-gui ranges for absolute cloth solver fields (global + per-material). */
export interface ClothSolverSliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Matches values used in character presets, multi-material library, and GPU assembly maps. */
export const CLOTH_SOLVER_SLIDER_RANGES = {
  dampening: { min: 0, max: 0.99999, step: 0.0001 },
  bendStiffness: { min: 0, max: 10, step: 0.0005 },
  tearStretchThreshold: { min: 0.25, max: 999, step: 0.01 },
} as const satisfies Record<string, ClothSolverSliderRange>;

export const CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES = {
  structuralScale: { min: 0.01, max: 10, step: 0.01 },
  compressionScale: { min: 0.01, max: 10, step: 0.01 },
  friction: { min: 0, max: 1, step: 0.01 },
  damageRate: { min: 0.01, max: 10, step: 0.01 },
  maxHealth: { min: 0.01, max: 10, step: 0.01 },
} as const satisfies Record<string, ClothSolverSliderRange>;
