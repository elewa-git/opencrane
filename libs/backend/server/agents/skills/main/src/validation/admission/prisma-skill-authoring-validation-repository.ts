import { createHash } from "node:crypto";

import { ArtifactRevisionState, ArtifactState, Prisma, SkillRevisionState, SkillTrustClass } from "@prisma/client";

import { SkillAuthoringValidationAdmissionRejectionReasons, type SkillAuthoringValidationAdmissionCommand, type SkillAuthoringValidationRecord, type SkillAuthoringValidationRepository, type SkillAuthoringValidationResolution } from "@opencrane/backend/agents/skills/workflows";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Select immutable coordinates and receipt fields so every replay check uses the same saved facts. */
const _VALIDATION_SELECT = {
	id: true,
	siloId: true,
	skillRevisionId: true,
	artifactRevisionId: true,
	artifactContentAddress: true,
	taskId: true,
	taskName: true,
	taskKey: true,
} as const satisfies Prisma.SkillAuthoringValidationSelect;

type _ValidationProjection = Prisma.SkillAuthoringValidationGetPayload<{ select: typeof _VALIDATION_SELECT }>;

/** Hash immutable coordinates so a retried admission resolves the same validation and task. */
function _TaskKey(command: SkillAuthoringValidationAdmissionCommand): string
{
	const identity = `${command.siloId}:${command.skillRevisionId}:${command.artifactRevisionId}:${command.artifactContentAddress}`;
	return `workflows:skill-authoring-validation:${createHash("sha256").update(identity).digest("hex")}`;
}

/** Maps immutable saved fields into the admission contract, leaving receipt binding to {@link bindTask}. */
function _Record(value: _ValidationProjection): SkillAuthoringValidationRecord
{
	return {
		validationId: value.id,
		siloId: value.siloId,
		skillRevisionId: value.skillRevisionId,
		artifactRevisionId: value.artifactRevisionId,
		artifactContentAddress: value.artifactContentAddress,
		taskKey: value.taskKey,
	};
}

/** Requires every immutable coordinate and task key before a saved row can satisfy a replay. */
function _Matches(value: _ValidationProjection, command: SkillAuthoringValidationAdmissionCommand, taskKey: string): boolean
{
	return value.siloId === command.siloId
		&& value.skillRevisionId === command.skillRevisionId
		&& value.artifactRevisionId === command.artifactRevisionId
		&& value.artifactContentAddress === command.artifactContentAddress
		&& value.taskKey === taskKey;
}

/** Converts the revision checks into the rejection values the admission use case returns. */
function _RevisionRejection(revision: { readonly skill: { readonly siloId: string }; readonly state: SkillRevisionState; readonly trustClass: SkillTrustClass; readonly artifactRevisionId: string; readonly artifactContentAddress: string } | null, command: SkillAuthoringValidationAdmissionCommand): SkillAuthoringValidationAdmissionRejectionReasons | null
{
	if (revision === null || revision.skill.siloId !== command.siloId)
	{
		return SkillAuthoringValidationAdmissionRejectionReasons.ForeignSilo;
	}
	if (revision.state !== SkillRevisionState.Draft)
	{
		return SkillAuthoringValidationAdmissionRejectionReasons.NotDraft;
	}
	if (revision.trustClass !== SkillTrustClass.SandboxedPython)
	{
		return SkillAuthoringValidationAdmissionRejectionReasons.UnsupportedTrustClass;
	}
	if (revision.artifactRevisionId !== command.artifactRevisionId || revision.artifactContentAddress !== command.artifactContentAddress)
	{
		return SkillAuthoringValidationAdmissionRejectionReasons.ArtifactNotPinned;
	}
	return null;
}

/**
 * Persists an authoring validation through the transaction its caller already owns.
 *
 * The validation record and its Absurd receipt must commit or roll back together; otherwise a task
 * could refer to a validation that the product transaction did not admit.
 */
