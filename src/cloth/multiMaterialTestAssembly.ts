import {
  buildClothAssembly,
  createQuadPatch,
  type ClothAssembly,
  type ClothAssemblyOptions,
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

/**
 * Horizontal banner strips stitched side-by-side, plus independent dangling strips
 * pinned only along the banner bottom edge.
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
  const dangleGap = options.dangleGap ?? 0.12;
  const pinTopY = options.pinTopY ?? 0;

  const patches = layout.bannerMaterialIds.map((materialPatchId, index) => {
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
  const dangleSegmentsU = 2;
  const dangleSegmentsV = 8;

  for (let i = 0; i < dangleCount; i += 1) {
    const materialPatchId = layout.dangleMaterialIds[i % layout.dangleMaterialIds.length]!;
    const centerX = (i + 0.5) * (bannerSpan / dangleCount);
    const half = dangleWidth * 0.5;
    const topY = pinTopY;
    const bottomY = pinTopY - dangleLength;
    patches.push(
      createQuadPatch({
        id: `${materialPatchId}-dangle-${i}`,
        label: `${materialPatchId} dangle ${i}`,
        segmentsU: dangleSegmentsU,
        segmentsV: dangleSegmentsV,
        corners: [
          [centerX - half, topY, 0],
          [centerX + half, topY, 0],
          [centerX + half, bottomY, 0],
          [centerX - half, bottomY, 0],
        ] as const,
      }),
    );

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
