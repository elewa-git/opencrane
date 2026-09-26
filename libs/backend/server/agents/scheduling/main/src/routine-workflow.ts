import type { IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { RoutineComputerActivationStatus, ___ParseRoutineComputerActivationResult, ___ParseRoutineRunAdmissionReceipt, type PrepareRoutineOccurrenceCommand, type RoutineComputerActivationReceipt, type RoutineFiringIdentity, type RoutineOccurrenceCommand, type RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";

import type { RoutineInstructionContext } from "./routine-instruction.types";
import { RoutineOccurrenceTaskDeclaration, RoutineScheduleTaskDeclaration } from "./routine-workflow-contract";
import { RoutineOccurrenceStage, type RoutineOccurrenceTaskInput, type RoutineOccurrenceTaskResult, type RoutineScheduleTaskInput, type RoutineScheduleTaskResult, type RoutineWorkflowDefinitions, type RoutineWorkflowDependencies } from "./routine-workflow.types";

/** Builds the two durable handlers without importing conversation or runtime implementations. */
export function __CreateRoutineWorkflowDefinitions(dependencies: RoutineWorkflowDependencies): RoutineWorkflowDefinitions
{
	return {
		schedule: {
			...RoutineScheduleTaskDeclaration,
			run: async function _RunSchedule(context, input): Promise<RoutineScheduleTaskResult>
			{
				await context.sleepUntil(new Date(input.slotEpochMs), "routine-schedule-slot");
				const firing = await dependencies.persistence.fireAutomatic({ siloId: input.siloId, routineId: input.routineId, routineRevision: input.routineRevision, scheduleTask: context.task, firingId: dependencies.ids.firingId(), conversationId: dependencies.ids.conversationId() });
				return { firingId: firing?.firingId ?? null };
			},
		},
		occurrence: {
			...RoutineOccurrenceTaskDeclaration,
			run: async function _RunOccurrenceTask(context, input): Promise<RoutineOccurrenceTaskResult>
			{
				return await _RunOccurrence(dependencies, context, input);
			},
		},
	};
}

/** Runs replay-safe external preparation before shared root-run admission. */
async function _RunOccurrence(dependencies: RoutineWorkflowDependencies, context: IWorkflowTaskContext, input: RoutineOccurrenceTaskInput): Promise<RoutineOccurrenceTaskResult>
{
	const identity: RoutineFiringIdentity = { siloId: input.siloId, firingId: input.firingId, routineId: input.routineId, routineRevision: input.routineRevision, task: context.task };
	const saved = await dependencies.persistence.authorizeOccurrenceStage(identity, RoutineOccurrenceStage.Preparation);
	if (saved === null)
	{
		return { firingId: identity.firingId, runId: null };
	}
	if (saved.admittedRunId !== null)
	{
		await dependencies.persistence.bindAdmittedRun(identity, saved.admittedRunId);
		return { firingId: identity.firingId, runId: saved.admittedRunId };
	}
	const { instruction: encryptedInstruction, ...occurrenceFacts } = saved;
	const occurrence: RoutineOccurrenceCommand = occurrenceFacts;
	const preparation = await context.checkpoint({ stepName: "routine-prepare-occurrence" }, async function _Prepare()
	{
		const cipherContext: RoutineInstructionContext = { siloId: occurrence.siloId, destinationConversationId: occurrence.destinationConversationId, requesterSubjectId: occurrence.requesterSubjectId, routineId: occurrence.routineId, routineRevision: occurrence.routineRevision };
		const instruction = await dependencies.cipher.decrypt(encryptedInstruction, cipherContext);
		const preparationCommand: PrepareRoutineOccurrenceCommand = { ...occurrence, instruction };
		return await dependencies.preparation.prepare(preparationCommand);
	});
	if (preparation === null)
	{
		return { firingId: identity.firingId, runId: null };
	}
	const savedPreparation = await dependencies.persistence.recordPreparation(identity, preparation);
	const savedActivation = await _ActivateOccurrence(dependencies, context, identity, occurrence, savedPreparation);
	if (savedActivation === null)
	{
		return { firingId: identity.firingId, runId: null };
	}
	if (await dependencies.persistence.authorizeOccurrenceStage(identity, RoutineOccurrenceStage.RunAdmission) === null)
	{
		return { firingId: identity.firingId, runId: null };
	}
	const admissionValue = await context.checkpoint({ stepName: "routine-admit-run" }, async function _AdmitRun()
	{
		return await dependencies.runAdmission.admit({ ...occurrence, preparation: savedPreparation, activation: savedActivation });
	});
	if (admissionValue === null)
	{
		return { firingId: identity.firingId, runId: null };
	}
	const admission = ___ParseRoutineRunAdmissionReceipt(admissionValue);
	await dependencies.persistence.bindAdmittedRun(identity, admission.runId);
	return { firingId: identity.firingId, runId: admission.runId };
}

/** Polls activation under a fresh authority fence and durably waits without spending task attempts. */
async function _ActivateOccurrence(dependencies: RoutineWorkflowDependencies, context: IWorkflowTaskContext, identity: RoutineFiringIdentity, occurrence: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineComputerActivationReceipt | null>
{
	let pollIndex = 0;
	while (true)
	{
		if (await dependencies.persistence.authorizeOccurrenceStage(identity, RoutineOccurrenceStage.Activation) === null)
		{
			return null;
		}
		const activationValue = await context.checkpoint({ stepName: `routine-activate-computer-${pollIndex}` }, async function _Activate()
		{
			return await dependencies.activation.activate(occurrence, preparation);
		});
		const activation = ___ParseRoutineComputerActivationResult(activationValue);
		if (activation.status === RoutineComputerActivationStatus.Refused)
		{
			return null;
		}
		if (activation.status === RoutineComputerActivationStatus.Active)
		{
			return await dependencies.persistence.recordActivation(identity, activation.receipt);
		}
		const wakeAtEpochMs = Math.min(activation.notBeforeEpochMs, activation.expiresAtEpochMs);
		await context.sleepUntil(new Date(wakeAtEpochMs), `routine-activation-poll-${pollIndex}`);
		pollIndex += 1;
	}
}
