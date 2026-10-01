import { Router, type Request, type Response } from "express";

import { SkillAuthoringValidationAdmissionError } from "@opencrane/backend/agents/skills/workflows";

import { SkillAuthoringValidationSubmissionForbiddenError, type SkillAuthoringValidationSubmissionRouterDependencies } from "./skill-authoring-validation-submission.types";

/** Build the authenticated route that starts one durable Draft Python skill validation. */
export function __CreateSkillAuthoringValidationSubmissionRouter(dependencies: SkillAuthoringValidationSubmissionRouterDependencies): Router
{
	const router = Router();
	router.post("/authoring-validations", async function _Submit(request: Request, response: Response): Promise<void>
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null)
		{
			response.status(401).json({ error: "skill_validation_authentication_required" });
			return;
		}
		const skillRevisionId = _SkillRevisionId(request.body);
		if (skillRevisionId === null)
		{
			response.status(400).json({ error: "skill_revision_id_required" });
			return;
		}
		try
		{
			const submitted = await dependencies.authority.submit(caller, skillRevisionId);
			response.status(202).json(submitted);
		}
		catch (err)
		{
			if (err instanceof SkillAuthoringValidationSubmissionForbiddenError)
			{
				response.status(403).json({ error: "skill_validation_forbidden" });
				return;
			}
			if (err instanceof SkillAuthoringValidationAdmissionError)
			{
				response.status(409).json({ error: "skill_validation_unavailable" });
				return;
			}
			dependencies.logger.error({ err, operation: "skills.authoring_validation.submit", siloId: caller.siloId }, "Skill validation submission failed");
			response.status(503).json({ error: "skill_validation_unavailable" });
		}
	});
	return router;
}

/** Accept exactly one bounded skill revision identifier. */
function _SkillRevisionId(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const body = value as Record<string, unknown>;
	const skillRevisionId = body["skillRevisionId"];
	return Object.keys(body).length === 1 && typeof skillRevisionId === "string" && skillRevisionId.length > 0 && skillRevisionId.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(skillRevisionId) ? skillRevisionId : null;
}
