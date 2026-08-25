import { createHash } from "node:crypto";

import { ArtifactRevisionState, ArtifactState, Prisma, SkillAuthoringValidationCompletionOutcome, SkillAuthoringValidationState, SkillRevisionState } from "@prisma/client";

import type { SkillAuthoringValidationCompletionEvent, SkillAuthoringValidationInput, SkillAuthoringValidationWorkerAuthority, SkillAuthoringValidationWorkerCompletion, SkillAuthoringValidationWorkerIdentity } from "./skill-authoring-validation-worker.types";

/** Selects the task and ownership facts the worker completion event must carry. */
const _EVENT_SELECT = { id: true, taskId: true, taskName: true, taskKey: true } as const satisfies Prisma.SkillAuthoringValidationSelect;

/** Builds a stable digest for one bounded completion payload without retaining worker output. */
function _CompletionDigest(command: SkillAuthoringValidationWorkerCompletion): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
}

/** Reads the exact bootstrap, claim, revision, and artifact facts a bound authoring Pod must match. */
const _WORKER_SELECT = {
	id: true,
	siloId: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	state: true,
	skillRevisionId: true,
	skillRevision: { select: { state: true, artifactId: true, artifactRevisionId: true, artifactContentAddress: true } },
	workloadClaim: { select: { firstPodUid: true } },
	bootstrap: { select: { id: true, referenceHash: true, namespace: true, serviceAccount: true, expiresAt: true, consumedAt: true, consumedByPodUid: true } },
	completionInbox: { select: { id: true, completionDigest: true, outcome: true, testReport: true, scanResult: true, failureCode: true, outbox: { select: { id: true, publishedAt: true } } } },
} as const satisfies Prisma.SkillAuthoringValidationSelect;

/**
 * Performs database-only authoring-worker operations inside one caller-owned transaction.
 *
 * It checks the recorded first Pod and bootstrap before it exposes an artifact or accepts a
 * completion. Completion persistence creates the workflow-event outbox in the same transaction,
 * so a Pod exit cannot lose the wake-up event. Called by:
 * `PrismaSkillAuthoringValidationWorkerUnitOfWork`.
 */
