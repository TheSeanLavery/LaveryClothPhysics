import { waitForAnimationFrames, waitForShirtSimSettle } from '../../character/characterGarmentDress.ts';
import { wrapAngleRad } from '../../character/rigForwardMeasure.ts';
import type { CharacterDuelScene } from './CharacterDuelScene.ts';

export interface DuelFighterStartupReport {
  readonly fighter: 'A' | 'B';
  readonly rootRotationY: number;
  readonly rootPosition: [number, number, number];
  readonly meshAlignErrorDeg: number | null;
}

export interface DuelStartupShirtAudit {
  readonly fighterA: DuelFighterStartupReport;
  readonly fighterB: DuelFighterStartupReport;
  readonly settledVertexCount: number;
  readonly settledPenetrationCount: number;
  readonly settledMinSignedDistance: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export interface DuelStartupShirtAuditOptions {
  readonly maxSettledPenetrations?: number;
  readonly minSettledClearance?: number;
  readonly minSettledVertices?: number;
  readonly maxMeshAlignErrorDeg?: number;
  readonly expectedSeparationX?: number;
}

export function auditDuelStartupState(
  duel: CharacterDuelScene,
  options: DuelStartupShirtAuditOptions = {},
): Omit<DuelStartupShirtAudit, 'settledVertexCount' | 'settledPenetrationCount' | 'settledMinSignedDistance'> & {
  readonly failures: string[];
} {
  const failures: string[] = [];
  const maxMeshAlignErrorDeg = options.maxMeshAlignErrorDeg ?? 28;
  const expectedSep = options.expectedSeparationX ?? 2.4;
  const half = expectedSep * 0.5;

  const fighterA = buildFighterReport('A', duel);
  const fighterB = buildFighterReport('B', duel);

  if (Math.abs(fighterA.rootPosition[0] + half) > 0.15) {
    failures.push(`fighter A x=${fighterA.rootPosition[0].toFixed(2)} expected ~${-half}`);
  }
  if (Math.abs(fighterB.rootPosition[0] - half) > 0.15) {
    failures.push(`fighter B x=${fighterB.rootPosition[0].toFixed(2)} expected ~${half}`);
  }
  if (fighterA.meshAlignErrorDeg !== null && Math.abs(fighterA.meshAlignErrorDeg) > maxMeshAlignErrorDeg) {
    failures.push(`fighter A mesh align error ${fighterA.meshAlignErrorDeg.toFixed(1)}°`);
  }
  if (fighterB.meshAlignErrorDeg !== null && Math.abs(fighterB.meshAlignErrorDeg) > maxMeshAlignErrorDeg) {
    failures.push(`fighter B mesh align error ${fighterB.meshAlignErrorDeg.toFixed(1)}°`);
  }

  return { fighterA, fighterB, failures };
}

export async function auditDuelStartupShirtsWithSim(
  duel: CharacterDuelScene,
  options: DuelStartupShirtAuditOptions = {},
): Promise<DuelStartupShirtAudit> {
  const maxSettledPenetrations = options.maxSettledPenetrations ?? 0;
  const minSettledClearance = options.minSettledClearance ?? 0.008;
  const minSettledVertices = options.minSettledVertices ?? 500;
  const settleTimeoutMs = 3_500;

  const state = auditDuelStartupState(duel, options);
  const failures = [...state.failures];

  let settled = await duel.getSettledShirtSurfaceReport();
  await waitForShirtSimSettle(
    async () => {
      settled = await duel.getSettledShirtSurfaceReport();
      return {
        vertexCount: settled.vertex.vertexCount,
        penetrationCount: settled.vertex.penetrationCount,
        minSignedDistance: settled.vertex.minSignedDistance,
      };
    },
    () => waitForAnimationFrames(1),
    {
      timeoutMs: settleTimeoutMs,
      minVertices: minSettledVertices,
      maxPenetrations: maxSettledPenetrations,
      minClearance: minSettledClearance,
    },
  );

  const settledVertexCount = settled.vertex.vertexCount;
  if (settledVertexCount < minSettledVertices) {
    failures.push(`settled cloth: only ${settledVertexCount} vertices (need ${minSettledVertices})`);
  }
  if (settled.vertex.penetrationCount > maxSettledPenetrations) {
    failures.push(`settled cloth: ${settled.vertex.penetrationCount} penetrations`);
  }
  if (
    settledVertexCount > 0
    && settled.vertex.minSignedDistance < minSettledClearance
  ) {
    failures.push(
      `settled cloth: min clearance ${settled.vertex.minSignedDistance.toFixed(4)} < ${minSettledClearance}`,
    );
  }

  return {
    fighterA: state.fighterA,
    fighterB: state.fighterB,
    settledVertexCount,
    settledPenetrationCount: settled.vertex.penetrationCount,
    settledMinSignedDistance: settled.vertex.minSignedDistance,
    passed: failures.length === 0,
    failures,
  };
}

function buildFighterReport(fighter: 'A' | 'B', duel: CharacterDuelScene): DuelFighterStartupReport {
  const rig = fighter === 'A' ? duel.rigA : duel.rigB;
  const debug = fighter === 'A' ? duel.controllerA.getFacingDebug() : duel.controllerB.getFacingDebug();
  return {
    fighter,
    rootRotationY: wrapAngleRad(rig.root.rotation.y),
    rootPosition: rig.root.position.toArray() as [number, number, number],
    meshAlignErrorDeg: debug.meshAlignErrorDeg,
  };
}
