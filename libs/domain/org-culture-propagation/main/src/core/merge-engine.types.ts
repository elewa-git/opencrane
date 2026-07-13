/**
 * Inputs to a culture→tenant 3-way merge (P4C.4).
 *
 * The merge follows `migrate up` semantics: `base` is what the tenant last
 * accepted, `ours` is the new culture version, `theirs` is the tenant's current
 * (possibly diverged) doc. Conflict policy: culture wins, tenant intent
 * preserved where compatible.
 */
export interface CultureMergeInput
{
  /** Document name being propagated (e.g. `SOUL`). */
  docName: string;
  /** The culture version the tenant last propagated against (merge base). */
  base: string;
  /** The new culture version to propagate toward ("ours"). */
  ours: string;
  /** The tenant's current effective doc ("theirs"). */
  theirs: string;
}

/** Result of a 3-way merge. */
export interface CultureMergeOutput
{
  /** The proposed merged content (L1/L2 only — never L0). */
  merged: string;
  /** A human-readable change summary of `theirs` → `merged`. */
  diff: string;
}

/**
 * Produces a culture→tenant merge proposal.
 *
 * Abstracts the merge engine so the propagation *orchestration* (proposal
 * storage, version tracking, L0 sandbox guard, idempotency) is unit-testable
 * against a deterministic merger, and a LiteLLM-backed agent merger can be wired
 * in via {@link _BuildCultureMergeEngine} without touching the orchestration.
 */
export interface CultureMergeEngine
{
  /**
   * Compute a proposed merge.
   * @param input - Base/ours/theirs documents and the doc name.
   */
  merge(input: CultureMergeInput): Promise<CultureMergeOutput>;
}
