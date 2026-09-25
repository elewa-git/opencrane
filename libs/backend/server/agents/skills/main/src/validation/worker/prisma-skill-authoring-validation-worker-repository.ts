import { createHash } from "node:crypto";

import { ArtifactRevisionState, ArtifactState, Prisma, SkillAuthoringValidationCompletionOutcome, SkillAuthoringValidationState, SkillRevisionState } from "@prisma/client";

import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { SkillAuthoringValidationWorkerOutcomes } from "./skill-authoring-validation-worker.types";
import type { SkillAuthoringValidationBootstrapRecord, SkillAuthoringValidationInput, SkillAuthoringValidationWorkerAuthority, SkillAuthoringValidationWorkerCompletion } from "./skill-authoring-validation-worker.types";

/** Select the exact worker and task facts shared by bootstrap, input, and completion operations. */
const _WORKER_VALIDATION_SELECT = {
	id: true,
	siloId: true,
	skillRevisionId: true,
	artifactRevisionId: true,
	artifactContentAddress: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	state: true,
	workloadClaim: { select: { workloadUid: true, firstPodUid: true } },
	bootstrap: { select: { referenceHash: true, namespace: true, serviceAccount: true, expiresAt: true, consumedAt: true, consumedByPodUid: true } },
	completionInbox: { select: { completionDigest: true } },
} as const satisfies Prisma.SkillAuthoringValidationSelect;

/** Names the validation aggregate loaded inside one worker-authority transaction. */
type _Validation = Prisma.SkillAuthoringValidationGetPayload<{ readonly select: typeof _WORKER_VALIDATION_SELECT }>;

/** Build the immutable task receipt already bound during validation admission. */
function _Task(validation: _Validation): IWorkflowTaskReceipt | null
{
	if (validation.taskId === null || validation.taskName === null)
		return null;
	return { taskId: validation.taskId, taskName: validation.taskName, idempotencyKey: validation.taskKey };
}

/** Require the exact current bound Pod and its consumed authoring bootstrap. */
function _IdentityMatches(validation: _Validation, identity: RuntimeWorkloadIdentity, requireConsumedBootstrap: boolean): boolean
{
	const bootstrap = validation.bootstrap;
	return validation.state === SkillAuthoringValidationState.Running
		&& validation.workloadClaim?.workloadUid !== null
		&& validation.workloadClaim?.workloadUid !== undefined
		&& validation.workloadClaim.firstPodUid === identity.podUid
		&& bootstrap !== null
		&& bootstrap.namespace === identity.namespace
		&& bootstrap.serviceAccount === identity.serviceAccountName
		&& (!requireConsumedBootstrap || (bootstrap.consumedAt !== null && bootstrap.consumedByPodUid === identity.podUid));
}

/** Hash the exact parsed completion so a repeated delivery can prove it is identical. */
function _CompletionDigest(command: SkillAuthoringValidationWorkerCompletion): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
}

/** Map the worker vocabulary to the database-owned completion vocabulary. */
function _CompletionOutcome(command: SkillAuthoringValidationWorkerCompletion): SkillAuthoringValidationCompletionOutcome
{
	return command.outcome === SkillAuthoringValidationWorkerOutcomes.Succeeded
		? SkillAuthoringValidationCompletionOutcome.Succeeded
		: SkillAuthoringValidationCompletionOutcome.Failed;
}

/** Applies the worker-only validation protocol through one caller-owned database transaction. */
export class PrismaSkillAuthoringValidationWorkerRepository implements SkillAuthoringValidationWorkerAuthority
{
	/** Database transaction shared by one worker authority operation. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds the caller-owned transaction for one worker operation. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Loads one unused bootstrap only after the workflow has bound both Job and first Pod UIDs. */
	async loadBootstrap(referenceHash: string): Promise<SkillAuthoringValidationBootstrapRecord | null>
	{
		const now = await this._databaseNow();
		const validation = await this.transaction.skillAuthoringValidation.findFirst({ where: { state: SkillAuthoringValidationState.Running, bootstrap: { is: { referenceHash, consumedAt: null, expiresAt: { gt: now } } }, workloadClaim: { is: { workloadUid: { not: null }, firstPodUid: { not: null } } } }, select: _WORKER_VALIDATION_SELECT });
		const bootstrap = validation?.bootstrap;
		const podUid = validation?.workloadClaim?.firstPodUid;
		if (validation === null || validation === undefined || bootstrap === null || bootstrap === undefined || podUid === null || podUid === undefined || _Task(validation) === null)
			return null;
		return { validationId: validation.id, namespace: bootstrap.namespace, serviceAccountName: bootstrap.serviceAccount, podUid };
	}

