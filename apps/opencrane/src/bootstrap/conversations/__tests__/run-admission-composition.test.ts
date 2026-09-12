import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionUnitOfWork, type RunAdmissionCommand, type RunAdmissionExistingVerifier, type RunAdmissionResult, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPromptCompilerRepository, type ExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import { ConversationComputerTurnAuthorityService, type ConversationComputerRunAdmissionCommand, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { FleetMembershipDeploymentModes, PrismaHumanMembershipEvidenceRepository, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { ___ExecutionSubjectSchema, ExecutionSubjectMembershipKinds, PROMPT_COMPILER_VERSION, type CompiledRunInput, type ExecutionSubject, type RunInputSnapshot } from "@opencrane/contracts";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AgentServiceKind, ModelRoutingScope } from "@prisma/client";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { _CreateConversationRunAdmission } from "@opencrane/backend/server/conversations";
import { _log } from "../../process/log";

afterEach(function _RestoreAdmission() { vi.restoreAllMocks(); });

/** Keeps the managed execution Principal distinct from the human who requested this saved run. */
function _subject(): ExecutionSubject
{
	const digest = `sha256:${"a".repeat(64)}`;
	const authenticatedAt = "2026-09-07T00:00:00.000Z";
	const trustedUntil = "2026-09-07T00:10:00.000Z";
	return {
		schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "company-principal",
		identity: { siloId: "silo-1", agentIdentityId: "identity-1", principalId: "company-principal", headRevision: "0", headDigest: digest, decisionEvidenceId: "identity-decision", verifiedAt: authenticatedAt },
		membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: "silo-1", principalId: "company-principal", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: digest, decisionEvidenceId: "company-decision", trustedUntil },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: digest, effectiveContractDigest: digest, decisionEvidenceId: "capability-decision", decidedAt: authenticatedAt },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "human-principal", requestIdempotencyKey: "message-1", authenticatedAt, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, siloId: "silo-1", principalId: "human-principal", revision: 1, assertionId: "membership-1", payloadDigest: digest, decisionEvidenceId: "human-decision", trustedUntil } },
		admission: { authorizingPrincipalId: "human-principal", decisionEvidenceId: "invocation-decision", admittedAt: authenticatedAt },
	};
}

/** Supplies the stored snapshot and its compiled input without refreshing either original deadline. */
function _savedRun(): { snapshot: RunInputSnapshot; compiled: CompiledRunInput }
{
	const budget = { maxModelTurns: 1, maxCompletionTokens: 4_096, maxCostUsdMicros: 10_000, maxToolInvocations: 0, wallClockDeadlineEpochMs: Date.parse("2026-09-07T00:20:00.000Z") };
	const snapshot: RunInputSnapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "child-1", messageIds: ["message-1"], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: { scope: "none" }, mcpTools: [], modelRoute: {}, budgetPolicy: budget, executionSubject: _subject(), promptCompilerVersion: "v1", digest: `sha256:${"b".repeat(64)}`, compiledAt: "2026-09-07T00:00:00.000Z" };
	const compiled: CompiledRunInput = { runId: snapshot.runId, attempt: 1, promptCompilerVersion: "v1", instructions: "", messages: [{ role: "user", content: "Group request" }], tools: [], model: { modelAlias: "company-model", maxOutputTokens: 4_096, generatedOutputCapabilities: [] }, budget, digest: `sha256:${"c".repeat(64)}` };
	return { snapshot, compiled };
}

/** Supplies the same claimed computer and immutable message coordinates as the accepted request. */
function _command(): ConversationComputerRunAdmissionCommand
{
	return { runId: "run-1", computer: { siloId: "silo-1", computerId: "computer-1", conversationId: "child-1", agentIdentityId: "identity-1" }, agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", profileRevisionId: "profile-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "claim-1" }, requesterPrincipalId: "human-principal", requesterSubjectId: "human-subject", requesterIssuer: "https://issuer.test", requesterAuthenticatedAt: "2026-09-07T00:00:00.000Z", requestIdempotencyKey: "message-1", messageInput: { mode: "pre_persisted_history", messageId: "message-1", historyRevision: "1", orderedMessageIds: ["message-1"] } };
}

