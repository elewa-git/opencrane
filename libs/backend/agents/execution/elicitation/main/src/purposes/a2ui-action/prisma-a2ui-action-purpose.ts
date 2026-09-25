import type { Prisma } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { ElicitationResponseValue } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _Record } from "../../elicitation-prisma-mapping";
import type { ElicitationPurposeRequest, ElicitationPurposeStrategy } from "../elicitation-purpose.types";

/**
 * Attaches the response to the action coordinates saved by the server.
 * The submitted response cannot replace the displayed action, component or action digest.
 */
export class PrismaA2uiActionPurposeAuthority implements ElicitationPurposeStrategy
{
	/** Use the transaction that owns the request and its response. */
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Bind a display-only A2UI answer back to server-owned action coordinates. */
	public async apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>
	{
		if (!_Record(request.purposePayload) || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest)
			return false;
		const displayedActionId = request.purposePayload["displayedActionId"];
		const sourceComponentId = request.purposePayload["sourceComponentId"];
		const actionDigest = request.purposePayload["actionDigest"];
		if (typeof displayedActionId !== "string" || displayedActionId.length === 0 || typeof sourceComponentId !== "string" || sourceComponentId.length === 0 || typeof actionDigest !== "string" || actionDigest.length === 0)
			return false;
		const payload = { kind: "a2ui_action", displayedActionId, sourceComponentId, actionDigest, response };
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload, payloadDigest: __DigestCanonicalJson(payload) } });
		return true;
	}

	/** Publish an empty terminal delivery for runtime-visible expiry. */
	public async expire(request: ElicitationPurposeRequest): Promise<void>
	{
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id } });
	}

}
