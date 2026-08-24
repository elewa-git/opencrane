// OpenTelemetry must run before the development composition imports instrumented dependencies.
import "../app/instrument";

import { randomBytes } from "node:crypto";

import { __CreateManagedRunAdmissionPort, __CreatePersonalRunAdmissionPort, __ReadRunAdmissionConcurrencyPolicy, _CreateRunAdmissionCapacityGate } from "@opencrane/backend/agents/execution/admission";
import { PrismaManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _CreateRunCancellationAuthority } from "../app/run-cancellation-composition";
import { _CreatePublicApp } from "../app/public-app";
import { _log } from "../app/log";
import { ___CreatePrismaClient } from "../infra/db/db";
import { _CreateObotAdapters } from "../infra/obot/obot-adapters.factory";
import { _CreateDevelopmentAuthentication } from "./authentication";
import { _ReadDevelopmentConfig } from "./config";
import { _CreateDevelopmentHealth } from "./health";
import { _CreateDevelopmentInternalApp } from "./internal-app";
import { _StartDevelopmentLifecycle } from "./lifecycle";
import { _CreateDevelopmentMembershipEvidence } from "./membership-evidence";
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
	const membershipEvidence = _CreateDevelopmentMembershipEvidence(config.membershipPublicKeyPath);
	const capacityGate = _CreateRunAdmissionCapacityGate(__ReadRunAdmissionConcurrencyPolicy());
	const managedRunAdmission = __CreateManagedRunAdmissionPort(prisma, capacityGate, new PrismaManagedExecutionEvidenceAuthority(membershipEvidence));
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
	);

	// 4. Add the authenticated workload listener only for Agent profiles, then bind both to loopback.
	const internalApp = config.controllerTokenPath && config.runtimeLaunchSecretPath
		? await _CreateDevelopmentInternalApp(prisma, runtimeConfig, config.profile, config.controllerTokenPath, config.runtimeLaunchSecretPath)
		: null;
	_StartDevelopmentLifecycle(publicApp, internalApp, prisma, runCancellation, config.publicPort, config.internalPort, unbindConsole);
}

void _Main().catch(function _FatalDevelopmentStartup(err: unknown): void
{
	_log.fatal({ err }, "Tier 2 OpenCrane startup failed");
	process.exitCode = 1;
});
