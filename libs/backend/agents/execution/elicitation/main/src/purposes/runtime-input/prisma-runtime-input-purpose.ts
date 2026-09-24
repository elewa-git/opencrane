import type { Prisma } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { ElicitationResponseValue } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { ElicitationPurposeRequest, ElicitationPurposeStrategy } from "../elicitation-purpose.types";

/**
 * Saves ordinary participant input for delivery to the paused run.
 * Expiry creates an empty delivery so the runtime can observe that the question ended.
 */
export class PrismaRuntimeInputPurposeAuthority implements ElicitationPurposeStrategy
{
	/** Use the transaction that owns the request and its response. */
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Persist one validated ordinary runtime response. */
	public async apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>
	{
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload: response as unknown as Prisma.InputJsonValue, payloadDigest: __DigestCanonicalJson(response as unknown as JsonValue) } });
		return true;
	}

	/** Publish an empty terminal delivery for runtime-visible expiry. */
	public async expire(request: ElicitationPurposeRequest): Promise<void>
	{
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id } });
	}

}
