import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { PersonalMemoryCommandDatasetStates, PersonalMemoryCommandFactStates, PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, PrismaPersonalMemoryCommandContextRepository, PrismaPersonalMemoryOperationRepository, type PersonalMemoryCommandDataset, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { PrismaAuthorizationAuthority, __DigestCanonicalJson, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import { _CreatePersonalMemoryOperationTask } from "../workflow/personal-memory-operation-task";
import { PrismaPersonalMemoryOperationActorRepository } from "../workflow/prisma-personal-memory-operation-actor-repository";
import { PrismaPersonalMemoryMessageSourceRepository } from "../source/prisma-personal-memory-message-source-repository";
import type { PersonalMemoryMessageSourceRead, PersonalMemoryMessageSourceReader } from "../source/personal-memory-message-source.types";
import { PersonalMemoryCommandAdmissionOutcomes, PersonalMemoryCommandConflict, PersonalMemoryCommandStates, type PersonalMemoryCommandAdmissionResult, type PersonalMemoryCommandAuthority, type PersonalMemoryCommandReceipt } from "./personal-memory-command-authority.types";
import type { PersonalMemoryCommand } from "./personal-memory-command.types";

/** Admits existing-dataset personal-memory commands with identity, authorization, audit, operation, and task in one transaction. */
export class PrismaPersonalMemoryCommandUnitOfWork implements PersonalMemoryCommandAuthority
{
	/** Creates the command owner composed by the OpenCrane server. */
	public constructor(private readonly prisma: PrismaClient, private readonly sources: PersonalMemoryMessageSourceReader, private readonly workflows: Pick<IWorkflowEngine, "spawn">, private readonly clock: () => Date = _Now, private readonly idFactory: () => string = randomUUID) {}

	/** @inheritdoc */
	public async admit(caller: ConversationCaller, command: PersonalMemoryCommand): Promise<PersonalMemoryCommandAdmissionResult | null>
	{
		const idempotencyKeyDigest = _IdempotencyDigest(caller, command.commandId);
		const source = command.kind === PersonalMemoryOperationKinds.Forget ? null : await this.sources.read(caller, command.source.conversationId, command.source.messageId, BigInt(command.source.messagePosition));
		if (command.kind !== PersonalMemoryOperationKinds.Forget && source === null)
			return null;
		return this._transaction(caller, command, idempotencyKeyDigest, source);
	}

	/** @inheritdoc */
	public async read(caller: ConversationCaller, commandId: string): Promise<PersonalMemoryCommandReceipt | null>
	{
		const digest = _IdempotencyDigest(caller, commandId);
		const clock = this.clock;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Read(transaction)
		{
			const now = clock();
			const actors = new PrismaPersonalMemoryOperationActorRepository(transaction);
			if (!_SameActor(caller, await actors.resolve(caller.siloId, caller.principalId)))
				return null;
			const operations = new PrismaPersonalMemoryOperationRepository(transaction);
			const operation = await operations.findByReplayKey(caller.siloId, digest);
			if (operation === null || operation.actorPrincipalId !== caller.principalId)
				return null;
			const contexts = new PrismaPersonalMemoryCommandContextRepository(transaction);
			if (!_SameDataset(operation, await contexts.findDataset({ siloId: operation.siloId, principalId: operation.actorPrincipalId })))
				return null;
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const decision = await authorization.decidePrincipal({ siloId: caller.siloId, principalId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.MemoryScope, id: operation.datasetId }, action: ProductAuthorizationActions.Read, nowEpochMs: now.getTime() });
			return decision.outcome === AuthorizationDecisionOutcomes.Allow ? _Receipt(commandId, operation) : null;
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attemptLimit: 1, operation: "personal-memory command read" });
	}

	/** Runs replay or fresh admission inside a bounded Serializable transaction. */
	private _transaction(caller: ConversationCaller, command: PersonalMemoryCommand, idempotencyKeyDigest: string, source: PersonalMemoryMessageSourceRead | null): Promise<PersonalMemoryCommandAdmissionResult | null>
	{
		const workflows = this.workflows;
		const clock = this.clock;
		const operationId = this.idFactory();
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Admit(transaction)
		{
			const now = clock();
			const actors = new PrismaPersonalMemoryOperationActorRepository(transaction);
			if (!_SameActor(caller, await actors.resolve(caller.siloId, caller.principalId)))
				return null;
			const operations = new PrismaPersonalMemoryOperationRepository(transaction);
			const saved = await operations.findByReplayKey(caller.siloId, idempotencyKeyDigest);
			if (saved !== null)
			{
				if (saved.actorPrincipalId !== caller.principalId || !_MatchesPublicCommand(saved, command))
					throw new PersonalMemoryCommandConflict();
				const contexts = new PrismaPersonalMemoryCommandContextRepository(transaction);
				if (!_SameDataset(saved, await contexts.findDataset({ siloId: saved.siloId, principalId: saved.actorPrincipalId })))
					return null;
				const sourceRepository = new PrismaPersonalMemoryMessageSourceRepository(transaction);
				if (source !== null && (!await sourceRepository.revalidate(caller, source.source) || !_SameSavedSource(saved, source)))
					return null;
				const replayDigest = _ResolvedCommandDigest(caller, command, saved.datasetId, saved.admittedProviderDatasetId, source, saved.targetDocumentId);
				if (saved.commandDigest !== replayDigest)
					throw new PersonalMemoryCommandConflict();
				const authorization = new PrismaAuthorizationAuthority(transaction);
				if (!await _Allows(authorization, caller, saved.datasetId, command.kind, replayDigest, now, false))
					return null;
				return { outcome: PersonalMemoryCommandAdmissionOutcomes.Idempotent, receipt: _Receipt(command.commandId, saved) };
			}
			const contexts = new PrismaPersonalMemoryCommandContextRepository(transaction);
			const dataset = await contexts.findDataset({ siloId: caller.siloId, principalId: caller.principalId });
			if (dataset === null || dataset.state !== PersonalMemoryCommandDatasetStates.Active || dataset.cogneeDatasetId === null)
				return null;
			const sourceRepository = new PrismaPersonalMemoryMessageSourceRepository(transaction);
			if (source !== null && !await sourceRepository.revalidate(caller, source.source))
				return null;
			const target = command.kind === PersonalMemoryOperationKinds.Remember ? null : await contexts.findTarget(dataset.id, command.targetFactId);
			if (command.kind === PersonalMemoryOperationKinds.Correct && (target === null || target.state !== PersonalMemoryCommandFactStates.Active || target.revision !== command.expectedFactRevision))
				return null;
			if (command.kind === PersonalMemoryOperationKinds.Forget && (target === null || (target.state !== PersonalMemoryCommandFactStates.Active && target.state !== PersonalMemoryCommandFactStates.Corrected) || target.revision !== command.expectedFactRevision))
				return null;
			const commandDigest = _ResolvedCommandDigest(caller, command, dataset.id, dataset.cogneeDatasetId, source, target?.cogneeExternalId ?? null);
			const authorization = new PrismaAuthorizationAuthority(transaction);
			if (!await _Allows(authorization, caller, dataset.id, command.kind, commandDigest, now, true))
				return null;
			const task = _CreatePersonalMemoryOperationTask({ siloId: caller.siloId, operationId });
			const admitted = await operations.admit({ operationId, siloId: caller.siloId, datasetId: dataset.id, actorPrincipalId: caller.principalId, idempotencyKeyDigest, commandDigest, kind: command.kind, source: source?.source ?? null, contentDigest: source?.contentDigest ?? null, targetFactId: target?.id ?? null, targetDocumentId: target?.cogneeExternalId ?? null, expectedFactRevision: target?.revision ?? null, providerDatasetId: dataset.cogneeDatasetId, task: { taskName: task.taskName, taskKey: task.idempotencyKey }, admittedAt: now }, async function _Spawn()
			{
				const receipt = await workflows.spawn({ client: transaction }, task);
				return { taskId: receipt.taskId, taskName: receipt.taskName, taskKey: receipt.idempotencyKey };
			});
			return { outcome: admitted.outcome === PersonalMemoryOperationAdmissionOutcomes.Created ? PersonalMemoryCommandAdmissionOutcomes.Accepted : PersonalMemoryCommandAdmissionOutcomes.Idempotent, receipt: _Receipt(command.commandId, admitted.operation) };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "personal-memory command admission" });
	}
}

