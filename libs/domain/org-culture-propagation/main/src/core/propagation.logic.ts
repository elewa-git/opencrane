import { type CulturePropagationProposal, type PrismaClient, PropagationStatus } from "@prisma/client";

import { _AssertNoL0Directives } from "./l0-guard.js";
import type { CultureMergeEngine } from "./merge-engine.types.js";
import type { PropagationOutcome } from "./propagation.types.js";
import type { PropagationDecisionResult, PropagationProposalResponse } from "../routes/culture-docs.types.js";

/**
 * Generate a culture→tenant propagation proposal (P4C.4).
 *
 * Runs the 3-way merge (base = the tenant's last-propagated culture version,
 * ours = the current culture version, theirs = the tenant's current doc),
 * guards the result against L0 directives (the agent can never edit L0), and
 * upserts a pending proposal keyed by (tenant, docName, targetVersion) so the
 * run is idempotent/resumable. No tenant doc is changed until approval (P4C.5).
 *
 * @param prisma  - Prisma client.
 * @param engine  - The merge engine (deterministic default or LiteLLM seam).
 * @param name    - Culture doc name.
 * @param tenant  - Tenant to propagate toward.
 * @returns A tagged outcome: missing prerequisites, already up-to-date, or a proposal.
 * @throws When the merged result carries forbidden L0 directives (sandbox breach).
 */
export async function _PropagateCultureDocToTenant(prisma: PrismaClient, engine: CultureMergeEngine, name: string, tenant: string): Promise<PropagationOutcome>
{
  // 1. Resolve the current culture version (the merge target); nothing to do
  //    until at least one culture version is published.
  const doc = await prisma.cultureDoc.findUnique({ where: { name }, select: { id: true, currentVersion: true } });
  if (!doc || doc.currentVersion === 0)
  {
    return { kind: "no-culture-version" };
  }

  // 2. The tenant must exist before we record a proposal against it.
  const tenantRow = await prisma.tenant.findUnique({ where: { name: tenant }, select: { name: true } });
  if (!tenantRow)
  {
    return { kind: "no-tenant" };
  }

  // 3. Load the tenant's current doc + propagation cursor; absent means a
  //    fresh tenant with no local edits (base/theirs empty, cursor 0).
  const workspace = await prisma.tenantCultureDoc.findUnique({
    where: { tenant_docName: { tenant, docName: name } },
    select: { content: true, lastPropagatedVersion: true },
  });
  const lastPropagatedVersion = workspace?.lastPropagatedVersion ?? 0;
  const theirs = workspace?.content ?? "";

  // 4. Idempotent fast-exit — the tenant is already on the current version.
  if (lastPropagatedVersion === doc.currentVersion)
  {
    return { kind: "up-to-date", version: doc.currentVersion };
  }

  // 5. Resolve the base ("ours-last-accepted") and ours (target) version content.
  const base = lastPropagatedVersion > 0
    ? (await prisma.cultureDocVersion.findUnique({ where: { cultureDocId_version: { cultureDocId: doc.id, version: lastPropagatedVersion } }, select: { content: true } }))?.content ?? ""
    : "";
  const ours = (await prisma.cultureDocVersion.findUnique({ where: { cultureDocId_version: { cultureDocId: doc.id, version: doc.currentVersion } }, select: { content: true } }))?.content ?? "";

  // 6. Run the merge and enforce the L0 sandbox on its output before persisting.
  const merge = await engine.merge({ docName: name, base, ours, theirs });
  _AssertNoL0Directives(merge.merged);

  // 7. Upsert the pending proposal (idempotent on the target version); a re-run
  //    refreshes the proposed content and resets any prior decision.
  const proposal = await prisma.culturePropagationProposal.upsert({
    where: { tenant_docName_targetVersion: { tenant, docName: name, targetVersion: doc.currentVersion } },
    create: {
      tenant,
      docName: name,
      baseVersion: lastPropagatedVersion,
      targetVersion: doc.currentVersion,
      proposedContent: merge.merged,
      diff: merge.diff,
    },
    update: {
      baseVersion: lastPropagatedVersion,
      proposedContent: merge.merged,
      diff: merge.diff,
      status: PropagationStatus.Pending,
      decidedAt: null,
      decidedBy: null,
    },
  });

  return { kind: "proposed", proposal: _ToPropagationProposalResponse(proposal) };
}

