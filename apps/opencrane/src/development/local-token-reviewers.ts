import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { __CreateLocalAgentRuntimeTokenReviewer } from "@opencrane/backend/agents/runtime/controller";
import type { FixedServiceAccountTokenReviewer, RuntimeIdentityNamespaces, RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

/** Load a private launch secret and reject files that another local account could read. */
async function _ReadPrivateSecret(path: string): Promise<Buffer>
{
	if (!isAbsolute(path))
	{
		throw new Error("Tier 2 identity secret paths must be absolute");
	}

	const file = await stat(path);

	if (!file.isFile() || (file.mode & 0o077) !== 0)
	{
		throw new Error("Tier 2 identity secret files must use owner-only permissions");
	}

	const secret = Buffer.from((await readFile(path, "utf8")).trim());

	if (secret.length < 32)
	{
		throw new Error("Tier 2 identity secrets must contain at least 32 bytes");
	}

	return secret;
}

/** Compare bearer bytes without leaking where a supplied value first differs. */
function _MatchesSecret(supplied: string, expected: Buffer): boolean
{
	const candidate = Buffer.from(supplied);
	return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Build the controller reviewer from the coordinator's private per-launch bearer file. */
export async function _CreateDevelopmentControllerTokenReviewer(tokenPath: string, serverNamespace: string): Promise<FixedServiceAccountTokenReviewer>
{
	const expectedToken = await _ReadPrivateSecret(tokenPath);
	const username = `system:serviceaccount:${serverNamespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`;

	return {
		async __Review(token: string)
		{
			if (!_MatchesSecret(token, expectedToken))
			{
				return null;
			}

			return {
				username,
				namespace: serverNamespace,
				serviceAccountName: AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME,
				audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE]
			};
		}
	};
}

/** Build one reviewer for the personal and managed identities allowed by local runtime profiles. */
export function _CreateDevelopmentRuntimeTokenReviewer(launchSecretPath: string, namespaces: RuntimeIdentityNamespaces): RuntimeTokenReviewer
{
	const personal = __CreateLocalAgentRuntimeTokenReviewer({
		launchSecretPath,
		namespace: namespaces.personalRuntimeNamespace,
		serviceAccountName: "agent-runtime-default"
	});
	const managed = __CreateLocalAgentRuntimeTokenReviewer({
		launchSecretPath,
		namespace: namespaces.managedRuntimeNamespace,
		serviceAccountName: "managed-agent-runtime-default"
	});

	return {
		async __Review(token: string)
		{
			const personalIdentity = await personal.__Review(token);

			if (personalIdentity)
			{
				return personalIdentity;
			}

			return managed.__Review(token);
		}
	};
}
