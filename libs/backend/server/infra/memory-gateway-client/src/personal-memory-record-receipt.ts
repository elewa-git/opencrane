import { z } from "zod";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import type { PersonalMemoryRecordReceipt } from "./memory-gateway-client.types";

/** Exact gateway receipt shape required before a workflow may record remote write evidence. */
const _PersonalMemoryRecordReceiptSchema: z.ZodType<PersonalMemoryRecordReceipt> = z.object({
	cogneeDatasetId: z.string().uuid(),
	cogneeDocumentId: z.string().uuid(),
	contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

/**
 * Thrown when the memory gateway's answer cannot be trusted as a valid response.
 *
 * Used in two places: a body that is not valid JSON (cognee-http.ts), and a search or write response
 * whose shape is unrecognised (cognee-payloads.ts and the check below). It is deliberately a failure
 * rather than an empty result — a broken contract must never look like "this subject has no facts"
 * or "the fact was stored". The message names only the check that failed, never the body.
 */
export class MemoryGatewayProtocolError extends Error
{
	/** Create an explicit protocol failure that callers must not reinterpret as an accepted fact. */
	constructor(message: string)
	{
		super(message);
		this.name = "MemoryGatewayProtocolError";
	}
}

/**
 * Protocol failure raised after an attempted mutation returned an unusable receipt.
 *
 * The gateway may have applied the operation before returning malformed evidence, so the existing
 * future durable workflow must reconcile it before another send. The serialized delivery state may
 * be stored with that workflow's recovery evidence; it never proves success.
 */
export class MemoryGatewayMutationProtocolError extends MemoryGatewayProtocolError
{
	/** Marks the failed attempt as unsafe to repeat without reconciliation. */
	readonly deliveryState = MemoryMutationDeliveryStates.Ambiguous;

	/** Creates an ambiguous protocol failure without retaining the response body. */
	constructor(message: string)
	{
		super(message);
		this.name = "MemoryGatewayMutationProtocolError";
	}
}

/**
 * Check an untrusted gateway write response and return its typed receipt.
 *
 * The receipt must carry the admitted Cognee dataset UUID, the Data/document UUID recovered in that
 * dataset, and a digest of the complete verified content. Unknown or missing fields are rejected.
 * This validates transport evidence only; it does not claim that the catalog adopted the fact or
 * that Cognee completed every index.
 *
 * Called by: no caller in this repo yet. Only __tests__/unavailable-memory-gateway-client.test.ts
 * exercises it; it is here ready for the write path that will replace the fail-closed
 * `recordPersonalFact`.
 *
 * @param value - Parsed but untrusted gateway response body.
 * @returns Dataset, document and digest evidence without a durable-completion claim.
 * @throws {MemoryGatewayMutationProtocolError} When the body is not the exact receipt shape. The
 *   error carries `MemoryMutationDeliveryStates.Ambiguous` because the remote effect may exist.
 */
export function __AssertPersonalMemoryRecordReceipt(value: unknown): PersonalMemoryRecordReceipt
{
	const receipt = _PersonalMemoryRecordReceiptSchema.safeParse(value);
	if (!receipt.success)
		throw new MemoryGatewayMutationProtocolError("Memory gateway returned invalid personal-memory record receipt");
	return receipt.data;
}
