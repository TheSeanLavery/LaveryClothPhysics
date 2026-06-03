export interface BoneSdfCapsuleSummary {
  readonly id: number;
  readonly name: string;
  readonly parentName: string;
  readonly radius: number;
  readonly length: number;
  readonly start: [number, number, number];
  readonly end: [number, number, number];
}

const SOFT_RAIL_PATTERN = /soft-(foot|hand|thigh|calf)-/i;

function capsulePriority(name: string): number {
  if (/soft-chest-|soft-butt-/i.test(name)) {
    return 0;
  }
  if (/arm|shoulder|forearm|hips|spine|neck|leg|upleg/i.test(name)) {
    return 1;
  }
  if (SOFT_RAIL_PATTERN.test(name)) {
    return 3;
  }
  return 2;
}

export function mergeBoneSdfCapsules(
  capsuleGroups: readonly (readonly BoneSdfCapsuleSummary[])[],
  maxCapsules = 96,
): BoneSdfCapsuleSummary[] {
  const merged = capsuleGroups.flatMap((group, groupIndex) =>
    group.map((capsule, capsuleIndex) => ({
      ...capsule,
      id: groupIndex * 1000 + capsuleIndex,
    })),
  );

  if (merged.length <= maxCapsules) {
    return merged.map((capsule, index) => ({ ...capsule, id: index }));
  }

  const sorted = [...merged].sort((a, b) => {
    const priorityDiff = capsulePriority(a.name) - capsulePriority(b.name);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return a.name.localeCompare(b.name);
  });

  return sorted.slice(0, maxCapsules).map((capsule, index) => ({ ...capsule, id: index }));
}
