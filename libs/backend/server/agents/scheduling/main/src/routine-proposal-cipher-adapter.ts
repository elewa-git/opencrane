import { ___RequestRoutineSuggestionSchema, type RequestRoutineSuggestion } from "@opencrane/backend/server/agents/scheduling/contract";

import type { RoutineInstructionPayloadCipher, RoutineInstructionPayloadCoordinates } from "./routine-instruction-cipher-adapter.types";
import { _ParseRoutineInstructionEnvelope } from "./routine-instruction-cipher-adapter.validator";
import type { RoutineInstructionEnvelope } from "./routine-instruction.types";
import type { RoutineProposalCipher, RoutineProposalCipherContext } from "./routine-proposal.types";

/** Purpose-separated namespace for encrypted suggestions awaiting human review. */
const _ROUTINE_PROPOSAL_PURPOSE = "opencrane:routine-proposal:v1";

/** Uses the mounted rotating payload cipher without sharing routine-instruction authenticated data. */
export class RoutineProposalCipherAdapter implements RoutineProposalCipher
{
	public constructor(private readonly payloadCipher: RoutineInstructionPayloadCipher) {}

	/** @inheritdoc */
	public async encrypt(suggestion: RequestRoutineSuggestion, context: RoutineProposalCipherContext): Promise<RoutineInstructionEnvelope>
	{
		const validated = ___RequestRoutineSuggestionSchema.parse(suggestion);
		const encrypted = this.payloadCipher.encrypt(JSON.stringify(validated), _Coordinates(context));
		return _ParseRoutineInstructionEnvelope(encrypted);
	}

	/** @inheritdoc */
	public async decrypt(envelope: RoutineInstructionEnvelope, context: RoutineProposalCipherContext): Promise<RequestRoutineSuggestion>
	{
		const plaintext = this.payloadCipher.decrypt(_ParseRoutineInstructionEnvelope(envelope), _Coordinates(context));
		let decoded: unknown;
		try
		{
			decoded = JSON.parse(plaintext);
		}
		catch
		{
			throw new Error("Routine proposal plaintext is invalid");
		}
		const parsed = ___RequestRoutineSuggestionSchema.safeParse(decoded);
		if (!parsed.success)
		{
			throw new Error("Routine proposal plaintext is invalid");
		}
		return parsed.data;
	}
}

/** Binds ciphertext to its distinct purpose and immutable owner coordinates. */
function _Coordinates(context: RoutineProposalCipherContext): RoutineInstructionPayloadCoordinates
{
	return {
		siloId: context.siloId,
		conversationId: context.sourceConversationId,
		authorSubject: context.requesterPrincipalId,
		payloadRef: JSON.stringify([_ROUTINE_PROPOSAL_PURPOSE, context.proposalId]),
	};
}
