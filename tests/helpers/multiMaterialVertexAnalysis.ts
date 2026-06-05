import type { ClothAssembly } from '../../src/cloth/patternAssembly.ts';

export function meanMinYForPatchIds(
  assembly: ClothAssembly,
  positions: readonly (readonly [number, number, number])[],
  patchIdNeedle: string,
): number {
  let sum = 0;
  let count = 0;
  for (const vertex of assembly.vertices) {
    if (!vertex.patchId.includes(patchIdNeedle)) {
      continue;
    }
    const position = positions[vertex.id];
    if (!position) {
      continue;
    }
    sum += position[1];
    count += 1;
  }
  return count > 0 ? sum / count : Number.NaN;
}

export function lowestYForPatchIds(
  assembly: ClothAssembly,
  positions: readonly (readonly [number, number, number])[],
  patchIdNeedle: string,
): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const vertex of assembly.vertices) {
    if (!vertex.patchId.includes(patchIdNeedle)) {
      continue;
    }
    const position = positions[vertex.id];
    if (!position) {
      continue;
    }
    lowest = Math.min(lowest, position[1]);
  }
  return lowest;
}
