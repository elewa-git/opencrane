/** Request body to publish a new immutable company-doc version (P4C.3). */
export interface PublishCompanyDocRequest
{
  /** The full document content for the new version. */
  content: string;
}

/** The current state of a company doc plus its latest content (P4C.3). */
export interface CompanyDocResponse
{
  /** Document name (workspace file stem, e.g. `SOUL`). */
  name: string;
  /** The highest published version number (0 when none published yet). */
  currentVersion: number;
  /** The current version's content, or null when nothing is published yet. */
  content: string | null;
  /** When the document was last updated. */
  updatedAt: string;
}

/** Summary metadata for one immutable company-doc version (no content). */
export interface CompanyDocVersionSummary
{
  /** Monotonic version number. */
  version: number;
  /** Identity that published this version. */
  createdBy: string;
  /** When this version was published. */
  createdAt: string;
}

/** Outcome of publishing a new company-doc version. */
export interface PublishCompanyDocResult
{
  /** Document name. */
  name: string;
  /** The version number assigned to the newly published content. */
  version: number;
}

/** Request body to generate a reconciliation proposal for a tenant (P4C.4). */
export interface ReconcileTenantRequest
{
  /** The tenant to reconcile toward the current company version. */
  tenant: string;
}

/** A reconciliation proposal returned by the reconcile/list endpoints. */
export interface DocProposalResponse
{
  /** Stable proposal identifier. */
  id: string;
  /** Tenant the proposal targets. */
  tenant: string;
  /** Document name being reconciled. */
  docName: string;
  /** The company version used as the merge base. */
  baseVersion: number;
  /** The company version reconciled toward. */
  targetVersion: number;
  /** The proposed merged content. */
  proposedContent: string;
  /** Human-readable change summary. */
  diff: string;
  /** Lifecycle status. */
  status: "pending" | "approved" | "rejected";
  /** When the proposal was generated. */
  createdAt: string;
}

/** Outcome of approving or rejecting a proposal (P4C.5). */
export interface DecideProposalResult
{
  /** Proposal identifier. */
  id: string;
  /** Resulting status. */
  status: "approved" | "rejected";
  /** For an approval: the tenant's new reconciled version; null on reject. */
  deliveredVersion: number | null;
}
