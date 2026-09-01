import { z } from "zod";

import { LocalDevelopmentProfileKinds } from "./local-development-profile.types";

/** Validates untrusted process values against the shared Tier 2 profile vocabulary. */
const LocalDevelopmentProfileKindSchema = z.nativeEnum(LocalDevelopmentProfileKinds);

/**
 * Parses an untrusted process value against the profile set shared by the Tier 2 server and
 * controller. Callers reject null before choosing adapters, so an unknown value never falls back to
 * a more capable composition.
 *
 * Called by: `_ReadDevelopmentConfig` in the OpenCrane server and local Agent controller.
 * @param value - Environment value to validate.
 * @returns The matching profile, or null when the value is outside the closed set.
 */
export function __ParseLocalDevelopmentProfileKind(value: unknown): LocalDevelopmentProfileKinds | null
{
	const result = LocalDevelopmentProfileKindSchema.safeParse(value);
	return result.success ? result.data : null;
}