export class PrismaSkillAuthoringValidationRepository implements SkillAuthoringValidationRepository
{
	/** Holds the transaction shared with workflow admission so both writes have one commit decision. */
	private readonly transaction: Prisma.TransactionClient;

	/** Uses the caller's transaction without opening, committing, or rolling it back. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Creates or reuses the validation after it rechecks the current skill and artifact facts.
	 *
	 * @returns A record that workflow admission may use when the requested silo, Draft Python revision,
	 * and active pinned artifact match. A rejection reason means no task may be admitted.
	 */
	async createOrFind(command: SkillAuthoringValidationAdmissionCommand): Promise<SkillAuthoringValidationResolution>
	{
		const revision = await this.transaction.skillRevision.findUnique({
			where: { id: command.skillRevisionId },
			select: {
				skill: { select: { siloId: true } },
				state: true,
				trustClass: true,
				artifactRevisionId: true,
				artifactContentAddress: true,
			},
		});
		const rejectionReason = _RevisionRejection(revision, command);
		if (rejectionReason !== null)
		{
			return { rejectionReason };
		}
		const artifact = await this.transaction.artifactRevision.findFirst({
			where: {
				id: command.artifactRevisionId,
				contentAddress: command.artifactContentAddress,
				state: ArtifactRevisionState.Published,
				artifact: { siloId: command.siloId, state: ArtifactState.Active },
			},
			select: { id: true },
		});
		if (artifact === null)
		{
			return { rejectionReason: SkillAuthoringValidationAdmissionRejectionReasons.ArtifactNotPinned };
		}
		const taskKey = _TaskKey(command);
		const saved = await this.transaction.skillAuthoringValidation.upsert({
			where: {
				skillRevisionId_artifactRevisionId_artifactContentAddress: {
					skillRevisionId: command.skillRevisionId,
					artifactRevisionId: command.artifactRevisionId,
					artifactContentAddress: command.artifactContentAddress,
				},
			},
			create: {
				siloId: command.siloId,
				skillRevisionId: command.skillRevisionId,
				artifactRevisionId: command.artifactRevisionId,
				artifactContentAddress: command.artifactContentAddress,
				taskKey,
			},
			update: {},
			select: _VALIDATION_SELECT,
		});
		if (!_Matches(saved, command, taskKey))
		{
			return { rejectionReason: SkillAuthoringValidationAdmissionRejectionReasons.ConflictingValidation };
		}
		return { record: _Record(saved) };
	}

	/**
	 * Binds the receipt returned by workflow admission to its matching validation record.
	 *
	 * @returns `bound` when this call saves the receipt, `idempotent` for the same saved receipt, or
	 * `conflict` when the validation or immutable receipt facts differ and the caller must roll back.
	 */
	async bindTask(record: SkillAuthoringValidationRecord, receipt: IWorkflowTaskReceipt): Promise<"bound" | "idempotent" | "conflict">
	{
		const saved = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: record.validationId }, select: _VALIDATION_SELECT });
		if (saved === null || !_Matches(saved, record, record.taskKey))
		{
			return "conflict";
		}
		if (saved.taskId !== null || saved.taskName !== null)
		{
			return saved.taskId === receipt.taskId && saved.taskName === receipt.taskName && saved.taskKey === receipt.idempotencyKey
				? "idempotent"
				: "conflict";
		}
		const updated = await this.transaction.skillAuthoringValidation.updateMany({
			where: { id: saved.id, taskId: null, taskName: null, taskKey: receipt.idempotencyKey },
			data: { taskId: receipt.taskId, taskName: receipt.taskName },
		});
		if (updated.count === 1)
		{
			return "bound";
		}
		const concurrent = await this.transaction.skillAuthoringValidation.findUnique({ where: { id: saved.id }, select: _VALIDATION_SELECT });
		return concurrent !== null && concurrent.taskId === receipt.taskId && concurrent.taskName === receipt.taskName && concurrent.taskKey === receipt.idempotencyKey
			? "idempotent"
			: "conflict";
	}
}
