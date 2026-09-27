import { createHash } from "node:crypto";

import { __ParseRoutineSchedule, __PreviewRoutineOccurrences, type RoutineSchedule } from "@opencrane/models/agents";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ChangeRoutineStatusCommand, CreateRoutineCommand, ListRoutineFiringsCommand, ListRoutinesCommand, ReadRoutineCommand, ReviseRoutineCommand, RoutineCommandResult, RoutineCreationOptionsCommand, RoutineCreationOptionsResult, RoutineFiringListResult, RoutineFiringResult, RoutineIdFactory, RoutineListResult, RoutineProjection, RoutineSchedulePreviewCommand, RoutineSchedulePreviewResult, RunRoutineNowCommand } from "./routine-authority.types";
import { RoutineCommandUnavailableError, RoutineCommandValidationError } from "./routine-command.errors";
import type { RoutineInstructionCipher, RoutineInstructionContext } from "./routine-instruction.types";
import type { RoutineCommandPersistence } from "./routine-persistence.types";
import { RoutineLifecycleEvent } from "./routine-lifecycle.types";
import { RoutinePageCursorEndpoints, type RoutinePageCursorCodec, type RoutineReadPersistence } from "./routine-read.types";

/** Maximum plaintext size accepted before mounted encryption. */
const _MAXIMUM_INSTRUCTION_LENGTH = 20_000;

/** Coordinates command validation, mounted encryption, and transactional routine persistence. */
export class RoutineAuthority
{
	/** Transactional product authority that never receives plaintext. */
	private readonly persistence: RoutineCommandPersistence & RoutineReadPersistence;
	/** Mounted AES-GCM adapter invoked only outside retryable database transactions. */
	private readonly cipher: RoutineInstructionCipher;
	/** Opaque id source invoked before retryable database transactions. */
	private readonly ids: RoutineIdFactory;
	/** Encrypts and decrypts continuation positions outside database transactions. */
	private readonly cursors: RoutinePageCursorCodec;

	/** Stores the persistence authority and external encryption boundary. */
	constructor(persistence: RoutineCommandPersistence & RoutineReadPersistence, cipher: RoutineInstructionCipher, ids: RoutineIdFactory, cursors: RoutinePageCursorCodec)
	{
		this.persistence = persistence;
		this.cipher = cipher;
		this.ids = ids;
		this.cursors = cursors;
	}

