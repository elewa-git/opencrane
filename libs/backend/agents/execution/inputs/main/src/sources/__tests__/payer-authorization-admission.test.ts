import { AgentRunTriggers, ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import type { RunAdmissionPayer } from "@opencrane/backend/agents/execution/runs";
import { TransactionBoundProductResourceAuthorizationSource } from "../product-resource-authorization-source";

const _Payer = {
	payingGroupId: "group-original",
	authorization: {
		decisionDigest: `sha256:${"1".repeat(64)}`,
		policyRevisionHash: `sha256:${"2".repeat(64)}`,
		effectiveAuthorizationDigest: `sha256:${"3".repeat(64)}`,
	},
} as const;

/** Creates a transaction double whose payer read remains scoped to the supplied transaction. */
function _Fixture(payer: RunAdmissionPayer | null | undefined, trigger: AgentRunTriggers = AgentRunTriggers.Interactive)
{
	const conversation = { payer: vi.fn().mockResolvedValue(payer) };
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: _Payer.authorization });
	const admit = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: _Payer.authorization });
	const admitPrincipalBatch = vi.fn().mockResolvedValue([{ outcome: AuthorizationDecisionOutcomes.Allow }, { outcome: AuthorizationDecisionOutcomes.Allow }]);
	const transaction = { authorization: { admitPrincipal, admit, admitPrincipalBatch }, admittedAtEpochMs: 10_000 };
	const createConversation = vi.fn(function _CreateConversation(scopedTransaction: unknown)
	{
		expect(scopedTransaction).toBe(transaction);
		return conversation;
	});
	const source = new TransactionBoundProductResourceAuthorizationSource(createConversation as never);
	const command = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1", trigger } as never;
	const managedSubject = { principalId: "managed-principal", agentIdentityId: "identity-1", membership: { kind: ExecutionSubjectMembershipKinds.Managed, revision: 4 }, requester: { requesterPrincipalId: "requester-1", membership: { kind: ExecutionSubjectMembershipKinds.Fleet, revision: 9 } }, runScope: { agentRevisionId: "revision-1" } } as never;
	const personalSubject = { principalId: "personal-principal", agentIdentityId: "identity-1", membership: { kind: ExecutionSubjectMembershipKinds.Standalone, revision: 4 }, requester: { requesterPrincipalId: "requester-1", membership: { kind: ExecutionSubjectMembershipKinds.Standalone, revision: 9 } }, runScope: { agentRevisionId: "revision-1" } } as never;
	async function _Load(subject = managedSubject)
	{
		return source.load(command, subject, { personaId: null, personaRevisionId: null }, { datasetId: null, memoryQueryPolicy: {} }, { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [{ toolRevisionId: "tool-1", name: "tool-1", description: null, inputSchema: {}, inputSchemaDigest: "sha256:tool" }], skillRevisionIds: [], artifactRevisionIds: [] }, transaction as never);
	}
	async function _Verify(subject = managedSubject, expectedPayer: RunAdmissionPayer | null = _Payer)
	{
		return source.verifyExisting(command, subject, expectedPayer, transaction as never);
	}
	return { admitPrincipal, admit, admitPrincipalBatch, conversation, createConversation, load: _Load, verify: _Verify, managedSubject, personalSubject };
}

describe("payer authorization admission", function _Suite()
{
	it("retains the saved managed payer exactly despite new authorization evidence", async function _RetainsSavedPayer()
	{
		const fixture = _Fixture(_Payer);
		fixture.admit.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { ..._Payer.authorization, decisionDigest: `sha256:${"9".repeat(64)}` } });
		await expect(fixture.load()).resolves.toEqual({ outcome: "loaded", value: _Payer });
	});

	it("uses the exact requester and group boundary for Budget Use", async function _UsesRequesterAndGroupBoundary()
	{
		const fixture = _Fixture(_Payer);
		await fixture.load();
		expect(fixture.admit).toHaveBeenCalledWith(expect.objectContaining({ principalId: "requester-1", actorId: "requester-1", action: ProductAuthorizationActions.Use, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "group-original" }, resource: { kind: ProductAuthorizationResourceKinds.Budget, id: "group:group-original" }, membershipRevision: 9, nowEpochMs: 10_000 }));
	});

	it("keeps personal execution payerless and does not admit a budget", async function _KeepsPersonalPayerless()
	{
		const fixture = _Fixture(null);
		await expect(fixture.load(fixture.personalSubject)).resolves.toEqual({ outcome: "loaded", value: null });
		expect(fixture.admit).not.toHaveBeenCalled();
	});

	it("rejects a personal subject when the conversation carries a payer", async function _RejectsPersonalPayer()
	{
		const fixture = _Fixture(_Payer);
		await expect(fixture.load(fixture.personalSubject)).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(fixture.admit).not.toHaveBeenCalled();
	});

	it.each([null, undefined])("denies managed execution for a missing or partial payer read: %s", async function _DeniesInvalidPayer(payer)
	{
		const fixture = _Fixture(payer as RunAdmissionPayer | null | undefined);
		await expect(fixture.load()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(fixture.admit).not.toHaveBeenCalled();
	});

	it("denies a duplicate when the saved payer does not match current payer evidence", async function _DeniesPayerMismatch()
	{
		const fixture = _Fixture({ ..._Payer, payingGroupId: "group-new" });
		await expect(fixture.verify()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(fixture.admitPrincipal).not.toHaveBeenCalled();
	});

	it("denies current budget on both fresh and duplicate admission", async function _DeniesBudget()
	{
		const fixture = _Fixture(_Payer);
		fixture.admit.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
		await expect(fixture.load()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		await expect(fixture.verify()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(fixture.admit).toHaveBeenCalledTimes(2);
	});

	it("preserves the scheduled routine audit actor for payer admission", async function _PreservesRoutineActor()
	{
		const fixture = _Fixture(_Payer, AgentRunTriggers.Scheduled);
		await fixture.load();
		expect(fixture.admit).toHaveBeenCalledWith(expect.objectContaining({ actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" }));
	});

	it("does not replay selected model or tool batch admission on duplicate verification", async function _DoesNotReplayResourceBatch()
	{
		const fixture = _Fixture(_Payer);
		await fixture.load();
		fixture.admitPrincipalBatch.mockClear();
		await expect(fixture.verify()).resolves.toEqual({ outcome: "loaded", value: _Payer });
		expect(fixture.admitPrincipalBatch).not.toHaveBeenCalled();
	});
});
