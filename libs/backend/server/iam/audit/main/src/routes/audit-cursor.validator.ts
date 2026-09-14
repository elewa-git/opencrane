import { z } from "zod";

import type { AuditCursorPayload } from "./audit.types";

/** Largest identifier PostgreSQL can store for the audit table's SERIAL primary key. */
const _MAX_AUDIT_ENTRY_ID = 2_147_483_647;

/** Checks that a cursor timestamp has the same canonical ISO form the encoder emits. */
function _IsCanonicalTimestamp(value: string): boolean
{
	const timestamp = new Date(value);
	return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

/** Validates untrusted decoded cursor data before the route passes it to the catalogue. */
export const _AuditCursorPayloadSchema: z.ZodType<AuditCursorPayload> = z.object({ timestamp: z.string().refine(_IsCanonicalTimestamp), id: z.number().int().positive().max(_MAX_AUDIT_ENTRY_ID) }).strict();
