import type GUI from 'lil-gui';
import {
  InextensibleFlagSimulation,
  type BbClothBlockingReport,
  type BbMotionSmoothnessReport,
  type CornerTearTestOptions,
  type InextensibleFlagSimulationOptions,
  type InextensibleFlagSimulationStats,
  type RandomTearGeometryAuditOptions,
  type RandomTearGeometryAuditReport,
  type SelfCollisionCompareResult,
  type SelfCollisionReport,
  type VisibleWorldGeometryAuditOptions,
  type VisibleWorldGeometryAuditReport,
} from '../sim/InextensibleFlagSimulation';
import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from '../sim/InextensibleFlagSettings';
import { cloneFlagSettings, normalizeFlagSettings } from '../sim/settingsPreset';
import {
  createInextensibleFlagControls,
  type InextensibleFlagControlsOptions,
} from '../ui/InextensibleFlagControls';
import type {
  FlagSettingsPresetSummary,
  StoredFlagSettingsPreset,
} from '../storage/flagSettingsDb';
import {
  deleteFlagSettingsPreset,
  getFlagSettingsPreset,
  listFlagSettingsPresets,
  saveFlagSettingsPreset,
} from '../storage/flagSettingsDb';
import type { StrandThreadAuditResult } from '../testing/strandThreadAudit';
import { ZeroGravityTubeScene, type ZeroGravityTubeStats } from './ZeroGravityTubeScene';
export {
  buildClothAssembly,
  createOctagonalTubeAssembly,
  createPyramidAssembly,
  createQuadPatch,
  createStitchedBoxAssembly,
  createTrianglePatch,
  validateClothAssembly,
  type AssemblyEdge,
  type AssemblyFace,
  type AssemblyValidationIssue,
  type AssemblyVec2,
  type AssemblyVec3,
  type AssemblyVertex,
  type BoundaryName,
  type BoxAssemblyOptions,
  type ClothAssembly,
  type ClothAssemblyOptions,
  type ClothPatchDefinition,
  type OctagonalTubeAssemblyOptions,
  type PyramidAssemblyOptions,
  type QuadPatchOptions,
  type StitchDefinition,
  type StitchEndpoint,
  type TrianglePatchOptions,
} from './patternAssembly';
import {
  configureMatteCottonFlagMaterial,
  updateMatteCottonFlagMaterial,
  type MatteCottonFlagMaterialOptions,
  type MatteCottonFlagMaterialUniforms,
} from '../shaders/FlagClothMaterial';
import {
  loadDenim512ClothTextures,
  type BakedClothTextureSet,
} from '../textures/loadBakedClothTextures';
import {
  buildClothSdfRenderMesh,
  createSimEdgeLookup,
  rebuildClothIndicesFromEdgeState,
  rebuildClothIndicesFromSdfEdgeState,
  type ClothRenderQuad,
  type ClothRenderTriangle,
  type ClothSdfMeshingOptions,
  type ClothSdfRenderMesh,
  type SimEdgeLookup,
  type StructuralGraphEdge,
} from '../sim/clothMeshCuts';

export type ClothSimulation = InextensibleFlagSimulation;
export type ClothSimulationOptions = InextensibleFlagSimulationOptions;
export type ClothSimulationSettings = InextensibleFlagSettings;
export type ClothSimulationStats = InextensibleFlagSimulationStats;
export type ClothControlsOptions = InextensibleFlagControlsOptions;

export interface ClothSimulationDomTargets {
  container: HTMLElement;
  statusEl: HTMLElement;
  backendEl: HTMLElement;
  particlesEl: HTMLElement;
}

export interface CreateClothSimulationOptions extends ClothSimulationOptions {
  autoInit?: boolean;
}

export async function createClothSimulation(
  targets: ClothSimulationDomTargets,
  options: CreateClothSimulationOptions = {},
): Promise<ClothSimulation> {
  const { autoInit = true, ...simulationOptions } = options;
  const simulation = new InextensibleFlagSimulation(
    targets.container,
    targets.statusEl,
    targets.backendEl,
    targets.particlesEl,
    simulationOptions,
  );

  if (autoInit) {
    await simulation.init();
  }

  return simulation;
}

export function createClothControls(
  simulation: ClothSimulation,
  options: ClothControlsOptions = {},
): GUI {
  return createInextensibleFlagControls(simulation, {
    title: options.title ?? 'Cloth Simulation',
    testId: options.testId ?? 'cloth-controls',
  });
}

export const defaultClothSettings = defaultInextensibleFlagSettings;
export const cloneClothSettings = cloneFlagSettings;
export const normalizeClothSettings = normalizeFlagSettings;

export {
  InextensibleFlagSimulation,
  ZeroGravityTubeScene,
  buildClothSdfRenderMesh,
  configureMatteCottonFlagMaterial,
  createSimEdgeLookup,
  createInextensibleFlagControls,
  deleteFlagSettingsPreset,
  getFlagSettingsPreset,
  listFlagSettingsPresets,
  loadDenim512ClothTextures,
  rebuildClothIndicesFromEdgeState,
  rebuildClothIndicesFromSdfEdgeState,
  saveFlagSettingsPreset,
  updateMatteCottonFlagMaterial,
  type BakedClothTextureSet,
  type BbClothBlockingReport,
  type BbMotionSmoothnessReport,
  type ClothRenderQuad,
  type ClothRenderTriangle,
  type ClothSdfMeshingOptions,
  type ClothSdfRenderMesh,
  type CornerTearTestOptions,
  type FlagSettingsPresetSummary,
  type InextensibleFlagSettings,
  type InextensibleFlagSimulationOptions,
  type InextensibleFlagSimulationStats,
  type MatteCottonFlagMaterialOptions,
  type MatteCottonFlagMaterialUniforms,
  type RandomTearGeometryAuditOptions,
  type RandomTearGeometryAuditReport,
  type SelfCollisionCompareResult,
  type SelfCollisionReport,
  type SimEdgeLookup,
  type StrandThreadAuditResult,
  type StructuralGraphEdge,
  type StoredFlagSettingsPreset,
  type VisibleWorldGeometryAuditOptions,
  type VisibleWorldGeometryAuditReport,
  type ZeroGravityTubeStats,
};
