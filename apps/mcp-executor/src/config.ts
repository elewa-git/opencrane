import { isAbsolute } from "node:path";

import type { McpExecutorProcessConfig } from "./config.types";

/** Read and fail-closed validate the one-shot companion configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): McpExecutorProcessConfig
{
	return {
		openCraneExecutorUrl: _OpenCraneUrl(environment),
		serverUrl: _ServerUrl(environment),
		tokenPath: _Absolute(environment, "OPENCRANE_MCP_TOKEN_PATH"),
		referencePath: _Absolute(environment, "OPENCRANE_MCP_CLAIM_REFERENCE_PATH"),
		podUid: _Required(environment, "POD_UID"),
		openCraneTimeoutMilliseconds: _Integer(environment, "OPENCRANE_MCP_REQUEST_TIMEOUT_MS", 15_000, 1_000, 60_000),
		serverTimeoutMilliseconds: _Integer(environment, "OPENCRANE_MCP_SERVER_TIMEOUT_MS", 60_000, 1_000, 120_000),
		commandByteLimit: _Integer(environment, "OPENCRANE_MCP_COMMAND_MAX_BYTES", 1_048_576, 1_024, 1_048_576),
		resultByteLimit: _Integer(environment, "OPENCRANE_MCP_RESULT_MAX_BYTES", 4_194_304, 1_024, 4_194_304),
		reportByteLimit: _Integer(environment, "OPENCRANE_MCP_REPORT_MAX_BYTES", 4_456_448, 1_024, 4_456_448),
	};
}

/** Require one non-empty environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value)
		throw new Error(`${name} is required`);
	return value;
}

/** Require an absolute mounted path. */
function _Absolute(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = _Required(environment, name);
	if (!isAbsolute(value))
		throw new Error(`${name} must be absolute`);
	return value;
}

/** Read a bounded positive integer. */
function _Integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	return value;
}

/** Require the exact credential-free cluster-local executor base path. */
function _OpenCraneUrl(environment: NodeJS.ProcessEnv): string
{
	const value = _Required(environment, "OPENCRANE_MCP_EXECUTOR_URL");
	const parsed = new URL(value);
	const port = Number(parsed.port);
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || !parsed.hostname.endsWith(".svc.cluster.local") || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || parsed.pathname !== "/api/internal/mcp-executor" || parsed.search || parsed.hash)
		throw new Error("OPENCRANE_MCP_EXECUTOR_URL must be the fixed credential-free cluster-local executor endpoint");
	return parsed.toString().replace(/\/$/u, "");
}

/** Require the exact loopback MCP path supplied by the Job launcher. */
function _ServerUrl(environment: NodeJS.ProcessEnv): string
{
	const value = _Required(environment, "OPENCRANE_MCP_SERVER_URL");
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "3000" || parsed.pathname !== "/mcp" || parsed.username || parsed.password || parsed.search || parsed.hash)
		throw new Error("OPENCRANE_MCP_SERVER_URL must be http://127.0.0.1:3000/mcp");
	return parsed.toString();
}
