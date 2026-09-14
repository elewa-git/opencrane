import { _AuditCursorPayloadSchema } from "./audit-cursor.validator";
import type { AuditCursorPayload, AuditPageCursor } from "./audit.types";

/** Matches the canonical unpadded base64url form emitted by Node. */
const _BASE64URL = /^[A-Za-z0-9_-]+$/u;
/** Maximum opaque cursor length accepted before allocating its decoded payload. */
export const _AUDIT_CURSOR_MAX_LENGTH = 512;

/** Encodes both coordinates required to resume the audit catalogue order. */
export function _EncodeAuditCursor(cursor: AuditPageCursor): string
{
	const payload: AuditCursorPayload = { timestamp: cursor.timestamp.toISOString(), id: cursor.id };
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decodes a canonical cursor and rejects partial, malformed, or extra coordinates. */
export function _DecodeAuditCursor(encoded: string): AuditPageCursor | null
{
	if (encoded.length > _AUDIT_CURSOR_MAX_LENGTH || !_BASE64URL.test(encoded))
		return null;

	const bytes = Buffer.from(encoded, "base64url");
	if (bytes.toString("base64url") !== encoded)
		return null;

	try
	{
		const value: unknown = JSON.parse(bytes.toString("utf8"));
		const parsed = _AuditCursorPayloadSchema.safeParse(value);
		return parsed.success ? { timestamp: new Date(parsed.data.timestamp), id: parsed.data.id } : null;
	}
	catch
	{
		return null;
	}
}
