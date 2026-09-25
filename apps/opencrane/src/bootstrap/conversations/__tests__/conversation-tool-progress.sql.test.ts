import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationToolProgressNotificationOutcomes, KurrentConversationToolRunningNotificationPublisher, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolRunningNotificationEvidenceReader, type ConversationToolRunningNotificationCommand, type ConversationToolDispatchDependencies } from "@opencrane/backend/server/conversations";
import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { __CreateMcpRuntimeCompanionRouter } from "@opencrane/backend/server/gateways/mcp";

import { _ToolHandoffSqlRuntime, _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";
import { _ProgressHistoryWithLostAcknowledgement } from "./conversation-tool-progress.sql-fixture";

/** Independent connections prove that history evidence comes from the saved claim after restart. */
const _FIRST = new PrismaClient();
/** The restarted reader shares no process-local claim state with the first server. */
const _SECOND = new PrismaClient();
/** Transport-reviewed identity used only to seed the dedicated proposal fixture. */
const _PROPOSER = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "progress-proof-pod", podUid: "progress-proof-pod" } as const;

/** Admit and register through the same PostgreSQL owners composed by the application. */
async function _Registered(lifetimeMs = 240_000)
{
	const fixture = await _SeedConversationToolProposalSqlFixture({ runLifetimeMs: lifetimeMs });
	const runtime = _ToolHandoffSqlRuntime(_FIRST, fixture);
	const proposals = new PrismaConversationToolProposalUnitOfWork(_FIRST, fixture.dependencies, runtime.admission, async function _ExpireApproval() {});
	await proposals.admit(fixture.turn, fixture.candidate, fixture.proposal, _PROPOSER);
	const registered = await runtime.register();
	if (registered === null)
		throw new Error("Progress proof requires its registered executor");
	return { fixture, runtime, registered };
}

/** Claim once after the synthetic controller registers its executor. */
async function _Claim(lifetimeMs = 240_000)
{
	const { fixture, runtime, registered } = await _Registered(lifetimeMs);
	const claimed = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
	if (claimed === null || typeof claimed === "string" || claimed.runInvocation === null)
		throw new Error("Progress proof requires the exact run-owned claim winner");
	return { fixture, runtime, registered, command: claimed.runInvocation };
}

