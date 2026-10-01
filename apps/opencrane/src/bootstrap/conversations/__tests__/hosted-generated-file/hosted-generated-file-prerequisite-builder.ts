import { link, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PrismaClient } from "@prisma/client";
import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork } from "@opencrane/backend/server/iam/identity";

import { HostedGeneratedFilePublicClient } from "./hosted-generated-file-client";
import { __CreateHostedGeneratedFileFetch } from "./hosted-generated-file-transport";
import type { HostedGeneratedFilePrerequisites, HostedGeneratedFileQualificationConfig } from "./hosted-generated-file.types";

/** Build a fresh authenticated client without sharing either user's session cookie. */
export function __CreateHostedGeneratedFileSession(config: HostedGeneratedFileQualificationConfig): HostedGeneratedFilePublicClient
{
	return new HostedGeneratedFilePublicClient(config.baseUrl, config.oidcTransportBaseUrl, __CreateHostedGeneratedFileFetch(config.baseUrl, config.baseTransportAddress), config.timeoutMilliseconds);
}

/** Establish all product prerequisites through public owners and persist their four coordinates. */
export async function __PrepareHostedGeneratedFile(config: HostedGeneratedFileQualificationConfig): Promise<HostedGeneratedFilePrerequisites>
{
	const owner = __CreateHostedGeneratedFileSession(config);
	await owner.login({ subject: config.ownerOidcSubject, email: config.ownerOidcEmail });
	const invitationToken = await owner.inviteAdministrator(config.oidcEmail);

	const requester = __CreateHostedGeneratedFileSession(config);
	await requester.login({ subject: config.oidcSubject, email: config.oidcEmail });
	await requester.acceptInvitation(invitationToken);
	const expectedPrincipalId = await _ResolvePrincipal(config);
	await requester.configureOpenAiProvider(config.timeoutMilliseconds);
	const providerCredentialId = await requester.openAiProviderCredentialId();
	const expectedModelDefinitionId = await requester.createModelDefinition(config.siloId, config.providerApiBaseUrl, providerCredentialId, config.timeoutMilliseconds);
	await requester.setTenantModelDefault(config.siloId);
	await requester.completePersona();
	await requester.completeOnboarding();
	const personalAgentRef = await requester.personalAgentRef();
	const prerequisites = { personalAgentRef, expectedModelDefinitionId, expectedPrincipalId, expectedSiloId: config.siloId };
	await _WriteExclusive(config.prerequisitesPath, prerequisites);
	return prerequisites;
}

/** Resolve only the authenticated Principal coordinate and always release the database client. */
async function _ResolvePrincipal(config: HostedGeneratedFileQualificationConfig): Promise<string>
{
	if (config.databaseUrl === null || config.databaseUrl.trim() === "")
		throw new Error("OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL is required for Principal resolution");
	const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
	try
	{
		const principal = await new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma).resolveAuthenticatedPrincipal(config.siloId, config.oidcIssuer, config.oidcSubject);
		return __HostedGeneratedFilePrincipalId(principal, config.siloId);
	}
	finally
	{
		await prisma.$disconnect();
	}
}

/** Accept only the Principal returned for the deployment's exact authenticated silo. */
export function __HostedGeneratedFilePrincipalId(principal: { readonly principalId: string; readonly siloId: string } | null, expectedSiloId: string): string
{
	if (principal === null || principal.siloId !== expectedSiloId || principal.principalId.length === 0)
		throw new Error("Hosted requester Principal does not match the configured OIDC identity and silo");
	return principal.principalId;
}

/** Atomically create the strict prerequisite file without replacing prior evidence. */
async function _WriteExclusive(path: string, prerequisites: HostedGeneratedFilePrerequisites): Promise<void>
{
	const temporary = join(dirname(path), `.hosted-generated-file-prerequisites-${process.pid}-${Date.now()}.json`);
	await writeFile(temporary, `${JSON.stringify(prerequisites, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
	try
	{
		await link(temporary, path);
	}
	finally
	{
		await unlink(temporary).catch(function _IgnoreMissingTemporary() {});
	}
}
