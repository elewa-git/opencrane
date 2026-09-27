import { createHash } from "node:crypto";

import { __ParseRoutineSchedule, type RoutineSchedule } from "@opencrane/models/agents";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ChangeRoutineStatusCommand, CreateRoutineCommand, ReadRoutineCommand, ReviseRoutineCommand, RoutineCommandResult, RoutineFiringResult, RoutineIdFactory, RoutineProjection, RunRoutineNowCommand } from "./routine-authority.types";
import { RoutineCommandUnavailableError, RoutineCommandValidationError } from "./routine-command.errors";
import type { RoutineInstructionCipher, RoutineInstructionContext } from "./routine-instruction.types";
import type { RoutineCommandPersistence } from "./routine-persistence.types";
import { RoutineLifecycleEvent } from "./routine-lifecycle.types";

/** Maximum plaintext size accepted before mounted encryption. */
const _MAXIMUM_INSTRUCTION_LENGTH = 20_000;

/** Coordinates command validation, mounted encryption, and transactional routine persistence. */
export class RoutineAuthority
{
	/** Transactional product authority that never receives plaintext. */
	private readonly persistence: RoutineCommandPersistence;
	/** Mounted AES-GCM adapter invoked only outside retryable database transactions. */
	private readonly cipher: RoutineInstructionCipher;
	/** Opaque id source invoked before retryable database transactions. */
	private readonly ids: RoutineIdFactory;

	/** Stores the persistence authority and external encryption boundary. */
	constructor(persistence: RoutineCommandPersistence, cipher: RoutineInstructionCipher, ids: RoutineIdFactory)
	{
		this.persistence = persistence;
		this.cipher = cipher;
		this.ids = ids;
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
		const audiencePrincipalIds = _AudiencePrincipalIds(command.audiencePrincipalIds, command.caller.principalId);
		const routineId = this.ids.routineId();
		const context = _InstructionContext(command.caller.siloId, command.destinationConversationId, command.caller.subjectId, routineId, 1);
		const envelope = await this.cipher.encrypt(instruction, context);
		const commandDigest = _CommandDigest({ operation: ProductAuthorizationActions.Create, destinationConversationId: command.destinationConversationId, selectedManagedServiceId: command.selectedManagedServiceId, audiencePrincipalIds, schedule, instructionDigest: _PlaintextDigest(instruction), idempotencyKey });
		return await this.persistence.create({ ...command, audiencePrincipalIds, idempotencyKey, schedule, instruction: envelope, routineId, revisionId: this.ids.revisionId(), commandReceiptId: this.ids.commandReceiptId(), commandDigest });
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
function _AudiencePrincipalIds(value: readonly string[], requesterPrincipalId: string): readonly string[]
{
	if (value.length === 0 || value.length > 100)
	{
		throw new RoutineCommandValidationError("routine audience must contain between 1 and 100 Principals");
	}
	if (value.some(principalId => principalId.length === 0 || principalId.length > 200 || principalId.trim() !== principalId) || new Set(value).size !== value.length)
	{
		throw new RoutineCommandValidationError("routine audience must contain unique nonblank Principal identifiers");
	}
	if (!value.includes(requesterPrincipalId))
	{
		throw new RoutineCommandValidationError("routine audience must include the original requester");
	}
	return [...value].sort();
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
