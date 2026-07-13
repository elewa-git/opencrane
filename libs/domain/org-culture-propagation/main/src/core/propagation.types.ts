import type { PropagationProposalResponse } from "../routes/culture-docs.types.js";

/** Distinct outcomes of a culture→tenant propagation attempt (P4C.4). */
export type PropagationOutcome =
  | { kind: "no-culture-version" }
  | { kind: "no-tenant" }
  | { kind: "up-to-date"; version: number }
  | { kind: "proposed"; proposal: PropagationProposalResponse };
