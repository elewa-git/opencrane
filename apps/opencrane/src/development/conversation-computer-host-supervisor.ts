import type { Server } from "node:http";

import type { HostDevelopmentConversationComputerSupervisorOptions } from "./conversation-computer-host-realizer.types";
import { _RunDevelopmentCleanup } from "./cleanup";

/** Close an HTTP listener after it stops accepting new requests. */
function _CloseServer(server: Server): Promise<void>
{
	return new Promise<void>(function _Closing(resolve, reject): void
	{
		server.close(function _Closed(error?: Error): void
		{
			if (error)
			{
				reject(error);
			}
			else
			{
				resolve();
			}
		});
	});
}

/** Own the loopback private listener and every child that authenticates to it. */
export class HostDevelopmentConversationComputerSupervisor
{
	/** Retains the listener once start succeeds. */
	private server: Server | null = null;

	/** Prevents signal and lifecycle cleanup from closing resources twice. */
	private stopping: Promise<void> | null = null;

	/** Supplies the private app, port, and child-process owner. */
	public constructor(private readonly options: HostDevelopmentConversationComputerSupervisorOptions) {}

	/** Start the private app on IPv4 loopback and attach process cleanup. */
	public async start(): Promise<{ readonly stop: () => Promise<void> }>
	{
		if (this.server !== null)
		{
			throw new Error("Host conversation computer supervisor already started");
		}
		this.server = await new Promise<Server>((resolve, reject): void =>
		{
			const server = this.options.app.listen(this.options.port, "127.0.0.1");
			server.once("error", reject);
			server.once("listening", function _Ready(): void
			{
				server.removeListener("error", reject);
				resolve(server);
			});
		});
		return { stop: this.stop.bind(this) };
	}

	/** Stop accepting private requests before stopping all authenticated children. */
	public async stop(): Promise<void>
	{
		if (this.stopping !== null)
		{
			return this.stopping;
		}
		this.stopping = this._Stop();
		return this.stopping;
	}

	/** Perform supervisor cleanup once. */
	private async _Stop(): Promise<void>
	{
		const server = this.server;
		this.server = null;
		await _RunDevelopmentCleanup([[
			function _CloseListener(): Promise<void> { return server === null ? Promise.resolve() : _CloseServer(server); },
			this.options.processes.close,
		]], "Host conversation-computer supervisor cleanup failed");
	}
}
