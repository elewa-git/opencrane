import type { DocMergeInput, DocMergeOutput, DocMergeReconciler } from "./reconciler.types.js";

/** Heading under which tenant-only additions are preserved on a conflicting merge. */
const _TENANT_ADDENDUM_HEADING = "## Tenant additions (preserved)";

/**
 * Dependency-free deterministic 3-way merger — the default reconciler.
 *
 * It is not the agent-driven merge of the locked design (that is the
 * LiteLLM-backed seam in {@link _BuildDocMergeReconciler}); it is a predictable
 * fallback so the reconciliation pipeline is functional and testable without a
 * live model. Policy:
 *   - If the tenant never diverged (`theirs === base`), fast-forward to `ours`.
 *   - Otherwise company wins: take `ours`, then append the tenant's own added
 *     lines (present in `theirs` but in neither `base` nor `ours`) under a
 *     clearly-labelled addendum so tenant intent is preserved, not discarded.
 */
export class _DeterministicReconciler implements DocMergeReconciler
{
  /**
   * Compute the deterministic merge.
   * @param input - Base/ours/theirs documents and the doc name.
   */
  async reconcile(input: DocMergeInput): Promise<DocMergeOutput>
  {
    // 1. Clean fast-forward — the tenant has no local edits, so the new company
    //    version applies wholesale with no addendum.
    if (input.theirs.trim() === input.base.trim())
    {
      return { merged: input.ours, diff: _SummariseDiff(input.theirs, input.ours) };
    }

    // 2. Conflicting merge — company content wins, but preserve the lines the
    //    tenant added on top (not in base, not already in ours) so their intent
    //    survives instead of being silently overwritten.
    const baseLines = new Set(_lines(input.base));
    const oursLines = new Set(_lines(input.ours));
    const tenantAdditions = _lines(input.theirs).filter(function _isOwnAddition(line)
    {
      return line.trim().length > 0 && !baseLines.has(line) && !oursLines.has(line);
    });

    const merged = tenantAdditions.length > 0
      ? `${input.ours.trimEnd()}\n\n${_TENANT_ADDENDUM_HEADING}\n${tenantAdditions.join("\n")}\n`
      : input.ours;

    return { merged, diff: _SummariseDiff(input.theirs, merged) };
  }
}

/**
 * Build the document-merge reconciler from the environment.
 *
 * Today this always returns the deterministic merger. A LiteLLM-backed,
 * agent-driven merger (the locked design) is the single seam to swap in here
 * once a model endpoint is wired — its merge quality needs live LiteLLM, so it
 * is not built in this slice.
 */
export function _BuildDocMergeReconciler(): DocMergeReconciler
{
  return new _DeterministicReconciler();
}

/**
 * Split content into lines, dropping a trailing empty line from a final newline.
 * @param content - The text to split.
 */
function _lines(content: string): string[]
{
  const split = content.split("\n");
  if (split.length > 0 && split[split.length - 1] === "")
  {
    split.pop();
  }
  return split;
}

/**
 * Render a readable per-line change summary of `before` → `after`.
 *
 * Not a minimal-edit (Myers) diff: it lists removed lines (`- `) then added
 * lines (`+ `) by set difference, which is enough for a human to review a
 * proposal. Returns a "no changes" marker when the two are identical.
 *
 * @param before - The prior content.
 * @param after  - The proposed content.
 */
function _SummariseDiff(before: string, after: string): string
{
  const beforeLines = _lines(before);
  const afterLines = _lines(after);
  const afterSet = new Set(afterLines);
  const beforeSet = new Set(beforeLines);

  const removed = beforeLines.filter(function _gone(line) { return line.trim().length > 0 && !afterSet.has(line); });
  const added = afterLines.filter(function _new(line) { return line.trim().length > 0 && !beforeSet.has(line); });

  if (removed.length === 0 && added.length === 0)
  {
    return "(no changes)";
  }

  const removedBlock = removed.map(function _minus(line) { return `- ${line}`; });
  const addedBlock = added.map(function _plus(line) { return `+ ${line}`; });
  return [...removedBlock, ...addedBlock].join("\n");
}
