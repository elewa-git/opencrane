import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { LocalAgentRuntimeTokenReviewer, LocalAgentRuntimeTokenReviewerOptions } from "./local-process-agent-controller-store.types";

/** Version prefix that makes future token formats fail closed instead of parsing ambiguously. */
const _TOKEN_VERSION = "ocr-local-runtime-v1";

/** Read and bound the local-session launch secret without returning empty material. */
async function _LaunchSecret(path: string): Promise<string>
{
	const secret = (await readFile(path, "utf8")).trim();

	if (secret.length < 32)
	{
		throw new Error("local runtime launch secret must contain at least 32 characters");
	}

	return secret;
}

/** Return the signed bytes that bind fixed identity coordinates to one attempt process. */
function _Signature(secret: string, namespace: string, serviceAccountName: string, podUid: string): Buffer
{
	const payload = `${_TOKEN_VERSION}\0${namespace}\0${serviceAccountName}\0${podUid}`;
	return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/** Create one per-attempt bearer for the local runtime process. */
export async function _CreateLocalAgentRuntimeToken(options: LocalAgentRuntimeTokenReviewerOptions, podUid: string): Promise<string>
{
	const secret = await _LaunchSecret(options.launchSecretPath);
	const signature = _Signature(secret, options.namespace, options.serviceAccountName, podUid);
	return `${_TOKEN_VERSION}.${podUid}.${signature.toString("base64url")}`;
}

/**
 * Create the development runtime reviewer used in place of Kubernetes TokenReview.
 *
 * The launch secret remains in its private file. A token authenticates one generated Pod UID and
 * fixed namespace/ServiceAccount pair, so copying another attempt's token cannot claim the current
 * registered process identity. The existing runtime authority still binds the returned coordinates
 * to the durable assignment. Production server composition never imports this development helper.
 *
 * Called by: the OpenCrane Tier 2 development runtime composition.
 * @param options - Secret path and fixed local runtime identity coordinates.
 * @returns A reviewer compatible with the existing runtime stream token-review port.
 * @throws At construction when the secret path or identity coordinates are not explicit.
 */
export function __CreateLocalAgentRuntimeTokenReviewer(options: LocalAgentRuntimeTokenReviewerOptions): LocalAgentRuntimeTokenReviewer
{
	if (!isAbsolute(options.launchSecretPath) || !options.namespace || !options.serviceAccountName)
	{
		throw new Error("local runtime token reviewer requires an absolute secret path and fixed identity");
	}

	return {
		async __Review(token: string)
		{
			const parts = token.split(".");

			if (parts.length !== 3 || parts[0] !== _TOKEN_VERSION || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[1] ?? ""))
			{
				return null;
			}

			const supplied = Buffer.from(parts[2] ?? "", "base64url");
			const secret = await _LaunchSecret(options.launchSecretPath);
			const expected = _Signature(secret, options.namespace, options.serviceAccountName, parts[1]);

			if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
			{
				return null;
			}

			return {
				subject: `system:serviceaccount:${options.namespace}:${options.serviceAccountName}`,
				namespace: options.namespace,
				serviceAccountName: options.serviceAccountName,
				podUid: parts[1]
			};
		}
	};
}
