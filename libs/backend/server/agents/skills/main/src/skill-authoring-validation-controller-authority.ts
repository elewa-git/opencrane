import { createHash } from "node:crypto";

import { Prisma, SkillAuthoringValidationCompletionOutcome, SkillAuthoringValidationState, SkillAuthoringValidationWorkloadClass } from "@prisma/client";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { __HashSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { SkillAuthoringValidationTaskNames, type SkillAuthoringValidationCompletion, type SkillAuthoringValidationControllerAuthority, type SkillAuthoringValidationControllerRecord, type SkillAuthoringValidationPodBindCommand, type SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Holds the one deployment profile that may validate a Draft Python skill. */
const _AUTHORING_PROFILE_NAME = "authoring";

/** Limits a worker bootstrap to the same bounded hand-off window as its controller delivery. */
const _BOOTSTRAP_TTL_MILLISECONDS = 5 * 60 * 1_000;

/** Selects only the immutable receipt and claim facts needed to issue one controller delivery. */
const _VALIDATION_SELECT = {
	id: true,
	siloId: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	state: true,
	workloadClaim: {
		select: {
			id: true,
			workloadClass: true,
			profileName: true,
			idempotencyKey: true,
			executionReference: true,
			claimedAt: true,
			deliveryCount: true,
			expiresAt: true,
			workloadUid: true,
			firstPodUid: true,
		},
	},
	bootstrap: { select: { id: true, referenceHash: true, namespace: true, serviceAccount: true, expiresAt: true } },
	completionInbox: { select: { completionDigest: true, outcome: true, failureCode: true } },
} as const satisfies Prisma.SkillAuthoringValidationSelect;

/** Names the record shape loaded by the claim authority inside its database transaction. */
type _Validation = Prisma.SkillAuthoringValidationGetPayload<{ readonly select: typeof _VALIDATION_SELECT }>;

/** Hashes a validation identifier into the stable key that makes claim creation replay-safe. */
function _ClaimKey(validationId: string): string
{
	const digest = createHash("sha256").update(validationId).digest("hex");
	return `workflows:skill-authoring-validation-workload:${digest}`;
}

/** Builds an opaque Kubernetes name component without exposing skill or artifact coordinates. */
function _JobId(validationId: string): string
{
	const digest = createHash("sha256").update(validationId).digest("hex");
	return `skill-validation-${digest.slice(0, 20)}`;
}

/** Checks that a controller request names the exact task receipt saved with this validation. */
function _TaskMatches(validation: _Validation, task: IWorkflowTaskReceipt): boolean
{
	return validation.taskId === task.taskId
		&& validation.taskName === SkillAuthoringValidationTaskNames.Validate
		&& validation.taskKey === task.idempotencyKey;
}

/** Maps a saved current claim to the controller record without exposing product coordinates. */
function _Record(validation: _Validation): SkillAuthoringValidationControllerRecord | null
{
	const claim = validation.workloadClaim;
	if (claim === null || claim.claimedAt === null || claim.expiresAt === null || claim.workloadClass !== SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation || claim.profileName !== _AUTHORING_PROFILE_NAME)
	{
		return null;
	}
	return {
		validationId: validation.id,
		siloId: validation.siloId,
		jobId: _JobId(validation.id),
		claim: {
			claimId: claim.id,
			siloId: validation.siloId,
			workloadClass: RuntimeWorkloadClaimClasses.SkillAuthoringValidation,
			profileName: claim.profileName,
			idempotencyKey: claim.idempotencyKey,
			executionReference: claim.executionReference,
			claimedAt: claim.claimedAt.toISOString(),
			deliveryCount: claim.deliveryCount,
			expiresAt: claim.expiresAt.toISOString(),
		},
	};
}

/** Checks one controller-provided binding against the current server-issued claim delivery. */
function _MatchesBinding(validation: _Validation, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand | SkillAuthoringValidationPodBindCommand): boolean
{
	const claim = validation.workloadClaim;
	const binding = command.binding;
	return _TaskMatches(validation, task)
		&& claim !== null
		&& claim.id === binding.claimId
		&& claim.profileName === _AUTHORING_PROFILE_NAME
		&& claim.claimedAt?.toISOString() === binding.claimedAt
		&& claim.deliveryCount === binding.deliveryCount
		&& claim.expiresAt !== null;
}

/** Requires the fixed worker identity the authoring profile owns. */
function _IsAuthoringWorkerNamespace(namespace: string): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) && namespace.length <= 63;
}

/**
 * Issues the server-owned claim that lets a controller bind one authoring-validation Job.
 *
 * This adapter owns one serializable transaction per call. It creates the one persisted claim only
 * after it rechecks the Absurd receipt, obtains both lease timestamps from PostgreSQL, and never
 * accepts a controller-selected class or profile.
 */
export class PrismaSkillAuthoringValidationControllerRepository implements SkillAuthoringValidationControllerAuthority
{
	/** Holds the caller-owned serializable transaction for one controller authority operation. */
	private readonly transaction: Prisma.TransactionClient;

