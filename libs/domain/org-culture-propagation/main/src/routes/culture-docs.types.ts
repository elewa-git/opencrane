/** Request body to publish a new immutable culture-doc version (P4C.3). */
export interface PublishCultureDocRequest
{
  /** The full document content for the new version. */
  content: string;
}

/** The current state of a culture doc plus its latest content (P4C.3). */
export interface CultureDocResponse
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

/** Summary metadata for one immutable culture-doc version (no content). */
export interface CultureDocVersionSummary
{
  /** Monotonic version number. */
  version: number;
  /** Identity that published this version. */
  createdBy: string;
  /** When this version was published. */
  createdAt: string;
}

/** Outcome of publishing a new culture-doc version. */
export interface PublishCultureDocResult
{
  /** Document name. */
  name: string;
  /** The version number assigned to the newly published content. */
  version: number;
}

/** Request body to propagate the current culture version to a tenant (P4C.4). */
export interface PropagateCultureRequest
{
  /** The tenant to propagate the current culture version toward. */
  tenant: string;
}

/** A culture-propagation proposal returned by the propagate/list endpoints. */
export interface PropagationProposalResponse
{
  /** Stable proposal identifier. */
  id: string;
  /** Tenant the proposal targets. */
  tenant: string;
  /** Document name being propagated. */
  docName: string;
  /** The culture version used as the merge base. */
  baseVersion: number;
  /** The culture version propagated toward. */
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

/** Outcome of approving or rejecting a propagation proposal (P4C.5). */
export interface PropagationDecisionResult
{
  /** Proposal identifier. */
  id: string;
  /** Resulting status. */
  status: "approved" | "rejected";
  /** For an approval: the tenant's new propagated version; null on reject. */
  deliveredVersion: number | null;
}
