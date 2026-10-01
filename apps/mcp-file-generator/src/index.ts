import "./instrument";

import { type Server } from "node:http";

import { MCP_FILE_GENERATOR_HOST, MCP_FILE_GENERATOR_PORT, __CreateMcpFileGeneratorServer } from "@opencrane/backend/agents/runtime/mcp-file-generator";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _log } from "./log";

/** Server kept at module scope so both operating-system signals close the same listener. */
const _server = __CreateMcpFileGeneratorServer(_log);
/** Prevents two signals from starting two shutdown sequences. */
let _closing = false;

/** Starts the fixed loopback listener used by the companion container. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(_log);
	process.once("exit", unbindConsole);
	_server.on("error", function _ServerError(err): void
	{
		_log.error({ err, operation: "mcp_file_generator.server" }, "MCP file generator server failed");
		void _Shutdown("server_error");
	});
	process.once("SIGTERM", function _Sigterm(): void { void _Shutdown("SIGTERM"); });
	process.once("SIGINT", function _Sigint(): void { void _Shutdown("SIGINT"); });
	await _Listen(_server);
	_log.info({ host: MCP_FILE_GENERATOR_HOST, port: MCP_FILE_GENERATOR_PORT }, "MCP file generator listening");
}

/** Waits until Node has bound the listener or reports its startup error. */
function _Listen(server: Server): Promise<void>
{
	return new Promise<void>(function _Start(resolve, reject)
	{
		server.once("error", reject);
		server.listen(MCP_FILE_GENERATOR_PORT, MCP_FILE_GENERATOR_HOST, function _Listening()
		{
			server.off("error", reject);
			resolve();
		});
	});
}

/** Stops accepting requests and flushes telemetry once. */
async function _Shutdown(signal: string): Promise<void>
{
	if (_closing)
		return;
	_closing = true;
	_log.info({ signal }, "MCP file generator shutting down");
	await new Promise<void>(function _Close(resolve)
	{
		_server.close(function _Closed(): void { resolve(); });
		_server.closeAllConnections();
	});
	await ___ShutdownTelemetry();
}

void _Main().catch(function _Fatal(err): void
{
	_log.error({ err }, "MCP file generator failed to start");
	void ___ShutdownTelemetry().finally(function _SetFailure(): void { process.exitCode = 1; });
});
