#!/usr/bin/env node

import { appendFileSync } from "node:fs";

import { hasCompleteDevelopSmokeBaseline } from "./develop-smoke-baseline.core.mjs";

const API_VERSION = "2022-11-28";

/** Write the single fail-closed admission output. */
function _Output(value)
{
	if (process.env.GITHUB_OUTPUT)
	{
		appendFileSync(process.env.GITHUB_OUTPUT, `develop_smoke_can_skip=${value}\n`);
		return;
	}
	process.stdout.write(`develop_smoke_can_skip=${value}\n`);
}

/** Read one bounded GitHub API response. */
async function _GitHub(path)
{
	const response = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`,
			"X-GitHub-Api-Version": API_VERSION,
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok)
	{
		throw new Error(`GitHub API returned ${response.status} for ${path.split("?")[0]}`);
	}
	return response.json();
}

/** Return workflow candidates for one exact base SHA. */
async function _WorkflowRuns(repository, baseSha)
{
	const query = new URLSearchParams({ head_sha: baseSha, per_page: "100" });
	const response = await _GitHub(`repos/${repository}/actions/workflows/docker.yml/runs?${query}`);
	return Array.isArray(response.workflow_runs) ? response.workflow_runs : [];
}

/** Return exact-base current-silo qualification evidence from completed workflow runs. */
async function _QualificationEvidence(repository, baseSha)
{
	const runs = (await _WorkflowRuns(repository, baseSha))
		.filter(function _Completed(run) { return run.status === "completed" && run.conclusion === "success"; });
	const evidence = await Promise.all(runs.map(async function _Jobs(run) {
		const response = await _GitHub(`repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
		const jobs = Array.isArray(response.jobs) ? response.jobs : [];
		return jobs.map(function _Evidence(job) {
			return {
				workflowPath: run.path ?? "",
				headSha: run.head_sha ?? "",
				runEvent: run.event ?? "",
				runStatus: run.status ?? "",
				runConclusion: run.conclusion ?? "",
				jobName: job.name ?? "",
				jobStatus: job.status ?? "",
				jobConclusion: job.conclusion ?? "",
			};
		});
	}));
	return evidence.flat();
}

const eventName = process.env.GITHUB_EVENT_NAME ?? "";
const baseSha = process.env.NX_BASE ?? "";
const deploymentInputsChanged = process.env.DEPLOYMENT_INPUTS_CHANGED !== "false";
const affectedContainerProjects = (process.env.AFFECTED_CONTAINER_PROJECTS ?? "").split(",").filter(Boolean);

if (eventName !== "pull_request" || deploymentInputsChanged || affectedContainerProjects.length > 0)
{
	_Output("false");
}
else
{
	try
	{
		const qualifications = await _QualificationEvidence(process.env.GITHUB_REPOSITORY ?? "", baseSha);
		_Output(String(hasCompleteDevelopSmokeBaseline({
			eventName,
			baseSha,
			deploymentInputsChanged,
			affectedContainerProjects,
			qualifications,
		})));
	}
	catch (error)
	{
		process.stderr.write(`[develop-smoke-baseline] Baseline proof unavailable; k3d remains required: ${error.message}\n`);
		_Output("false");
	}
}
