import { randomUUID } from "node:crypto";
import { AgentRunCancellationDecision, AgentRunState, AgentRunTerminalReason, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Independent connections prove that terminal authority is stored in PostgreSQL. */
const _First = new PrismaClient();
/** Recovery does not share the first connection's transaction state. */
const _Recovery = new PrismaClient();

/** Seeds a valid original turn receipt and a real product authorization decision. */
async function _Fixture()
{
	const fixture = await _SeedConversationToolProposalSqlFixture();
	const commandId = randomUUID();
	const commandDigest = ___DigestCanonicalJson({ commandId, runId: fixture.runId, bootstrapId: fixture.turn.bootstrapId });
	await _First.agentRun.update({ where: { id: fixture.runId }, data: { workflowTaskId: randomUUID(), workflowTaskName: "conversation-computer-turn", workflowTaskKey: randomUUID() } });
	const admission = await _First.$transaction(async function _Authorize(transaction)
	{
		const authority = new PrismaAuthorizationAuthority(transaction);
		return authority.admitPrincipal({ siloId: fixture.siloId, principalId: fixture.principalId, actorKind: "user", actorId: fixture.principalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: fixture.turn.binding.conversationId }, action: ProductAuthorizationActions.Use, argumentsDigest: commandDigest, nowEpochMs: Date.now() });
	});
	if (admission.evidence === null)
		throw new Error("Stop SQL fixture failed current product authorization");
	const data = { state: AgentRunState.Cancelling, cancellationCommandId: commandId, cancellationCommandDigest: commandDigest, cancellationBootstrapId: fixture.turn.bootstrapId, cancellationRequestedByPrincipalId: fixture.principalId, cancellationRequestedAt: new Date(), cancellationAuthorizationDecisionDigest: admission.evidence.decisionDigest, cancellationWorkflowTaskId: randomUUID(), cancellationWorkflowTaskName: "conversation-computer-stop", cancellationWorkflowTaskKey: commandId };
	return { ...fixture, data };
}

describe("Stop authority in the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The Stop SQL proof requires DATABASE_URL and a fresh target baseline");
		await Promise.all([_First.$connect(), _Recovery.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Recovery.$disconnect()]); });

	it("rejects partial admission and an audit for different arguments", async function _ExactAdmission()
	{
		const f = await _Fixture();
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Cancelling, cancellationCommandId: f.data.cancellationCommandId } })).rejects.toThrow("admission must be complete");
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { ...f.data, cancellationCommandDigest: ___DigestCanonicalJson("different-command") } })).rejects.toThrow("exact recorded requester authorization");
		expect(await _Recovery.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Running, cancellationCommandId: null });
	});

	it("rejects a different requester and reuse of the original workflow task", async function _RequesterAndTask()
	{
		const f = await _Fixture();
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { ...f.data, cancellationRequestedByPrincipalId: "another-requester" } })).rejects.toThrow("original run requester");
		const run = await _First.agentRun.findUniqueOrThrow({ where: { id: f.runId } });
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { ...f.data, cancellationWorkflowTaskId: run.workflowTaskId! } })).rejects.toThrow("agent_runs_cancellation_material_check");
	});

	it("keeps the command and target immutable across a new server connection", async function _ImmutableAdmission()
	{
		const f = await _Fixture();
		await _First.agentRun.update({ where: { id: f.runId }, data: f.data });
		await expect(_Recovery.agentRun.update({ where: { id: f.runId }, data: { cancellationBootstrapId: randomUUID() } })).rejects.toThrow("cancellation admission is immutable");
		await expect(_Recovery.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Running } })).rejects.toThrow("invalid AgentRun state transition");
		await expect(_Recovery.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success, finishedAt: new Date() } })).rejects.toThrow("only when final output won");
	});

	it("persists cancellation as the terminal winner and cannot replenish the original inputs", async function _CancellationWinner()
	{
		const f = await _Fixture();
		const before = await _First.runInputSnapshot.findFirstOrThrow({ where: { runId: f.runId } });
		await _First.agentRun.update({ where: { id: f.runId }, data: f.data });
		await _First.agentRun.update({ where: { id: f.runId }, data: { cancellationDecision: AgentRunCancellationDecision.CancellationWon } });
		await expect(_Recovery.agentRun.update({ where: { id: f.runId }, data: { cancellationDecision: AgentRunCancellationDecision.OutputWon } })).rejects.toThrow("terminal winner is immutable");
		await _Recovery.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: new Date() } });
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Running, terminalReason: null, finishedAt: null } })).rejects.toThrow("terminal AgentRun attempt coordinates are immutable");
		expect(await _Recovery.runInputSnapshot.findFirstOrThrow({ where: { runId: f.runId } })).toEqual(before);
		expect(await _First.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Cancelled, cancellationDecision: AgentRunCancellationDecision.CancellationWon, cancellationDecidedAt: expect.any(Date) });
	});

	it("preserves output that won without reopening the run", async function _OutputWinner()
	{
		const f = await _Fixture();
		await _First.agentRun.update({ where: { id: f.runId }, data: f.data });
		await _Recovery.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Completed, cancellationDecision: AgentRunCancellationDecision.OutputWon, terminalReason: AgentRunTerminalReason.Success, finishedAt: new Date() } });
		await expect(_First.agentRun.update({ where: { id: f.runId }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled } })).rejects.toThrow("terminal AgentRun attempt coordinates are immutable");
		expect(await _First.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Completed, cancellationDecision: AgentRunCancellationDecision.OutputWon });
	});
});