/** Supplies an empty command-bound document preparation for tests outside the PDF slice. */
function _Prepared(command = _command())
{
	return { siloId: command.computer.siloId, conversationId: command.computer.conversationId, historyRevision: command.messageInput.historyRevision, orderedMessageIds: command.messageInput.orderedMessageIds, documents: [] } as const;
}

describe("conversation run admission composition", function _ConversationRunAdmissionCompositionSuite()
{
	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("assembles and persists a first %s answer input through the real admission owners", async function _FirstAdmission(kind)
	{
		const company = _subject();
		const subject: ExecutionSubject = kind === AgentServiceKind.Personal ? { ...company, principalId: "human-principal", identity: { ...company.identity, principalId: "human-principal" }, membership: company.requester.membership } : company;
		const command = _command();
		const model = { id: "model-1", siloId: "silo-1", scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-1", publicModelName: "test-model", litellmModelId: "provider-model", generatedOutputCapabilities: [] };
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			runInputSnapshot: { create: vi.fn() },
			authorizationGrant: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
			auditEntry: { create: vi.fn() },
			agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", kind, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", state: "Published", promptPolicyVersion: PROMPT_COMPILER_VERSION } }) },
			principal: { findUnique: vi.fn().mockResolvedValue({ subject: "human-subject" }) },
			personaProfile: { findUnique: vi.fn(async function _Persona(query)
			{
				return query.where.siloId_userId.userId === "human-subject" ? { activeRevision: { id: "persona-1", state: "Approved", personaProfileId: "profile-1" } } : null;
			}) },
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ compiledInstructions: "Answer in plain English." }) },
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ id: "child-1", runs: [] }) },
			agentRevision: { findFirst: vi.fn().mockResolvedValue({ modelDefinition: model, mcpToolAssignments: [], skillAssignments: [], budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 } }) },
			mcpToolAdmissionClaim: { upsert: vi.fn() },
			skillRevision: { findMany: vi.fn().mockResolvedValue([]) },
			artifactRevision: { findMany: vi.fn().mockResolvedValue([]) },
			agentRevisionSkillAssignment: { findMany: vi.fn().mockResolvedValue([]) },
			modelDefinition: { findFirst: vi.fn().mockResolvedValue(model) },
			memoryDataset: { findFirst: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) };
		// Identity and grant decisions are supplied at their ports; persistence and input sources run unchanged.
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"d".repeat(64)}` } } as never);
		const resources = vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipalBatch").mockImplementation(async function _AdmitResources(commands) { return commands.map(function _Allowed() { return {} as never; }); });
		const messages = { loadMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Please help with this group request." }]) };
		const compilers = { prepare: vi.fn().mockResolvedValue(_Prepared(command)), create: function _Compiler(_command: ConversationComputerRunAdmissionCommand, _prepared: ReturnType<typeof _Prepared>, transaction: ConstructorParameters<typeof PrismaPromptCompilerRepository>[0]) { return new PrismaPromptCompilerRepository(transaction, messages, "silo-1"); }, compile: vi.fn() };
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "1", orderedMessageIds: ["message-1"], finalMessageAuthor: { principalId: "human-principal", issuer: command.requesterIssuer, subjectId: command.requesterSubjectId, authenticatedAt: command.requesterAuthenticatedAt } }) };
		const port = _CreateConversationRunAdmission(prisma as never, { create: function _Identity() { return { load: vi.fn().mockResolvedValue({ outcome: "loaded", value: subject }) }; } }, { create: function _History() { return history; } }, compilers, { maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 }, _log);

		const result = await port.admit(command);

		expect(result.compiledInput.messages).toEqual([{ role: "user", content: "Please help with this group request." }]);
		expect(compilers.prepare).toHaveBeenCalledExactlyOnceWith(command);
		expect(compilers.prepare.mock.invocationCallOrder[0]).toBeLessThan(resources.mock.invocationCallOrder[0]!);
		expect(compilers.compile).not.toHaveBeenCalled();
		expect(result.compiledInput.model.modelAlias).toBe("test-model");
		expect(result.compiledInput.model.maxOutputTokens).toBe(4096);
		expect(result.compiledInput.budget.maxCompletionTokens).toBe(256_000);
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: subject.principalId, executionSubject: subject }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ memoryQueryPolicy: { scope: "none" }, preferenceFactIds: [], messageIds: ["message-1"] }) });
		expect(resources.mock.calls[0][0].every(function _ExecutionPrincipal(resource) { return resource.principalId === subject.principalId; })).toBe(true);
		expect(transaction.memoryDataset.findFirst).not.toHaveBeenCalled();
		if (kind === AgentServiceKind.Personal)
		{
			expect(transaction.principal.findUnique).toHaveBeenCalledWith({ where: { id_siloId: { id: "human-principal", siloId: "silo-1" } }, select: { subject: true } });
			expect(result.compiledInput.instructions).toBe("Answer in plain English.");
			expect(transaction.authorizationGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", resourceKind: ProductAuthorizationResourceKinds.AgentRun, resourceId: "run-1", subjectPrincipalId: "human-principal", boundaryPrincipalId: "human-principal", boundaryCoverage: "Exact", effect: "Allow" }) });
		}
		else
		{
			expect(transaction.personaProfile.findUnique).not.toHaveBeenCalled();
			expect(transaction.authorizationGrant.create).not.toHaveBeenCalled();
			expect(result.compiledInput.instructions).toBe("");
		}
	});

	it("logs a typed refusal with trusted coordinates and keeps the thrown error generic", async function _SafeAdmissionRefusal()
	{
		vi.spyOn(PrismaRunAdmissionUnitOfWork.prototype, "admit").mockResolvedValue({ outcome: "denied", reason: "persona_unavailable" });
		const warn = vi.spyOn(_log, "warn").mockImplementation(function _Silence() {});
		const port = _CreateConversationRunAdmission({} as never, { create: vi.fn() }, { create: vi.fn() }, { prepare: vi.fn().mockResolvedValue(_Prepared()), create: vi.fn(), compile: vi.fn() }, { maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 }, _log);

		await expect(port.admit(_command())).rejects.toThrow(/^Conversation run admission was denied$/);
		expect(warn).toHaveBeenCalledExactlyOnceWith({ operation: "conversation.run.admission", reason: "persona_unavailable", runId: "run-1", siloId: "silo-1", conversationId: "child-1", agentServiceId: "service-1" }, "Conversation run admission was denied");
	});

	it("rejects an invalid process capacity before constructing usable admission", function _RejectInvalidCapacity()
	{
		expect(function _ComposeWithoutActiveCapacity()
		{
			_CreateConversationRunAdmission({} as never, {} as never, {} as never, {} as never, { maxConcurrentAdmissions: 0, maxQueuedAdmissions: 1 }, _log);
		}).toThrow(/maxConcurrentAdmissions must be a positive integer/);
	});

	it.each([
		["execution", "2026-09-07T00:02:00.000Z", "2026-09-07T00:09:00.000Z"],
		["requester", "2026-09-07T00:09:00.000Z", "2026-09-07T00:02:00.000Z"],
	])("caps duplicate admission at the shorter current %s membership expiry", async function _ShorterCurrentEvidence(_kind, executionExpiry, requesterExpiry)
	{
		const { snapshot, compiled } = _savedRun();
		const original = structuredClone(snapshot);
		const subject = snapshot.executionSubject;
		if (subject.requester.membership.kind !== ExecutionSubjectMembershipKinds.Fleet)
			throw new Error("Fixture requires Fleet membership");
		const current: ExecutionSubject = { ...subject, membership: { ...subject.membership, trustedUntil: executionExpiry }, requester: { ...subject.requester, membership: { ...subject.requester.membership, revision: 2, trustedUntil: requesterExpiry } } };
		const load = vi.fn<ExecutionSubjectAuthority["load"]>().mockResolvedValue({ outcome: "loaded", value: current });
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"d".repeat(64)}` } });
		const transaction: RunAdmissionTransaction = { prisma: {}, authorization: { admitPrincipal } as never, admittedAt: "2026-09-07T00:01:00.000Z", admittedAtEpochMs: Date.parse("2026-09-07T00:01:00.000Z") };
		// The persistence boundary supplies the saved row; the real assembler must verify it again.
		const persistence = vi.spyOn(PrismaRunAdmissionUnitOfWork.prototype, "admit").mockImplementation(async function _Duplicate<TDenial>(_admission: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>): Promise<RunAdmissionResult<TDenial>>
		{
			const verified = await verifyExisting(snapshot, transaction);
			if (verified.outcome === "denied")
				return { outcome: "denied", reason: verified.reason };
			return { outcome: "idempotent", snapshot };
		});
		const compilers = { prepare: vi.fn().mockResolvedValue(_Prepared()), create: vi.fn(), compile: vi.fn().mockResolvedValue(compiled) };
		const port = _CreateConversationRunAdmission({} as never, { create: function _ExecutionSubject() { return { load }; } }, { create: vi.fn() }, compilers, { maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 }, _log);
		const command = _command();

		const result = await port.admit(command);

		expect(result).toEqual({ compiledInput: compiled, authorityExpiresAt: "2026-09-07T00:02:00.000Z" });
		expect(persistence).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ runId: command.runId, requestIdempotencyKey: command.requestIdempotencyKey }), expect.objectContaining({ agentRevisionId: snapshot.agentRevisionId }), transaction);
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human-principal", membershipRevision: 2, action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: "child-1" } }));
		expect(compilers.create).not.toHaveBeenCalled();
		expect(compilers.compile).toHaveBeenCalledWith(command, _Prepared(command), snapshot);
		expect(compilers.prepare).toHaveBeenCalledExactlyOnceWith(command);
		expect(snapshot).toEqual(original);
	});
});

