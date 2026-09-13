import { randomUUID } from "node:crypto";

import { Absurd } from "absurd-sdk";
import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import pg from "pg";
import { AgentRunState, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { _RegisterConversationGeneratedFileWorkflow, type GeneratedFileWorkflowPersistenceDependencies } from "@opencrane/backend/server/conversation-assets";
import { type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { _KurrentHistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { ConversationEntryKinds, ConversationMessageContentBlockKinds } from "@opencrane/contracts";

import { _FinishGeneratedFileSqlRuntimes } from "./conversation-generated-file.sql-fixture";
import { _PrepareGeneratedFileOutputIntegrationFixture, _RecoverGeneratedFileOutputAuthority, type _GeneratedFileOutputIntegrationFixture, type _GeneratedFileOutputRunLifecycle } from "./conversation-generated-file-output.integration.sql.fixture";

const _KURRENT_URL = process.env["KURRENTDB_INTEGRATION_URL"];
const _DATABASE_URL = process.env["DATABASE_URL"];
const _RUN_REAL_PROOFS = _KURRENT_URL !== undefined && _DATABASE_URL !== undefined;
const _QUEUE = `generated-output-${randomUUID()}`;
const _Pool = new pg.Pool({ connectionString: _DATABASE_URL, max: 4 });
const _PrismaClients: PrismaClient[] = [];
const _KurrentClients: KurrentDBClient[] = [];
let _QueueOwner: Absurd;
let _Workflows: ReturnType<typeof _CreateAbsurdWorkflowEngine>;

it.skipIf(_RUN_REAL_PROOFS)("skips generated output recovery because PostgreSQL or KurrentDB is unset", function _Skipped()
{
	expect(_DATABASE_URL === undefined || _KURRENT_URL === undefined).toBe(true);
});

describe.skipIf(!_RUN_REAL_PROOFS)("generated file output across PostgreSQL and KurrentDB", function _Suite()
{
	beforeAll(async function _Connect()
	{
		_QueueOwner = new Absurd({ db: _Pool, queueName: _QUEUE });
		await _QueueOwner.createQueue(_QUEUE);
		_Workflows = _CreateWorkflows();
	});

	afterEach(_FinishGeneratedFileSqlRuntimes);
	afterAll(async function _Disconnect()
	{
		await Promise.all(_PrismaClients.map(client => client.$disconnect()));
		await Promise.all(_KurrentClients.map(client => client.dispose()));
		await _Workflows?.close();
		await _QueueOwner?.close();
		await _Pool.end();
	});

	it("commits one Text and Artifact answer, exact link and restart-safe replay", async function _CompleteAndReplay()
	{
		const firstPrisma = _Prisma();
		const firstHistory = _History();
		const fixture = await _PrepareGeneratedFileOutputIntegrationFixture(firstPrisma, firstHistory, _Workflows);
		await expect(fixture.authority.advance(fixture.turn.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		await _ExpectOneOriginalContinuation(fixture);
		expect((await fixture.turns.load(fixture.turn.bootstrapId))?.toolSelection?.proposalId).toBe(fixture.capture.command.invocationId);

		const saved = await fixture.turns.load(fixture.turn.bootstrapId);
		_ExpectSavedArtifact(saved, fixture);
		await _ExpectOneAnswer(firstHistory, fixture);
		await expect(firstPrisma.conversationAsset.findUniqueOrThrow({ where: { id: fixture.capture.assetId } })).resolves.toMatchObject({ messageId: saved!.outputSourceCommandId });

		const recoveryPrisma = _Prisma();
		const recoveryHistory = _History();
		const recovery = _RecoverGeneratedFileOutputAuthority(recoveryPrisma, recoveryHistory, fixture);
		await expect(recovery.authority.advance(fixture.turn.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		await _ExpectOneOriginalContinuation(fixture);
		await expect(recovery.linker.link((await recovery.turns.load(fixture.turn.bootstrapId))!)).resolves.toBeUndefined();
		await _ExpectOneAnswer(recoveryHistory, fixture);
		await expect(recoveryPrisma.conversationAsset.count({ where: { id: fixture.capture.assetId, messageId: saved!.outputSourceCommandId } })).resolves.toBe(1);
	});

	it("recovers after Kurrent saves output and the first link attempt loses its response", async function _CrashBeforeLink()
	{
		const first = await _PrepareGeneratedFileOutputIntegrationFixture(_Prisma(), _History(), _Workflows, { generatedFiles: { async link() { throw new Error("injected failure after output before link"); } } });
		await expect(first.authority.advance(first.turn.bootstrapId)).resolves.not.toEqual({ outcome: "completed" });
		const saved = await first.turns.load(first.turn.bootstrapId);
		_ExpectSavedArtifact(saved, first);
		await expect(_Prisma().conversationAsset.findUniqueOrThrow({ where: { id: first.capture.assetId } })).resolves.toMatchObject({ messageId: null });

		const recovery = _RecoverGeneratedFileOutputAuthority(_Prisma(), _History(), first);
		await expect(recovery.authority.advance(first.turn.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		await _ExpectOneAnswer(_History(), first);
		await expect(_Prisma().conversationAsset.findUniqueOrThrow({ where: { id: first.capture.assetId } })).resolves.toMatchObject({ messageId: saved!.outputSourceCommandId });
	});

	it("recovers the exact link after completion fails without requiring ended tool authority", async function _CrashAfterLink()
	{
		const prisma = _Prisma();
		const lifecycle = new PrismaConversationRunLifecycleUnitOfWork(prisma);
		let failCompletion = true;
		const interrupted: _GeneratedFileOutputRunLifecycle = {
			start: lifecycle.start.bind(lifecycle),
			async complete(command)
			{
				if (failCompletion)
				{
					failCompletion = false;
					throw new Error("injected failure after link before completion");
				}
				await lifecycle.complete(command);
			},
		};
		const first = await _PrepareGeneratedFileOutputIntegrationFixture(prisma, _History(), _Workflows, { runLifecycle: interrupted });
		await expect(first.authority.advance(first.turn.bootstrapId)).resolves.not.toEqual({ outcome: "completed" });
		const linked = await prisma.conversationAsset.findUniqueOrThrow({ where: { id: first.capture.assetId } });
		expect(linked.messageId).not.toBeNull();
		await prisma.authorizationGrant.update({ where: { id: first.capture.fixture.toolGrantId }, data: { revokedAt: new Date() } });

		const recoveryPrisma = _Prisma();
		const recovery = _RecoverGeneratedFileOutputAuthority(recoveryPrisma, _History(), first);
		await expect(recovery.authority.advance(first.turn.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		await expect(recoveryPrisma.agentRun.findUniqueOrThrow({ where: { id: first.capture.fixture.runId } })).resolves.toMatchObject({ state: AgentRunState.Completed });
		await _ExpectOneAnswer(_History(), first);
	});

	it("rejects a substituted saved Artifact and a fresh link after authority revocation", async function _WrongAndRevoked()
	{
		const prisma = _Prisma();
		const first = await _PrepareGeneratedFileOutputIntegrationFixture(prisma, _History(), _Workflows, { generatedFiles: { async link() { throw new Error("hold link for rejection proof"); } } });
		await expect(first.authority.advance(first.turn.bootstrapId)).resolves.not.toEqual({ outcome: "completed" });
		const saved = (await first.turns.load(first.turn.bootstrapId))!;
		const changed = _ChangedArtifact(saved);
		await expect(first.linker.link(changed)).rejects.toThrow("does not match the saved turn");
		await prisma.authorizationGrant.update({ where: { id: first.capture.fixture.toolGrantId }, data: { revokedAt: new Date() } });
		await expect(first.linker.link(saved)).rejects.toThrow("authority ended before linking");
		await expect(prisma.conversationAsset.findUniqueOrThrow({ where: { id: first.capture.assetId } })).resolves.toMatchObject({ messageId: null });
		await _ExpectOneAnswer(_History(), first);
	});
});

/** Create one real Kurrent adapter and retain its client for suite cleanup. */
function _History(): _KurrentHistoryStore
{
	const client = KurrentDBClient.connectionString(_KURRENT_URL ?? "");
	_KurrentClients.push(client);
	return new _KurrentHistoryStore(client);
}

/** Create an independent Prisma client so recovery never relies on process-local state. */
function _Prisma(): PrismaClient
{
	const client = new PrismaClient({ datasourceUrl: _DATABASE_URL });
	_PrismaClients.push(client);
	return client;
}

/** Register only the task needed for transactional capture; this test drives promotion and scanning explicitly. */
function _CreateWorkflows()
{
	const workflows = _CreateAbsurdWorkflowEngine({ databaseUrl: _DATABASE_URL!, databasePool: _Pool, databasePoolSize: 2, queueAuthority: { queueForTask: function _QueueForTask() { return _QUEUE; } } });
	_RegisterConversationGeneratedFileWorkflow(workflows, {
		persistence: {
			async loadCurrent() { throw new Error("Output integration drives generated persistence explicitly"); },
			async openVerifiedBytes() { throw new Error("Output integration does not transfer bytes"); },
			async finalizeQuarantine() { throw new Error("Output integration drives quarantine explicitly"); },
		},
		promotion: { async promote() { throw new Error("Output integration does not call external promotion"); } },
	});
	return workflows;
}

/** Require the saved participant output to contain exactly one text and the captured Artifact. */
function _ExpectSavedArtifact(turn: FrozenConversationComputerTurn | null, fixture: _GeneratedFileOutputIntegrationFixture): void
{
	const entry = turn?.outputReceipt?.event.data.entry;
	expect(entry).toMatchObject({ kind: ConversationEntryKinds.Message, blocks: [
		{ kind: ConversationMessageContentBlockKinds.Text },
		{ kind: ConversationMessageContentBlockKinds.Artifact, id: fixture.capture.assetId, artifactId: fixture.capture.operation.artifactId, artifactRevisionId: fixture.capture.operation.revisionId },
	] });
	if (entry?.kind !== ConversationEntryKinds.Message)
		throw new Error("Generated output proof requires one saved message");
	expect(entry.blocks).toHaveLength(2);
}

/** Read the public history contract and prove retries never append another answer. */
async function _ExpectOneAnswer(history: _KurrentHistoryStore, fixture: _GeneratedFileOutputIntegrationFixture): Promise<void>
{
	const result = await new ConversationHistoryReader(history).read({ siloId: fixture.capture.fixture.siloId, conversationId: fixture.capture.fixture.turn.binding.conversationId });
	const answers = result.entries.filter(entry => entry.kind === ConversationEntryKinds.Message).filter(entry => entry.replyToEntryId === fixture.capture.fixture.turn.latestPendingEntryId);
	expect(answers).toHaveLength(1);
	expect(answers[0]?.blocks).toHaveLength(2);
}

/** Change only the caller-supplied Artifact name; the linker must reload and reject it. */
function _ChangedArtifact(turn: FrozenConversationComputerTurn): FrozenConversationComputerTurn
{
	const entry = turn.outputReceipt?.event.data.entry;
	if (entry?.kind !== ConversationEntryKinds.Message || entry.blocks[1]?.kind !== ConversationMessageContentBlockKinds.Artifact)
		throw new Error("Generated output rejection proof requires one saved Artifact");
	const changedEntry = { ...entry, blocks: [entry.blocks[0]!, { ...entry.blocks[1], name: "substituted.csv" }] };
	return { ...turn, outputReceipt: { ...turn.outputReceipt!, event: { ...turn.outputReceipt!.event, data: { entry: changedEntry } } } };
}

/** Prove recovery cannot dispatch again or replenish the first reservation's spent token share. */
async function _ExpectOneOriginalContinuation(fixture: _GeneratedFileOutputIntegrationFixture): Promise<void>
{
	const input = fixture.capture.fixture.candidate.compiledInput;
	const total = input.budget.maxCompletionTokens;
	const route = input.model.maxOutputTokens;
	if (total === null || route === null)
		throw new Error("Generated output proof requires frozen completion-token ceilings");
	const expectedRemaining = Math.min(total - 128, route);
	expect(fixture.modelDispatches.maxCompletionTokens).toEqual([expectedRemaining]);
	const saved = await fixture.turns.load(fixture.turn.bootstrapId);
	expect(saved?.modelReservation?.maxCompletionTokens).toBe(128);
	expect(saved?.continuationReservation?.maxCompletionTokens).toBe(expectedRemaining);
}
