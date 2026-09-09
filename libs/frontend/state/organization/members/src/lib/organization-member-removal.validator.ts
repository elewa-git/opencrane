// The adapter validates server-authored removal capability beside its in-memory model so unknown states never enable a control.
import { z } from "zod";

import { OrganizationMemberRemovalReasons, OrganizationMemberRemovalStates, type OrganizationMemberRemoval } from "./organization-member-directory.types";

/** Rejects unknown capability states, reasons and fields before a view can offer removal. */
export const ___OrganizationMemberRemovalSchema: z.ZodType<OrganizationMemberRemoval> = z.discriminatedUnion("state", [
	z.object({ state: z.literal(OrganizationMemberRemovalStates.Available) }).strict(),
	z.object({ state: z.literal(OrganizationMemberRemovalStates.Unavailable), reason: z.nativeEnum(OrganizationMemberRemovalReasons) }).strict()
]);
