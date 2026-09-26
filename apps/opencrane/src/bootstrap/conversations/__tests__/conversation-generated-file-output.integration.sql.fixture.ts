import { randomUUID } from "node:crypto";

import { ArtifactScannerVerdict, ConversationModelResponseKinds, ConversationModelToolModes } from "@opencrane/contracts";
import type { PrismaClient, Prisma } from "@prisma/client";

import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { PrismaConversationGeneratedFileOutputLinkUnitOfWork, PrismaConversationGeneratedFileResultRepository, PrismaConversationGeneratedFileWorkflowRepository } from "@opencrane/backend/server/conversation-assets";
import { CurrentConversationToolRequestedNotificationEvidenceReader, KurrentConversationToolRequestedNotificationPublisher, ConversationComputerTurnAuthorityService, ConversationComputerTurnWriterFactory, CurrentConversationToolResultNotificationEvidenceReader, KurrentConversationComputerTurnStore, KurrentConversationToolResultNotificationPublisher, PrismaConversationComputerTurnUnitOfWork, PrismaConversationModelCustodyUnitOfWork, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, type ConversationComputerRunLifecycleCommand, type ConversationComputerTurnAuthorityDependencies, type ConversationComputerTurnCandidateResolver, type ConversationGeneratedFileOutputLinker, type ConversationGeneratedFileResultRepositoryFactory, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority, ConversationHistoryModes, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _ActualGeneratedFileScanner, _CaptureActualGeneratedFileSqlFixture, _ClaimActualGeneratedFile, _GeneratedFileWorkflowDependencies, _QuarantineActualGeneratedFile, type _ActualGeneratedFileCapture } from "./conversation-generated-file-lifecycle.sql-fixture";
import { _GENERATED_FILE_ARGUMENTS, _GENERATED_FILE_PROPOSER } from "./conversation-generated-file-capture.sql-fixture";
import { _ConversationTurnRequest } from "./conversation-turn-protocol.fixture";

/** Narrow lifecycle surface used by output completion and its injected recovery fault. */
export interface _GeneratedFileOutputRunLifecycle
{
	start(command: ConversationComputerRunLifecycleCommand): Promise<void>;
	enterRecoveryRequired(command: ConversationComputerRunLifecycleCommand): Promise<void>;
	complete(command: ConversationComputerRunLifecycleCommand): Promise<void>;
}

/** Synthetic encryption key used only by the combined PostgreSQL and KurrentDB proof. */
export const _GENERATED_OUTPUT_CIPHER = AesGcmConversationPrivatePayloadCipher.fromDocument({ currentKeyId: "generated-output-integration", keys: { "generated-output-integration": Buffer.alloc(32, 23).toString("base64url") } });

/** Exact current Pod identity already admitted by the real generated-file capture fixture. */
export const _GENERATED_OUTPUT_WORKLOAD: RuntimeWorkloadIdentity = {
	subject: "system:serviceaccount:computers:computer",
	namespace: _GENERATED_FILE_PROPOSER.namespace,
	serviceAccountName: _GENERATED_FILE_PROPOSER.serviceAccountName,
	podUid: _GENERATED_FILE_PROPOSER.podUid,
};

/** Optional recovery faults injected after one durable output milestone. */
export interface _GeneratedFileOutputRecoveryHooks
{
	/** Replaces the generated-file linker while preserving every other production owner. */
	readonly generatedFiles?: ConversationGeneratedFileOutputLinker;
	/** Replaces run completion so a test can lose the response after a committed link. */
	readonly runLifecycle?: _GeneratedFileOutputRunLifecycle;
}

/** Complete captured, scanned, consumed and continuation-reserved evidence for one output. */
export interface _GeneratedFileOutputIntegrationFixture
{
	/** Real generated-file capture and immutable operation. */
	readonly capture: _ActualGeneratedFileCapture;
	/** Output authority composed over the production Kurrent turn and PostgreSQL owners. */
	readonly authority: ConversationComputerTurnAuthorityService;
	/** Real generated-file output linker used by recovery clients. */
	readonly linker: PrismaConversationGeneratedFileOutputLinkUnitOfWork;
	/** Real Kurrent-backed turn store. */
	readonly turns: KurrentConversationComputerTurnStore;
	/** Saved turn after result consumption and before assistant output. */
	readonly turn: FrozenConversationComputerTurn;
	/** Result reader and acknowledgement owner bound to the real saved invocation. */
	readonly toolResults: PrismaConversationToolResultsUnitOfWork;
	/** Candidate checks fixed to the actual admitted run and Pod. */
	readonly candidates: ConversationComputerTurnCandidateResolver;
	/** Records the one synthetic continuation dispatch across fresh authority composition. */
	readonly modelDispatches: { readonly maxCompletionTokens: number[] };
}

