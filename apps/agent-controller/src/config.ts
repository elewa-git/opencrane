import { isAbsolute } from "node:path";

import { __ValidateAgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import { __ValidateSkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";

import type { AgentControllerProcessConfig } from "./config.types.js";

/** Read one required, trimmed environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

/** Parse a bounded safe integer or use its explicit default. */
function _Integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
	{
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
	}
	return value;
}

/** Parse JSON while converting syntax errors into a stable configuration failure. */
function _Json(value: string): unknown
{
	try
	{
		return JSON.parse(value) as unknown;
	}
	catch
	{
		throw new Error("AGENT_CONTROLLER_PROFILES_JSON must contain valid JSON");
	}
}

/** Parse skill profile JSON while keeping its configuration failure distinct from runtime profiles. */
function _SkillProfilesJson(value: string): unknown
{
	try
	{
		return JSON.parse(value) as unknown;
	}
	catch
	{
		throw new Error("AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON must contain valid JSON");
	}
}

/** Read and fail-closed validate the complete agent-controller process configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): AgentControllerProcessConfig
{
	// 1. Fix workload mutations to the explicit dedicated runtime namespace.
	const runtimeNamespace = _Required(environment, "AGENT_RUNTIME_NAMESPACE");

	// 2. Require the separately audience-bound OpenCrane credential by mounted path, never raw value.
	const controllerTokenPath = _Required(environment, "OPENCRANE_CONTROLLER_TOKEN_PATH");
	if (!isAbsolute(controllerTokenPath))
	{
		throw new Error("OPENCRANE_CONTROLLER_TOKEN_PATH must be absolute");
	}

	// 3. Validate the runtime/server namespace split and every immutable Job profile at startup.
	const profiles = __ValidateAgentControllerRuntimeProfiles(_Json(_Required(environment, "AGENT_CONTROLLER_PROFILES_JSON")), runtimeNamespace);
	const skillWorkloadProfiles = __ValidateSkillWorkloadControllerProfiles(_SkillProfilesJson(_Required(environment, "AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON")));
	return {
		openCraneInternalUrl: _Required(environment, "OPENCRANE_INTERNAL_URL"),
		controllerTokenPath,
		runtimeNamespace,
		pollIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		outboxPruneIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS", 3_600_000, 60_000, 86_400_000),
		requestTimeoutMilliseconds: _Integer(environment, "AGENT_CONTROLLER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
		profiles,
		skillWorkloadProfiles,
	};
}
