import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationToolDispatchAdmission } from "@opencrane/backend/server/conversations";
import { ExternalActionClaimKinds, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ExecutionSubjectMembershipKinds } from "@opencrane/contracts";

import { GeneratedFileCurrentExecutionAuthorityAdapter } from "../generated-file-current-execution-authority";
import type { GeneratedFileInvocationEvidence } from "../generated-file-invocation-evidence.types";

/** Fixed clock makes expiry during an awaited authority read reproducible. */
const _NOW = new Date("2026-09-13T12:00:00.000Z");

/** Facts returned by the MCP and conversation owners, without a database substitute inside the adapter. */
function _Fixture()
{
	vi.spyOn(Date, "now").mockReturnValue(_NOW.getTime());
	const invocation = {
		id: "invocation-row", siloId: "silo", runId: "run", attempt: 1, agentRevisionId: "agent-revision", mcpTaskId: null,
		state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 7, revision: 4, claimExpiresAt: new Date(_NOW.getTime() + 30_000),
		requestIdentity: { runtimeInstanceId: "computer", commandId: "bootstrap", candidateId: "candidate" },
		toolInvocationId: "tool-call", toolRevisionId: "tool-revision", effectiveArguments: { rows: [] },
	} as unknown as ToolInvocationRecord;
	const evidence: GeneratedFileInvocationEvidence = {
		invocation, companionNotAfterEpochMs: _NOW.getTime() + 20_000, serverRevisionId: "server-revision", toolName: "opencrane.files.create_csv", workloadUid: "executor-job",
		executionId: "execution", executionReference: "reference", claimFence: "companion-fence", podUid: "executor-pod",
		workload: { subject: "system:serviceaccount:executors:mcp", namespace: "executors", serviceAccountName: "mcp", podUid: "executor-pod" },
		toolClaim: { invocationId: invocation.id, kind: ExternalActionClaimKinds.Dispatch, fence: 7, revision: 4 },
	};
	const admission = {
		conversationId: "conversation", requesterSubjectId: "human-subject", identity: { kind: "proxied", id: "identity", proxiedPrincipalId: "principal" }, notAfterEpochMs: _NOW.getTime() + 40_000,
		subject: { siloId: "silo", agentIdentityId: "identity", principalId: "principal",
			runScope: { runId: "run", attempt: 1, agentServiceId: "service", agentRevisionId: "agent-revision" },
			computerScope: { computerId: "computer", leaseId: "lease", leaseGeneration: 3 },
			requester: { siloId: "silo", requesterPrincipalId: "principal", membership: { siloId: "silo", kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "principal", subjectId: "human-subject" } },
		},
	} as unknown as ConversationToolDispatchAdmission;
	const admit = vi.fn().mockResolvedValue(admission);
	const authority = new GeneratedFileCurrentExecutionAuthorityAdapter(evidence, { admit });
	return { evidence, admission, admit, authority };
}

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("generated-file current execution evidence", function _Suite()
{
	it("uses IAM's saved bootstrap and the original Job and Pod as distinct audit coordinates", async function _ProjectsCurrentEvidence()
	{
		const f = _Fixture();
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).resolves.toMatchObject({
			bootstrapId: "bootstrap", computerId: "computer", leaseId: "lease", leaseGeneration: 3, requesterSubjectId: "human-subject",
			notAfterEpochMs: _NOW.getTime() + 20_000, authorizationWorkload: { workloadKind: "job", workloadUid: "executor-job", podUid: "executor-pod" },
		});
		expect(f.admit).toHaveBeenCalledExactlyOnceWith(f.evidence.invocation, _NOW, expect.objectContaining({ workloadUid: "executor-job" }));
	});

	it("uses the current Principal subject for a Fleet personal requester", async function _AcceptsFleet()
	{
		const f = _Fixture();
		const admission = { ...f.admission, subject: { ...f.admission.subject, requester: { ...f.admission.subject.requester, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal", siloId: "silo", revision: 9, assertionId: "assertion", payloadDigest: "digest", decisionEvidenceId: "evidence", trustedUntil: new Date(_NOW.getTime() + 40_000).toISOString() } } } };
		f.admit.mockResolvedValue(admission);
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).resolves.toMatchObject({ requesterSubjectId: "human-subject", requesterPrincipalId: "principal" });
	});

	it.each([{ principalId: "other-principal" }, { siloId: "other-silo" }])("refuses mismatched requester membership %#", async function _RejectsMembership(change)
	{
		const f = _Fixture();
		const admission = { ...f.admission, subject: { ...f.admission.subject, requester: { ...f.admission.subject.requester, membership: { ...f.admission.subject.requester.membership, ...change } } } };
		f.admit.mockResolvedValue(admission);
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).resolves.toBeNull();
	});

	it("refuses a different Pod before reading current execution history", async function _RejectsForeignPod()
	{
		const f = _Fixture();
		await expect(f.authority.admitCurrent({ ...f.evidence, podUid: "other-pod" }, _NOW)).resolves.toBeNull();
		expect(f.admit).not.toHaveBeenCalled();
	});

	it.each([
		{ claimFence: 8 }, { revision: 5 }, { state: ToolInvocationStates.Succeeded },
		{ claimExpiresAt: _NOW }, { runId: null, mcpTaskId: "task" },
	])("refuses a replaced or ended IAM claim %#", async function _RejectsClaim(change)
	{
		const f = _Fixture();
		const evidence = { ...f.evidence, invocation: { ...f.evidence.invocation, ...change } };
		const authority = new GeneratedFileCurrentExecutionAuthorityAdapter(evidence, { admit: f.admit });
		await expect(authority.admitCurrent(evidence, _NOW)).resolves.toBeNull();
		expect(f.admit).not.toHaveBeenCalled();
	});

	it("refuses a saved bootstrap bound to another conversation computer", async function _RejectsOtherComputer()
	{
		const f = _Fixture();
		const evidence = { ...f.evidence, invocation: { ...f.evidence.invocation, requestIdentity: { ...f.evidence.invocation.requestIdentity, runtimeInstanceId: "other-computer" } } };
		const authority = new GeneratedFileCurrentExecutionAuthorityAdapter(evidence, { admit: f.admit });
		await expect(authority.admitCurrent(evidence, _NOW)).resolves.toBeNull();
	});

	it("keeps a revoked or unavailable dispatch decision authoritative", async function _PropagatesAuthority()
	{
		const f = _Fixture();
		f.admit.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("history unavailable"));
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).resolves.toBeNull();
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).rejects.toThrow("history unavailable");
	});

	it("does not extend the companion deadline while awaiting current authority", async function _ExpiresDuringRead()
	{
		const f = _Fixture();
		f.admit.mockImplementation(async function _Delayed()
		{
			vi.spyOn(Date, "now").mockReturnValue(_NOW.getTime() + 20_000);
			return f.admission;
		});
		await expect(f.authority.admitCurrent(f.evidence, _NOW)).resolves.toBeNull();
	});
});