export class PrismaSkillAuthoringValidationWorkerRepository implements SkillAuthoringValidationWorkerAuthority
{
	/** Holds the transaction opened by the unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Uses only the transaction supplied by the validation worker unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Spends the server-bound bootstrap only for the first Pod recorded by the remote workflow. */
	async consumeBootstrap(referenceHash: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<string | null>
	{
		const validation = await this.transaction.skillAuthoringValidation.findFirst({ where: { bootstrap: { is: { referenceHash } } }, select: _WORKER_SELECT });
		if (validation === null || !_WorkerMatches(validation, identity) || validation.bootstrap?.referenceHash !== referenceHash || validation.bootstrap.consumedAt !== null)
		{
			return null;
		}
		const consumed = await this.transaction.skillAuthoringValidationBootstrap.updateMany({ where: { id: validation.bootstrap.id, consumedAt: null, expiresAt: { gt: new Date() }, namespace: identity.namespace, serviceAccount: identity.serviceAccountName }, data: { consumedAt: new Date(), consumedByPodUid: identity.podUid } });
		return consumed.count === 1 ? validation.id : null;
	}

	/** Loads one active immutable source artifact only after bootstrap consumption bound it to this Pod. */
	async loadInput(validationId: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationInput | null>
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _WORKER_SELECT });
		if (validation === null || !_WorkerMatches(validation, identity) || validation.bootstrap?.consumedByPodUid !== identity.podUid || validation.bootstrap.consumedAt === null || validation.skillRevision.state !== SkillRevisionState.Draft)
		{
			return null;
		}
		const revision = await this.transaction.artifactRevision.findFirst({ where: { id: validation.skillRevision.artifactRevisionId, artifactId: validation.skillRevision.artifactId, contentAddress: validation.skillRevision.artifactContentAddress, state: ArtifactRevisionState.Published, artifact: { siloId: validation.siloId, state: ArtifactState.Active } }, select: { id: true, artifactId: true, contentAddress: true, byteLength: true, mediaType: true } });
		if (revision === null || !Number.isSafeInteger(Number(revision.byteLength)) || Number(revision.byteLength) < 0)
		{
			return null;
		}
		return { siloId: validation.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength: Number(revision.byteLength), mediaType: revision.mediaType };
	}

	/** Stores one completion inbox and event outbox together, returning their fixed workflow receipt. */
	async complete(command: SkillAuthoringValidationWorkerCompletion, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationCompletionEvent | null>
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: command.validationId }, select: _WORKER_SELECT });
		if (validation === null || !_WorkerMatches(validation, identity) || validation.bootstrap?.consumedByPodUid !== identity.podUid || validation.bootstrap.consumedAt === null || validation.taskId === null || validation.taskName === null)
		{
			return null;
		}
		const digest = _CompletionDigest(command);
		if (validation.completionInbox !== null)
		{
			return validation.completionInbox.completionDigest === digest ? _Event(validation, digest) : null;
		}
		const completion = command.outcome === "succeeded"
			? { completionDigest: digest, outcome: SkillAuthoringValidationCompletionOutcome.Succeeded, testReport: command.testReport as Prisma.InputJsonValue, scanResult: command.scanResult as Prisma.InputJsonValue, failureCode: null }
			: { completionDigest: digest, outcome: SkillAuthoringValidationCompletionOutcome.Failed, testReport: Prisma.DbNull, scanResult: Prisma.DbNull, failureCode: command.failureCode };
		await this.transaction.skillAuthoringValidationCompletionInbox.create({ data: { validationId: validation.id, ...completion, outbox: { create: { eventName: "skill-authoring-completed", payload: { validationId: validation.id, completionDigest: digest } } } } });
		const saved = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validation.id }, select: _WORKER_SELECT });
		return saved === null ? null : _Event(saved, digest);
	}

	/** Marks the durable outbox delivered after Absurd accepted the immutable completion event. */
	async markEventPublished(event: SkillAuthoringValidationCompletionEvent): Promise<void>
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: event.event.payload.validationId }, select: _WORKER_SELECT });
		if (validation === null || validation.completionInbox?.completionDigest !== event.event.payload.completionDigest || validation.completionInbox.outbox === null)
		{
			throw new Error("skill authoring validation completion event is unavailable");
		}
		await this.transaction.skillAuthoringValidationWorkflowEventOutbox.updateMany({ where: { id: validation.completionInbox.outbox.id, publishedAt: null }, data: { publishedAt: new Date(), publicationAttempts: { increment: 1 } } });
	}

	/** Reads one unpublished completion event so the process publisher can recover after a worker exits. */
	async nextUnpublished(): Promise<SkillAuthoringValidationCompletionEvent | null>
	{
		const outbox = await this.transaction.skillAuthoringValidationWorkflowEventOutbox.findFirst({
			where: { publishedAt: null, eventName: "skill-authoring-completed" },
			orderBy: { createdAt: "asc" },
			select: { completionInbox: { select: { completionDigest: true, validation: { select: _EVENT_SELECT } } } },
		});
		const validation = outbox?.completionInbox.validation;
		if (outbox === null || validation === undefined || validation.taskId === null || validation.taskName === null)
		{
			return null;
		}
		return { task: { taskId: validation.taskId, taskName: validation.taskName, idempotencyKey: validation.taskKey }, event: { eventName: "skill-authoring-completed", payload: { validationId: validation.id, completionDigest: outbox.completionInbox.completionDigest } } };
	}
}

/** Checks the stored bootstrap and claimed first Pod before a worker can read or write anything. */
function _WorkerMatches(validation: Prisma.SkillAuthoringValidationGetPayload<{ readonly select: typeof _WORKER_SELECT }>, identity: SkillAuthoringValidationWorkerIdentity): boolean
{
	return validation.state === SkillAuthoringValidationState.Running
		&& validation.workloadClaim?.firstPodUid === identity.podUid
		&& validation.bootstrap?.namespace === identity.namespace
		&& validation.bootstrap.serviceAccount === identity.serviceAccountName;
}

/** Maps saved immutable event facts back into the only event the remote workflow accepts. */
function _Event(validation: Prisma.SkillAuthoringValidationGetPayload<{ readonly select: typeof _WORKER_SELECT }>, completionDigest: string): SkillAuthoringValidationCompletionEvent | null
{
	return validation.taskId !== null && validation.taskName !== null
		? { task: { taskId: validation.taskId, taskName: validation.taskName, idempotencyKey: validation.taskKey }, event: { eventName: "skill-authoring-completed", payload: { validationId: validation.id, completionDigest } } }
		: null;
}