/** Bind the exact public generated-result reader to its caller's transaction. */
export function _GeneratedOutputResultFactory(capture: _ActualGeneratedFileCapture): ConversationGeneratedFileResultRepositoryFactory
{
	const dependencies = _GeneratedFileWorkflowDependencies(capture);
	return function _GeneratedResults(transactionValue)
	{
		const transaction = transactionValue as Prisma.TransactionClient;
		return new PrismaConversationGeneratedFileResultRepository(transaction, new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies));
	};
}

/** Construct the production output linker for a fresh Prisma and Kurrent client pair. */
export function _GeneratedOutputLinker(prisma: PrismaClient, history: HistoryStore, capture: _ActualGeneratedFileCapture): PrismaConversationGeneratedFileOutputLinkUnitOfWork
{
	return new PrismaConversationGeneratedFileOutputLinkUnitOfWork(prisma, new KurrentConversationComputerTurnStore(history), _GeneratedOutputResultFactory(capture), capture.fixture.dependencies);
}

/** Recompose the output authority from committed PostgreSQL and Kurrent evidence after a process restart. */
export function _RecoverGeneratedFileOutputAuthority(prisma: PrismaClient, history: HistoryStore, fixture: Pick<_GeneratedFileOutputIntegrationFixture, "capture" | "modelDispatches" | "turn">, hooks: _GeneratedFileOutputRecoveryHooks = {})
{
	const turns = new KurrentConversationComputerTurnStore(history);
	const candidates = _Candidates(fixture.capture, fixture.turn, history);
	const generatedResults = _GeneratedOutputResultFactory(fixture.capture);
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, fixture.capture.fixture.siloId, turns, candidates, fixture.capture.fixture.dependencies, generatedResults);
	const linker = _GeneratedOutputLinker(prisma, history, fixture.capture);
	const outputPayloads = new PrismaConversationComputerTurnUnitOfWork(prisma, history, _GENERATED_OUTPUT_CIPHER, 1_000_000, { async admit() { throw new Error("Output persistence must not admit another run"); } });
	const runLifecycle = hooks.runLifecycle ?? new PrismaConversationRunLifecycleUnitOfWork(prisma);
	return { authority: new ConversationComputerTurnAuthorityService(_AuthorityDependencies(prisma, fixture.capture, turns, candidates, toolResults, outputPayloads, hooks.generatedFiles ?? linker, runLifecycle, history, fixture.modelDispatches)), linker, turns };
}

