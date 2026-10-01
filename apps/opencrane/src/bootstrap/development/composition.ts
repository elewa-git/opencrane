import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";
import { ConversationGeneratedFileResultStates, PrismaConversationComputerCredentialUnitOfWork, _CreateProductionConversationRunAdmission, _StartConversationComputerActivationWorker, type ConversationComputerToolInvocationDispatch, type ConversationGeneratedFileOutputLinker, type ConversationGeneratedFileResultRepositoryFactory } from "@opencrane/backend/server/conversations";
import { AesGcmConversationPrivatePayloadCipher, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { PrismaConversationPromptDocumentRepository } from "@opencrane/backend/server/conversation-assets";
import { _CreatePublishedArtifactReader } from "@opencrane/backend/server/agents/artifacts";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { _AssertHistoryStoreSilo, _CreateHistoryStoreComposition, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___CreateDbHealthProbe, _CreatePublicHealthReportReader } from "@opencrane/backend/server/infra/http";
import { ___CreatePrismaClient } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerReleaseProfileConfig, OpenCraneWorkflowConfig } from "../configuration/config.types";
import { _log } from "../process/log";
import { _CreateMcpWorkflowComposition } from "../workflows/mcp-workflow-composition";
import { _CreateOrganizationMembersComposition } from "../http/organization-members-composition";
import { _CreateConversationComputerWorkflowComposition } from "../conversations/conversation-computer-workflow-composition";
import type { DevelopmentConversationComputerSupervisor, DevelopmentServerComposition } from "./composition.types";
import type { DevelopmentConfig } from "./config.types";
import { DevelopmentProfileKinds } from "./config.types";
import { _CreateHostDevelopmentConversationComputerRealization } from "./conversation-computer-host-realizer";
import { _RethrowAfterDevelopmentCleanup } from "./cleanup";
import { _StartDevelopmentConversationComputerLifecycle } from "./conversation-computer-lifecycle";
import { DevelopmentConversationComputerRuntime } from "./conversation-computer-runtime";
import { _CreateDevelopmentPublicApp } from "./public-app";
import { DeterministicDevelopmentConversationModelTransport, DevelopmentConversationComputerCredentialIssuer } from "./simulated-conversation-model";

/** Stable current local profile identity persisted with development conversation-computer history. */
const _DEVELOPMENT_PROFILE_REVISION = `sha256:${createHash("sha256").update("opencrane-0.11-tier2-conversation-computer-profile-v1").digest("hex")}`;

/** Report that the selected Tier 2 profile did not start the probed service. */
async function _CheckUnavailableService(): Promise<void> { throw new Error("service is not part of the selected Tier 2 profile"); }

/** Fixed unavailable probe used for optional services that the core profile does not start. */
const _UNAVAILABLE_HEALTH_PROBE = { check: _CheckUnavailableService };

/** Return the current time for the public health-report cache. */
function _NowEpochMilliseconds(): number { return Date.now(); }

/** Refuse workload tool invocation because Tier 2 has no workload-side tool runner. */
async function _RefuseWorkloadToolInvocation(): Promise<boolean> { return false; }

/** Refuse durable tool execution because Tier 2 starts no MCP executor runtime. */
const _UNAVAILABLE_TOOL_DISPATCH: ConversationComputerToolInvocationDispatch = {
	async tryExecute(): Promise<boolean> { return false; },
	async settleExhausted(): Promise<boolean> { return false; },
};

/** Report that a refused Tier 2 tool invocation has no generated-file operation. */
const _UNAVAILABLE_GENERATED_FILE_RESULTS: ConversationGeneratedFileResultRepositoryFactory = function _CreateUnavailableGeneratedFileRepository()
{
	return {
		async read() { return { state: ConversationGeneratedFileResultStates.NotGenerated }; },
	};
};

/** Refuse generated output because Tier 2 admits no workload tools or file-producing runtime. */
const _UNAVAILABLE_GENERATED_FILE_OUTPUT: ConversationGeneratedFileOutputLinker = {
	async link(): Promise<void> { throw new Error("Tier 2 does not admit generated-file output"); },
};

