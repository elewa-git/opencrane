import { OrgMemberStatus, PrincipalProvenance } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates, ExecutionSubjectMembershipKinds } from "@opencrane/contracts";
import { __DigestCanonicalJson, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { PrismaConversationToolDispatchAuthority } from "@opencrane/backend/server/conversations";

import { _CreateConversationToolDispatchDependencies } from "../../workflows/mcp-runtime-composition";

/** Represents an identity already verified by this admission port's transport owner. */
const _WORKLOAD = { audience: "opencrane-mcp-executor", namespace: "mcp-executors", serviceAccountName: "mcp-executor-default", workloadKind: "job", workloadUid: "executor-job-1", podUid: "executor-pod-1" } as const;

/** Fixed server time makes expiry across awaited history and grant reads reproducible. */
const _NOW = new Date("2026-09-09T00:00:00.000Z");
/** Frozen human evidence outlives the short current evidence used by the regression test. */
const _MEMBERSHIP = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.test", subjectId: "user-1", membershipId: "membership-1", membershipUpdatedAt: new Date(_NOW.getTime() - 2_000).toISOString(), observedAt: _NOW.toISOString(), trustedUntil: new Date(_NOW.getTime() + 60_000).toISOString() } as const;

/** Build persisted grants consumed by the real central authority, rather than mocking allow decisions. */
function _Grant(kind: ProductAuthorizationResourceKinds, id: string, action: ProductAuthorizationActions, principalId = "principal-1")
{
	const capability = __ProductAuthorizationCapability(kind, action)!;
	return { id: `grant-${principalId}-${kind}-${action}`, siloId: "silo-1", subjectKind: "Principal", subjectPrincipalId: principalId, subjectGroupId: null, boundaryKind: "Personal", boundaryPrincipalId: principalId, boundaryGroupId: null, boundaryCoverage: "Exact", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind: kind, resourceId: id, effect: "Allow", priority: 0, validFrom: new Date(0), expiresAt: null as Date | null, revokedAt: null as Date | null };
}

/** Exercise real service, membership, authorization and MCP assignment owners over mutable database rows. */
function _Fixture()
{
	vi.useFakeTimers();
	vi.setSystemTime(_NOW);
	const subject = {
		schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "0", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-evidence", verifiedAt: _NOW.toISOString() },
		membership: _MEMBERSHIP,
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-evidence", decidedAt: _NOW.toISOString() },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { membership: _MEMBERSHIP, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: _NOW.toISOString() },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-evidence", admittedAt: _NOW.toISOString() },
	} as const;
	const identity = { schemaVersion: 1, id: "identity-1", siloId: "silo-1", agentServiceId: "service-1", name: "Personal assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "principal-1", createdAt: _NOW.toISOString(), kind: "proxied", proxiedPrincipalId: "principal-1", delegationPolicyId: "personal-agent-session-v1" } as const;
	const identityHead = { identity, revision: 0n, headDigest: subject.identity.headDigest, headEventId: "identity-event", streamName: "identity-identity-1" };
	const computer = { computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { state: ComputerLeaseStates.Active, id: "lease-1", generation: 1, computerId: "computer-1", sandboxId: "sandbox-1", expiresAt: new Date(_NOW.getTime() + 60_000).toISOString() } };
	const grants = [_Grant(ProductAuthorizationResourceKinds.AgentService, "service-1", ProductAuthorizationActions.Invoke), _Grant(ProductAuthorizationResourceKinds.Conversation, "conversation-1", ProductAuthorizationActions.Use), _Grant(ProductAuthorizationResourceKinds.McpToolRevision, "tool-1", ProductAuthorizationActions.Invoke)];
	const principal = { id: "principal-1", siloId: "silo-1", issuer: "https://issuer.test", subject: "user-1", provenance: PrincipalProvenance.External };
	const membership = { id: "membership-1", clusterTenant: "silo-1", subject: "user-1", status: OrgMemberStatus.Active as OrgMemberStatus, updatedAt: new Date(_NOW.getTime() - 2_000) };
	const transaction = {
		agentRun: { findFirst: vi.fn().mockResolvedValue({ conversationId: "conversation-1", executionSubject: subject, inputSnapshotDigest: `sha256:${"e".repeat(64)}` }) },
		runInputSnapshot: { findFirst: vi.fn().mockResolvedValue({ budgetPolicy: { wallClockDeadlineEpochMs: _NOW.getTime() + 60_000, maxToolInvocations: 1 } }) },
		mcpServerInstall: { findFirst: vi.fn().mockResolvedValue({ id: "install-1" }) },
		toolInvocation: { count: vi.fn().mockResolvedValue(1) },
		conversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-1", computerAgentIdentityId: "identity-1", computerProfileRevisionId: "profile-1" }) },
		agentRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision-1", digest: `sha256:${"a".repeat(64)}`, modelDefinitionId: "model-1", budget: {}, boundaryAttachments: [], skillAssignments: [], mcpToolAssignments: [{ toolRevisionId: "tool-1" }] }) },
		principal: { findFirst: vi.fn().mockResolvedValue(principal), findUnique: vi.fn().mockResolvedValue(principal) },
		orgMembership: { findUnique: vi.fn().mockResolvedValue(membership), findFirst: vi.fn().mockResolvedValue(membership) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
		auditDecision: { create: vi.fn().mockResolvedValue({}) },
		conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ userId: "user-1" }) },
		conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) },
		agentRevisionMcpToolAssignment: { findFirst: vi.fn().mockResolvedValue({ agentRevisionId: "revision-1" }) },
	};
	const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentRevisionId: "revision-1", mcpTaskId: null, toolRevisionId: "tool-1", effectiveArguments: { query: "permitted record" }, effectiveArgumentsDigest: __DigestCanonicalJson({ query: "permitted record" }), authorizationEvidence: { actorKind: "workload", executionSubject: subject, coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-1" }, action: ProductAuthorizationActions.Invoke }] } } as unknown as ToolInvocationRecord;
	const identities = { load: vi.fn().mockResolvedValue(identityHead) };
	const computers = { load: vi.fn().mockResolvedValue(computer) };
	const config = { mode: FleetMembershipDeploymentModes.Standalone, siloId: "silo-1", trustedOidcIssuer: "https://issuer.test", maximumStalenessMs: 5_000 } as const;
	const dependencies = { ..._CreateConversationToolDispatchDependencies({} as never, config), identities, computers };
	const authority = new PrismaConversationToolDispatchAuthority(transaction as never, dependencies);
	return { authority, dependencies, transaction, invocation, subject, identityHead, computer, grants, membership, principal, identities, computers };
}