describe("conversation tool progress SQL authority", function _Suite()
{
	beforeAll(async function _Connect() { await Promise.all([_FIRST.$connect(), _SECOND.$connect()]); });
	afterAll(async function _Disconnect() { await Promise.all([_FIRST.$disconnect(), _SECOND.$disconnect()]); });

	it("recovers safe display evidence on another server without claiming the provider again", async function _Restart()
	{
		const saved = await _Claim();
		const reader = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, saved.fixture.dependencies);
		const row = await _SECOND.toolInvocation.findUniqueOrThrow({ where: { id: saved.command.invocationId } });
		await expect(reader.readCurrent(saved.command)).resolves.toEqual({
			bootstrapId: saved.fixture.turn.bootstrapId, siloId: saved.fixture.siloId,
			conversationId: saved.fixture.turn.binding.conversationId, runId: saved.fixture.runId,
			attempt: 1, toolInvocationId: saved.command.toolInvocationId,
			toolName: saved.fixture.tool.name, toolKind: "mcp", occurredAt: row.createdAt.toISOString(),
		});
		await expect(saved.runtime.authority.claimCompanion(saved.registered.identity, saved.registered.executionReference)).resolves.toBeNull();
		expect((await _SECOND.toolInvocation.findUniqueOrThrow({ where: { id: row.id } })).claimAttempt).toBe(1);
	});

	it.each([false, true])("recovers a lost running-history acknowledgement within the original claim request (revoked=%s)", async function _LostAcknowledgement(revoke)
	{
		const saved = await _Registered();
		const state = _ProgressHistoryWithLostAcknowledgement(saved.fixture, async function _AfterRunningCommit()
		{
			if (revoke)
				await _SECOND.authorizationGrant.update({ where: { id: saved.fixture.toolGrantId }, data: { revokedAt: new Date() } });
		});
		const evidence = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, saved.fixture.dependencies);
		const publisher = new KurrentConversationToolRunningNotificationPublisher(evidence, new ConversationHistoryAuthority(state.history), new ConversationHistoryReader(state.history), state.history);
		const publishCurrentRunInvocation = vi.fn(async function _Publish(command: ConversationToolRunningNotificationCommand)
		{
			return await publisher.publishRunning(command) === ConversationToolProgressNotificationOutcomes.Published;
		});
		const claim = vi.spyOn(saved.runtime.authority, "claimCompanion");
		const app = express();
		app.use(express.json());
		app.use("/mcp", __CreateMcpRuntimeCompanionRouter({ authority: saved.runtime.authority, tokenReviewer: { __Review: vi.fn().mockResolvedValue(saved.registered.identity) }, publishCurrentRunInvocation, logger: { error: vi.fn() } as never }));
		const body = { executionReference: saved.registered.executionReference, podUid: saved.registered.identity.podUid };
		const response = await request(app).post("/mcp/claim").set("authorization", "Bearer synthetic-progress-proof").send(body);
		expect(response.status).toBe(revoke ? 410 : 200);
		expect(claim).toHaveBeenCalledOnce();
		expect(publishCurrentRunInvocation).toHaveBeenCalledOnce();
		expect(state.lostAcknowledgements()).toBe(1);
		const history = await new ConversationHistoryReader(state.history).read({ siloId: saved.fixture.siloId, conversationId: saved.fixture.turn.binding.conversationId, fromRevision: 1n, maxCount: 10, maximumBytes: 65_536 });
		expect(history.entries).toMatchObject([{ phase: "requested" }, { phase: "running" }]);
		const execution = await _SECOND.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: saved.registered.executionId } });
		const invocation = await _SECOND.toolInvocation.findUniqueOrThrow({ where: { id: execution.toolInvocationId! } });
		expect(invocation.claimAttempt).toBe(1);
		if (revoke)
			expect(response.text).toBe("");
		else
		{
			expect(response.body).toMatchObject({ kind: "invocation", executionId: execution.id, invocationId: invocation.toolInvocationId, toolName: saved.fixture.tool.name });
			expect(response.body).not.toHaveProperty("runInvocation");
		}
		const retry = await request(app).post("/mcp/claim").set("authorization", "Bearer synthetic-progress-proof").send(body);
		expect(retry.status).toBe(204);
		expect(publishCurrentRunInvocation).toHaveBeenCalledOnce();
		expect((await _SECOND.toolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).claimAttempt).toBe(1);
	});

	it("rejects substituted run, conversation, workload and both claim fences", async function _Coordinates()
	{
		const saved = await _Claim();
		const reader = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, saved.fixture.dependencies);
		const original = saved.command;
		const invalid: ConversationToolRunningNotificationCommand[] = [
			{ ...original, attempt: original.attempt + 1 },
			{ ...original, conversationId: "another-conversation" },
			{ ...original, companionClaimFence: "another-companion-fence" },
			{ ...original, workload: { ...original.workload, podUid: "another-pod" } },
			{ ...original, workload: { ...original.workload, workloadUid: "another-job" } },
			{ ...original, toolClaim: { ...original.toolClaim, fence: original.toolClaim.fence + 1 } },
			{ ...original, toolClaim: { ...original.toolClaim, revision: original.toolClaim.revision + 1 } },
			{ ...original, requestIdentity: { ...original.requestIdentity, commandId: "another-bootstrap" } },
		];
		for (const command of invalid)
			await expect(reader.readCurrent(command)).resolves.toBeNull();
		await expect(reader.readCurrent(original)).resolves.not.toBeNull();
	});

	it("refuses a previously valid claim after its tool grant is revoked", async function _RevokedGrant()
	{
		const saved = await _Claim();
		const reader = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, saved.fixture.dependencies);
		await expect(reader.readCurrent(saved.command)).resolves.not.toBeNull();
		await _FIRST.authorizationGrant.update({ where: { id: saved.fixture.toolGrantId }, data: { revokedAt: new Date() } });
		await expect(reader.readCurrent(saved.command)).resolves.toBeNull();
	});

	it("refuses a claim when current computer history moves to another generation", async function _NewGeneration()
	{
		const saved = await _Claim();
		const current = await saved.fixture.dependencies.computers.load() as Awaited<ReturnType<ConversationToolDispatchDependencies["computers"]["load"]>>;
		if (current === null || current.lease === null)
			throw new Error("Progress proof requires current computer history");
		const lease = current.lease;
		const dependencies = { ...saved.fixture.dependencies, computers: { async load()
		{
			return { ...current, computer: { ...current.computer, leaseGeneration: 2 }, lease: { ...lease, generation: 2 } };
		} } };
		const reader = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, dependencies);
		await expect(reader.readCurrent(saved.command)).resolves.toBeNull();
	});

	it("refuses the original claim after its saved absolute deadline", async function _Expired()
	{
		const saved = await _Claim(4_000);
		const reader = new PrismaConversationToolRunningNotificationEvidenceReader(_SECOND, saved.fixture.dependencies);
		await expect(reader.readCurrent(saved.command)).resolves.not.toBeNull();
		await _WaitPastSqlDeadline(_SECOND, saved.fixture.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
		await expect(reader.readCurrent(saved.command)).resolves.toBeNull();
	}, 15_000);
});