	/** Creates one reviewed routine after encrypting its instruction outside the transaction. */
	async create(command: CreateRoutineCommand): Promise<RoutineCommandResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.destinationConversationId, "routine destination conversation");
		_Identifier(command.selectedManagedServiceId, "routine selected managed service");
		const instruction = _Instruction(command.instruction);
		const schedule = _Schedule(command.schedule);
		const idempotencyKey = _IdempotencyKey(command.idempotencyKey);
		const audienceParticipantRefs = _AudienceParticipantRefs(command.audienceParticipantRefs);
		const routineId = this.ids.routineId();
		const context = _InstructionContext(command.caller.siloId, command.destinationConversationId, command.caller.subjectId, routineId, 1);
		const envelope = await this.cipher.encrypt(instruction, context);
		const commandDigest = _CommandDigest({ operation: ProductAuthorizationActions.Create, destinationConversationId: command.destinationConversationId, selectedManagedServiceId: command.selectedManagedServiceId, audienceParticipantRefs, schedule, instructionDigest: _PlaintextDigest(instruction), idempotencyKey });
		return await this.persistence.create({ ...command, audienceParticipantRefs, idempotencyKey, schedule, instruction: envelope, routineId, revisionId: this.ids.revisionId(), commandReceiptId: this.ids.commandReceiptId(), commandDigest });
	}

	/** Returns a sparse page after decrypting and re-encrypting its caller-bound continuation. */
	async list(command: ListRoutinesCommand): Promise<RoutineListResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		const limit = _Limit(command.limit);
		const context = { caller: command.caller, endpoint: RoutinePageCursorEndpoints.Routines, routineId: null } as const;
		const after = command.cursor === undefined ? null : await this.cursors.decode(command.cursor, context);
		const page = await this.persistence.list({ caller: command.caller, limit, after });
		const nextCursor = page.next === null ? undefined : await this.cursors.encode(page.next, context);
		return { items: page.items, limit, ...(nextCursor === undefined ? {} : { nextCursor }) };
	}

	/** Returns one authorized routine's sparse firing history with a routine-bound continuation. */
	async firings(command: ListRoutineFiringsCommand): Promise<RoutineFiringListResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.routineId, "routine");
		const limit = _Limit(command.limit);
		const context = { caller: command.caller, endpoint: RoutinePageCursorEndpoints.Firings, routineId: command.routineId } as const;
		const after = command.cursor === undefined ? null : await this.cursors.decode(command.cursor, context);
		const page = await this.persistence.firings({ caller: command.caller, routineId: command.routineId, limit, after });
		const nextCursor = page.next === null ? undefined : await this.cursors.encode(page.next, context);
		return { items: page.items, limit, ...(nextCursor === undefined ? {} : { nextCursor }) };
	}

	/** Returns current destination participants and managed services without admitting an effect. */
	async creationOptions(command: RoutineCreationOptionsCommand): Promise<RoutineCreationOptionsResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.destinationConversationId, "routine destination conversation");
		return await this.persistence.creationOptions(command.caller, command.destinationConversationId);
	}

	/** Calculates five future slots from the database clock without admitting work. */
	async preview(command: RoutineSchedulePreviewCommand): Promise<RoutineSchedulePreviewResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		const schedule = _Schedule(command.schedule);
		const calculatedAt = await this.persistence.previewClock();
		const occurrences = __PreviewRoutineOccurrences(schedule, calculatedAt.getTime(), 5).map(epochMs => new Date(epochMs).toISOString());
		return { schedule, calculatedAt: calculatedAt.toISOString(), nextOccurrences: occurrences as [string, string, string, string, string] };
	}

	/** Returns the current routine only after transactional authorization and external decryption. */
	async read(command: ReadRoutineCommand): Promise<RoutineProjection | null>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.routineId, "routine");
		const encrypted = await this.persistence.read(command);
		if (encrypted === null)
		{
			return null;
		}
		const context = _InstructionContext(command.caller.siloId, encrypted.destinationConversationId, encrypted.requesterSubjectId, encrypted.routineId, encrypted.currentRevision);
		const instruction = await this.cipher.decrypt(encrypted.instruction, context);
		return { ...encrypted, instruction };
	}

	/** Appends one immutable schedule and encrypted-instruction revision. */
	async revise(command: ReviseRoutineCommand): Promise<RoutineCommandResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.routineId, "routine");
		_PositiveInteger(command.expectedRevision, "routine expected revision");
		_PositiveInteger(command.expectedLifecycleRevision, "routine expected lifecycle revision");
		const instruction = _Instruction(command.instruction);
		const schedule = _Schedule(command.schedule);
		const idempotencyKey = _IdempotencyKey(command.idempotencyKey);
		const revision = command.expectedRevision + 1;
		const current = await this.persistence.read({ caller: command.caller, routineId: command.routineId });
		if (current === null)
		{
			throw new RoutineCommandUnavailableError("routine is unavailable for revision");
		}
		const context = _InstructionContext(command.caller.siloId, current.destinationConversationId, current.requesterSubjectId, command.routineId, revision);
		const envelope = await this.cipher.encrypt(instruction, context);
		const commandDigest = _CommandDigest({ operation: RoutineLifecycleEvent.Revise, routineId: command.routineId, expectedRevision: command.expectedRevision, expectedLifecycleRevision: command.expectedLifecycleRevision, schedule, instructionDigest: _PlaintextDigest(instruction), idempotencyKey });
		return await this.persistence.revise({ ...command, idempotencyKey, schedule, instruction: envelope, revisionId: this.ids.revisionId(), commandReceiptId: this.ids.commandReceiptId(), commandDigest });
	}

	/** Pauses automatic work without changing the cursor or allowing catch-up. */
	pause(command: ChangeRoutineStatusCommand): Promise<RoutineCommandResult>
	{
		return this._ChangeStatus(command, RoutineLifecycleEvent.Pause);
	}

	/** Resumes automatic work from the database time of this command. */
	resume(command: ChangeRoutineStatusCommand): Promise<RoutineCommandResult>
	{
		return this._ChangeStatus(command, RoutineLifecycleEvent.Resume);
	}

	/** Stops new work permanently, retaining existing audience Read grants subject to current chat access. */
	retire(command: ChangeRoutineStatusCommand): Promise<RoutineCommandResult>
	{
		return this._ChangeStatus(command, RoutineLifecycleEvent.Retire);
	}

	/** Creates one immediate occurrence for an active or paused routine. */
	async runNow(command: RunRoutineNowCommand): Promise<RoutineFiringResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.routineId, "routine");
		_PositiveInteger(command.expectedLifecycleRevision, "routine expected lifecycle revision");
		const commandDigest = _CommandDigest({ operation: RoutineLifecycleEvent.RunNow, routineId: command.routineId, expectedLifecycleRevision: command.expectedLifecycleRevision, idempotencyKey: _IdempotencyKey(command.idempotencyKey) });
		return await this.persistence.runNow({ ...command, idempotencyKey: _IdempotencyKey(command.idempotencyKey), firingId: this.ids.firingId(), conversationId: this.ids.conversationId(), commandReceiptId: this.ids.commandReceiptId(), commandDigest });
	}

	/** Applies one requester lifecycle command through the transactional state owner. */
	private async _ChangeStatus(command: ChangeRoutineStatusCommand, event: RoutineLifecycleEvent): Promise<RoutineCommandResult>
	{
		_ValidateCaller(command.caller.authenticatedAt);
		_Identifier(command.routineId, "routine");
		_PositiveInteger(command.expectedLifecycleRevision, "routine expected lifecycle revision");
		const idempotencyKey = _IdempotencyKey(command.idempotencyKey);
		const commandDigest = _CommandDigest({ operation: event, routineId: command.routineId, expectedLifecycleRevision: command.expectedLifecycleRevision, idempotencyKey });
		return await this.persistence.changeStatus({ ...command, idempotencyKey, event, commandReceiptId: this.ids.commandReceiptId(), commandDigest });
	}
}

