import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface SnapshotIslandSummary {
  readonly id: number;
  readonly pixelCount: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly classification: string;
  readonly touchesLargest: boolean;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SnapshotIslandAnalysis {
  readonly pass: boolean;
  readonly anchorIslandCount: number;
  readonly islandCount: number;
  readonly floatingIslandCount: number;
  readonly floatingPixelCount: number;
  readonly islands: readonly SnapshotIslandSummary[];
  readonly floatingIslands: readonly SnapshotIslandSummary[];
}

export interface ClothVisualSnapshotFixture {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screenshot: {
    readonly width: number;
    readonly height: number;
    readonly pngBase64: string;
  } | null;
  readonly floatingIslands?: SnapshotIslandAnalysis | null;
  readonly state?: {
    readonly frameCount?: number;
    readonly settings?: Record<string, unknown>;
  };
  readonly audits?: {
    readonly connectivity?: {
      readonly brokenEdgeCount?: number;
      readonly connectedComponentCount?: number;
    } | null;
    readonly strandThreads?: {
      readonly brokenEdgeCount?: number;
      readonly tornAdjacentMissingEdgeIds?: readonly number[];
      readonly missingEdgeIds?: readonly number[];
    } | null;
  };
}

export function formatIslandAnalysis(analysis: SnapshotIslandAnalysis): string {
  const lines = [
    `pass=${analysis.pass}`,
    `anchors=${analysis.anchorIslandCount}`,
    `islands=${analysis.islandCount}`,
    `floating=${analysis.floatingIslandCount} (${analysis.floatingPixelCount}px)`,
    'all islands:',
    ...analysis.islands.map((island) => (
      `  #${island.id} ${island.classification} ${island.pixelCount}px `
      + `centroid=(${Math.round(island.centroidX)},${Math.round(island.centroidY)}) `
      + `touchesLargest=${island.touchesLargest}`
    )),
  ];
  if (analysis.floatingIslands.length > 0) {
    lines.push('floating debris:');
    for (const island of analysis.floatingIslands) {
      lines.push(
        `  #${island.id} ${island.pixelCount}px `
        + `bbox=(${island.minX},${island.minY})-(${island.maxX},${island.maxY})`,
      );
    }
  }
  return lines.join('\n');
}

export function writeSnapshotDebugArtifacts(
  snapshotPath: string,
  analysis: SnapshotIslandAnalysis,
  pngBase64: string,
): { analysisPath: string; screenshotPath: string } {
  const dir = path.join('test-results', 'cloth-snapshot-debug');
  mkdirSync(dir, { recursive: true });
  const stamp = path.basename(snapshotPath, '.json');
  const analysisPath = path.join(dir, `${stamp}-islands.json`);
  const screenshotPath = path.join(dir, `${stamp}-screenshot.png`);
  writeFileSync(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  writeFileSync(screenshotPath, Buffer.from(pngBase64, 'base64'));
  return { analysisPath, screenshotPath };
}

export function islandNear(
  islands: readonly SnapshotIslandSummary[],
  centroidX: number,
  centroidY: number,
  tolerancePx: number,
): SnapshotIslandSummary | undefined {
  return islands.find((island) =>
    Math.hypot(island.centroidX - centroidX, island.centroidY - centroidY) <= tolerancePx,
  );
}
