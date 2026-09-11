import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AesGcmConversationPrivatePayloadCipher, PrismaConversationComputerCredentialUnitOfWork } from "@opencrane/backend/server/conversations";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";

import type { ConversationComputerReleaseProfileConfig, OpenCraneWorkflowConfig } from "../app/config.types";
import { _StartConversationComputerActivationConsumer } from "../app/conversation-computer-activation-composition";
import { _CreateConversationComputerTurnAuthority } from "../app/conversation-computer-turn-composition";
import { _ReadConversationPrivatePayloadKeyring } from "../app/conversation-history-composition";
import { _CreateHistoryStoreComposition } from "../app/history-store-composition";
import { _AssertHistoryStoreSilo } from "../app/history-store-silo-guard";
import { _log } from "../app/log";
import { _CreateMcpWorkflowComposition } from "../app/mcp-workflow-composition";
import { _CreateOrganizationMembersComposition } from "../app/organization-members-composition";
import { _CreateProductionConversationRunAdmission } from "../app/run-admission-composition";
import { _CreateArtifactUploadGateway } from "../infra/artifacts/artifact-upload.factory";
import { ___CreateDbHealthProbe, ___CreatePrismaClient } from "../infra/db/db";
import { _CreatePublicHealthReportReader } from "../infra/health/public-health";
import type { DevelopmentConversationComputerSupervisor, DevelopmentServerComposition } from "./composition.types";
import type { DevelopmentConfig } from "./config.types";
import { DevelopmentProfileKinds } from "./config.types";
import { _CreateHostDevelopmentConversationComputerRealization } from "./conversation-computer-host-realizer";
import { HostDevelopmentConversationComputerSupervisor } from "./conversation-computer-host-supervisor";
import { _RethrowAfterDevelopmentCleanup } from "./cleanup";
import { _CreateHostDevelopmentConversationComputerPrivateApp } from "./conversation-computer-private-app";
import { _StartDevelopmentConversationComputerLifecycle } from "./conversation-computer-lifecycle";
import { DevelopmentConversationComputerRuntime } from "./conversation-computer-runtime";
import { _CreateDevelopmentPublicApp } from "./public-app";
import { DeterministicDevelopmentConversationModelTransport, DevelopmentConversationComputerCredentialIssuer } from "./simulated-conversation-model";

/** Browser origin reserved for the Tier 2 Angular server and its invitation links. */
const _DEVELOPMENT_BROWSER_ORIGIN = "http://local-development.localhost:4200";

/** Stable current local profile identity persisted with development conversation-computer history. */
const _DEVELOPMENT_PROFILE_REVISION = `sha256:${createHash("sha256").update("opencrane-0.11-tier2-conversation-computer-profile-v1").digest("hex")}`;

/** Fixed unavailable probe used for optional services that the core profile does not start. */
const _UNAVAILABLE_HEALTH_PROBE = { async check(): Promise<void> { throw new Error("service is not part of the selected Tier 2 profile"); } };

/** Build current workflow settings whose external targets remain inert until explicitly requested. */
function _CreateWorkflowConfig(config: DevelopmentConfig): OpenCraneWorkflowConfig
{
	return {
		databasePoolSize: 4,
		databaseUrl: config.databaseUrl,
		mcpEraProbeMaximumResponseBytes: 1_048_576,
		mcpEraProbeTimeoutMilliseconds: 15_000,
		ociRegistryAuthorizationFilePath: undefined,
		ociRegistryBaseUrl: "https://registry.invalid",
		ociRegistryRepository: "opencrane/local-development",
		ociRegistryTimeoutMilliseconds: 15_000,
		pollIntervalMilliseconds: 250,
		siloId: config.identity.siloId,
		workerConcurrency: 2,
	};
}

/** Build the realization-neutral profile used by onboarding and local run admission. */
function _CreateDevelopmentProfile(): ConversationComputerReleaseProfileConfig
{
	return {
		leaseTtlMilliseconds: 3_600_000,
		maximumTurnCostUsdMicros: 100_000,
		profileName: "developer",
		profileRevisionId: _DEVELOPMENT_PROFILE_REVISION,
	};
}

/** Decode the coordinator-owned invitation key without relaxing the production HTTPS parser. */
function _ReadInvitationSigningKey(path: string): Uint8Array
{
	const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
	if (key.byteLength < 32)
	{
		throw new Error("Tier 2 invitation signing key must contain at least 32 base64url-decoded bytes");
	}
	return key;
}

/** Reads one owner-only browser credential without accepting a symbolic link. */
function _ReadBrowserSessionCredential(path: string): string
{
	const statistics = lstatSync(path);
	if (!statistics.isFile() || statistics.isSymbolicLink() || (statistics.mode & 0o077) !== 0)
	{
		throw new Error("Tier 2 browser session credential must be an owner-only regular file");
	}
	const credential = readFileSync(path, "utf8").trim();
	if (!/^[A-Za-z0-9_-]{43}$/u.test(credential))
	{
		throw new Error("Tier 2 browser session credential must contain 32 base64url bytes");
	}
	return credential;
}

