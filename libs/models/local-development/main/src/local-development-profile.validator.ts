import { z } from "zod";

import { LocalDevelopmentProfileKinds } from "./local-development-profile.types";

/** Validates untrusted process values against the shared Tier 2 profile vocabulary. */
export const LocalDevelopmentProfileKindSchema = z.nativeEnum(LocalDevelopmentProfileKinds);

/** Parses one untrusted process value into a supported Tier 2 profile or returns null. */
export function __ParseLocalDevelopmentProfileKind(value: unknown): LocalDevelopmentProfileKinds | null
{
	const result = LocalDevelopmentProfileKindSchema.safeParse(value);
	return result.success ? result.data : null;
}
