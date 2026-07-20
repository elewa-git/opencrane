/** Single detect-only mismatch discovered between CRDs and PostgreSQL projections. */
export interface ProjectionDriftMismatch
{
  /** Resource name shared by the CRD and projection row. */
  name: string;

  /** Coarse mismatch class used by dashboards and operators. */
  issue: "missing-source" | "missing-projection" | "field-mismatch";

  /** Specific fields that differed when both sides existed. */
  fields?: string[];
}

/** Summary payload returned by the projection drift report endpoints. */
export interface ProjectionDriftReport
{
  /** Entity family being compared. */
  resource: "Tenant" | "AccessPolicy";

  /** Current hardening mode for this report. */
  mode: "detect-only";

  /** Fields compared for this entity family. */
  comparedFields: string[];

  /** Aggregate counts that make drift volume easy to monitor. */
  summary: {
    /** Number of CRDs treated as the source of truth. */
    sourceCount: number;

    /** Number of PostgreSQL projection rows compared against CRDs. */
    projectionCount: number;

    /** Number of drift findings in this report. */
    driftCount: number;
  };

  /** Per-resource findings for operators to inspect manually. */
  mismatches: ProjectionDriftMismatch[];
}