/** Supplies the production wall clock without an anonymous default constructor callback. */
function _Now(): Date
{
	return new Date();
}

/** Matches the stored active external identity to every trusted caller coordinate. */
function _SameActor(caller: ConversationCaller, actor: ConversationCaller | null): boolean
{
	return caller.externalIssuer !== undefined && actor?.principalId === caller.principalId && actor.subjectId === caller.subjectId && actor.externalIssuer === caller.externalIssuer;
}

/** Matches the current active personal dataset to all coordinates frozen by the operation. */
function _SameDataset(operation: PersonalMemoryOperationRecord, dataset: PersonalMemoryCommandDataset | null): boolean
{
	return dataset?.id === operation.datasetId && dataset.state === PersonalMemoryCommandDatasetStates.Active && dataset.cogneeDatasetId?.toLowerCase() === operation.providerDatasetId?.toLowerCase();
}

/** Checks current MemoryScope permission and records evidence only for a fresh mutation. */
async function _Allows(authorization: Pick<AuthorizationAuthority, "admitPrincipal" | "decidePrincipal">, caller: ConversationCaller, datasetId: string, kind: PersonalMemoryOperationKinds, commandDigest: string, now: Date, admit: boolean): Promise<boolean>
{
	const input = { siloId: caller.siloId, principalId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.MemoryScope, id: datasetId }, action: kind === PersonalMemoryOperationKinds.Forget ? ProductAuthorizationActions.Forget : ProductAuthorizationActions.Manage, nowEpochMs: now.getTime() } as const;
	if (!admit)
		return (await authorization.decidePrincipal(input)).outcome === AuthorizationDecisionOutcomes.Allow;
	const result = await authorization.admitPrincipal({ ...input, actorKind: "user", actorId: caller.principalId, argumentsDigest: commandDigest as `sha256:${string}` });
	return result.outcome === AuthorizationDecisionOutcomes.Allow && result.evidence !== null;
}

