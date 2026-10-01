import { AgentRunState, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaConversationRunLifecycleUnitOfWork, type ConversationRunLifecycleCommand } from "@opencrane/backend/agents/execution/runs";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** First server connection used to persist response uncertainty. */
const _FIRST = new PrismaClient();
/** Independent connection used to recover the same saved attempt. */
const _SECOND = new PrismaClient();

describe("conversation run recovery on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Run recovery proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_FIRST.$connect(), _SECOND.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_FIRST.$disconnect(), _SECOND.$disconnect()]); });

	it("retains recovery and the original allowance across independent server connections", async function _Recover()
	{
		const fixture = await _SeedConversationToolProposalSqlFixture();
		const command: ConversationRunLifecycleCommand = { runId: fixture.runId, siloId: fixture.siloId, attempt: 1, computerId: fixture.turn.computerId, lease: fixture.turn.lease };
		const before = await _FIRST.agentRun.findUniqueOrThrow({ where: { id: fixture.runId } });
		const snapshot = await _FIRST.runInputSnapshot.findMany({ where: { runId: fixture.runId }, select: { id: true, digest: true, budgetPolicy: true } });
		const first = new PrismaConversationRunLifecycleUnitOfWork(_FIRST);
		await first.enterRecoveryRequired(command);
		await _FIRST.$disconnect();

		const recovery = new PrismaConversationRunLifecycleUnitOfWork(_SECOND);
		await recovery.start(command);
		await recovery.enterRecoveryRequired(command);
		expect(await _SECOND.agentRun.findUniqueOrThrow({ where: { id: fixture.runId } })).toMatchObject({ state: AgentRunState.RecoveryRequired, attempt: before.attempt, inputSnapshotDigest: before.inputSnapshotDigest, startedAt: before.startedAt, finishedAt: null, terminalReason: null });
		expect(await _SECOND.runInputSnapshot.findMany({ where: { runId: fixture.runId }, select: { id: true, digest: true, budgetPolicy: true } })).toEqual(snapshot);
		await expect(recovery.complete(command)).rejects.toThrow("cannot transition from the current state");
		await expect(recovery.start({ ...command, lease: { ...command.lease, leaseGeneration: command.lease.leaseGeneration + 1 } })).rejects.toThrow("admitted computer lease fence");
		expect(await _SECOND.agentRun.findUniqueOrThrow({ where: { id: fixture.runId } })).toMatchObject({ state: AgentRunState.RecoveryRequired, attempt: before.attempt, finishedAt: null, terminalReason: null });
	});
});
