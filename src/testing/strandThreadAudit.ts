export interface StrandThreadAuditResult {
  frameCount: number;
  brokenEdgeCount: number;
  requiredCount: number;
  renderedCount: number;
  missingEdgeIds: number[];
  extraEdgeIds: number[];
  /** Active structural edges touching an SDF/edge-cull torn triangle. */
  tornAdjacentCount: number;
  /** Subset of torn-adjacent edges with GPU strand visibility set. */
  tornAdjacentVisibleCount: number;
  /** Torn-adjacent structural edges that should show strands but do not. */
  tornAdjacentMissingEdgeIds: number[];
  /** Structural edges where CPU and GPU coverage disagree (debug). */
  coverageMismatchEdgeIds: number[];
}
