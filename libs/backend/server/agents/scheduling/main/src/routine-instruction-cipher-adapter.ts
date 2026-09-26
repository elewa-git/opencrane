import type { RoutineInstructionCipher, RoutineInstructionContext, RoutineInstructionEnvelope } from "./routine-instruction.types";
import type { RoutineInstructionPayloadCipher, RoutineInstructionPayloadCoordinates } from "./routine-instruction-cipher-adapter.types";
import { _ParseRoutineInstructionContext, _ParseRoutineInstructionEnvelope } from "./routine-instruction-cipher-adapter.validator";

/** Separates routine instructions from every other payload encrypted by the shared cipher. */
const _ROUTINE_INSTRUCTION_PURPOSE = "opencrane:routine-instruction:v1";

/** Adapts the server's rotating payload cipher without importing conversation authority. */
export class RoutineInstructionCipherAdapter implements RoutineInstructionCipher
{
	/** Stores the mounted cipher that owns encryption details and key rotation. */
	public constructor(private readonly payloadCipher: RoutineInstructionPayloadCipher) {}

	/** @inheritdoc */
	public async encrypt(plaintext: string, context: RoutineInstructionContext): Promise<RoutineInstructionEnvelope>
	{
		const validatedContext = _ParseRoutineInstructionContext(context);
		const coordinates = _Coordinates(validatedContext);
		const encrypted = this.payloadCipher.encrypt(plaintext, coordinates);
		return _ParseRoutineInstructionEnvelope(encrypted);
	}

	/** @inheritdoc */
	public async decrypt(envelope: RoutineInstructionEnvelope, context: RoutineInstructionContext): Promise<string>
	{
		const validatedContext = _ParseRoutineInstructionContext(context);
		const validatedEnvelope = _ParseRoutineInstructionEnvelope(envelope);
		const coordinates = _Coordinates(validatedContext);
		return this.payloadCipher.decrypt(validatedEnvelope, coordinates);
	}
}

/** Maps validated routine ownership into purpose-separated authenticated coordinates. */
function _Coordinates(context: RoutineInstructionContext): RoutineInstructionPayloadCoordinates
{
	const payloadRef = JSON.stringify([_ROUTINE_INSTRUCTION_PURPOSE, context.routineId, context.routineRevision]);
	return { siloId: context.siloId, conversationId: context.destinationConversationId, authorSubject: context.requesterSubjectId, payloadRef };
}
