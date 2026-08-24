import { z } from "zod";

import { DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpEraProbeObservation, McpEraProbeTaskInput } from "./mcp-era-probe.types";

/** Checks task input before it can select a catalogue row. */
const _TASK_INPUT_SCHEMA: z.ZodType<McpEraProbeTaskInput> = z.object({
	siloId: z.string().trim().min(1).max(128),
	serverId: z.string().trim().min(1).max(128),
	registrationDigest: z.string().trim().min(1).max(128),
}).strict();

/** Checks the small discovery result that may be saved in task and product state. */
const _OBSERVATION_SCHEMA = z.object({
	protocolVersion: z.string().trim().min(1).max(64),
	evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(function _EvidenceDigest(value): `sha256:${string}` { return value as `sha256:${string}`; }),
}).strict();

/**
 * Rejects malformed task input without echoing its fields into worker diagnostics.
 *
 * Called by: task-key generation and the registered MCP protocol-check handler.
 * @param input - Saved input to check before it selects a catalogue row.
 * @throws {@link DurableTaskTerminalError} when the task input cannot be trusted.
 * @see {@link McpEraProbeTaskInput}
 */
export function __AssertMcpEraProbeTaskInput(input: McpEraProbeTaskInput): void
{
	if (!_TASK_INPUT_SCHEMA.safeParse(input).success)
	{
		throw new DurableTaskTerminalError("MCP era-probe task input is invalid.");
	}
}

/**
 * Parses remote discovery evidence before it reaches a checkpoint or catalogue row.
 *
 * Called by: the MCP protocol-check workflow after its external adapter responds.
 * @param value - Untrusted observation returned by the external protocol adapter.
 * @returns The checked observation that may be saved as workflow evidence.
 * @throws {@link DurableTaskTerminalError} when the observation is malformed.
 * @see {@link McpEraProbeObservation}
 */
export function __ParseMcpEraProbeObservation(value: McpEraProbeObservation): McpEraProbeObservation
{
	const parsed = _OBSERVATION_SCHEMA.safeParse(value);
	if (!parsed.success)
	{
		throw new DurableTaskTerminalError("MCP era-probe response is invalid.");
	}
	return parsed.data;
}