/** Capture, scan and consume one real MCP generated file before the model continuation answers. */
export async function _PrepareGeneratedFileOutputIntegrationFixture(prisma: PrismaClient, history: HistoryStore, workflows: IWorkflowEngine, hooks: _GeneratedFileOutputRecoveryHooks = {}): Promise<_GeneratedFileOutputIntegrationFixture>
{
	const capture = await _CaptureActualGeneratedFileSqlFixture(prisma, workflows, _GENERATED_OUTPUT_CIPHER, { maximumCompletionTokens: 384 });
	await _QuarantineActualGeneratedFile(prisma, capture);
	const claim = await _ClaimActualGeneratedFile(prisma, capture.operation);
	const scanner = _ActualGeneratedFileScanner(prisma, capture);
	const scan = await scanner.complete({ jobId: claim.id, attempt: claim.attempt, claimFence: claim.claimFence!, verdict: ArtifactScannerVerdict.Clean, scannerVersion: "generated-output-integration" });
	if (scan !== "completed")
		throw new Error("Generated output fixture requires one completed clean scan");

	await history.append(new ConversationHistoryAuthority(history).genesisAppend({ schemaVersion: 1, siloId: capture.fixture.siloId, conversationId: capture.fixture.turn.binding.conversationId, mode: ConversationHistoryModes.AgentSession, agentServiceId: capture.fixture.turn.binding.agentServiceId, createdByPrincipalId: capture.fixture.principalId, createdAt: new Date().toISOString() }, randomUUID()));
	const turns = new KurrentConversationComputerTurnStore(history);
	let turn = await turns.createOrRead(capture.fixture.frozenTurn);
	const invocation = await prisma.toolInvocation.findFirstOrThrow({ where: { runId: capture.fixture.runId } });
	const delivery = await prisma.toolResultDelivery.findUniqueOrThrow({ where: { toolInvocationId: invocation.id } });
	const deadline = _OutputDeadline(capture.fixture.candidate);
	const original = capture.fixture.turn.protocol.steps[0]!.reservation;
	const first = _ConversationTurnRequest(turn, { ordinal: original.ordinal, invocationFence: original.invocationFence,
		tools: original.tools, maxCompletionTokens: original.maxCompletionTokens, authorityExpiresAtEpochMs: deadline, dispatchDeadlineEpochMs: deadline });
	await turns.reserveModel(turn.bootstrapId, first);
	turn = await _RequiredTurn(turns, turn.bootstrapId);
	const custody = new PrismaConversationModelCustodyUnitOfWork(prisma, _GENERATED_OUTPUT_CIPHER);
	await custody.storeDeclaration(turn, {
		bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest,
		ordinal: first.ordinal, modelInvocationFence: first.invocationFence, acceptedAtEpochMs: Date.now(), requestNotAfterEpochMs: deadline,
		credentialDigest: delivery.payloadDigest, credentialExpiresAt: new Date(deadline).toISOString(),
		call: { id: `generated-file-${invocation.toolInvocationId}`, name: capture.fixture.tool.modelName, arguments: JSON.stringify(_GENERATED_FILE_ARGUMENTS), content: null },
	});

	const candidates = _Candidates(capture, turn, history);
	const generatedResults = _GeneratedOutputResultFactory(capture);
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, capture.fixture.siloId, turns, candidates, capture.fixture.dependencies, generatedResults);
	const modelDispatches = { maxCompletionTokens: [] as number[] };
	const recovered = _RecoverGeneratedFileOutputAuthority(prisma, history, { capture, modelDispatches, turn }, hooks);
	return { capture, authority: recovered.authority, linker: recovered.linker, turns, turn, toolResults, candidates, modelDispatches };
}

/** Keep test doubles limited to unused provider surfaces and explicit crash points. */
function _AuthorityDependencies(prisma: PrismaClient, capture: _ActualGeneratedFileCapture, turns: KurrentConversationComputerTurnStore, candidates: ConversationComputerTurnCandidateResolver, toolResults: PrismaConversationToolResultsUnitOfWork, outputPayloads: PrismaConversationComputerTurnUnitOfWork, generatedFiles: ConversationGeneratedFileOutputLinker, runLifecycle: _GeneratedFileOutputRunLifecycle, history: HistoryStore, modelDispatches: _GeneratedFileOutputIntegrationFixture["modelDispatches"]): ConversationComputerTurnAuthorityDependencies
{
	const unused = async function _Unused(): Promise<never> { throw new Error("Generated output integration must not call a provider surface"); };
	const custody = new PrismaConversationModelCustodyUnitOfWork(prisma, _GENERATED_OUTPUT_CIPHER);
	const proposals = new PrismaConversationToolProposalUnitOfWork(prisma, capture.fixture.dependencies, capture.runtime.admission, async function _ApprovalExpiry() {});
	const historyAuthority = new ConversationHistoryAuthority(history);
	const historyReader = new ConversationHistoryReader(history);
	const notifications = new KurrentConversationToolResultNotificationPublisher(new CurrentConversationToolResultNotificationEvidenceReader(turns, candidates, toolResults), historyAuthority, historyReader, history);
	return {
		siloId: capture.fixture.siloId,
		candidates,
		credentials: { issueOnce: unused, async reuseExact(command) { return { key: "synthetic-model-key", credentialDigest: command.expectedCredentialDigest, expiresAt: command.expectedExpiresAt }; }, async revoke() {} },
		endpoint: "http://unused.invalid",
		model: { async request(input)
		{
			if (input.tools !== ConversationModelToolModes.None || input.history.length !== 1)
				throw new Error("Generated output integration permits only the saved continuation call");
			modelDispatches.maxCompletionTokens.push(input.maxCompletionTokens);
			return { kind: ConversationModelResponseKinds.Text, text: "I created the requested county totals file." };
		} },
		modelCustody: custody,
		toolResults,
		toolResultNotifications: notifications,
		toolRequestedNotifications: new KurrentConversationToolRequestedNotificationPublisher(new CurrentConversationToolRequestedNotificationEvidenceReader(prisma, turns, candidates), historyAuthority, historyReader, history),
		logger: { warn() {} },
		reviewCredentials: { bearer() { throw new Error("Generated output integration does not issue review credentials"); }, derive() { throw new Error("Generated output integration does not issue review credentials"); } },
		generatedFiles,
		outputPayloads,
		store: turns,
		writers: new ConversationComputerTurnWriterFactory(history, turns, candidates, toolResults),
		runLifecycle,
		routineProgress: { async recordCompleted() {}, async recordUnavailable() {} },
		toolProposals: proposals,
	};
}