/** Compose one workstation process owner for an Agent profile. */
function _CreateDevelopmentConversationComputer(config: DevelopmentConfig, prisma: ReturnType<typeof ___CreatePrismaClient>, history: Parameters<typeof _CreateConversationComputerTurnAuthority>[0]["history"], profile: ConversationComputerReleaseProfileConfig): DevelopmentConversationComputerSupervisor | null
{
	if (config.profile === DevelopmentProfileKinds.Core)
	{
		return null;
	}
	const owner = _CreateHostDevelopmentConversationComputerRealization({ internalEndpoint: `http://127.0.0.1:${config.internalPort}`, launch: { executable: "python3", arguments: ["-B", "-m", "src.main"], workingDirectory: join(process.cwd(), "apps/conversation-computer") } });
	const runAdmission = _CreateProductionConversationRunAdmission(prisma, history, config.conversationPrivatePayloadKeyringPath, { maxConcurrentAdmissions: 4, maxQueuedAdmissions: 16 });
	const simulated = config.profile === DevelopmentProfileKinds.AgentSimulated;
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(config.conversationPrivatePayloadKeyringPath));
	const credentials = simulated
		? new DevelopmentConversationComputerCredentialIssuer()
		: new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey, revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias }, config.identity.siloId);
	const endpoint = simulated ? "simulated://tier2" : process.env.LITELLM_ENDPOINT?.trim() ?? "";
	if (!simulated && !endpoint)
	{
		throw new Error("Tier 2 Agent model profiles require LITELLM_ENDPOINT");
	}
	const authority = _CreateConversationComputerTurnAuthority({
		credentials,
		endpoint,
		history,
		keyringPath: config.conversationPrivatePayloadKeyringPath,
		maximumTurnCostUsdMicros: profile.maximumTurnCostUsdMicros,
		model: simulated ? new DeterministicDevelopmentConversationModelTransport() : { request: __RequestConversationModel },
		prisma,
		realizer: owner.realizer,
		runAdmission,
		runtimeAdmission: async function _RefuseWorkloadToolInvocation(): Promise<boolean> { return false; },
		siloId: config.identity.siloId,
	});
	const privateApp = _CreateHostDevelopmentConversationComputerPrivateApp({ authenticator: owner.authenticator, authority, logger: _log });
	const supervisor = new HostDevelopmentConversationComputerSupervisor({ app: privateApp, port: config.internalPort, processes: { close: owner.stop } });
	return new DevelopmentConversationComputerRuntime(
		function _StartLifecycle() { return _StartDevelopmentConversationComputerLifecycle(prisma, history, owner.realizer, config.identity.siloId, profile); },
		function _StartActivations() { return _StartConversationComputerActivationConsumer(prisma, history, config.identity.siloId, profile, owner.realizer); },
		supervisor,
	);
}

/**
 * Compose current 0.11 product routes over clean PostgreSQL and TLS KurrentDB dependencies.
 *
 * Called by: the Tier 2 development entrypoint after the repository coordinator owns local resources.
 */
export async function _CreateDevelopmentServerComposition(config: DevelopmentConfig): Promise<DevelopmentServerComposition>
{
	const prisma = ___CreatePrismaClient(_log);
	const historyStore = _CreateHistoryStoreComposition(config.historyStore);
	try
	{
		await _AssertHistoryStoreSilo(historyStore.historyStore, config.identity.siloId);
		const profile = _CreateDevelopmentProfile();
		const workflows = _CreateMcpWorkflowComposition(prisma, _CreateWorkflowConfig(config));
		const providerEffects = _CreateProviderEffectCommandExecutor(prisma, null, null, _log);
		const health = _CreatePublicHealthReportReader({
			cacheMilliseconds: 5_000,
			clock: { nowEpochMilliseconds: function _Now(): number { return Date.now(); } },
			database: ___CreateDbHealthProbe(prisma),
			files: _UNAVAILABLE_HEALTH_PROBE,
			logger: _log,
			memory: _UNAVAILABLE_HEALTH_PROBE,
			models: _UNAVAILABLE_HEALTH_PROBE,
		});
		const organizationMembers = _CreateOrganizationMembersComposition(prisma, {
			mode: OrganizationMembershipDeploymentModes.Standalone,
			standalone: {
				invitationSigningKey: _ReadInvitationSigningKey(config.invitationSigningKeyPath),
				invitationTtlMilliseconds: 604_800_000,
				publicBaseUrl: _DEVELOPMENT_BROWSER_ORIGIN,
			},
		});
		const conversationComputer = _CreateDevelopmentConversationComputer(config, prisma, historyStore.historyStore, profile);
		const app = _CreateDevelopmentPublicApp({ artifactScannerEnabled: false, browserSessionCredential: _ReadBrowserSessionCredential(config.browserSessionCredentialPath), conversationPrivatePayloadKeyringPath: config.conversationPrivatePayloadKeyringPath, health, historyStore: historyStore.historyStore, mcpWorkflows: workflows, organizationMembers, prisma, profile, providerEffects });
		app.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma, workflows.execution);
		return { app, conversationComputer, historyStore, prisma, providerEffects, workflowRuntime: workflows.runtime };
	}
	catch (error)
	{
		return _RethrowAfterDevelopmentCleanup(error, [[historyStore.close, prisma.$disconnect.bind(prisma)]], "Tier 2 server-composition cleanup failed");
	}
}
