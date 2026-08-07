import { __ManagedAgentServicePrincipal } from "@opencrane/backend/server/agents/agent-services";
import type { ManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { ___IsSha256Digest } from "@opencrane/util";

import type { IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Adapts managed-service evidence into the run-input identity port without accepting caller-provided service claims. */
export class ManagedExecutionIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Agent-service authority that verifies current signed membership and effective scope attachment evidence. */
	private readonly evidenceAuthority: ManagedExecutionEvidenceAuthority;

	/** Creates the adapter over the control-plane authority that owns managed service identity. */
	constructor(evidenceAuthority: ManagedExecutionEvidenceAuthority)
	{
		this.evidenceAuthority = evidenceAuthority;
	}

	/** Loads only exact managed-service evidence bound to the current active service and revision. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		// 1. Prevent a personal service from entering the managed control-plane evidence path.
		if (run.agentKind !== "managed" || command.identityKind !== "service") return { outcome: "denied", reason: "identity_unavailable" };

		// 2. Ask the owned control-plane authority to revalidate membership and effective attachments in this admission transaction.
		const evidence = await this.evidenceAuthority.load({ siloId: command.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId }, { prisma: transaction.prisma, admittedAtEpochMs: transaction.admittedAtEpochMs });
		if (evidence.outcome === "denied") return evidence;

		// 3. Defend the adapter boundary as well: identity must name this exact service principal and canonical digests.
		const expectedSubject = __ManagedAgentServicePrincipal(run.agentServiceId);
		if (evidence.value.identity.kind !== "service" || evidence.value.identity.agentServiceId !== run.agentServiceId || evidence.value.identity.executionSubjectId !== expectedSubject || !___IsSha256Digest(evidence.value.identity.effectiveScopeAttachmentDigest) || !___IsSha256Digest(evidence.value.capabilitySetDigest)) return { outcome: "denied", reason: "identity_unavailable" };
		return { outcome: "loaded", value: { ...evidence.value.identity, capabilitySetDigest: evidence.value.capabilitySetDigest } };
	}
}
