import { z, type ZodType } from "zod";

import type { CogneeProviderCredentials, CogneeProviderLoginResponse } from "./cognee-provider-session.types";

/** Mounted credentials cross a file boundary before reaching this strict service-user model. */
const _CredentialSchema: ZodType<CogneeProviderCredentials> = z.object({
	email: z.string().email().max(320),
	password: z.string().min(1).max(4_096),
}).strict();

/** Cognee login JSON is untrusted provider data and must match the pinned response exactly. */
const _LoginResponseSchema = z.object({
	access_token: z.string().min(1).max(65_536).regex(/^[A-Za-z0-9._~+/-]+={0,2}$/u),
	token_type: z.literal("bearer"),
}).strict();

/** Return validated mounted credentials without exposing Zod's value-bearing errors. */
export function _ParseCogneeProviderCredentials(value: unknown): CogneeProviderCredentials | null
{
	const result = _CredentialSchema.safeParse(value);
	if (!result.success)
		return null;
	return result.data;
}

/** Return the ephemeral bearer from an exact pinned login response. */
export function _ParseCogneeProviderLoginResponse(value: unknown): CogneeProviderLoginResponse | null
{
	const result = _LoginResponseSchema.safeParse(value);
	if (!result.success)
		return null;
	return { accessToken: result.data.access_token };
}
