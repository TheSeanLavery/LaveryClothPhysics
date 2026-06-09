import type { ClothSimulation } from '../../cloth';
import type { AssemblyMaterialMaps } from '../../cloth/clothMaterialPhysics.ts';
import type { ClothMaterialsPanelApi } from '../../dev/panels/clothMaterialsPanelApi.ts';
import {
  hexToRgb,
  linearRgbFromHex,
  rgbDistance,
  sampleCanvasRgbAtNdc,
  sampleCanvasRgbPatch,
  type CanvasRgbSample,
} from './multiMaterialCanvasProbe.ts';

export interface MultiMaterialMaterialAudit {
  readonly patchColors: Readonly<Record<string, string>>;
  readonly gpuSegmentColors: ReturnType<ClothSimulation['auditSegmentGpuColors']>;
  readonly libraryScales: AssemblyMaterialMaps;
  readonly livePatchScalars: ReturnType<ClothSimulation['auditPatchMaterialScalars']>;
}

export function wireMultiMaterialMaterialEditor(options: {
  readonly cloth: ClothSimulation;
  readonly getLibraryScales: () => AssemblyMaterialMaps;
  readonly getPatchColors: () => Readonly<Record<string, string>>;
  readonly getPanelApi: () => ClothMaterialsPanelApi | undefined;
  readonly getPresentationWait: () => Promise<void>;
}): () => void {
  window.__multiMaterialMaterialPanel = () => options.getPanelApi();
  window.__multiMaterialMaterialAudit = (): MultiMaterialMaterialAudit => ({
    patchColors: { ...options.getPatchColors() },
    gpuSegmentColors: options.cloth.auditSegmentGpuColors(),
    libraryScales: options.getLibraryScales(),
    livePatchScalars: options.cloth.auditPatchMaterialScalars(),
  });
  window.__multiMaterialSampleCanvasRgbAtNdc = (
    ndcX: number,
    ndcY: number,
  ): Promise<CanvasRgbSample | null> => sampleCanvasRgbAtNdc(ndcX, ndcY);
  window.__multiMaterialSampleCanvasRgbPatch = (
    ndcX: number,
    ndcY: number,
    radiusNdc?: number,
  ): Promise<CanvasRgbSample | null> => sampleCanvasRgbPatch(ndcX, ndcY, radiusNdc);
  window.__multiMaterialCanvasColorDistance = (
    sampleRgb: readonly [number, number, number],
    hexColor: string,
  ): number => rgbDistance(sampleRgb, hexToRgb(hexColor));
  window.__multiMaterialWaitForPresentation = () => options.getPresentationWait();
  window.__multiMaterialLinearRgbFromHex = (hex: string) => linearRgbFromHex(hex);

  return () => {
    delete window.__multiMaterialMaterialPanel;
    delete window.__multiMaterialMaterialAudit;
    delete window.__multiMaterialSampleCanvasRgbAtNdc;
    delete window.__multiMaterialSampleCanvasRgbPatch;
    delete window.__multiMaterialCanvasColorDistance;
    delete window.__multiMaterialWaitForPresentation;
  };
}

declare global {
  interface Window {
    __multiMaterialMaterialPanel?: () => ClothMaterialsPanelApi | undefined;
    __multiMaterialMaterialAudit?: () => MultiMaterialMaterialAudit;
    __multiMaterialSampleCanvasRgbAtNdc?: (
      ndcX: number,
      ndcY: number,
    ) => Promise<CanvasRgbSample | null>;
    __multiMaterialSampleCanvasRgbPatch?: (
      ndcX: number,
      ndcY: number,
      radiusNdc?: number,
    ) => Promise<CanvasRgbSample | null>;
    __multiMaterialCanvasColorDistance?: (
      sampleRgb: readonly [number, number, number],
      hexColor: string,
    ) => number;
    __multiMaterialWaitForPresentation?: () => Promise<void>;
    __multiMaterialLinearRgbFromHex?: (hex: string) => readonly [number, number, number];
  }
}
