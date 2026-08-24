import { z } from "zod";

import { GroupMembershipAuthorities } from "@opencrane/contracts";

import type { GroupCreateCommand, GroupUpdateCommand } from "./groups.logic.types";

/** Accepts a complete group create command and rejects unknown public fields. */
export const ___GroupCreateWriteSchema: z.ZodType<GroupCreateCommand> = z.object({
	name: z.string().trim().min(1),
	membershipAuthority: z.nativeEnum(GroupMembershipAuthorities),
	parentId: z.string().trim().min(1).nullable().optional(),
	description: z.string().optional(),
	members: z.array(z.string().trim().min(1)).optional(),
}).strict();

/** Accepts mutable group fields while keeping membership authority immutable. */
export const ___GroupUpdateWriteSchema: z.ZodType<GroupUpdateCommand> = z.object({
	name: z.string().trim().min(1).optional(),
	parentId: z.string().trim().min(1).nullable().optional(),
	description: z.string().optional(),
	members: z.array(z.string().trim().min(1)).optional(),
}).strict();
