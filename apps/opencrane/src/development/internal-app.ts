import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";

import { ___RequestContext } from "@opencrane/backend/observability";
import { _ErrorHandler } from "@opencrane/backend/server/infra/http";
import { _ValidateRuntimeIdentityNamespaces } from "@opencrane/backend/server/infra/workload-identity";
import type { FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

import { _log } from "../app/log";
import { _CreateHttpRequestLogger } from "../app/telemetry";
import { _CreateDevelopmentInternalRuntimeComposition } from "./internal-runtime";
import { _CreateDevelopmentControllerTokenReviewer, _CreateDevelopmentRuntimeTokenReviewer } from "./local-token-reviewers";
import type { DevelopmentRuntimeConfig } from "./runtime-config.types";

/**
 * Builds the loopback workload API used by the three Agent-enabled Tier 2 profiles.
 *
 * The caller supplies the membership evidence already selected for run admission. Passing it into
 * the runtime composition keeps later external-action checks on that same trust configuration.
 *
 * Called by: `_Main` in `development/index.ts` after startup validates the Agent credential paths.
 * @param prisma - Database client shared by the runtime authorities.
 * @param runtimeConfig - Runtime namespaces and command lifetimes for this process.
 * @param profile - Agent profile that selects simulated or LiteLLM model keys.
 * @param controllerTokenPath - File containing the controller workload token.
 * @param runtimeLaunchSecretPath - File containing the runtime launch secret.
 * @param continuationKeyringPath - File containing the runtime continuation keyring.
 * @param membershipEvidence - Startup-validated issuer, verifier, and staleness limit.
 * @returns The authenticated internal Express application.
 */
export async function _CreateDevelopmentInternalApp(prisma: PrismaClient, runtimeConfig: DevelopmentRuntimeConfig, profile: LocalDevelopmentProfileKinds, controllerTokenPath: string, runtimeLaunchSecretPath: string, continuationKeyringPath: string, membershipEvidence: FleetMembershipEvidenceConfig): Promise<Express>
{
	// 1. Load separate controller and runtime identities before exposing a workload route.
	const namespaces = _ValidateRuntimeIdentityNamespaces(runtimeConfig);
	const controllerTokenReviewer = await _CreateDevelopmentControllerTokenReviewer(controllerTokenPath, namespaces.serverNamespace);
	const runtimeTokenReviewer = _CreateDevelopmentRuntimeTokenReviewer(runtimeLaunchSecretPath, namespaces);
	const runtime = _CreateDevelopmentInternalRuntimeComposition(prisma, runtimeConfig, namespaces, profile, controllerTokenReviewer, runtimeTokenReviewer, continuationKeyringPath, membershipEvidence);

	// 2. Apply the same request and logging boundaries as the production internal listener.
	const app = express();
	app.set("trust proxy", 1);
	app.use("/api/internal/warm-runtime", express.json({
		limit: 64 * 1_024,
		strict: true
	}));
	app.use(express.json());
	app.use(___RequestContext());
	app.use(_CreateHttpRequestLogger(_log));

	// 3. Expose only controller and runtime protocol routes; optional services remain unreachable.
	app.use("/api/internal/agent-controller", runtime.agentRunWorkflowController);
	app.use("/api/internal/warm-runtime", runtime.warmRuntimeBinding);
	app.use("/api/internal/warm-runtime", runtime.warmRuntimeStream);
	app.use("/api/internal/warm-runtime", runtime.agentThreadParentDeliveries);
	app.use(_ErrorHandler(_log));
	return app;
}
