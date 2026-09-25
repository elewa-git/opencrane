import { z } from "zod";
import { ConversationModelPreForwardContracts } from "@opencrane/contracts";

import type { ConversationModelProxyQualification } from "./conversation-model-proxy.types";

/**
 * Validates deployment-supplied qualification beside its model. The composer emits these fields
 * only for its managed, digest-pinned image. A custom endpoint or an incoming header cannot qualify
 * a proxy. This parser rejects partial configuration instead of silently changing retry semantics.
 */

/** Recognizes release-owned Service origins without accepting credentials, paths or external hosts. */
function _managedOrigin(value: string): boolean
{
	try
	{
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) && url.origin === value
			&& /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?-litellm(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.svc(?:\.cluster\.local)?)?$/u.test(url.hostname);
	}
	catch { return false; }
}

/** Rejects unknown versions and destinations outside the managed Service naming contract. */
export const _ConversationModelProxyQualificationSchema: z.ZodType<ConversationModelProxyQualification> = z.object({
	origin: z.string().max(512).refine(_managedOrigin),
	contract: z.literal(ConversationModelPreForwardContracts.V1),
}).strict();

/**
 * Freezes qualification at server composition. An absent pair keeps all failures non-retryable.
 * @throws Error with no configuration values when the pair is incomplete or the endpoint differs.
 */
export function _ReadConversationModelProxyQualification(environment: Readonly<Record<string, string | undefined>>): ConversationModelProxyQualification | null
{
	const contract = environment["LITELLM_PREFORWARD_CONTRACT"];
	const endpoint = environment["LITELLM_PREFORWARD_ENDPOINT"];
	if (!contract && !endpoint)
		return null;
	try
	{
		const qualification = _ConversationModelProxyQualificationSchema.parse({ contract, origin: new URL(endpoint ?? "").origin });
		const configured = new URL(environment["LITELLM_ENDPOINT"] ?? "");
		if (new URL(endpoint ?? "").href !== `${qualification.origin}/` || configured.href !== `${qualification.origin}/`)
			throw new Error("Model proxy qualification does not match the configured origin");
		return Object.freeze(qualification);
	}
	catch
	{
		throw new Error("Model proxy qualification is invalid");
	}
}
