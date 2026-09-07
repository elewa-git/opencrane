import { z } from "zod";

// LiteLLM 1.81.0 returns some credential errors as HTTP 200. These schemas inspect the
// response status fields and strip other upstream metadata so it never enters our logs.
/** Confirms a successful mutation without accepting a conflicting error code. */
const _SUCCESS = z.object({ success: z.literal(true), code: z.never().optional() }).strip();
/** Reads the string HTTP code serialized by LiteLLM's returned ProxyException. */
const _ERROR = z.object({ code: z.string().regex(/^[45][0-9]{2}$/), success: z.never().optional() }).strip();

/**
 * Interprets the credential endpoint's explicit success or returned error response.
 *
 * @param value - Untrusted JSON from a successful HTTP response.
 * @returns 200 for confirmed success, or the error's HTTP code.
 * @throws A secret-free error when the response does not confirm either outcome.
 * @see https://github.com/BerriAI/litellm/blob/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm/proxy/credential_endpoints/endpoints.py
 */
export function _ParseLiteLlmCredentialMutationStatus(value: unknown): number
{
	if (_SUCCESS.safeParse(value).success)
		return 200;
	const error = _ERROR.safeParse(value);
	if (error.success)
		return Number(error.data.code);
	throw new Error("LiteLLM credential mutation returned an unrecognized response");
}