/** Keep company and human grants separate while exercising the real managed evidence owner. */
function _ManagedFixture()
{
	const f = _Fixture();
	const subject = { ...f.subject, principalId: "managed-1", identity: { ...f.subject.identity, principalId: "managed-1" }, membership: { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "managed-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "managed-evidence", trustedUntil: _MEMBERSHIP.trustedUntil } } as const;
	const identity = { ...f.identityHead.identity, kind: "managed", principalId: "managed-1" };
	f.identities.load.mockResolvedValue({ ...f.identityHead, identity });
	f.transaction.agentRun.findFirst.mockResolvedValue({ conversationId: "conversation-1", executionSubject: subject, inputSnapshotDigest: `sha256:${"e".repeat(64)}` });
	const service = { id: "service-1", principalId: "managed-1", name: "Company assistant", workloadProfile: {}, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", siloId: "silo-1", agentServiceId: "service-1", state: "Published", digest: `sha256:${"a".repeat(64)}`, personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 }, skillAssignments: [], mcpToolAssignments: [{ toolRevisionId: "tool-1" }], boundaryAttachments: [] } };
	const managedPrincipal = { ...f.principal, id: "managed-1", subject: "company-assistant", provenance: PrincipalProvenance.Internal };
	const managedToolGrant = _Grant(ProductAuthorizationResourceKinds.McpToolRevision, "tool-1", ProductAuthorizationActions.Invoke, "managed-1");
	f.grants.push(_Grant(ProductAuthorizationResourceKinds.ModelDefinition, "model-1", ProductAuthorizationActions.Use, "managed-1"), managedToolGrant);
	const transaction = { ...f.transaction, agentService: { findFirst: vi.fn().mockResolvedValue(service) }, principal: {
		findFirst: vi.fn(async function _PrincipalById(query: { where: { id: string } })
		{
			if (query.where.id === "managed-1")
				return managedPrincipal;
			if (query.where.id === f.principal.id)
				return f.principal;
			return null;
		}),
		findUnique: vi.fn(async function _PrincipalByScope(query: { where: { id_siloId: { id: string } } })
		{
			if (query.where.id_siloId.id === "managed-1")
				return managedPrincipal;
			if (query.where.id_siloId.id === f.principal.id)
				return f.principal;
			return null;
		}),
	}, authorizationGrant: { findMany: vi.fn(async function _GrantsForSubjects(query: { where: { OR: { subjectPrincipalId?: string }[] } }) { return f.grants.filter(grant => query.where.OR.some(subject => subject.subjectPrincipalId === grant.subjectPrincipalId)); }) } };
	const invocation = { ...f.invocation, authorizationEvidence: { ...f.invocation.authorizationEvidence, executionSubject: subject } } as ToolInvocationRecord;
	const authority = new PrismaConversationToolDispatchAuthority(transaction as never, f.dependencies);
	return { ...f, authority, invocation, transaction, service, managedToolGrant };
}

afterEach(function _ResetClock() { vi.useRealTimers(); });

describe("current conversation tool dispatch authority", function _Suite()
{
	it("rechecks central permission, membership and assignment for the saved execution principal", async function _AllowsCurrentWork()
	{
		const f = _Fixture();
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBe(_NOW.getTime() + 5_000);
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "Running", attempt: 1, principalId: "principal-1" }) }));
		expect(f.transaction.mcpServerInstall.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ principalId: "principal-1", connectionStatus: "Credentialless" }) }));
		expect(f.transaction.orgMembership.findUnique).toHaveBeenCalledOnce();
		expect(f.transaction.agentRevisionMcpToolAssignment.findFirst).toHaveBeenCalledOnce();
		expect(f.transaction.auditDecision.create).toHaveBeenCalledTimes(3);
		expect(f.transaction.auditDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorKind: "Workload", actorId: _WORKLOAD.podUid, audience: _WORKLOAD.audience, namespace: _WORKLOAD.namespace, serviceAccountName: _WORKLOAD.serviceAccountName, workloadKind: "Job", workloadUid: _WORKLOAD.workloadUid, podUid: _WORKLOAD.podUid, runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }) });
	});

	it("denies a saved tool when its execution principal no longer has a ready installation", async function _MissingInstallation()
	{
		const f = _Fixture();
		f.transaction.mcpServerInstall.findFirst.mockResolvedValue(null);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it.each([0, 1, 2])("denies a revoked persisted grant at coordinate %i", async function _RevokedGrant(index)
	{
		const f = _Fixture();
		f.grants[index]!.revokedAt = _NOW;
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it.each(["run", "lease"])("returns the shorter %s deadline instead of the configured dispatch lease", async function _ShortDeadline(bound)
	{
		const f = _Fixture();
		const deadline = _NOW.getTime() + 2_000;
		if (bound === "run")
			f.transaction.runInputSnapshot.findFirst.mockResolvedValue({ budgetPolicy: { wallClockDeadlineEpochMs: deadline, maxToolInvocations: 1 } });
		else
			f.computer.lease.expiresAt = new Date(deadline).toISOString();
		f.computers.load.mockImplementation(async function _DelayedHistory() { vi.setSystemTime(_NOW.getTime() + 1_000); return f.computer; });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBe(deadline);
	});

	it("denies current membership removal and tool assignment removal", async function _CurrentRows()
	{
		const f = _Fixture();
		f.membership.status = OrgMemberStatus.Suspended;
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
		f.membership.status = OrgMemberStatus.Active;
		f.transaction.agentRevisionMcpToolAssignment.findFirst.mockResolvedValue(null);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it.each([null, { conversationId: "conversation-1", executionSubject: {} }])("denies a missing, stale or substituted run row %j", async function _RunFence(row)
	{
		const f = _Fixture();
		f.transaction.agentRun.findFirst.mockResolvedValue(row);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
		expect(f.identities.load).not.toHaveBeenCalled();
	});

	it.each([{ state: ComputerLeaseStates.Released }, { id: "other-lease" }, { generation: 2 }, { expiresAt: _NOW.toISOString() }, { sandboxId: null }])("denies stale lease evidence %j", async function _LeaseFence(patch)
	{
		const f = _Fixture();
		f.computers.load.mockResolvedValue({ ...f.computer, lease: { ...f.computer.lease, ...patch } });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it.each([null, { budgetPolicy: {} }, { budgetPolicy: { wallClockDeadlineEpochMs: _NOW.getTime() } }, { budgetPolicy: { wallClockDeadlineEpochMs: _NOW.getTime() + 60_000, maxToolInvocations: 0 } }])("denies absent, expired or exhausted frozen input %j", async function _OriginalBudget(snapshot)
	{
		const f = _Fixture();
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue(snapshot);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("keeps the original deadline across an awaited authority read", async function _BudgetExpiresDuringHistory()
	{
		const f = _Fixture();
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue({ budgetPolicy: { wallClockDeadlineEpochMs: _NOW.getTime() + 1_000, maxToolInvocations: 1 } });
		f.computers.load.mockImplementation(async function _DelayedHistory() { vi.setSystemTime(_NOW.getTime() + 2_000); return f.computer; });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("counts all admitted invocations against the frozen limit", async function _ToolBudget()
	{
		const f = _Fixture();
		f.transaction.toolInvocation.count.mockResolvedValue(2);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("propagates history transport failure without writing an admission", async function _HistoryFailure()
	{
		const f = _Fixture();
		f.identities.load.mockRejectedValue(new Error("history unavailable"));
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).rejects.toThrow("history unavailable");
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("uses a post-history decision time for a grant that expires during the history read", async function _GrantExpiresDuringHistory()
	{
		const f = _Fixture();
		f.grants[2]!.expiresAt = new Date(_NOW.getTime() + 1_000);
		f.computers.load.mockImplementation(async function _DelayedHistory() { vi.setSystemTime(_NOW.getTime() + 2_000); return f.computer; });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("does not extend short current membership to the frozen evidence deadline", async function _CurrentMembershipExpires()
	{
		const f = _Fixture();
		f.transaction.agentRevisionMcpToolAssignment.findFirst.mockImplementation(async function _DelayedAssignment() { vi.setSystemTime(_NOW.getTime() + 6_000); return { agentRevisionId: "revision-1" }; });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("refuses an effective argument digest that no longer matches its saved content", async function _ChangedArguments()
	{
		const f = _Fixture();
		await expect(f.authority.admitUntil({ ...f.invocation, effectiveArguments: { query: "substituted" } }, _NOW, _WORKLOAD)).resolves.toBeNull();
		expect(f.transaction.agentRun.findFirst).not.toHaveBeenCalled();
	});
	it("denies an identity head change and a removed conversation participant", async function _IdentityAndParticipant()
	{
		const f = _Fixture();
		f.identities.load.mockResolvedValue({ ...f.identityHead, headDigest: `sha256:${"b".repeat(64)}` });
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
		f.identities.load.mockResolvedValue(f.identityHead);
		f.transaction.conversationParticipant.findFirst.mockResolvedValue(null);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("admits an assigned company tool through the assistant's own principal", async function _ManagedToolAdmission()
	{
		const f = _ManagedFixture();
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBe(_NOW.getTime() + 5_000);
		expect(f.transaction.agentService.findFirst).toHaveBeenCalledOnce();
		expect(f.transaction.authorizationGrant.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { siloId: "silo-1", OR: [{ subjectKind: "Principal", subjectPrincipalId: "managed-1", subjectGroupId: null }] } }));
		expect(f.transaction.auditDecision.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ actorKind: "Workload", actorId: _WORKLOAD.podUid, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, resourceId: "tool-1" }) });
	});

	it("does not borrow the human tool grant after the company grant is revoked", async function _ManagedGrantRevoked()
	{
		const f = _ManagedFixture();
		f.managedToolGrant.revokedAt = _NOW;
		expect(f.grants[2]!.revokedAt).toBeNull();
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it.each(["revision", "requester", "assignment"])("denies company dispatch after current %s changes", async function _ManagedCurrentAuthority(change)
	{
		const f = _ManagedFixture();
		if (change === "revision")
			f.service.activeRevisionId = "revision-2";
		else if (change === "requester")
			f.membership.status = OrgMemberStatus.Suspended;
		else
			f.transaction.agentRevisionMcpToolAssignment.findFirst.mockResolvedValue(null);
		await expect(f.authority.admitUntil(f.invocation, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

});