/**
 * List propagation proposals for a culture doc, newest first (P4C.4/P4C.5).
 *
 * @param prisma  - Prisma client.
 * @param name    - Culture doc name.
 * @param filters - Optional tenant and status filters.
 */
export async function _ListPropagationProposals(prisma: PrismaClient, name: string, filters: { tenant?: string; status?: PropagationStatus }): Promise<PropagationProposalResponse[]>
{
  const proposals = await prisma.culturePropagationProposal.findMany({
    where: { docName: name, ...(filters.tenant ? { tenant: filters.tenant } : {}), ...(filters.status ? { status: filters.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return proposals.map(_ToPropagationProposalResponse);
}

/**
 * Approve or reject a propagation proposal (P4C.5).
 *
 * On **approve**, the proposed content becomes the tenant's effective workspace
 * doc and the propagation cursor advances to the target version — both in one
 * transaction with the status flip — so the next contract re-pull delivers it
 * into the pod with no restart. On **reject**, only the proposal status changes;
 * the tenant doc is left untouched.
 *
 * @param prisma     - Prisma client.
 * @param name       - Culture doc name (must match the proposal).
 * @param proposalId - The proposal to decide.
 * @param decision   - `"approve"` or `"reject"`.
 * @param decidedBy  - Identity making the decision (for audit).
 * @returns The decision result, or null when the proposal is missing/mismatched.
 * @throws When the proposal is not pending (already decided).
 */
export async function _DecidePropagationProposal(prisma: PrismaClient, name: string, proposalId: string, decision: "approve" | "reject", decidedBy: string): Promise<PropagationDecisionResult | null>
{
  // 1. Load and validate the proposal — it must exist and belong to this doc.
  const proposal = await prisma.culturePropagationProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.docName !== name)
  {
    return null;
  }

  // 2. Only a pending proposal can be decided — guard against double-apply.
  if (proposal.status !== PropagationStatus.Pending)
  {
    throw new Error(`proposal ${proposalId} is already ${proposal.status.toLowerCase()}`);
  }

  // 3. Reject — flip status only; the tenant's doc and cursor stay as they were.
  if (decision === "reject")
  {
    await prisma.culturePropagationProposal.update({
      where: { id: proposalId },
      data: { status: PropagationStatus.Rejected, decidedAt: new Date(), decidedBy },
    });
    return { id: proposalId, status: "rejected", deliveredVersion: null };
  }

  // 4. Approve — deliver the merged content as the tenant's effective doc and
  //    advance the cursor atomically with the status flip.
  await prisma.$transaction(async function _approve(tx): Promise<void>
  {
    await tx.tenantCultureDoc.upsert({
      where: { tenant_docName: { tenant: proposal.tenant, docName: proposal.docName } },
      create: {
        tenant: proposal.tenant,
        docName: proposal.docName,
        content: proposal.proposedContent,
        lastPropagatedVersion: proposal.targetVersion,
      },
      update: {
        content: proposal.proposedContent,
        lastPropagatedVersion: proposal.targetVersion,
      },
    });

    await tx.culturePropagationProposal.update({
      where: { id: proposalId },
      data: { status: PropagationStatus.Approved, decidedAt: new Date(), decidedBy },
    });
  });

  return { id: proposalId, status: "approved", deliveredVersion: proposal.targetVersion };
}

/**
 * Map a Prisma proposal row to the API response shape.
 * @param row - The proposal row.
 */
function _ToPropagationProposalResponse(row: CulturePropagationProposal): PropagationProposalResponse
{
  return {
    id: row.id,
    tenant: row.tenant,
    docName: row.docName,
    baseVersion: row.baseVersion,
    targetVersion: row.targetVersion,
    proposedContent: row.proposedContent,
    diff: row.diff,
    status: row.status.toLowerCase() as "pending" | "approved" | "rejected",
    createdAt: row.createdAt.toISOString(),
  };
}
