import type { RoutineSchedule } from "@opencrane/models/agents";

import type { ChangeRoutineStatusCommand, CreateRoutineCommand, EncryptedRoutineProjection, ReadRoutineCommand, ReviseRoutineCommand, RoutineCommandResult, RoutineFiringResult, RunRoutineNowCommand } from "./routine-authority.types";
import type { RoutineInstructionEnvelope } from "./routine-instruction.types";
import type { RoutineLifecycleEvent } from "./routine-lifecycle.types";

/** Creation command after ids, ciphertext, and a stable digest are prepared outside the transaction. */
export interface CreateRoutinePersistenceCommand extends Omit<CreateRoutineCommand, "instruction">
{
	/** Preallocated stable aggregate identifier. */
	readonly routineId: string;
	/** Preallocated first immutable revision identifier. */
	readonly revisionId: string;
	/** Preallocated command receipt identifier. */
	readonly commandReceiptId: string;
	/** Encrypted instruction produced before the transaction. */
	readonly instruction: RoutineInstructionEnvelope;
	/** Digest of the normalized plaintext command used only for retry comparison. */
	readonly commandDigest: `sha256:${string}`;
}

/** Revision command after ciphertext and ids are prepared outside the transaction. */
export interface ReviseRoutinePersistenceCommand extends Omit<ReviseRoutineCommand, "instruction">
{
	/** Preallocated immutable revision identifier. */
	readonly revisionId: string;
	/** Preallocated command receipt identifier. */
	readonly commandReceiptId: string;
	/** Encrypted replacement instruction. */
	readonly instruction: RoutineInstructionEnvelope;
	/** Digest of the normalized plaintext command used only for retry comparison. */
	readonly commandDigest: `sha256:${string}`;
}

/** Lifecycle command after its receipt identity and command digest are prepared. */
export interface ChangeRoutineStatusPersistenceCommand extends ChangeRoutineStatusCommand
{
	/** Pause, resume, or retire event selected by the public method. */
	readonly event: RoutineLifecycleEvent;
	/** Preallocated command receipt identifier. */
	readonly commandReceiptId: string;
	/** Digest used to reject reuse of a key for different arguments. */
	readonly commandDigest: `sha256:${string}`;
}

/** Immediate firing command after every occurrence identity is preallocated. */
export interface RunRoutineNowPersistenceCommand extends RunRoutineNowCommand
{
	/** Preallocated immutable occurrence identifier. */
	readonly firingId: string;
	/** Preallocated independent occurrence conversation. */
	readonly conversationId: string;
	/** Preallocated command receipt identifier. */
	readonly commandReceiptId: string;
	/** Digest used to reject reuse of a key for a different request. */
	readonly commandDigest: `sha256:${string}`;
}

/** Transactional routine-definition operations implemented by the Prisma command repository. */
export interface RoutineCommandPersistence
{
	/** Creates the aggregate, first revision, grants, cursor, task, and receipt atomically. */
	create(command: CreateRoutinePersistenceCommand): Promise<RoutineCommandResult>;
	/** Reads an encrypted revision only after current fixed-audience authorization. */
	read(command: ReadRoutineCommand): Promise<EncryptedRoutineProjection | null>;
	/** Appends one immutable revision and replaces the schedule task without changing audience. */
	revise(command: ReviseRoutinePersistenceCommand): Promise<RoutineCommandResult>;
	/** Applies pause, resume, or retirement with requester and lifecycle compare-and-set checks. */
	changeStatus(command: ChangeRoutineStatusPersistenceCommand): Promise<RoutineCommandResult>;
	/** Creates or recovers one manual occurrence without moving the automatic cursor. */
	runNow(command: RunRoutineNowPersistenceCommand): Promise<RoutineFiringResult>;
}

/** Validated revision data shared by create and revise persistence. */
export interface RoutineRevisionPersistenceData
{
	/** Normalized schedule copied into the immutable revision. */
	readonly schedule: RoutineSchedule;
	/** Encrypted instruction copied into the immutable revision. */
	readonly instruction: RoutineInstructionEnvelope;
}
