import { readFile } from "node:fs/promises";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import { McpCompanionCommandKinds, McpCompanionFailureCodes, McpCompanionRemoteClaimOutcomes, McpCompanionRunOutcomes, type McpCompanionCommand, type McpCompanionDependencies, type McpCompanionIdentity } from "./mcp-companion.types";

/** Read and validate the opaque mounted reference and immutable Pod UID once at startup. */
export async function __ReadMcpCompanionIdentity(referencePath: string, podUid: string): Promise<McpCompanionIdentity>
{
	const executionReference = (await readFile(referencePath, "utf8")).trim();
	if (!_Coordinate(executionReference, 256))
		throw new Error("MCP companion execution reference was invalid");
	if (!_Coordinate(podUid, 128))
		throw new Error("MCP companion Pod UID was invalid");
	return { executionReference, podUid };
}

/** Claim and execute at most one command before returning a terminal process outcome. */
export async function __RunMcpCompanion(dependencies: McpCompanionDependencies, identity: McpCompanionIdentity, signal: AbortSignal): Promise<McpCompanionRunOutcomes>
{
	await dependencies.server.ready(signal);
	const command = await _ClaimWhenRegistered(dependencies, identity, signal);
	if (command === McpCompanionRemoteClaimOutcomes.Terminal)
	{
		dependencies.log.info({}, "MCP companion stopped because its saved execution had ended");
		return McpCompanionRunOutcomes.Stopped;
	}
	if (command === null)
	{
		dependencies.log.info({}, "MCP companion found no command");
		return McpCompanionRunOutcomes.Idle;
	}
	return ___DoWithTrace("mcp_companion.command.execute", { commandKind: command.kind }, async function _ExecuteCommand(): Promise<McpCompanionRunOutcomes>
	{
		let completion;
		try
		{
			completion = await _Execute(dependencies, command, signal);
		}
		catch (err)
		{
			if (signal.aborted)
				throw err;
			const failureCode = command.kind === McpCompanionCommandKinds.Discovery ? McpCompanionFailureCodes.DiscoveryFailed : McpCompanionFailureCodes.ToolCallFailed;
			await dependencies.remote.fail(identity, command.lease, failureCode, signal);
			dependencies.log.warn({ commandKind: command.kind, failureCode }, "MCP companion command failed and was reported");
			return McpCompanionRunOutcomes.Failed;
		}
		await dependencies.remote.complete(identity, command.lease, completion, signal);
		dependencies.log.info({ commandKind: command.kind }, "MCP companion command completed");
		return McpCompanionRunOutcomes.Completed;
	});
}

/** Wait for controller Pod registration instead of letting the one-shot Job exit early. */
async function _ClaimWhenRegistered(dependencies: McpCompanionDependencies, identity: McpCompanionIdentity, signal: AbortSignal): Promise<McpCompanionCommand | McpCompanionRemoteClaimOutcomes.Terminal | null>
{
	while (!signal.aborted)
	{
		const command = await dependencies.remote.claim(identity, signal);
		if (command !== null)
			return command;
		await new Promise<void>(function _Wait(resolve)
		{
			function _Complete(): void
			{
				clearTimeout(timer);
				signal.removeEventListener("abort", _Complete);
				resolve();
			}
			const timer = setTimeout(_Complete, 100);
			signal.addEventListener("abort", _Complete, { once: true });
		});
	}
	return null;
}

/** Run the exchange selected by the server-issued command kind. */
async function _Execute(dependencies: McpCompanionDependencies, command: McpCompanionCommand, signal: AbortSignal)
{
	if (command.kind === McpCompanionCommandKinds.Discovery)
	{
		const tools = await dependencies.server.discover(_LeaseSignal(command, signal));
		return { kind: McpCompanionCommandKinds.Discovery, tools } as const;
	}
	const result = await dependencies.server.call(command, signal);
	return { kind: McpCompanionCommandKinds.Invocation, result } as const;
}

/** Bind all companion work to the database-issued command deadline. */
function _LeaseSignal(command: McpCompanionCommand, signal: AbortSignal): AbortSignal
{
	const remainingMilliseconds = Date.parse(command.lease.expiresAt) - Date.now();
	if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0)
		throw new Error("MCP companion command lease expired before execution");
	return AbortSignal.any([signal, AbortSignal.timeout(Math.min(remainingMilliseconds, 2_147_483_647))]);
}

/** Accept one bounded non-empty mounted coordinate without control characters. */
function _Coordinate(value: string, maximumLength: number): boolean
{
	return value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/u.test(value);
}
