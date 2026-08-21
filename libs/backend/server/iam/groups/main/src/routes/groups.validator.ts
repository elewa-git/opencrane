/**
 * Validates untrusted group request bodies before the router reaches persistence.
 * Typing these strict schemas against the route model makes accepted fields change with that model.
 */
import { z } from "zod";

import type { GroupWriteRequest } from "./groups.types";

/** Accepts a complete group create body and rejects unknown fields at the public HTTP boundary. */
export const ___GroupCreateWriteSchema: z.ZodType<GroupWriteRequest> = z.object({
	name: z.string().trim().min(1),
	scope: z.enum(["org", "department", "project", "personal"]),
	parentId: z.string().trim().min(1).nullable().optional(),
	description: z.string().optional(),
	members: z.array(z.string().trim().min(1)).optional(),
}).strict();

/** Accepts a partial group update while preserving the create contract's field validation. */
export const ___GroupUpdateWriteSchema: z.ZodType<Partial<GroupWriteRequest>> = z.object({
	name: z.string().trim().min(1).optional(),
	scope: z.enum(["org", "department", "project", "personal"]).optional(),
	parentId: z.string().trim().min(1).nullable().optional(),
	description: z.string().optional(),
	members: z.array(z.string().trim().min(1)).optional(),
}).strict();
