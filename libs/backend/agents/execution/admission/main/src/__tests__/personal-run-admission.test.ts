import { describe, expect, it, vi } from "vitest";

import { RunAdmissionConcurrencyDenialReasons, RunAdmissionConcurrencyGate, RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { _CreateRunAdmissionCapacityGate } from "../managed-run-admission";
import { __CreatePersonalRunAdmissionPortWithGate } from "../personal-run-admission";
import { PersonalRunAdmissionOutcomes, PersonalRunIdempotencyOutcomes, type PersonalRunAdmissionCommand, type PersonalRunAdmissionDependencies } from "../personal-run-admission.types";

/** Builds the server-side command the personal admission port takes. */
function _Command(): Parameters<ReturnType<typeof __CreatePersonalRunAdmissionPortWithGate>["admitPersonalRun"]>[0]
{
	return { siloId: "silo-1", requesterIssuer: "https://issuer.test", requesterSubjectId: "user-1", requesterAuthenticatedAt: "2026-09-01T00:00:00.000Z", conversationId: "conversation-1", requestIdempotencyKey: "request-1", inputMessageId: "message-1", inputMessageBlocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };
}

/** Provides a target subject producer; individual admission tests do not need to inspect its evidence. */
function _ExecutionSubjectAuthority(): never
{
	return {
		issue: vi.fn(async function _issue(command)
		{
			return {
				outcome: "loaded",
				value: {
					schemaVersion: 1,
					siloId: command.siloId,
					agentIdentityId: "identity-1",
					principalId: "principal-1",
					identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: command.siloId, headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" },
					membership: { principalId: "principal-1", siloId: command.siloId, revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-09-01T00:00:00.000Z" },
					capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" },
					runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: command.agentServiceId, agentRevisionId: "revision-1" },
					computerScope: { siloId: command.siloId, computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
					requester: { siloId: command.siloId, requesterPrincipalId: "requester-1", requestIdempotencyKey: command.requester.requestIdempotencyKey, authenticatedAt: command.requester.authenticatedAt },
					admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" },
				},
			} as const;
		}),
		load: vi.fn(),
	} as never;
}

/** Builds a default set of dependencies, so each test can replace just one of them. */
function _Dependencies(overrides: Partial<PersonalRunAdmissionDependencies> = {}): PersonalRunAdmissionDependencies
{
	return {
		repository: { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }), resolveConversation: vi.fn(async function _resolveConversation() { return { agentServiceId: "service-1" }; }), hasActiveConversationRun: vi.fn(async function _hasActiveConversationRun() { return false; }) },
		assemble: vi.fn(async function _assemble() { return { outcome: "accepted", admissionOutcome: "accepted", snapshot: { runId: "run-1" } } as never; }),
		capacityGate: new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 2, maxQueuedAdmissions: 0 }),
		logger: { warn: vi.fn() } as never,
		...overrides,
	};
}

