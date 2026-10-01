import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ___ConversationModelPreForwardEnvelopeSchema, ConversationModelResponseKinds, type ConversationModelResponse } from "@opencrane/contracts";
import { ___CanonicalizeJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";

import { ConversationModelError, ConversationModelFailureCodes, type PreparedConversationModelRequest } from "../core/conversation-model.types";
import type { ConversationModelProxyQualification } from "./conversation-model-proxy.types";

/** Caps proof envelopes independently of model answers and tool declarations. */
export const _CONVERSATION_MODEL_RECEIPT_MAX_BYTES = 2048;

/**
 * Adds private request coordinates only for a proxy qualified by server composition. They are not
 * model fields, and the producer must remove them before any provider or callback receives input.
 * @see https://www.rfc-editor.org/rfc/rfc6648 — these are private, unregistered HTTP headers.
 */
export function _ConversationModelDeliveryHeaders(prepared: PreparedConversationModelRequest, qualification: ConversationModelProxyQualification | null): Record<string, string>
{
	if (qualification === null || prepared.delivery === undefined)
		return {};
	if (qualification.origin !== prepared.url.origin)
		throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
	return {
		"x-opencrane-preforward-contract": qualification.contract,
		"x-opencrane-request-nonce": prepared.delivery.physicalNonce,
		"x-opencrane-logical-fence": prepared.delivery.logicalFence,
		"x-opencrane-request-deadline": String(prepared.deadlineEpochMs),
	};
}

/**
 * Authenticates a closed rejection envelope for this physical send. The existing attempt key is
 * domain-separated for receipt authentication; it is never saved or returned with the proof.
 * This relies on the existing private bearer-authenticated connection, not protection from an
 * attacker who can read that connection. Status codes and provider usage never substitute for proof.
 * @throws ConversationModelError when any binding, encoding, time or authentication check fails.
 * @see https://www.rfc-editor.org/rfc/rfc2104 — the keyed message authentication construction.
 */
export function _VerifyConversationModelReceipt(text: string, authentication: string | null, prepared: PreparedConversationModelRequest, qualification: ConversationModelProxyQualification): ConversationModelResponse
{
	try
	{
		if (prepared.delivery === undefined || qualification.origin !== prepared.url.origin || authentication === null || !/^[0-9a-f]{64}$/u.test(authentication))
			throw new Error("Invalid receipt authentication");
		const envelope = ___ParseAndValidateJson(text, "Model proxy receipt", function _validate(candidate)
		{
			return ___ConversationModelPreForwardEnvelopeSchema.parse(candidate);
		});
		const receipt = envelope.receipt;
		if (receipt.version !== qualification.contract || receipt.physicalNonce !== prepared.delivery.physicalNonce
			|| receipt.logicalFence !== prepared.delivery.logicalFence || receipt.deadlineEpochMs !== prepared.deadlineEpochMs
			|| receipt.requestBodySha256 !== createHash("sha256").update(prepared.body).digest("hex")
			|| receipt.retryAtEpochMs <= prepared.preparedAtEpochMs || Date.now() >= receipt.deadlineEpochMs)
			throw new Error("Receipt does not match this request");
		const key = createHmac("sha256", prepared.authorization.slice(7)).update("opencrane:preforward-receipt:key:v1").digest();
		const canonical = ___CanonicalizeJson(receipt as unknown as JsonValue);
		const expected = createHmac("sha256", key).update("opencrane:preforward-receipt:message:v1\0").update(canonical).digest();
		if (!timingSafeEqual(expected, Buffer.from(authentication, "hex")))
			throw new Error("Invalid receipt authentication");
		return { kind: ConversationModelResponseKinds.PreForwardRejected, receipt };
	}
	catch
	{
		throw new ConversationModelError(ConversationModelFailureCodes.HttpRejected);
	}
}
