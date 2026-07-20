/**
 * Inputs to a company→tenant 3-way merge (P4C.4).
 *
 * The merge follows `migrate up` semantics: `base` is what the tenant last
 * accepted, `ours` is the new company version, `theirs` is the tenant's current
 * (possibly diverged) doc. Conflict policy: company wins, tenant intent
 * preserved where compatible.
 */
export interface DocMergeInput
{
  /** Document name being reconciled (e.g. `SOUL`). */
  docName: string;
  /** The company version the tenant last reconciled against (merge base). */
  base: string;
  /** The new company version to reconcile toward ("ours"). */
  ours: string;
  /** The tenant's current effective doc ("theirs"). */
  theirs: string;
}

/** Result of a 3-way merge. */
export interface DocMergeOutput
{
  /** The proposed merged content (L1/L2 only — never L0). */
  merged: string;
  /** A human-readable change summary of `theirs` → `merged`. */
  diff: string;
}

/**
 * Produces a company→tenant merge proposal.
 *
 * Abstracts the merge engine so the reconciliation *orchestration* (proposal
 * storage, version tracking, L0 sandbox guard, idempotency) is unit-testable
 * against a deterministic merger, and a LiteLLM-backed agent merger can be wired
 * in via {@link _BuildDocMergeReconciler} without touching the orchestration.
 */
export interface DocMergeReconciler
{
  /**
   * Compute a proposed merge.
   * @param input - Base/ours/theirs documents and the doc name.
   */
  reconcile(input: DocMergeInput): Promise<DocMergeOutput>;
}