	/** Uses the transaction opened by the unit of work without committing it. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Issues or reloads the active fenced delivery for the exact saved task receipt. */
	async claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>
	{
		{
			// 1. Reload the admission receipt before any claim write so another task cannot obtain this Job.
			let validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
			if (validation === null || !_TaskMatches(validation, task) || (validation.state !== SkillAuthoringValidationState.Pending && validation.state !== SkillAuthoringValidationState.Running))
			{
				return null;
			}

			// 2. Create the fixed claim identity once; the database trigger rejects a record without task admission.
			if (validation.workloadClaim === null)
			{
				await this.transaction.skillAuthoringValidationWorkloadClaim.create({
					data: {
						validationId: validation.id,
						workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation,
						profileName: _AUTHORING_PROFILE_NAME,
						idempotencyKey: _ClaimKey(validation.id),
						executionReference: validation.id,
					},
				});
				validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
				if (validation === null)
				{
					return null;
				}
			}

			// 3. Ask the database trigger to issue or reload the lease from its own clock.
			const claim = validation.workloadClaim;
			if (claim === null)
			{
				return null;
			}
			await this.transaction.skillAuthoringValidationWorkloadClaim.update({ where: { id: claim.id }, data: { deliveryCount: claim.deliveryCount } });
			validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
			if (validation === null)
			{
				return null;
			}
			return _Record(validation);
		}
	}

	/** Binds the immutable Job UID and one-use bootstrap after the handler created a suspended Job. */
	async bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (!_IsAuthoringWorkerNamespace(command.namespace) || command.binding.profileName !== _AUTHORING_PROFILE_NAME || command.binding.workloadUid.trim().length === 0)
		{
			return "conflict";
		}
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
		if (validation === null || !_MatchesBinding(validation, task, command))
		{
			return "conflict";
		}
			const claim = validation.workloadClaim;
		if (claim === null || (validation.state !== SkillAuthoringValidationState.Pending && validation.state !== SkillAuthoringValidationState.Running))
		{
			return "conflict";
		}
			const referenceHash = await __HashSkillWorkloadBootstrapReference(command.bootstrapReference);
		if (claim.workloadUid !== null)
		{
			const matches = claim.workloadUid === command.binding.workloadUid
				&& validation.bootstrap?.referenceHash === referenceHash
				&& validation.bootstrap.namespace === command.namespace
				&& validation.bootstrap.serviceAccount === "skill-authoring-default";
			if (!matches || validation.bootstrap === null)
			{
				return "conflict";
			}
			await this.transaction.skillAuthoringValidationBootstrap.update({ where: { id: validation.bootstrap.id }, data: { expiresAt: validation.bootstrap.expiresAt } });
			return "idempotent";
			}
			const bound = await this.transaction.skillAuthoringValidationWorkloadClaim.updateMany({
				where: { id: claim.id, workloadUid: null, claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, expiresAt: claim.expiresAt },
				data: { workloadUid: command.binding.workloadUid },
			});
		if (bound.count !== 1)
		{
			return "conflict";
		}
			const running = await this.transaction.skillAuthoringValidation.updateMany({ where: { id: validation.id, state: SkillAuthoringValidationState.Pending }, data: { state: SkillAuthoringValidationState.Running } });
		if (running.count !== 1)
		{
			return "conflict";
		}
			await this.transaction.skillAuthoringValidationBootstrap.create({
				data: { validationId: validation.id, referenceHash, namespace: command.namespace, serviceAccount: "skill-authoring-default", expiresAt: new Date(Date.now() + _BOOTSTRAP_TTL_MILLISECONDS) },
			});
		return "bound";
	}

	/** Binds the exact first Job-owned Pod before a worker can complete the validation. */
	async bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (command.binding.firstPodUid === undefined || command.binding.firstPodUid.trim().length === 0)
		{
			return "conflict";
		}
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
		if (validation === null || validation.state !== SkillAuthoringValidationState.Running || !_MatchesBinding(validation, task, command))
		{
			return "conflict";
		}
			const claim = validation.workloadClaim;
		if (claim === null || claim.workloadUid !== command.binding.workloadUid)
		{
			return "conflict";
		}
		if (claim.firstPodUid !== null)
		{
			return claim.firstPodUid === command.binding.firstPodUid ? "idempotent" : "conflict";
		}
			const updated = await this.transaction.skillAuthoringValidationWorkloadClaim.updateMany({ where: { id: claim.id, firstPodUid: null, workloadUid: command.binding.workloadUid, claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, expiresAt: claim.expiresAt }, data: { firstPodUid: command.binding.firstPodUid } });
		return updated.count === 1 ? "bound" : "conflict";
	}

	/** Loads a saved completion only for the task receipt that admitted this validation. */
	async loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
		return validation !== null && _TaskMatches(validation, task) && validation.completionInbox?.completionDigest === completionDigest
			? { validationId, completionDigest }
			: null;
	}

	/** Moves the validation to the terminal state already evidenced by the saved worker completion. */
	async complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		const validation = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: validationId }, select: _VALIDATION_SELECT });
		if (validation === null || completion.validationId !== validation.id || !_TaskMatches(validation, task) || validation.completionInbox?.completionDigest !== completion.completionDigest)
		{
			return "conflict";
		}
			const completionInbox = validation.completionInbox;
		if (completionInbox === null)
		{
			return "conflict";
		}
			const state = completionInbox.outcome === SkillAuthoringValidationCompletionOutcome.Succeeded ? SkillAuthoringValidationState.Succeeded : SkillAuthoringValidationState.Failed;
		if (validation.state === state)
		{
			return "idempotent";
		}
		if (validation.state !== SkillAuthoringValidationState.Running)
		{
			return "conflict";
		}
			const updated = await this.transaction.skillAuthoringValidation.updateMany({ where: { id: validation.id, state: SkillAuthoringValidationState.Running }, data: { state, failureCode: completionInbox.outcome === SkillAuthoringValidationCompletionOutcome.Failed ? completionInbox.failureCode : null } });
		return updated.count === 1 ? "completed" : "conflict";
	}
}
