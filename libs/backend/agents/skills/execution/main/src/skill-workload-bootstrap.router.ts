import { Router, type Request, type Response } from "express";

import { __HashSkillWorkloadBootstrapReference, __IsSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import type { SkillWorkloadBootstrapRouterDependencies } from "./skill-workload-bootstrap.types";

/**
 * Build the route where a worker acknowledges its bootstrap, once.
 *
 * **This router is NOT behind `___AuthMiddleware`.** A worker presents the ServiceAccount token
 * Kubernetes rotates for it. Authorisation comes from two checks: TokenReview on that token, and a
 * comparison against the Pod UID stored on the bootstrap row. Helm also restricts the worker
 * namespaces to reaching only this listener and DNS.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — server ingress and worker egress floor.
 * @see apps/agent-controller/helm/templates/_resources.tpl — projected worker-token audiences.
 */
export function __CreateSkillWorkloadBootstrapRouter(dependencies: SkillWorkloadBootstrapRouterDependencies): Router
{
	const router = Router();
	router.post("/skill-workloads:bootstrap", async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		const reference = _Reference(request.body);
		const token = _Bearer(request.header("authorization"));
		if (reference === null || token === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			// 1. Look the bootstrap up by the reference hash, to learn which audience TokenReview must check.
			const hash = await __HashSkillWorkloadBootstrapReference(reference);
			const record = await dependencies.authority.loadUnconsumedByReferenceHash(hash);
			if (record === null)
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}

			// 2. TokenReview the worker's token against the audience and identity the bootstrap row names.
			const identity = await dependencies.tokenReviewer.__Review(token, record.audience);
			if (identity === null || identity.namespace !== record.namespace || identity.serviceAccountName !== record.serviceAccountName || identity.podUid !== record.podUid)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}

			// 3. Mark the bootstrap used under that same identity, and return only the workload id already stored on it.
			const outcome = await dependencies.authority.consumeAtomically(hash, identity);
			if (outcome !== "consumed")
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}
			response.status(200).json({ acknowledged: true, workloadId: record.workloadId });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_workload.bootstrap" }, "Skill workload bootstrap acknowledgement failed");
			response.status(503).json({ error: "bootstrap_authority_unavailable" });
		}
	});
	return router;
}

/** Read the single `bootstrapReference` field, rejecting a body with any other key. */
function _Reference(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 1 && __IsSkillWorkloadBootstrapReference(body["bootstrapReference"]) ? body["bootstrapReference"] : null;
}

/** Read the token from a single `Bearer <token>` header, rejecting anything else. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}