/** Builds instruction additional authenticated data from immutable product coordinates. */
function _InstructionContext(siloId: string, destinationConversationId: string, requesterSubjectId: string, routineId: string, routineRevision: number): RoutineInstructionContext
{
	return { siloId, destinationConversationId, requesterSubjectId, routineId, routineRevision };
}

/** Normalizes and bounds plaintext before it can reach the mounted cipher. */
function _Instruction(value: string): string
{
	const instruction = value.trim();
	if (instruction.length === 0 || instruction.length > _MAXIMUM_INSTRUCTION_LENGTH)
	{
		throw new RoutineCommandValidationError("routine instruction must contain between 1 and 20000 characters");
	}
	return instruction;
}

/** Normalizes and bounds a caller command key. */
function _IdempotencyKey(value: string): string
{
	const key = value.trim();
	if (key.length === 0 || key.length > 200)
	{
		throw new RoutineCommandValidationError("routine idempotency key must contain between 1 and 200 characters");
	}
	return key;
}

/** Copies the exact reviewed audience without silently adding or removing a Principal. */
function _AudienceParticipantRefs(value: readonly string[]): readonly string[]
{
	if (value.length === 0 || value.length > 100)
	{
		throw new RoutineCommandValidationError("routine audience must contain between 1 and 100 participants");
	}
	if (value.some(principalId => principalId.length === 0 || principalId.length > 200 || principalId.trim() !== principalId) || new Set(value).size !== value.length)
	{
		throw new RoutineCommandValidationError("routine audience must contain unique nonblank participant references");
	}
	return [...value].sort();
}

/** Bounds one database candidate window independently of transport coercion. */
function _Limit(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1 || value > 25)
		throw new RoutineCommandValidationError("routine page limit must be between 1 and 25");
	return value;
}

/** Requires a valid original authentication instant before retaining it as provenance. */
function _ValidateCaller(authenticatedAt: string): void
{
	if (!Number.isFinite(Date.parse(authenticatedAt)))
	{
		throw new RoutineCommandValidationError("routine caller authentication instant is invalid");
	}
}

/** Parses schedule input while keeping its detailed parser failure behind the command boundary. */
function _Schedule(value: RoutineSchedule): RoutineSchedule
{
	try
	{
		return __ParseRoutineSchedule(value);
	}
	catch
	{
		throw new RoutineCommandValidationError("routine schedule is invalid");
	}
}

/** Requires a nonblank identifier without changing the value used by persistence or digests. */
function _Identifier(value: string, name: string): void
{
	if (value.length === 0 || value.length > 200 || value.trim() !== value)
	{
		throw new RoutineCommandValidationError(`${name} identifier must contain between 1 and 200 characters without outer whitespace`);
	}
}

/** Requires a positive safe revision counter. */
function _PositiveInteger(value: number, name: string): void
{
	if (!Number.isSafeInteger(value) || value < 1)
	{
		throw new RoutineCommandValidationError(`${name} must be a positive safe integer`);
	}
}

/** Hashes plaintext without placing it in a command receipt or authorization payload. */
function _PlaintextDigest(value: string): `sha256:${string}`
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Produces the stable retry comparison digest for one normalized command. */
function _CommandDigest(value: unknown): `sha256:${string}`
{
	return ___DigestCanonicalJson(value as never);
}
