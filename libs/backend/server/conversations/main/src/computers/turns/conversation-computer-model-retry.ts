import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "./conversation-computer-model-retry.types";
import { _ConversationComputerModelRejectionSchema, _ConversationComputerModelRetryClaimSchema } from "./conversation-computer-model-retry.validator";
import { ConversationComputerTurnProtocolStates } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnModelReservation, ConversationComputerTurnProtocolProjection } from "./conversation-computer-turn-protocol.types";

/** Bounds physical retries within the original logical request, allowance and deadline. */
export const _CONVERSATION_MODEL_MAX_RETRIES = 2;

/** Binds proxy proof to the complete original reservation with a separate hash domain. */
export function _ConversationModelLogicalFence(reservation: ConversationComputerTurnModelReservation): string
{
	return ___DigestCanonicalJson({ domain: "opencrane.conversation-model.logical-fence.v1", reservation } as unknown as JsonValue).slice("sha256:".length);
}

/** Identifies the first physical request without giving a recovery pass permission to send it. */
export function _ConversationModelInitialNonce(reservation: ConversationComputerTurnModelReservation): string
{
	return ___DigestCanonicalJson({ domain: "opencrane.conversation-model.initial-nonce.v1", reservation } as unknown as JsonValue).slice("sha256:".length);
}

/**
 * Saves authenticated no-forward evidence without changing logical work or consumed allowance.
 *
 * Called by: the exhaustive turn reducer after the transport has authenticated a receipt.
 * Replay checks continuity only; it cannot reconstruct cryptographic authentication or dispatch.
 */
export function _RejectConversationModel(projection: ConversationComputerTurnProtocolProjection, value: ConversationComputerModelRejection): ConversationComputerTurnProtocolProjection
{
	const rejection = _ConversationComputerModelRejectionSchema.parse(value);
	const current = projection.steps.at(-1);
	const previous = projection.modelRetry;
	const receipt = rejection.receipt;
	if (projection.state !== ConversationComputerTurnProtocolStates.ModelReserved || current?.state !== ConversationComputerTurnProtocolStates.ModelReserved
		|| receipt.logicalFence !== _ConversationModelLogicalFence(current.reservation)
		|| receipt.deadlineEpochMs !== current.reservation.dispatchDeadlineEpochMs
		|| rejection.receivedAtEpochMs >= receipt.deadlineEpochMs || Date.parse(rejection.credentialExpiresAt) < receipt.deadlineEpochMs)
		throw new Error("Conversation computer model rejection crossed its original reservation");
	if (previous === null)
	{
		if (receipt.physicalNonce !== _ConversationModelInitialNonce(current.reservation))
			throw new Error("Conversation computer model rejection differs from its initial physical request");
	}
	else
	{
		const first = previous.rejections[0];
		const claim = previous.claim;
		if (first === undefined || previous.rejections.length > _CONVERSATION_MODEL_MAX_RETRIES || claim === null
			|| claim.retryOrdinal !== previous.rejections.length || claim.ordinal !== current.reservation.ordinal || claim.modelInvocationFence !== current.reservation.invocationFence
			|| receipt.physicalNonce !== claim.physicalNonce || rejection.receivedAtEpochMs < claim.claimedAtEpochMs || receipt.retryAtEpochMs < claim.claimedAtEpochMs
			|| receipt.requestBodySha256 !== first.receipt.requestBodySha256 || rejection.credentialDigest !== first.credentialDigest || rejection.credentialExpiresAt !== first.credentialExpiresAt)
			throw new Error("Conversation computer model rejection crossed its saved retry claim");
	}
	return { ...projection, state: ConversationComputerTurnProtocolStates.ModelRetryWaiting, revision: projection.revision + 1n, modelRetry: { rejections: [...previous?.rejections ?? [], rejection], claim: previous?.claim ?? null } };
}

/**
 * Records one fresh physical nonce after the saved reset without renewing any model authority.
 *
 * Called by: the turn reducer for replay and before a conditional append. The reducer's result is
 * never dispatch permission; only the store's own acknowledged append can return that permission.
 */
export function _ClaimConversationModelRetry(projection: ConversationComputerTurnProtocolProjection, value: ConversationComputerModelRetryClaim): ConversationComputerTurnProtocolProjection
{
	const claim = _ConversationComputerModelRetryClaimSchema.parse(value);
	const current = projection.steps.at(-1);
	const retry = projection.modelRetry;
	const latest = retry?.rejections.at(-1);
	if (projection.state !== ConversationComputerTurnProtocolStates.ModelRetryWaiting || current?.state !== ConversationComputerTurnProtocolStates.ModelReserved
		|| retry === null || latest === undefined || claim.ordinal !== current.reservation.ordinal || claim.modelInvocationFence !== current.reservation.invocationFence
		|| claim.retryOrdinal !== retry.rejections.length || claim.retryOrdinal > _CONVERSATION_MODEL_MAX_RETRIES
		|| (retry.claim?.retryOrdinal ?? 0) !== claim.retryOrdinal - 1
		|| retry.rejections.some(rejection => rejection.receipt.physicalNonce === claim.physicalNonce)
		|| claim.claimedAtEpochMs < latest.receivedAtEpochMs || claim.claimedAtEpochMs < latest.receipt.retryAtEpochMs
		|| claim.claimedAtEpochMs >= current.reservation.dispatchDeadlineEpochMs || claim.claimedAtEpochMs >= Date.parse(latest.credentialExpiresAt))
		throw new Error("Conversation computer model retry crossed its saved rejection or deadline");
	return { ...projection, state: ConversationComputerTurnProtocolStates.ModelReserved, revision: projection.revision + 1n, modelRetry: { ...retry, claim } };
}
