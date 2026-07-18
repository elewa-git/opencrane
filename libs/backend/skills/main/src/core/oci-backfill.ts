import type { PrismaClient } from "@prisma/client";

import type { OciBundleStore } from "./oci-bundle-store.js";
import type { OciBackfillItemResult, OciBackfillSummary } from "./oci-backfill.types.js";

/** Minimal published-bundle row shape the backfill reads. */
interface _BackfillRow
{
  /** Skill bundle identifier. */
  id: string;
  /** Bundle name. */
  name: string;
  /** Recorded content digest (delivery's lookup key). */
  digest: string;
  /** Stored bundle content, or null when never uploaded. */
  content: string | null;
}

/**
 * Push one published bundle's content into the OCI store and classify the outcome.
 *
 * Reuses {@link OciBundleStore.pushBundle} (idempotent, content-addressed), then
 * guards against a recorded digest that does not match the content hash: delivery
 * pulls by the *recorded* digest, so storing under a different one yields an orphan
 * blob that delivery would never find — that is reported as a failure, not a success.
 *
 * @param ociStore - The OCI store to push into.
 * @param row      - The published bundle row.
 * @returns The per-bundle backfill result.
 */
async function _backfillOne(ociStore: OciBundleStore, row: _BackfillRow): Promise<OciBackfillItemResult>
{
  // 1. Nothing to push when the bundle carries no DB content — record it as skipped
  //    rather than failed so a clean report distinguishes "empty" from "errored".
  if (!row.content)
  {
    return { id: row.id, name: row.name, digest: row.digest, outcome: "skipped" };
  }

  try
  {
    // 2. Push the content; the store derives and returns the content's digest.
    const result = await ociStore.pushBundle(row.content);

    // 3. Reconcile against the recorded digest. A mismatch means delivery (which looks
    //    up row.digest) would never resolve this blob, so surface it as a failure.
    if (result.digest !== row.digest)
    {
      return {
        id: row.id,
        name: row.name,
        digest: row.digest,
        outcome: "failed",
        reason: `digest mismatch: recorded ${row.digest}, content hashes to ${result.digest}`,
      };
    }

    return { id: row.id, name: row.name, digest: row.digest, outcome: "pushed" };
  }
  catch (err)
  {
    // 4. A transport/registry error is per-bundle isolated so one bad bundle does not
    //    abort the run; the failure is recorded for the caller to retry.
    return {
      id: row.id,
      name: row.name,
      digest: row.digest,
      outcome: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Backfill every published skill bundle's DB content into the OCI store.
 *
 * This is the prerequisite tooling for the parked live-Zot backfill (plan P4D.2):
 * it populates the registry from the still-authoritative DB `content` column so the
 * registry-only end state can later be cut over safely. Idempotent — re-running it
 * re-pushes content-addressed blobs the registry already has without error.
 *
 * @param prisma   - Prisma client used to read published bundles.
 * @param ociStore - The OCI store to push content into.
 * @returns A summary with per-bundle outcomes and aggregate counts.
 */
export async function _BackfillBundlesToOci(prisma: PrismaClient, ociStore: OciBundleStore): Promise<OciBackfillSummary>
{
  // 1. Load all published bundles — only published bundles are deliverable, so only
  //    they need to exist in the registry. Selecting content here avoids a per-row fetch.
  const rows = await (prisma as unknown as {
    skillBundle: {
      findMany: (args: { where: { status: "published" }; select: { id: true; name: true; digest: true; content: true } }) => Promise<_BackfillRow[]>;
    };
  }).skillBundle.findMany({
    where: { status: "published" },
    select: { id: true, name: true, digest: true, content: true },
  });

  // 2. Push each bundle sequentially so the registry is not hammered with concurrent
  //    uploads; per-bundle errors are captured, never thrown, so the run always completes.
  const results: OciBackfillItemResult[] = [];
  for (const row of rows)
  {
    results.push(await _backfillOne(ociStore, row));
  }

  // 3. Tally the outcomes into an aggregate summary for the API response.
  return {
    total: results.length,
    pushed: results.filter(function _isPushed(r) { return r.outcome === "pushed"; }).length,
    skipped: results.filter(function _isSkipped(r) { return r.outcome === "skipped"; }).length,
    failed: results.filter(function _isFailed(r) { return r.outcome === "failed"; }).length,
    results,
  };
}