/** Build current workflow settings whose external targets remain inert until explicitly requested. */
function _CreateWorkflowConfig(config: DevelopmentConfig): OpenCraneWorkflowConfig
{
	return {
		databasePoolSize: 4,
		databaseUrl: config.databaseUrl,
		mcpRemoteMaximumResponseBytes: 1_048_576,
		mcpRemoteTimeoutMilliseconds: 15_000,
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

	if (
		!statistics.isFile()
		|| statistics.isSymbolicLink()
		|| (statistics.mode & 0o077) !== 0
	)
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
function _CreateDevelopmentConversationComputer(config: DevelopmentConfig, prisma: ReturnType<typeof ___CreatePrismaClient>, history: HistoryStore, profile: ConversationComputerReleaseProfileConfig, workflows: ReturnType<typeof _CreateMcpWorkflowComposition>): DevelopmentConversationComputerSupervisor | null
{
	if (config.profile === DevelopmentProfileKinds.Core)
	{
		return null;
	}
	const owner = _CreateHostDevelopmentConversationComputerRealization({
		internalEndpoint: `http://127.0.0.1:${config.internalPort}`,
		launch: {
			executable: "python3",
			arguments: [
				"-B",
				"-m",
				"src.main",
			],
			workingDirectory: join(process.cwd(), "apps/conversation-computer"),
		},
	});
	const documentAuthorities = {
		create: function _CreatePromptDocumentAuthority(transaction: Prisma.TransactionClient)
		{
			return new PrismaConversationPromptDocumentRepository(transaction);
		},
	};
	const runAdmission = _CreateProductionConversationRunAdmission(prisma, history, config.conversationPrivatePayloadKeyringPath, documentAuthorities, _CreatePublishedArtifactReader(prisma), { maxConcurrentAdmissions: 4, maxQueuedAdmissions: 16 }, _log);
	const simulated = config.profile === DevelopmentProfileKinds.AgentSimulated;
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(config.conversationPrivatePayloadKeyringPath));
	const credentials = simulated
		? new DevelopmentConversationComputerCredentialIssuer()
		: new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, {
			issue: _IssueAttemptLiteLlmKey,
			revoke: _RevokeAttemptLiteLlmKey,
			revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias,
		}, config.identity.siloId);
	const endpoint = simulated ? "simulated://tier2" : process.env.LITELLM_ENDPOINT?.trim() ?? "";

	if (!simulated && !endpoint)
	{
		throw new Error("Tier 2 Agent model profiles require LITELLM_ENDPOINT");
	}
	const conversationComputerWorkflows = _CreateConversationComputerWorkflowComposition({
		credentials,
		modelEndpoint: endpoint,
		history,
		keyringPath: config.conversationPrivatePayloadKeyringPath,
		model: simulated ? new DeterministicDevelopmentConversationModelTransport() : { request: __RequestConversationModel },
		prisma,
		realizer: owner.realizer,
		processes: owner.realizer,
		authenticator: owner.authenticator,
		profile,
		runAdmission,
		runtimeAdmission: _RefuseWorkloadToolInvocation,
		siloId: config.identity.siloId,
		toolDispatch: _UNAVAILABLE_TOOL_DISPATCH,
		workflows: workflows.execution,
		generatedFiles: _UNAVAILABLE_GENERATED_FILE_RESULTS,
		generatedOutput: _UNAVAILABLE_GENERATED_FILE_OUTPUT,
	});

	return new DevelopmentConversationComputerRuntime(
		function _StartLifecycle() { return _StartDevelopmentConversationComputerLifecycle(prisma, history, owner.realizer, config.identity.siloId, profile); },
		function _StartActivations()
		{
			return _StartConversationComputerActivationWorker(prisma, history, workflows.execution, config.identity.siloId, profile, owner.realizer, {
				stopAuthority: conversationComputerWorkflows.stopAuthority,
				logger: _log,
				onExhausted: function _RequestProcessShutdown(): void { process.kill(process.pid, "SIGTERM"); },
			});
		},
		{ stop: owner.stop },
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
		const workflows = _CreateMcpWorkflowComposition(prisma, _CreateWorkflowConfig(config), 15_000);
		const memoryWorkflow = { siloId: config.identity.siloId, gateway: new __UnavailableMemoryGatewayClient() };
		const providerEffects = _CreateProviderEffectCommandExecutor(prisma, null, null, _log);
		const health = _CreatePublicHealthReportReader({
			cacheMilliseconds: 5_000,
			clock: { nowEpochMilliseconds: _NowEpochMilliseconds },
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
				publicBaseUrl: config.browserOrigin,
			},
		});
		const conversationComputer = _CreateDevelopmentConversationComputer(config, prisma, historyStore.historyStore, profile, workflows);
		const app = _CreateDevelopmentPublicApp({
			artifactScannerEnabled: false,
			browserOrigin: config.browserOrigin,
			browserSessionCredential: _ReadBrowserSessionCredential(config.browserSessionCredentialPath),
			conversationPrivatePayloadKeyringPath: config.conversationPrivatePayloadKeyringPath,
			health,
			historyStore: historyStore.historyStore,
			mcpWorkflows: workflows,
			memoryWorkflow,
			organizationMembers,
			prisma,
			profile,
			providerEffects,
		});
		return {
			app,
			conversationComputer,
			historyStore,
			prisma,
			providerEffects,
			workflowRuntime: workflows.runtime,
		};
	}
	catch (error)
	{
		return _RethrowAfterDevelopmentCleanup(error, [[historyStore.close, prisma.$disconnect.bind(prisma)]], "Tier 2 server-composition cleanup failed");
	}
}
