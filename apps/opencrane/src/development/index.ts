// OpenTelemetry must run before the development composition imports instrumented dependencies.
import "../app/instrument";

import { randomBytes } from "node:crypto";

import { __CreateManagedRunAdmissionPort, __CreatePersonalRunAdmissionPort, __ReadRunAdmissionConcurrencyPolicy, _CreateRunAdmissionCapacityGate } from "@opencrane/backend/agents/execution/admission";
import { _CreateElicitationInterruptReader } from "@opencrane/backend/agents/execution/elicitation";
import { _CreateConversationAttachmentAdmission } from "@opencrane/backend/server/conversation-assets";
import { _CreatePrismaSelfConversationSocketServer } from "@opencrane/backend/server/conversations";
import { _CreateManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";
import { _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _CreateRunCancellationAuthority } from "../app/run-cancellation-composition";
import { _CreateConversationSocketAuthenticator } from "../app/conversation-socket-authenticator";
import { _CreatePublicApp } from "../app/public-app";
import { _log } from "../app/log";
import { _ProcessShutdownSignal } from "../app/process-shutdown";
import { ___CreatePrismaClient } from "../infra/db/db";
import { _CreateObotAdapters } from "../infra/obot/obot-adapters.factory";
import { _CreateDevelopmentAuthentication } from "./authentication";
import { _ReadDevelopmentConfig } from "./config";
import { _CreateDevelopmentHealth } from "./health";
import { _CreateDevelopmentInternalApp } from "./internal-app";
import { _StartDevelopmentLifecycle } from "./lifecycle";
import { _CreateDevelopmentMembershipEnvironment } from "./membership-evidence";
import { _CreateDevelopmentRuntimeConfig } from "./runtime-config";
import { _CreateUnavailableDevelopmentCoreApi } from "./unavailable-kubernetes";

/** Compose the real API and PostgreSQL Tier 2 profile without loading production infrastructure. */
async function _Main(): Promise<void>
{
	// 1. Validate the development boundary and bind structured logging before external state opens.
	const unbindConsole = ___BindConsole(_log);
	const config = _ReadDevelopmentConfig();
	const prisma = ___CreatePrismaClient(_log);

	// 2. Reuse the production run authorities with the coordinator-signed local membership evidence.
	const membershipEnvironment = _CreateDevelopmentMembershipEnvironment(config.membershipPublicKeyPath);
	const membershipEvidence = _CreateFleetMembershipEvidenceConfig(membershipEnvironment);
	const capacityGate = _CreateRunAdmissionCapacityGate(__ReadRunAdmissionConcurrencyPolicy());
	const managedRunAdmission = __CreateManagedRunAdmissionPort(prisma, capacityGate, _CreateManagedExecutionEvidenceAuthority(membershipEnvironment));
	const personalRunAdmission = __CreatePersonalRunAdmissionPort(prisma, capacityGate, membershipEvidence);
	const runtimeConfig = _CreateDevelopmentRuntimeConfig();
	const runCancellation = _CreateRunCancellationAuthority(prisma, runtimeConfig);

	// 3. Compose live browser routes with explicit unavailable infrastructure adapters.
	const authentication = _CreateDevelopmentAuthentication(config.identity);
	const obot = _CreateObotAdapters(null);
	const health = _CreateDevelopmentHealth(prisma, config.profile);
	const organizationMembership = {
		mode: OrganizationMembershipDeploymentModes.Standalone,
		standalone: {
			invitationSigningKey: randomBytes(32),
			invitationTtlMilliseconds: 604_800_000,
			publicBaseUrl: "http://local-development.localhost:4200",
		},
	} as const;
	const publicApp = _CreatePublicApp(
		prisma,
		_CreateUnavailableDevelopmentCoreApi(),
		managedRunAdmission,
		personalRunAdmission,
		runCancellation,
		runtimeConfig.serverNamespace,
		obot.custody,
		authentication,
		organizationMembership,
		false,
		false,
		health,
		null
	);
	const conversationSockets = _CreatePrismaSelfConversationSocketServer(
		prisma,
		personalRunAdmission,
		_CreateConversationAttachmentAdmission,
		_log,
		_CreateConversationSocketAuthenticator(authentication.sessionMiddleware, authentication.authMiddleware),
		{
			interrupts: _CreateElicitationInterruptReader(prisma),
			shutdownSignal: _ProcessShutdownSignal
		}
	);

	// 4. Add the authenticated workload listener only for Agent profiles, then bind both to loopback.
	const internalApp = config.controllerTokenPath && config.runtimeLaunchSecretPath
		? await _CreateDevelopmentInternalApp(prisma, runtimeConfig, config.profile, config.controllerTokenPath, config.runtimeLaunchSecretPath)
		: null;
	_StartDevelopmentLifecycle(publicApp, internalApp, conversationSockets, prisma, runCancellation, config.publicPort, config.internalPort, unbindConsole);
}

void _Main().catch(function _FatalDevelopmentStartup(err: unknown): void
{
	_log.fatal({ err }, "Tier 2 OpenCrane startup failed");
	process.exitCode = 1;
});