describe("personal run admission", function _describePersonalRunAdmission()
{
	it("returns an original snapshot before a later conversation change is consulted", async function _returnsDurableDuplicateFirst()
	{
		const repository = { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: "original-run" } as const; }), resolveConversation: vi.fn(async function _resolveConversation() { return { agentServiceId: "service-1" }; }), hasActiveConversationRun: vi.fn(async function _hasActiveConversationRun() { return false; }) };
		const assemble = vi.fn();
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({
			repository,
			assemble,
		}));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: "original-run" });
		expect(repository.resolveConversation).toHaveBeenCalledTimes(1);
		expect(assemble).not.toHaveBeenCalled();
	});

	it("namespaces the public message key by conversation before entering the silo-global run keyspace", async function _scopesMessageIdempotency()
	{
		const resolve = vi.fn(async function _resolve(_command: PersonalRunAdmissionCommand) { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; });
		const resolveConversation = vi.fn(async function _resolveConversation() { return { agentServiceId: "service-1" }; });
		const assemble = vi.fn(async function _assemble(command: PersonalRunAdmissionCommand) { return { outcome: "assembled", admissionOutcome: "accepted", snapshot: { runId: command.conversationId } } as never; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ repository: { resolve, resolveConversation, hasActiveConversationRun: vi.fn(async function _hasActiveConversationRun() { return false; }) }, assemble }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "conversation-1" });
		await expect(port.admitPersonalRun({ ..._Command(), conversationId: "conversation-2" })).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "conversation-2" });

		const firstKey = resolve.mock.calls[0]?.[0].requestIdempotencyKey;
		const secondKey = resolve.mock.calls[1]?.[0].requestIdempotencyKey;
		expect(firstKey).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(secondKey).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(firstKey).not.toBe(secondKey);
		expect(assemble.mock.calls[0]?.[0].requestIdempotencyKey).toBe(firstKey);
		expect(assemble.mock.calls[1]?.[0].requestIdempotencyKey).toBe(secondKey);
	});

	it("admits a first Agent-thread run without pre-reading a child that is created in the same transaction", async function _AdmitsFirstThreadRun()
	{
		const prepare = vi.fn();
		const commit = vi.fn();
		const assemble = vi.fn(async function _Assemble(command: PersonalRunAdmissionCommand, authority: { readonly agentServiceId: string }, actualCommit, actualPrepare)
		{
			expect(authority.agentServiceId).toBe("service-1");
			expect(actualPrepare).toBe(prepare);
			expect(actualCommit).toBe(commit);
			return { outcome: "assembled", admissionOutcome: "accepted", snapshot: { runId: command.conversationId } } as never;
		});
		const dependencies = _Dependencies({ assemble });
		const port = __CreatePersonalRunAdmissionPortWithGate(dependencies);

		await expect(port.admitFirstAgentThreadRun(_Command(), "service-1", prepare, commit)).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "conversation-1" });
		expect(dependencies.repository.resolve).not.toHaveBeenCalled();
		expect(dependencies.repository.resolveConversation).not.toHaveBeenCalled();
	});

	it("preserves exact retry semantics after conversation-scoping the public message key", async function _preservesScopedRetry()
	{
		const keys: string[] = [];
		const repository = {
			resolve: vi.fn(async function _resolve(command: PersonalRunAdmissionCommand)
			{
				keys.push(command.requestIdempotencyKey);
				return keys.length === 1 ? { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const : { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: "run-1" } as const;
			}),
			resolveConversation: vi.fn(async function _resolveConversation() { return { agentServiceId: "service-1" }; }),
			hasActiveConversationRun: vi.fn(async function _hasActiveConversationRun() { return false; }),
		};
		const assemble = vi.fn(async function _assemble() { return { outcome: "assembled", admissionOutcome: "accepted", snapshot: { runId: "run-1" } } as never; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ repository, assemble }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" });
		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: "run-1" });
		expect(keys[0]).toBe(keys[1]);
		expect(assemble).toHaveBeenCalledTimes(1);
	});

	it("denies a cross-silo or nonparticipant conversation without assembling a snapshot", async function _deniesUnavailableConversation()
	{
		const assemble = vi.fn();
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ repository: { resolve: async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }, resolveConversation: async function _resolveConversation() { return null; }, hasActiveConversationRun: async function _hasActiveConversationRun() { return false; } }, assemble }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: "conversation_unavailable" });
		expect(assemble).not.toHaveBeenCalled();
	});

	it("does not consult duplicate or conversation Prisma authorities before the bounded preflight lane grants capacity", async function _boundsPreflightReads()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const capacityGate = _CreateRunAdmissionCapacityGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 });
		const activePreflight = capacityGate.execute({ siloId: "silo-1", agentServiceId: "__personal_admission_preflight__" }, async function _holdPreflight() { await held; return "held"; });
		const repository = { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }), resolveConversation: vi.fn(async function _resolveConversation() { return { agentServiceId: "service-1" }; }), hasActiveConversationRun: vi.fn(async function _hasActiveConversationRun() { return false; }) };
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ capacityGate, repository }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited });
		expect(repository.resolve).not.toHaveBeenCalled();
		expect(repository.resolveConversation).not.toHaveBeenCalled();
		release?.();
		await expect(activePreflight).resolves.toEqual({ outcome: "completed", value: "held" });
	});

	it("uses the same shared capacity gate that protects managed admissions", async function _sharesCapacity()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const capacityGate = _CreateRunAdmissionCapacityGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 });
		const first = capacityGate.execute({ siloId: "silo-1", agentServiceId: "managed-service" }, async function _holdManagedAdmission() { await held; return "held"; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ capacityGate }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited });
		release?.();
		await expect(first).resolves.toEqual({ outcome: "completed", value: "held" });
	});

	it("preserves the final active-run denial from durable admission", async function _preservesActiveRunDenial()
	{
		const assemble = vi.fn(async function _assemble() { return { outcome: "denied", reason: RunAdmissionDenialReasons.ActiveRun } as const; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ assemble: assemble as never }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.ActiveRun });
	});

	it("recovers a different-key unique conflict as active_run only when fresh conversation authority confirms it", async function _recoversActiveRun()
	{
		const hasActiveConversationRun = vi.fn(async function _hasActiveConversationRun() { return true; });
		const assemble = vi.fn(async function _assemble() { return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable } as const; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ assemble: assemble as never, repository: { ..._Dependencies().repository, hasActiveConversationRun } }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.ActiveRun });
		expect(hasActiveConversationRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation-1", requestIdempotencyKey: expect.stringMatching(/^sha256:/u) }));
	});

	it("keeps an unclassified final persistence failure unavailable", async function _keepsUnknownFailureUnavailable()
	{
		const hasActiveConversationRun = vi.fn(async function _hasActiveConversationRun() { return false; });
		const assemble = vi.fn(async function _assemble() { return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable } as const; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ assemble: assemble as never, repository: { ..._Dependencies().repository, hasActiveConversationRun } }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.PersistenceUnavailable });
	});

	it("keeps the original persistence denial when active-run recovery is unavailable", async function _keepsRecoveryFailureUnavailable()
	{
		const recoveryError = new Error("recovery unavailable");
		const warn = vi.fn();
		const hasActiveConversationRun = vi.fn(async function _hasActiveConversationRun(): Promise<boolean> { throw recoveryError; });
		const assemble = vi.fn(async function _assemble() { return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable } as const; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ assemble: assemble as never, repository: { ..._Dependencies().repository, hasActiveConversationRun }, logger: { warn } as never }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.PersistenceUnavailable });
		expect(warn).toHaveBeenCalledWith({ err: recoveryError, siloId: "silo-1", agentServiceId: "service-1", failureKind: "active_run_recovery_failed" }, "Personal run admission recovery failed");
	});
});
