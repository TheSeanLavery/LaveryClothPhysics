import {
  buildClothAssembly,
  createQuadPatch,
  type ClothAssembly,
  type ClothAssemblyOptions,
  type ClothPatchDefinition,
  type StitchDefinition,
} from './patternAssembly.ts';

export interface MultiMaterialTestLayout {
  readonly bannerMaterialIds: readonly string[];
  readonly dangleMaterialIds: readonly string[];
}

export interface MultiMaterialTestAssemblyOptions {
  readonly layout: MultiMaterialTestLayout;
  readonly bannerStripCount?: number;
  readonly bannerWidth?: number;
  readonly bannerHeight?: number;
  readonly bannerSegmentsU?: number;
  readonly bannerSegmentsV?: number;
  readonly dangleCount?: number;
  readonly dangleLength?: number;
  readonly dangleGap?: number;
  readonly pinTopY?: number;
}

const DEFAULT_LAYOUT: MultiMaterialTestLayout = {
  bannerMaterialIds: ['banner-a', 'banner-b', 'banner-c'],
  dangleMaterialIds: ['dangle-soft', 'dangle-stiff'],
};

export const MULTI_MATERIAL_DEFAULT_PIN_TOP_Y = 0;
export const MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT = 0.35;

function boundaryVertex(
  patch: ClothPatchDefinition,
  boundary: 'bottom' | 'top',
  index: number,
): readonly [number, number, number] {
  const localId = patch.boundaries[boundary]![index]!;
  return patch.vertices[localId]!;
}

function resolveDangleBannerAttachment(
  centerX: number,
  halfWidth: number,
  stripWidth: number,
  stripCount: number,
  segmentsU: number,
): { stripIndex: number; uStart: number; uEnd: number } {
  const stripIndex = Math.min(
    stripCount - 1,
    Math.max(0, Math.floor(centerX / stripWidth)),
  );
  const x0 = stripIndex * stripWidth;
  const left = centerX - halfWidth;
  const right = centerX + halfWidth;
  let uStart = Math.ceil(((left - x0) / stripWidth) * segmentsU - 1e-9);
  let uEnd = Math.floor(((right - x0) / stripWidth) * segmentsU + 1e-9);
  uStart = Math.max(0, Math.min(segmentsU - 1, uStart));
  uEnd = Math.max(uStart + 1, Math.min(segmentsU, uEnd));
  return { stripIndex, uStart, uEnd };
}

/**
 * Horizontal banner strips stitched side-by-side, with dangling strips sewn to
 * the banner bottom. Only the banner top edge is pinned at load time.
 */
export function createMultiMaterialTestAssembly(
  options: MultiMaterialTestAssemblyOptions = { layout: DEFAULT_LAYOUT },
): ClothAssembly {
  const layout = options.layout;
  const stripCount = layout.bannerMaterialIds.length;
  const stripWidth = options.bannerWidth ?? 0.45;
  const stripHeight = options.bannerHeight ?? 0.35;
  const segmentsU = options.bannerSegmentsU ?? 6;
  const segmentsV = options.bannerSegmentsV ?? 4;
  const dangleCount = options.dangleCount ?? 5;
  const dangleLength = options.dangleLength ?? 0.55;
  const pinTopY = options.pinTopY ?? 0;

  const patches: ClothPatchDefinition[] = layout.bannerMaterialIds.map((materialPatchId, index) => {
    const x0 = index * stripWidth;
    const x1 = x0 + stripWidth;
    return createQuadPatch({
      id: materialPatchId,
      label: materialPatchId,
      segmentsU,
      segmentsV,
      corners: [
        [x0, pinTopY + stripHeight, 0],
        [x1, pinTopY + stripHeight, 0],
        [x1, pinTopY, 0],
        [x0, pinTopY, 0],
      ] as const,
    });
  });

  const stitches: StitchDefinition[] = [];
  for (let i = 0; i < stripCount - 1; i += 1) {
    const left = layout.bannerMaterialIds[i]!;
    const right = layout.bannerMaterialIds[i + 1]!;
    stitches.push({
      id: `stitch-${left}-${right}`,
      a: { patchId: left, boundary: 'right' },
      b: { patchId: right, boundary: 'left' },
      restLength: 0,
    });
  }

  const bannerSpan = stripCount * stripWidth;
  const dangleWidth = stripWidth * 0.35;
  const dangleSegmentsV = 8;

  for (let i = 0; i < dangleCount; i += 1) {
    const materialPatchId = layout.dangleMaterialIds[i % layout.dangleMaterialIds.length]!;
    const centerX = (i + 0.5) * (bannerSpan / dangleCount);
    const half = dangleWidth * 0.5;
    const dangleId = `${materialPatchId}-dangle-${i}`;
    const { stripIndex, uStart, uEnd } = resolveDangleBannerAttachment(
      centerX,
      half,
      stripWidth,
      stripCount,
      segmentsU,
    );
    const hostBanner = layout.bannerMaterialIds[stripIndex]!;
    const hostPatch = patches[stripIndex]!;
    // Quad patch v=0 is labeled "bottom" but sits at the banner's high-Y hoist edge;
    // the banner edge that meets dangles is boundary "top" (low Y).
    const attachLeft = boundaryVertex(hostPatch, 'top', uStart);
    const attachRight = boundaryVertex(hostPatch, 'top', uEnd);
    const bottomY = pinTopY - dangleLength;

    patches.push(
      createQuadPatch({
        id: dangleId,
        label: `${materialPatchId} dangle ${i}`,
        segmentsU: uEnd - uStart,
        segmentsV: dangleSegmentsV,
        corners: [
          attachLeft,
          attachRight,
          [attachRight[0], bottomY, attachRight[2]],
          [attachLeft[0], bottomY, attachLeft[2]],
        ] as const,
      }),
    );

    stitches.push({
      id: `stitch-${hostBanner}-${dangleId}`,
      a: { patchId: hostBanner, boundary: 'top', start: uStart, end: uEnd },
      b: { patchId: dangleId, boundary: 'bottom' },
      restLength: 0,
    });
  }

  const assemblyOptions: ClothAssemblyOptions = {
    patches,
    stitches,
    scale: 1,
  };

  return buildClothAssembly(assemblyOptions);
}

/** Map patchId prefix to material library id for render tinting (until GPU segment table lands). */
export function patchIdToMaterialKey(patchId: string): string {
  if (patchId.startsWith('banner-')) {
    return patchId;
  }
  if (patchId.includes('dangle-soft')) {
    return 'dangle-soft';
  }
  if (patchId.includes('dangle-stiff')) {
    return 'dangle-stiff';
  }
  const base = patchId.replace(/-dangle-\d+$/, '');
  return base || patchId;
}

export function materialColorByPatch(
  patchId: string,
  colors: Readonly<Record<string, string>>,
): string {
  return colors[patchIdToMaterialKey(patchId)] ?? '#888888';
}
