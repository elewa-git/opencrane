import { ___GroupChildOriginSchema } from "@opencrane/models/conversations";
import type { GroupChildCreateCommand, GroupChildOrigin, GroupChildShareCommand } from "./group-child.types";

/** Rejects malformed retry keys before they select durable command coordinates. */
const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Parses an explicit message binding; a bare textual mention never starts work. */
export function _ParseGroupChildCreate(value: unknown): GroupChildCreateCommand | null
{
	if (!_Exact(value, ["parentMessageId", "parentMessagePosition", "agentServiceId", "idempotencyKey"]))
		return null;
	if (!_Uuid(value.parentMessageId) || !_Position(value.parentMessagePosition) || !_Identifier(value.agentServiceId) || !_Uuid(value.idempotencyKey))
		return null;
	return { parentMessageId: value.parentMessageId.toLowerCase(), parentMessagePosition: value.parentMessagePosition, agentServiceId: value.agentServiceId, idempotencyKey: value.idempotencyKey.toLowerCase() };
}

/** Accepts one bounded reviewed text and its exact child source position. */
export function _ParseGroupChildShare(value: unknown): GroupChildShareCommand | null
{
	if (!_Exact(value, ["sourceEntryId", "sourcePosition", "text", "idempotencyKey"]))
		return null;
	if (!_Uuid(value.sourceEntryId) || !_Position(value.sourcePosition) || !_Uuid(value.idempotencyKey) || typeof value.text !== "string" || !value.text.trim() || Buffer.byteLength(value.text, "utf8") > 65_536)
		return null;
	return { sourceEntryId: value.sourceEntryId.toLowerCase(), sourcePosition: value.sourcePosition, text: value.text, idempotencyKey: value.idempotencyKey.toLowerCase() };
}

/** Validates immutable child genesis without accepting self-parenting or malformed source coordinates. */
export function _ParseGroupChildOrigin(value: unknown, childConversationId: string): GroupChildOrigin | null
{
	const parsed = ___GroupChildOriginSchema.safeParse(value);
	return parsed.success && parsed.data.parentConversationId !== childConversationId ? parsed.data : null;
}

/** Requires every expected key and rejects undeclared authority or audience fields. */
function _Exact(value: unknown, keys: readonly string[]): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Checks an immutable identifier without normalizing its target. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value === value.trim() && value.length <= 256;
}

/** Checks UUID command and entry identifiers. */
function _Uuid(value: unknown): value is string { return typeof value === "string" && _UUID.test(value); }

/** Selects one non-genesis Kurrent revision without permitting overflow. */
function _Position(value: unknown): value is string
{
	return typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) < 18_446_744_073_709_551_615n;
}
