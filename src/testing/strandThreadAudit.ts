export interface StrandThreadAuditResult {
  frameCount: number;
  brokenEdgeCount: number;
  requiredCount: number;
  renderedCount: number;
  missingEdgeIds: number[];
  extraEdgeIds: number[];
}
