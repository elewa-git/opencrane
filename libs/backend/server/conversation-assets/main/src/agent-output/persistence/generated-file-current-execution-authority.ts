import type { ConversationToolExecutionAdmissionAuthority } from "@opencrane/backend/server/conversations";
import { ExternalActionClaimKinds, ToolInvocationStates, type ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import { AgentIdentityKinds, MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import type { GeneratedFileCaptureProof, GeneratedFileCurrentExecutionAuthority, GeneratedFileCurrentExecutionEvidence } from "./generated-file-capture.types";
import type { GeneratedFileInvocationEvidence } from "./generated-file-invocation-evidence.types";

/** Reuses conversation dispatch authority before accepting bytes from one current MCP completion. */
export class GeneratedFileCurrentExecutionAuthorityAdapter implements GeneratedFileCurrentExecutionAuthority
{
	/** Keep the freshly loaded MCP evidence and current dispatch reader on the completion transaction. */
	constructor(private readonly evidence: GeneratedFileInvocationEvidence, private readonly dispatch: ConversationToolExecutionAdmissionAuthority) {}

	/** Require the exact claimed invocation and personal requester before projecting capture coordinates. */
	async admitCurrent(proof: GeneratedFileCaptureProof, now: Date): Promise<GeneratedFileCurrentExecutionEvidence | null>
	{
		const evidence = this.evidence;
		const invocation = evidence.invocation;
		const checkedAt = Math.max(now.getTime(), Date.now());
		if (!_SameProof(proof, evidence) || !_CurrentInvocation(evidence, checkedAt))
			return null;
		const workload: ProductAuthorizationWorkloadContext = {
			audience: MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, namespace: proof.workload.namespace, serviceAccountName: proof.workload.serviceAccountName,
			workloadKind: "job", workloadUid: evidence.workloadUid, podUid: proof.podUid,
		};
		const admission = await this.dispatch.admit(invocation, now, workload);
		if (admission === null || admission.identity.kind !== AgentIdentityKinds.Proxied)
			return null;
		const subject = admission.subject;
		const requester = subject.requester.membership;
		if (requester.siloId !== subject.siloId || subject.requester.siloId !== subject.siloId
			|| admission.identity.proxiedPrincipalId !== subject.principalId || admission.identity.id !== subject.agentIdentityId
			|| invocation.siloId !== subject.siloId || invocation.runId !== subject.runScope.runId || invocation.attempt !== subject.runScope.attempt
			|| invocation.agentRevisionId !== subject.runScope.agentRevisionId || invocation.requestIdentity.runtimeInstanceId !== subject.computerScope.computerId
			|| subject.principalId !== subject.requester.requesterPrincipalId || requester.principalId !== subject.requester.requesterPrincipalId)
			return null;
		const notAfterEpochMs = Math.min(admission.notAfterEpochMs, evidence.companionNotAfterEpochMs, invocation.claimExpiresAt!.getTime());
		if (!Number.isSafeInteger(notAfterEpochMs) || notAfterEpochMs <= Math.max(now.getTime(), Date.now()))
			return null;
		return {
			authorizationRun: { runId: subject.runScope.runId, attempt: subject.runScope.attempt, agentServiceId: subject.runScope.agentServiceId, agentRevisionId: subject.runScope.agentRevisionId },
			authorizationWorkload: workload, bootstrapId: invocation.requestIdentity.commandId, computerId: subject.computerScope.computerId,
			conversationId: admission.conversationId, execution: { executionId: evidence.executionId, executionReference: evidence.executionReference, claimFence: evidence.claimFence },
			effectiveArguments: invocation.effectiveArguments, agentIdentityId: subject.agentIdentityId, attempt: subject.runScope.attempt,
			leaseGeneration: subject.computerScope.leaseGeneration, leaseId: subject.computerScope.leaseId, notAfterEpochMs,
			requesterPrincipalId: subject.requester.requesterPrincipalId, requesterSubjectId: admission.requesterSubjectId, runId: subject.runScope.runId,
			serverRevisionId: evidence.serverRevisionId, siloId: subject.siloId, toolInvocationRowId: invocation.id,
			toolInvocationId: invocation.toolInvocationId, toolName: evidence.toolName, toolRevisionId: invocation.toolRevisionId,
		};
	}
}

/** Match the immutable request proof with the TokenReview identity used to load the MCP row. */
function _SameProof(proof: GeneratedFileCaptureProof, evidence: GeneratedFileInvocationEvidence): boolean
{
	return proof.executionId === evidence.executionId && proof.executionReference === evidence.executionReference && proof.claimFence === evidence.claimFence
		&& proof.podUid === evidence.podUid && proof.podUid === proof.workload.podUid && proof.podUid === evidence.workload.podUid
		&& proof.workload.namespace === evidence.workload.namespace && proof.workload.serviceAccountName === evidence.workload.serviceAccountName;
}

/** Refuse ended, substituted or non-conversation invocation claims before reading execution history. */
function _CurrentInvocation(evidence: GeneratedFileInvocationEvidence, checkedAt: number): boolean
{
	const invocation = evidence.invocation;
	const claim = evidence.toolClaim;
	return invocation.state === ToolInvocationStates.Claimed && invocation.claimKind === ExternalActionClaimKinds.Dispatch
		&& claim.kind === ExternalActionClaimKinds.Dispatch && invocation.id === claim.invocationId && invocation.claimFence === claim.fence && invocation.revision === claim.revision
		&& invocation.runId !== null && invocation.attempt !== null && invocation.agentRevisionId !== null && invocation.mcpTaskId === null
		&& invocation.claimExpiresAt instanceof Date && invocation.claimExpiresAt.getTime() > checkedAt
		&& Number.isSafeInteger(evidence.companionNotAfterEpochMs) && evidence.companionNotAfterEpochMs > checkedAt
		&& typeof evidence.workloadUid === "string" && evidence.workloadUid.trim().length > 0;
}