	/** Consumes the one-use bootstrap under the deployment-fixed, Pod-bound worker identity. */
	async consumeBootstrap(referenceHash: string, identity: RuntimeWorkloadIdentity): Promise<"consumed" | "conflict">
	{
		const now = await this._databaseNow();
		const validation = await this.transaction.skillAuthoringValidation.findFirst({ where: { state: SkillAuthoringValidationState.Running, bootstrap: { is: { referenceHash, consumedAt: null, expiresAt: { gt: now } } } }, select: _WORKER_VALIDATION_SELECT });
		if (validation === null || !_IdentityMatches(validation, identity, false))
			return "conflict";
		const updated = await this.transaction.skillAuthoringValidationBootstrap.updateMany({ where: { validationId: validation.id, referenceHash, consumedAt: null, expiresAt: { gt: now }, namespace: identity.namespace, serviceAccount: identity.serviceAccountName }, data: { consumedAt: new Date(0), consumedByPodUid: identity.podUid } });
		return updated.count === 1 ? "consumed" : "conflict";
	}

	/** Loads the exact published artifact only for the Pod that spent this validation bootstrap. */
	async loadInput(validationId: string, identity: RuntimeWorkloadIdentity): Promise<SkillAuthoringValidationInput | null>
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _WORKER_VALIDATION_SELECT });
		if (validation === null || !_IdentityMatches(validation, identity, true) || _Task(validation) === null)
			return null;
		const skillRevision = await this.transaction.skillRevision.findFirst({ where: { id: validation.skillRevisionId, state: SkillRevisionState.Draft, artifactRevisionId: validation.artifactRevisionId, artifactContentAddress: validation.artifactContentAddress }, select: { id: true } });
		if (skillRevision === null)
			return null;
		const revision = await this.transaction.artifactRevision.findFirst({ where: { id: validation.artifactRevisionId, contentAddress: validation.artifactContentAddress, state: ArtifactRevisionState.Published, artifact: { siloId: validation.siloId, state: ArtifactState.Active } }, select: { artifactId: true, id: true, contentAddress: true, byteLength: true, mediaType: true } });
		const byteLength = Number(revision?.byteLength);
		if (revision === null || !Number.isSafeInteger(byteLength) || byteLength < 0)
			return null;
		return { siloId: validation.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength, mediaType: revision.mediaType };
	}

	/** Saves the completion inbox after rechecking the exact bound Pod. */
	async complete(command: SkillAuthoringValidationWorkerCompletion, identity: RuntimeWorkloadIdentity): Promise<"completed" | "idempotent" | "conflict">
	{
		// 1. Recheck the task, Job, Pod, and one-use bootstrap before accepting worker evidence.
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: command.validationId }, select: _WORKER_VALIDATION_SELECT });
		const task = validation === null ? null : _Task(validation);
		if (validation === null || task === null || !_IdentityMatches(validation, identity, true))
			return "conflict";
		const completionDigest = _CompletionDigest(command);
		if (validation.completionInbox !== null)
			return validation.completionInbox.completionDigest === completionDigest ? "idempotent" : "conflict";

		// 2. Persist the bounded outcome for the task's one-second recovery heartbeat.
		const succeeded = command.outcome === SkillAuthoringValidationWorkerOutcomes.Succeeded;
		await this.transaction.skillAuthoringValidationCompletionInbox.create({
			data: {
				validationId: validation.id,
				completionDigest,
				outcome: _CompletionOutcome(command),
				testReport: succeeded ? command.testReport as unknown as Prisma.InputJsonValue : Prisma.DbNull,
				scanResult: succeeded ? command.scanResult as unknown as Prisma.InputJsonValue : Prisma.DbNull,
				failureCode: succeeded ? null : command.failureCode,
			},
		});
		return "completed";
	}

	/** Reads the current time from the database authority used by the bootstrap expiry trigger. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("skill authoring validation database clock unavailable");
		return clock.now;
	}
}
