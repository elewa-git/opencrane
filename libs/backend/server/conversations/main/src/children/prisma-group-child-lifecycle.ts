import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { WorkflowTaskRetryableError, type IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { _ConversationFailureDiagnostic } from "../messages/conversation-failure-diagnostic";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { GroupChildAgentResolver, GroupChildCreateCommand, GroupChildTaskInput, GroupChildView, GroupChildLifecyclePort, GroupChildRequest } from "./group-child.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import type { SelfConversationHistoryAuthority } from "../messages/self-conversation-history.types";
import type { GroupChildRequestRepository } from "./db/group-child-request-repository.types";
import { PrismaGroupChildRequestRepository } from "./db/prisma-group-child-request-repository";
import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import { GroupChildConflictError } from "./group-child.errors";
import { GroupChildHistory } from "./group-child-history";
import { _GroupChildCaller } from "./group-child.mapper";
import { _ReadGroupChildSource } from "./group-child-source";
import { GROUP_CHILD_TASK } from "./group-child-task";

/** Resumes admitted cold creation without placing history effects inside database rollback retries. */
export class PrismaGroupChildLifecycleUnitOfWork implements GroupChildLifecyclePort
{
	public constructor(private readonly prisma: PrismaClient, private readonly histories: GroupChildHistory, private readonly cipher: ConversationPrivatePayloadCipher, private readonly agents: GroupChildAgentResolver<Prisma.TransactionClient>, private readonly workflows: Pick<IWorkflowEngine, "spawn">, private readonly participantHistory: Pick<SelfConversationHistoryAuthority, "read">, private readonly logger: Pick<Logger, "warn">) {}

	/** Binds one caller UUID to an exact own group message and a currently admitted shared audience. */
	public async create(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand): Promise<GroupChildView | null>
	{
		const id = _DeterministicUuid("group-child-request", caller.siloId, caller.principalId, command.idempotencyKey);
		const digest = ___DigestCanonicalJson({ parentConversationId: parentId, ...command });
		if (caller.externalIssuer === undefined || caller.verifiedAuthenticationAt === undefined || !await this._transaction(repository => repository.canCreate(caller, parentId, command, id, digest)))
			return null;
		const source = await _ReadGroupChildSource(this.participantHistory, caller, parentId, command.parentMessageId, BigInt(command.parentMessagePosition));
		if (source === null || source.entry.author.kind !== "human" || source.entry.author.principalId !== caller.principalId || source.entry.author.participantId !== caller.subjectId || source.entry.visibility.audience !== "conversation")
			return null;
		return this._transaction(repository => repository.create(caller, parentId, command, id, digest));
	}

	/** Lists the latest admitted requests whose source and child are still visible to the caller. */
	public list(caller: ConversationCaller, parentId: string): Promise<readonly GroupChildView[] | null>
	{
		return this._transaction(repository => repository.list(caller, parentId));
	}

	/** Replays committed stages after process loss without restoring removed grants or participants. */
	public async run(input: GroupChildTaskInput, attempt = 1): Promise<void>
	{
		const request = await this._transaction(repository => repository.find(input.requestId));
		if (request === null || request.siloId !== input.siloId || request.state !== "Pending")
			return;
		let stage = "current_authority";
		try
		{
			if (!await this._transaction(repository => repository.current(request)))
				return this._unavailable(request);
			stage = "history_establishment";
			await this.histories.establish(request);
			stage = "projection";
			if (!await this._transaction(repository => repository.project(request)))
				return this._unavailable(request);
			stage = "source_read";
			const source = await _ReadGroupChildSource(this.participantHistory, _GroupChildCaller(request), request.parentConversationId, request.parentMessageId, request.parentMessagePosition);
			if (source === null || source.entry.author.kind !== "human" || source.entry.author.principalId !== request.requestedByPrincipalId || source.entry.author.participantId !== request.requesterSubjectId || source.entry.visibility.audience !== "conversation")
				return this._unavailable(request);
			stage = "input_admission";
			const payload = await this._transaction(repository => repository.prepareInput(request, source.text));
			if (payload === null || !await this._transaction(repository => repository.current(request)))
				return this._unavailable(request);
			stage = "activation";
			await this.histories.activate(request, source.entry, payload);
			stage = "completion";
			await this._transaction(async repository => repository.setState(request, await repository.current(request) ? "Ready" : "Unavailable"));
		}
		catch (error)
		{
			const diagnostic = _ConversationFailureDiagnostic(error);
			this.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: request.siloId, requestId: request.id, stage, attempt }, "Group child creation unavailable");
			if (error instanceof GroupChildConflictError || attempt >= GROUP_CHILD_TASK.retryPolicy!.maximumAttempts)
				return this._unavailable(request);
			throw new WorkflowTaskRetryableError("Group child creation dependency is unavailable");
		}
	}

	/** Makes revoked or inconsistent work terminal without exposing a partly created child. */
	private _unavailable(request: GroupChildRequest): Promise<void>
	{
		return this._transaction(repository => repository.setState(request, "Unavailable"));
	}

	/** Retries only known rolled-back transactions; Kurrent effects remain outside the callback. */
	private _transaction<TResult>(operation: (repository: GroupChildRequestRepository) => Promise<TResult>): Promise<TResult>
	{
		const agents = this.agents;
		const workflows = this.workflows;
		const cipher = this.cipher;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _GroupChildTransaction(transaction: Prisma.TransactionClient) { return operation(new PrismaGroupChildRequestRepository(transaction, agents, workflows, cipher)); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "conversation-group-child" });
	}
}
