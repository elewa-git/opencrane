const FULL_SHA = /^[0-9a-f]{40}$/u;

/** Return whether the exact base SHA already completed the current-silo k3d job successfully. */
export function hasSuccessfulCurrentSiloQualification(qualifications, baseSha)
{
	return qualifications.some(function _Successful(qualification) {
		return qualification.workflowPath === ".github/workflows/docker.yml"
			&& qualification.headSha === baseSha
			&& ["push", "workflow_dispatch"].includes(qualification.runEvent)
			&& qualification.runStatus === "completed"
			&& qualification.runConclusion === "success"
			&& qualification.jobName === "k3d current-silo smoke test"
			&& qualification.jobStatus === "completed"
			&& qualification.jobConclusion === "success";
	});
}

/**
 * Returns whether a pull request may reuse the exact base commit's current-silo qualification.
 *
 * Every input is positive evidence. Missing or malformed evidence returns false so workflow output
 * loss, expired Actions history, or an unqualified stacked base runs k3d instead of bypassing it.
 */
export function hasCompleteDevelopSmokeBaseline(input)
{
	if (input.eventName !== "pull_request"
		|| !FULL_SHA.test(input.baseSha)
		|| input.deploymentInputsChanged
		|| input.affectedContainerProjects.length > 0)
	{
		return false;
	}
	return hasSuccessfulCurrentSiloQualification(input.qualifications, input.baseSha);
}
