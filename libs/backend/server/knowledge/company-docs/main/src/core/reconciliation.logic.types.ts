import type { DocProposalResponse } from "../routes/company-docs.types.js";

/** Distinct outcomes of a company-document reconciliation attempt. */
export type ReconcileOutcome =
  | { kind: "no-company-version" }
  | { kind: "no-tenant" }
  | { kind: "up-to-date"; version: number }
  | { kind: "proposed"; proposal: DocProposalResponse };
