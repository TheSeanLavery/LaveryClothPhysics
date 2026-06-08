import GUI from 'lil-gui';
import type { WrappedGarmentProofKind } from '../../garments/wrappedGarmentBuilder.ts';
import type { WrappedGarmentProofReport } from '../../garments/wrappedGarmentBuilder.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export interface WrappedGarmentPanelOptions {
  readonly onLoadProof: (
    proof: WrappedGarmentProofKind,
    options?: { looseness?: number; gridSpacing?: number },
  ) => Promise<WrappedGarmentProofReport>;
}

const PROOF_LABELS: Record<WrappedGarmentProofKind, string> = {
  torso: 'Torso panels',
  torsoTube: 'Torso tube (360°)',
  leftArm: 'Left arm',
  rightArm: 'Right arm',
  torsoAndArms: 'Torso + arms (stitched)',
  torsoAndArmsLoose: 'Torso + arms (loose)',
};

export function createWrappedGarmentPanelDefinition(
  options: WrappedGarmentPanelOptions,
): DevPanelDefinition {
  return {
    id: 'character-wrapped-garment',
    title: 'SDF wrap proofs',
    side: 'left',
    testId: 'character-wrapped-garment-controls',
    defaultOpen: false,
    create: (container) => {
      const gui = new GUI({ title: 'SDF Wrap Proofs', container, width: 280 });
      gui.domElement.setAttribute('data-testid', 'character-wrapped-garment-controls');

      const state = {
        gridSpacing: 0.044,
        looseness: 0.08,
        lastReport: '—',
      };

      gui.add(state, 'gridSpacing', 0.03, 0.08, 0.002).name('Grid spacing');
      gui.add(state, 'looseness', 0, 0.2, 0.01).name('Looseness ratio');

      const proofFolder = gui.addFolder('Load proof');
      proofFolder.open();

      for (const proof of Object.keys(PROOF_LABELS) as WrappedGarmentProofKind[]) {
        const action = { run: () => void loadProof(proof) };
        proofFolder.add(action, 'run').name(PROOF_LABELS[proof]);
      }

      const reportLine = gui.add(state, 'lastReport').name('Last audit').disable();

      async function loadProof(proof: WrappedGarmentProofKind): Promise<void> {
        const report = await options.onLoadProof(proof, {
          gridSpacing: state.gridSpacing,
          looseness: proof === 'torsoAndArmsLoose' ? state.looseness : undefined,
        });
        state.lastReport = report.passed
          ? `OK ${report.vertexCount}v ${report.stitchEdgeCount} stitches`
          : `FAIL: ${report.failures[0] ?? 'unknown'}`;
        reportLine.updateDisplay();
      }

      return {
        gui,
        destroy: () => gui.destroy(),
      };
    },
  };
}