/** Synthetic Pod/candidate authority retains the captured input while real IAM and result owners decide every file effect. */
function _Candidates(capture: _ActualGeneratedFileCapture, expectedTurn: FrozenConversationComputerTurn, history: Pick<HistoryStore, "readHead">): ConversationComputerTurnCandidateResolver
{
	function _AssertTurn(turn: FrozenConversationComputerTurn): void
	{
		if (turn.bootstrapId !== expectedTurn.bootstrapId || turn.compile.runId !== capture.fixture.runId || turn.lease.leaseId !== expectedTurn.lease.leaseId)
			throw new Error("Generated output fixture received another turn");
	}
	function _AssertWorkload(workload: RuntimeWorkloadIdentity): void
	{
		if (workload.namespace !== _GENERATED_OUTPUT_WORKLOAD.namespace || workload.serviceAccountName !== _GENERATED_OUTPUT_WORKLOAD.serviceAccountName || workload.podUid !== _GENERATED_OUTPUT_WORKLOAD.podUid)
			throw new Error("Generated output fixture received another Pod");
	}
	async function _CurrentCandidate()
	{
		const head = await history.readHead(`conversation-${capture.fixture.turn.binding.conversationId}`);
		if (head.revision === null)
			throw new Error("Generated output fixture requires conversation genesis");
		return { ...capture.fixture.candidate, binding: { ...capture.fixture.candidate.binding, expectedRevision: head.revision } };
	}
	return {
		async admit(command) { _AssertWorkload(command.workload); },
		async resolve() { return _CurrentCandidate(); },
		async resolveForWorkflow() { return { candidate: await _CurrentCandidate(), workload: _GENERATED_OUTPUT_WORKLOAD }; },
		async assertCurrent(turn, workload) { _AssertTurn(turn); _AssertWorkload(workload); return _CurrentCandidate(); },
		async assertCurrentForWorkflow(turn) { _AssertTurn(turn); return { candidate: await _CurrentCandidate(), workload: _GENERATED_OUTPUT_WORKLOAD }; },
		async assertLeaseForWorkflow(turn) { _AssertTurn(turn); return _GENERATED_OUTPUT_WORKLOAD; },
	};
}

/** Return the original run deadline, capped so the test never creates a refreshed allowance. */
function _OutputDeadline(candidate: _ActualGeneratedFileCapture["fixture"]["candidate"]): number
{
	const runDeadline = candidate.compiledInput.budget.wallClockDeadlineEpochMs;
	const credentialDeadline = Date.parse(candidate.credentialExpiresAt);
	if (runDeadline === null || !Number.isSafeInteger(runDeadline) || !Number.isSafeInteger(credentialDeadline))
		throw new Error("Generated output fixture requires fixed run authority");
	return Math.min(runDeadline, credentialDeadline, Date.now() + 25_000);
}

/** Fail closed when Kurrent omitted the saved turn after an accepted append. */
async function _RequiredTurn(turns: KurrentConversationComputerTurnStore, bootstrapId: string): Promise<FrozenConversationComputerTurn>
{
	const turn = await turns.load(bootstrapId);
	if (turn === null)
		throw new Error("Generated output fixture lost its saved turn");
	return turn;
}