/** Hashes the command UUID within its authenticated actor and silo namespace. */
function _IdempotencyDigest(caller: ConversationCaller, commandId: string): string
{
	return __DigestCanonicalJson({ siloId: caller.siloId, principalId: caller.principalId, commandId });
}

/** Binds all resolved immutable command evidence while excluding source plaintext. */
function _ResolvedCommandDigest(caller: ConversationCaller, command: PersonalMemoryCommand, datasetId: string, providerDatasetId: string | null, source: PersonalMemoryMessageSourceRead | null, targetDocumentId: string | null): string
{
	const evidence: JsonValue = { siloId: caller.siloId, actorPrincipalId: caller.principalId, command: _PublicCommandEvidence(command), datasetId, providerDatasetId, source: source === null ? null : { conversationId: source.source.conversationId, messageId: source.source.messageId, messagePosition: source.source.messagePosition.toString(), payloadRef: source.source.payloadRef, ciphertextDigest: source.source.ciphertextDigest, authorPrincipalId: source.source.authorPrincipalId, contentDigest: source.contentDigest }, targetDocumentId };
	return __DigestCanonicalJson(evidence);
}

/** Converts the public command union into canonical JSON without accepting any plaintext field. */
function _PublicCommandEvidence(command: PersonalMemoryCommand): JsonValue
{
	if (command.kind === PersonalMemoryOperationKinds.Remember)
		return { commandId: command.commandId, kind: command.kind, source: { conversationId: command.source.conversationId, messageId: command.source.messageId, messagePosition: command.source.messagePosition } };
	const target = { targetFactId: command.targetFactId, expectedFactRevision: command.expectedFactRevision };
	if (command.kind === PersonalMemoryOperationKinds.Forget)
		return { commandId: command.commandId, kind: command.kind, ...target };
	return { commandId: command.commandId, kind: command.kind, source: { conversationId: command.source.conversationId, messageId: command.source.messageId, messagePosition: command.source.messagePosition }, ...target };
}

/** Confirms the current source read still matches every source field frozen by the operation. */
function _SameSavedSource(operation: PersonalMemoryOperationRecord, source: PersonalMemoryMessageSourceRead): boolean
{
	return operation.source?.conversationId === source.source.conversationId && operation.source.messageId === source.source.messageId && operation.source.messagePosition === source.source.messagePosition && operation.source.payloadRef === source.source.payloadRef && operation.source.ciphertextDigest === source.source.ciphertextDigest && operation.source.authorPrincipalId === source.source.authorPrincipalId && operation.expectedContentDigest === source.contentDigest;
}

/** Confirms replay fields without resolving a changed current target or reading source plaintext. */
function _MatchesPublicCommand(operation: PersonalMemoryOperationRecord, command: PersonalMemoryCommand): boolean
{
	if (operation.kind !== command.kind)
		return false;
	if (command.kind === PersonalMemoryOperationKinds.Remember)
		return operation.targetFactId === null && operation.source?.conversationId === command.source.conversationId && operation.source.messageId === command.source.messageId && operation.source.messagePosition === BigInt(command.source.messagePosition);
	if (operation.targetFactId !== command.targetFactId || operation.expectedFactRevision !== command.expectedFactRevision)
		return false;
	return command.kind === PersonalMemoryOperationKinds.Forget ? operation.source === null : operation.source?.conversationId === command.source.conversationId && operation.source.messageId === command.source.messageId && operation.source.messagePosition === BigInt(command.source.messagePosition);
}

/** Projects durable lifecycle state without provider evidence or source coordinates. */
function _Receipt(commandId: string, operation: PersonalMemoryOperationRecord): PersonalMemoryCommandReceipt
{
	const state = _CommandState(operation.phase);
	return { commandId, operationId: operation.operationId, kind: operation.kind, state, revision: operation.revision, resultFactId: state === PersonalMemoryCommandStates.Completed && operation.kind !== PersonalMemoryOperationKinds.Forget ? operation.operationId : null };
}

/** Maps the saved provider lifecycle into the small product status vocabulary. */
function _CommandState(phase: PersonalMemoryOperationPhases): PersonalMemoryCommandStates
{
	return _COMMAND_STATE_BY_PHASE[phase];
}

/** Exhaustively maps every durable operation phase to its public command state. */
const _COMMAND_STATE_BY_PHASE: Readonly<Record<PersonalMemoryOperationPhases, PersonalMemoryCommandStates>> = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.DocumentAddPending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.CognifyPending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.CatalogCommitPending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.DocumentDeletePending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: PersonalMemoryCommandStates.Pending,
	[PersonalMemoryOperationPhases.RecoveryRequired]: PersonalMemoryCommandStates.NeedsAttention,
	[PersonalMemoryOperationPhases.Completed]: PersonalMemoryCommandStates.Completed,
};
