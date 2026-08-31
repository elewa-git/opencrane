import { isAbsolute } from "node:path";

import { __ValidateAgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import { __ValidateMcpExecutorControllerProfile } from "@opencrane/backend/agents/runtime/mcp-executor/controller";
import { __ValidateSkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgentControllerProcessConfig } from "./config.types";

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

/** Read and fail-closed validate the complete agent-controller process configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): AgentControllerProcessConfig
{
	// 1. Require the separately audience-bound OpenCrane credential by mounted path, never raw value.
	const controllerTokenPath = _Required(environment, "OPENCRANE_CONTROLLER_TOKEN_PATH");
	if (!isAbsolute(controllerTokenPath))
	{
		throw new Error("OPENCRANE_CONTROLLER_TOKEN_PATH must be absolute");
	}

	// 2. Validate every immutable profile and its dedicated runtime namespace at startup.
	const profiles = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_PROFILES_JSON"), "AGENT_CONTROLLER_PROFILES_JSON", __ValidateAgentControllerRuntimeProfiles);
	const skillWorkloadProfiles = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON"), "AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON", __ValidateSkillWorkloadControllerProfiles);
	const mcpExecutorProfile = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON"), "AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON", __ValidateMcpExecutorControllerProfile);
	return {
		openCraneInternalUrl: _Required(environment, "OPENCRANE_INTERNAL_URL"),
		controllerTokenPath,
		pollIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		outboxPruneIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS", 3_600_000, 60_000, 86_400_000),
		requestTimeoutMilliseconds: _Integer(environment, "AGENT_CONTROLLER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
		profiles,
		skillWorkloadProfiles,
		mcpExecutorProfile,
	};
}
