import { createHash } from "node:crypto";

import { Router, type Request, type Response } from "express";

import type { SkillWorkloadBootstrapRouterDependencies } from "./skill-workload-bootstrap.types.js";

/** Build the one-use worker bootstrap acknowledgement boundary. */
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
			// 1. Load only hash-addressed authority to select the exact audience before TokenReview.
			const hash = _ReferenceHash(reference);
			const record = await dependencies.repository.loadUnconsumedByReferenceHash(hash);
			if (record === null)
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}

			// 2. Review the short-lived projected token for the authority-selected audience and identity.
			const identity = await dependencies.tokenReviewer.__Review(token, record.audience);
			if (identity === null || identity.namespace !== record.namespace || identity.serviceAccountName !== record.serviceAccountName || identity.podUid !== record.podUid)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}

			// 3. Consume under the same reviewed identity; return only the already-bound opaque completion coordinate.
			const outcome = await dependencies.repository.consumeAtomically(hash, identity);
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

/** Parse the sole opaque reference field without accepting caller-selected identity or policy. */
function _Reference(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 1 && typeof body["bootstrapReference"] === "string" && /^skill-bootstrap-v1_[a-f0-9]{64}$/.test(body["bootstrapReference"]) ? body["bootstrapReference"] : null;
}

/** Parse one unambiguous standard bearer credential. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}

/** Hash the transient reference before it crosses the durable repository boundary. */
function _ReferenceHash(reference: string): string
{
	return `sha256:${createHash("sha256").update(reference, "utf8").digest("hex")}`;
}
