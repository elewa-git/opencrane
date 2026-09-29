import type { Prisma } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CompileRunInput, __CreatePrismaSessionAssemblyAuthorities, SessionAssemblyLoadOutcomes, SessionAssemblyOutcomes } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionUnitOfWork, RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseRoutineRunAdmissionReceipt, type RoutineRunAdmissionInput, type RoutineRunAdmissionPort, type RoutineRunAdmissionReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { KurrentConversationHistoryAdmissionReader } from "../messages/kurrent-conversation-history-admission-reader";
import { CONVERSATION_COMPUTER_TURN_TASK } from "../computers/turns/workflow/conversation-computer-turn-task";
import { PrismaConversationComputerTurnWorkflowReceiptRepository } from "../computers/turns/workflow/prisma-conversation-computer-turn-workflow-receipt-repository";
import { _AssertRoutineActivationComputer, _AssertRoutineActivationHistory, _AssertRoutineActivationReplay, _RoutineActivationCommand, _RoutineActivationEnded } from "./routine-computer-activation.mapper";
import { RoutineOccurrencePromptHistoryReader } from "./routine-occurrence-prompt-history-reader";
import { _RoutineRunCommand } from "./routine-run-coordinates";
import { _RoutineExecutionSubject, _RoutinePromptCompiler, _RoutineTurnReceipts } from "./routine-run-input-composition";
import type { RoutineRunAdmissionDependencies } from "./routine-run-admission.types";

/**
 * Admits the root run and execution task in one transaction after scheduling's final current check.
 * An uncertain response retries the same keys; a duplicate recovers the committed run and task.
 */
export class PrismaRoutineRunAdmissionUnitOfWork implements RoutineRunAdmissionPort
{
	/** Uses existing scheduling, history, input and workflow owners rather than writing their rows. */
	public constructor(private readonly dependencies: RoutineRunAdmissionDependencies) {}

	/** Revalidates immutable evidence before entering the transaction that performs the final guard. */
	public admit(input: RoutineRunAdmissionInput): Promise<RoutineRunAdmissionReceipt | null>
	{
		const self = this;
		return ___DoWithTrace("routine.run_admit", { siloId: input.siloId, firingId: input.firingId, conversationId: input.conversationId }, async function _Admit()
		{
			return self._admit(input);
		});
	}

	/** The commit callback owns task creation; duplicate admission skips it and reads the saved receipt. */
	private async _admit(input: RoutineRunAdmissionInput): Promise<RoutineRunAdmissionReceipt | null>
	{
		const dependencies = this.dependencies;
		const { preparation, activation, ...occurrence } = input;
		const record = await dependencies.occurrences.readRecord(input.siloId, input.conversationId);
		_AssertRoutineActivationHistory(occurrence, preparation, record);
		const computers = new ConversationComputerHistory(dependencies.history);
		const current = await computers.load({ computer: { siloId: record.siloId, conversationId: record.conversationId, computerId: record.computerId, agentIdentityId: record.agentIdentityId }, profileRevisionId: record.profileRevisionId });
		_AssertRoutineActivationComputer(current);
		if (_RoutineActivationEnded(current, Date.now()))
			return this._refuse(input);
		_AssertRoutineActivationReplay(activation, record, preparation, current);
		const lease = current.lease;
		if (lease === null)
			throw new Error("Routine run admission requires an active lease");
		const command = _RoutineRunCommand(record);
		const persistence = new PrismaRunAdmissionUnitOfWork(dependencies.prisma);
		const subject = _RoutineExecutionSubject(dependencies, record, command, current);
		const authorities = __CreatePrismaSessionAssemblyAuthorities(persistence, subject, new KurrentConversationHistoryAdmissionReader(dependencies.history), new RoutineOccurrencePromptHistoryReader(dependencies.occurrences));
		const runAuthority = authorities.runAuthority;
		const guarded = { ...authorities, runAuthority: { load: async function _LoadRun(candidate: Parameters<typeof runAuthority.load>[0], transaction: Parameters<typeof runAuthority.load>[1])
		{
			const routines = dependencies.routines(transaction.prisma as Prisma.TransactionClient);
			if (!await routines.authorize(input))
				return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "run_not_admittable" } as const;
			return runAuthority.load(candidate, transaction);
		} } };
		const result = await __AssembleRunInputSnapshot(command, guarded, async function _CommitRunTask(context, value)
		{
			const transaction = context.prisma as Prisma.TransactionClient;
			const compiler = _RoutinePromptCompiler(transaction, dependencies, command);
			await __CompileRunInput(value.snapshot, value.snapshot.attempt, compiler);
			const causation = _RoutineActivationCommand(record);
			const taskInput = { siloId: record.siloId, computerId: record.computerId, leaseId: lease.id, leaseGeneration: lease.generation, activationEventId: causation.activationEventId, causationId: causation.causationId, causationPosition: causation.causationPosition };
			const receipt = await dependencies.workflows.spawn({ client: transaction }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: causation.activationEventId, input: taskInput });
			const receipts = _RoutineTurnReceipts(transaction);
			if (!await receipts.bind(value.snapshot.runId, value.snapshot.attempt, receipt))
				throw new Error("Routine run task could not bind its admitted attempt");
		});
		if (result.outcome === SessionAssemblyOutcomes.Denied)
		{
			if (result.reason === RunAdmissionDenialReasons.PersistenceUnavailable)
				throw new Error("Routine run admission was not confirmed; retry the same firing");
			return this._refuse(input);
		}
		if (result.snapshot.runId !== command.runId || result.snapshot.attempt !== 1)
			throw new Error("Routine admission recovered another run attempt");
		const prisma = dependencies.prisma;
		const runTask = await ___RunInPrismaUnitOfWork(prisma, async function _ReadReceipt(transaction)
		{
			const routines = dependencies.routines(transaction);
			if (!await routines.recover(input, command.runId))
				throw new Error("Routine admitted run differs from its saved stage receipts");
			const receipts = new PrismaConversationComputerTurnWorkflowReceiptRepository(transaction);
			return receipts.read(command.runId, 1);
		}, { isolationLevel: "ReadCommitted", operation: "routine admitted turn receipt" });
		if (runTask === null || runTask.taskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || runTask.idempotencyKey !== _RoutineActivationCommand(record).activationEventId)
			throw new Error("Routine admitted run has no matching execution task");
		return ___ParseRoutineRunAdmissionReceipt({ runId: result.snapshot.runId, inputSnapshotDigest: result.snapshot.digest, runTask });
	}

	/** Never converts an uncertain write or already admitted run into a refused firing. */
	private async _refuse(input: RoutineRunAdmissionInput): Promise<null>
	{
		const dependencies = this.dependencies;
		const prisma = dependencies.prisma;
		const refused = await ___RunInPrismaUnitOfWork(prisma, async function _Refuse(transaction)
		{
			const routines = dependencies.routines(transaction);
			return routines.refuse(input);
		}, { isolationLevel: "Serializable", operation: "routine run admission refusal" });
		if (!refused)
			throw new Error("Routine execution is no longer authorized; its admitted run remains recorded");
		return null;
	}
}
