import { __ManagedAgentServicePrincipal } from "@opencrane/backend/server/agents/agent-services";
import type { ManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { ___IsSha256Digest } from "@opencrane/util";

import type { IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Turns managed-service evidence into the run's identity, ignoring any service identity the caller
 * claims.
 *
 * A thin adapter, but it re-checks the authority's answer rather than trusting it: the returned
 * identity must name this run's own service principal and carry valid SHA-256 digests. That second
 * check is here so a bug in the evidence authority cannot become a wrong-identity run.
 *
 * Constructed by: `__CreateManagedRunAdmissionPort`
 * (execution/admission/main/src/managed-run-admission.composition.ts).
 *
 * @implements IdentityEnvelopeSource
 * @see PersonalExecutionIdentityEnvelopeSource - the user-facing counterpart.
 */
export class ManagedExecutionIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Checks the service's current signed membership and its scope attachments. */
	private readonly evidenceAuthority: ManagedExecutionEvidenceAuthority;

	/** Creates the adapter over the control-plane authority that owns managed service identity. */
	constructor(evidenceAuthority: ManagedExecutionEvidenceAuthority)
	{
		this.evidenceAuthority = evidenceAuthority;
	}

	/**
	 * Loads the managed-service evidence for this run's active service and revision, and nothing else.
	 *
	 * @param command - The admission command. Must have `identityKind` of `"service"`.
	 * @param run - Facts from the run authority. Must have `agentKind` of `"managed"`.
	 * @param transaction - The admission transaction; the evidence authority re-checks membership
	 * through it so the check and the snapshot see the same rows.
	 * @returns `loaded` with the service identity and its capability digest. `denied` with
	 * `identity_unavailable` when the run is not managed, the evidence authority refuses, or the
	 * returned identity is not this exact service principal with valid digests.
	 */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		// 1. Stop here for a personal service; only managed services use this evidence path.
		if (run.agentKind !== "managed" || command.identityKind !== "service") return { outcome: "denied", reason: "identity_unavailable" };

		// 2. Have the control-plane authority re-check membership and scope attachments inside this transaction.
		const evidence = await this.evidenceAuthority.load({ siloId: command.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId }, { prisma: transaction.prisma, admittedAtEpochMs: transaction.admittedAtEpochMs });
		if (evidence.outcome === "denied") return evidence;

		// 3. Re-check here too: the returned identity must be this exact service principal, with valid SHA-256 digests.
		const expectedSubject = __ManagedAgentServicePrincipal(run.agentServiceId);
		if (evidence.value.identity.kind !== "service" || evidence.value.identity.agentServiceId !== run.agentServiceId || evidence.value.identity.executionSubjectId !== expectedSubject || !___IsSha256Digest(evidence.value.identity.effectiveScopeAttachmentDigest) || !___IsSha256Digest(evidence.value.capabilitySetDigest)) return { outcome: "denied", reason: "identity_unavailable" };
		return { outcome: "loaded", value: { ...evidence.value.identity, capabilitySetDigest: evidence.value.capabilitySetDigest } };
	}
}
