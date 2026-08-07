import { Router, type Request, type Response } from "express";

import { ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import type { Es256PublicJwk } from "@opencrane/models/authorization";

import { __ConsumeRuntimeBootstrap } from "./runtime-proof.js";
import type { RuntimeBootstrapClaim, RuntimeBootstrapExpectation } from "./runtime-proof.types.js";
import type { RuntimeBootstrapExchangeRecord, RuntimeBootstrapReviewedIdentity, RuntimeBootstrapRouterDependencies, RuntimeBootstrapSubmission } from "./runtime-bootstrap.types.js";

/**
 * Build the workload-authenticated one-use runtime bootstrap-exchange API.
 *
 * **This router is NOT behind `___AuthMiddleware`.** Identity is established by TokenReview over the
 * runtime's projected ServiceAccount token, and reachability is otherwise enforced by Kubernetes
 * NetworkPolicy. The router accepts no caller-selected policy or time: it loads the durable bootstrap
 * and its independent assignment authority, cross-checks both against the reviewed Pod identity, and
 * delegates single-consumption to `__ConsumeRuntimeBootstrap`. A replay, a missing binding, or any
 * mismatch fails closed and never returns prior authority.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — policy restricting which pods can reach
 *   the opencrane-api internal listener.
 * @see libs/backend/agents/runtime/k8s-launcher/src/agent-runtime-job.ts — the runtime Job that
 *   projects the bootstrap reference and the audience-bound token this router reviews.
 */
export function __CreateRuntimeBootstrapRouter(dependencies: RuntimeBootstrapRouterDependencies): Router
{
	const router = Router();

	router.post("/bootstrap", async function _bootstrap(request: Request, response: Response)
	{
		try
		{
			// 1. Establish the reviewed runtime identity before reading any durable bootstrap state.
			const identity = await _ReviewIdentity(request, dependencies);
			if (identity === null)
			{
				response.status(401).json({ code: "UNAUTHORIZED" });
				return;
			}
			const submission = _ParseSubmission(request.body);
			if (submission === null)
			{
				response.status(400).json({ error: "invalid_bootstrap_submission" });
				return;
			}

			// 2. Load the durable bootstrap and its independent assignment authority.
			const record = await dependencies.repository.loadBootstrapExchange(submission.bootstrapReference);
			if (record === null)
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}

			// 3. Delegate single-consumption; the pure authority cross-checks every bound coordinate.
			const claim = _BuildClaim(record, submission);
			const expectation = _BuildExpectation(record, identity, dependencies.clock.nowEpochMs());
			const result = await __ConsumeRuntimeBootstrap(dependencies.repository, claim, expectation);
			if (result.outcome === "consumed")
			{
				response.status(200).json({ receiptId: result.receiptId });
				return;
			}
			response.status(409).json({ error: result.reason });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_runtime.bootstrap" }, "Runtime bootstrap exchange failed");
			response.status(503).json({ error: "bootstrap_authority_unavailable" });
		}
	});

	return router;
}

/** TokenReview one bearer and require one exact runtime namespace and matching identity grammar. */
async function _ReviewIdentity(request: Request, dependencies: RuntimeBootstrapRouterDependencies): Promise<RuntimeBootstrapReviewedIdentity | null>
{
	const token = _BearerValue(request.header("authorization"));
	if (!token) return null;
	const identity = await dependencies.tokenReviewer.__Review(token);
	if (identity === null || !dependencies.runtimeNamespaces.includes(identity.namespace) || (!_IsRuntimeServiceAccountName(identity.serviceAccountName)) || identity.podUid.trim().length === 0) return null;
	return identity;
}

/** Accept either bounded runtime class; durable bootstrap evidence fixes which one is authoritative. */
function _IsRuntimeServiceAccountName(value: string): boolean
{
	return ___IsAgentRuntimeServiceAccountName(value) || ___IsManagedAgentRuntimeServiceAccountName(value);
}

/** Read one unambiguous standard bearer credential. */
function _BearerValue(value: string | undefined): string | null
{
	if (!value) return null;
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Parse only the fixed submission shape without accepting extra self-asserted fields. */
function _ParseSubmission(value: unknown): RuntimeBootstrapSubmission | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	const expectedKeys = ["bootstrapReference", "proofKeyThumbprint", "proofPublicJwk"];
	if (Object.keys(body).length !== expectedKeys.length || !expectedKeys.every(key => key in body)) return null;
	const bootstrapReference = body["bootstrapReference"];
	const proofKeyThumbprint = body["proofKeyThumbprint"];
	if (typeof bootstrapReference !== "string" || !/^bootstrap-v1_[0-9a-f]{64}$/.test(bootstrapReference)) return null;
	if (typeof proofKeyThumbprint !== "string" || proofKeyThumbprint.trim().length === 0 || proofKeyThumbprint.length > 128) return null;
	const proofPublicJwk = _ParseJwk(body["proofPublicJwk"]);
	if (proofPublicJwk === null) return null;
	return { bootstrapReference, proofKeyThumbprint, proofPublicJwk };
}

/** Accept only a syntactically complete P-256 public JWK; cryptographic checks stay in the authority. */
function _ParseJwk(value: unknown): Es256PublicJwk | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const jwk = value as Record<string, unknown>;
	if (jwk["kty"] !== "EC" || jwk["crv"] !== "P-256" || typeof jwk["x"] !== "string" || typeof jwk["y"] !== "string") return null;
	if (jwk["x"].length === 0 || jwk["x"].length > 128 || jwk["y"].length === 0 || jwk["y"].length > 128) return null;
	return { kty: "EC", crv: "P-256", x: jwk["x"], y: jwk["y"] };
}

/** Build the bootstrap-sourced claim, binding the runtime's proposed public proof key. */
function _BuildClaim(record: RuntimeBootstrapExchangeRecord, submission: RuntimeBootstrapSubmission): RuntimeBootstrapClaim
{
	return {
		bootstrapId: record.bootstrapId,
		siloId: record.bootstrapSiloId,
		audience: record.bootstrapAudience,
		subjectId: record.bootstrapSubjectId,
		serviceAccountName: record.bootstrapServiceAccountName,
		namespace: record.bootstrapNamespace,
		workloadKind: record.bootstrapWorkloadKind,
		workloadUid: record.bootstrapWorkloadUid,
		podUid: record.assignmentPodUid,
		runId: record.bootstrapRunId,
		agentServiceId: record.bootstrapAgentServiceId,
		attempt: record.bootstrapAttempt,
		agentRevisionId: record.bootstrapAgentRevisionId,
		proofPublicJwk: submission.proofPublicJwk,
		proofKeyThumbprint: submission.proofKeyThumbprint,
		expiresAtEpochMs: record.bootstrapExpiresAtEpochMs,
	};
}

/** Build the expectation from independent assignment authority and the reviewed Pod identity. */
function _BuildExpectation(record: RuntimeBootstrapExchangeRecord, identity: RuntimeBootstrapReviewedIdentity, nowEpochMs: number): RuntimeBootstrapExpectation
{
	return {
		siloId: record.assignmentSiloId,
		audience: record.assignmentAudience,
		subjectId: record.assignmentSubjectId,
		serviceAccountName: identity.serviceAccountName,
		namespace: identity.namespace,
		workloadKind: record.assignmentWorkloadKind,
		workloadUid: record.assignmentWorkloadUid,
		podUid: identity.podUid,
		runId: record.assignmentRunId,
		agentServiceId: record.assignmentAgentServiceId,
		attempt: record.assignmentAttempt,
		agentRevisionId: record.assignmentAgentRevisionId,
		nowEpochMs,
	};
}
