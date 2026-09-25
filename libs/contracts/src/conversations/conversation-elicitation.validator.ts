import { z } from "zod";

import { McpCredentialRequirement } from "../mcp/mcp-operator.types";
import { ElicitationConnectionOwnerKinds, type ElicitationExecutionConnection } from "./conversation-elicitation.types";

/** Reject control characters that could conceal or reverse the displayed connection owner. */
const _UNSAFE_OWNER_LABEL = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** Require a nonblank label without modifying the server's saved disclosure. */
function _isOwnerLabel(value: string): boolean
{
	return value.trim().length > 0 && !_UNSAFE_OWNER_LABEL.test(value);
}

/**
 * Checks the connection disclosure at the server and browser boundaries.
 *
 * The model and validator change together so clients cannot discard or invent ownership fields.
 * Unknown fields are rejected to keep identifiers and credential coordinates out of this payload.
 * This validates display data, not the owner's permission to execute the action.
 */
export const ___ElicitationExecutionConnectionSchema: z.ZodType<ElicitationExecutionConnection> = z.object({
	ownerKind: z.nativeEnum(ElicitationConnectionOwnerKinds),
	ownerLabel: z.string().max(200).refine(_isOwnerLabel),
	credentialRequirement: z.nativeEnum(McpCredentialRequirement),
}).strict();