/** Exercises the real local reader, saved-run verifier and computer credential orchestration. */
function _StandaloneComputerFixture()
{
	const saved = _savedRun();
	let snapshot = saved.snapshot;
	const compiled = saved.compiled;
	let now = Date.parse("2026-09-07T00:01:00.000Z");
	const observed = "2026-09-07T00:00:00.000Z";
	const human = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "human-principal", siloId: "silo-1", issuer: "https://issuer.test", subjectId: "human-subject", membershipId: "local-1", membershipUpdatedAt: observed, observedAt: observed, trustedUntil: "2026-09-07T00:05:00.000Z" } as const;
	snapshot = { ...snapshot, executionSubject: { ...snapshot.executionSubject, requester: { ...snapshot.executionSubject.requester, membership: human } } };
	const row = { id: "local-1", clusterTenant: "silo-1", subject: "human-subject", status: "Active", updatedAt: new Date(observed) };
	const principal = { id: "human-principal", siloId: "silo-1", issuer: "https://issuer.test", subject: "human-subject", provenance: "External" };
	const database = { principal: { findFirst: vi.fn().mockResolvedValue(principal) }, orgMembership: { findUnique: vi.fn().mockResolvedValue(row) }, verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(null) } };
	let config: HumanMembershipEvidenceConfig = { mode: FleetMembershipDeploymentModes.Standalone, siloId: "silo-1", trustedOidcIssuer: "https://issuer.test", maximumStalenessMs: 300_000 };
	const load: ExecutionSubjectAuthority["load"] = async function _CurrentMembership()
	{
		const current = await new PrismaHumanMembershipEvidenceRepository(database as never, config).load("silo-1", "human-principal", now);
		if (current === null)
			return { outcome: "denied", reason: "membership_stale" };
		const value = ___ExecutionSubjectSchema.parse({ ...snapshot.executionSubject, requester: { ...snapshot.executionSubject.requester, membership: current } });
		return { outcome: "loaded", value };
	};
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"d".repeat(64)}` } });
	vi.spyOn(PrismaRunAdmissionUnitOfWork.prototype, "admit").mockImplementation(async function _Duplicate<TDenial>(_admission: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>): Promise<RunAdmissionResult<TDenial>>
	{
		const transaction: RunAdmissionTransaction = { prisma: database, authorization: { admitPrincipal } as never, admittedAt: new Date(now).toISOString(), admittedAtEpochMs: now };
		const verified = await verifyExisting(snapshot, transaction);
		return verified.outcome === "denied" ? { outcome: "denied", reason: verified.reason } : { outcome: "idempotent", snapshot };
	});
	const compilers = { prepare: vi.fn().mockResolvedValue(_Prepared()), create: vi.fn(), compile: vi.fn().mockResolvedValue(compiled) };
	const port = _CreateConversationRunAdmission({} as never, { create: function _Subject() { return { load }; } }, { create: vi.fn() }, compilers, { maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 }, _log);
	const command = _command();
	let stored: FrozenConversationComputerTurn | null = null;
	const issueOnce = vi.fn().mockResolvedValue({ key: "test-attempt-key", credentialDigest: `sha256:${"f".repeat(64)}` });
	const resolveCandidate = async function _ResolveCandidate()
			{
				const result = await port.admit(command);
				return { binding: { siloId: "silo-1", conversationId: "child-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Company", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 }, lease: command.lease, compiledInput: result.compiledInput, latestPendingEntryId: "message-1", latestPendingEntryPosition: "1", modelAlias: "company-model", maximumBudgetUsd: 0.1, credentialLifetimeSeconds: 300, credentialExpiresAt: result.authorityExpiresAt };
			};
	const workload = { subject: "system:serviceaccount:test:computer", namespace: "test", serviceAccountName: "computer", podUid: "pod-1" };
	const computer = new ConversationComputerTurnAuthorityService({
		logger: { warn: vi.fn() }, modelCustody: { loadDeclaration: vi.fn().mockResolvedValue(null), storeDeclaration: vi.fn(), loadContinuation: vi.fn(), storeContinuation: vi.fn() }, toolResults: { read: vi.fn(), consume: vi.fn() }, toolResultNotifications: { publishTerminal: vi.fn().mockResolvedValue("published") }, model: { request: vi.fn() },
		toolProposals: { admit: vi.fn() },
		siloId: "silo-1", endpoint: "http://gateway.test", credentials: { issueOnce, reuseExact: vi.fn(), revoke: vi.fn() },
		reviewCredentials: { derive: vi.fn(), bearer: vi.fn() }, outputPayloads: { store: vi.fn() }, writers: { create: vi.fn() },
		runLifecycle: { start: vi.fn(), complete: vi.fn() },
		store: { reserveModel: vi.fn(), selectTool: vi.fn(), reserveContinuation: vi.fn(), loadActive: async function _Active() { return stored; }, createOrRead: async function _Freeze(turn) { stored = turn; return turn; }, load: async function _Load() { return stored; }, markOutput: vi.fn(), settle: vi.fn() },
		candidates: {
			admit: vi.fn(),
			resolve: resolveCandidate,
			resolveForWorkflow: async function _ResolveForWorkflow() { return { candidate: await resolveCandidate(), workload }; },
			assertCurrentForWorkflow: async function _AssertCurrentForWorkflow() { return { candidate: await resolveCandidate(), workload }; },
			assertLeaseForWorkflow: vi.fn().mockResolvedValue(workload),
			assertCurrent: resolveCandidate,
		},
	});
	const workflowCommand = { computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1 }, causationId: "message-1", causationPosition: "1" };
	return { database, row, principal, issueOnce, computer, workflowCommand, compilers, advance: function _Advance() { now += 60_000; }, selectFleet: function _SelectFleet() { config = { mode: FleetMembershipDeploymentModes.Fleet, trustedIssuerId: "fleet", maximumStalenessMs: 300_000, verifier: { verify: vi.fn() } }; } };
}

describe("standalone membership on actual workflow start retry", function _StandaloneRetrySuite()
{
	it("rechecks an unreserved workflow start without issuing a model credential", async function _UnchangedRetry()
	{
		const f = _StandaloneComputerFixture();
		await expect(f.computer.start(f.workflowCommand)).resolves.toMatchObject({ bootstrapId: expect.any(String) });
		f.advance();
		await expect(f.computer.start(f.workflowCommand)).resolves.toMatchObject({ bootstrapId: expect.any(String) });
		expect(f.issueOnce).not.toHaveBeenCalled();
	});

	it.each(["version", "row", "inactive", "issuer", "mode"])("refuses changed %s authority before the first model request", async function _ChangedRetry(change)
	{
		const f = _StandaloneComputerFixture();
		await f.computer.start(f.workflowCommand);
		f.advance();
		if (change === "version")
			f.database.orgMembership.findUnique.mockResolvedValue({ ...f.row, updatedAt: new Date("2026-09-07T00:01:30.000Z") });
		if (change === "row")
			f.database.orgMembership.findUnique.mockResolvedValue({ ...f.row, id: "replacement" });
		if (change === "inactive")
			f.database.orgMembership.findUnique.mockResolvedValue({ ...f.row, status: "Suspended" });
		if (change === "issuer")
			f.database.principal.findFirst.mockResolvedValue({ ...f.principal, issuer: "https://other.test" });
		if (change === "mode")
			f.selectFleet();
		await expect(f.computer.start(f.workflowCommand)).rejects.toThrow("Conversation run admission was denied");
		expect(f.issueOnce).not.toHaveBeenCalled();
	});
});
