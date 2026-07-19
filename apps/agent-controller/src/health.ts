import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { ControllerHealth, ControllerHealthOptions } from "./health.types.js";

/** Creates the private, bodyless liveness and reconciliation-readiness probe listener. */
export function _CreateControllerHealth(options: ControllerHealthOptions): ControllerHealth
{
	return new _ControllerHealth(options);
}

/** Tracks controller lifecycle without introducing a product-facing network authority. */
class _ControllerHealth implements ControllerHealth
{
	/** Fixed local TCP listener. */
	private readonly server: Server;
	/** Requested probe port, which may be zero in tests. */
	private readonly requestedPort: number;
	/** True once one full controller reconciliation has completed successfully. */
	private ready = false;
	/** False only after graceful shutdown begins. */
	private live = true;

	/** Creates a probe listener that never calls Kubernetes or OpenCrane from probe requests. */
	constructor(options: ControllerHealthOptions)
	{
		const health = this;
		this.requestedPort = options.port;
		this.server = createServer(function _respond(request: IncomingMessage, response: ServerResponse)
		{
			const path = new URL(request.url ?? "/", "http://localhost").pathname;
			if (path === "/livez")
			{
				response.writeHead(health.live ? 204 : 503);
				response.end();
				return;
			}
			if (path === "/readyz")
			{
				response.writeHead(health.ready && health.live ? 204 : 503);
				response.end();
				return;
			}
			response.writeHead(404);
			response.end();
		});
	}

	/** Begins the listener before the first reconciliation can set readiness. */
	async listen(): Promise<void>
	{
		const health = this;
		await new Promise<void>(function _listen(resolve: () => void, reject: (error: Error) => void)
		{
			health.server.once("error", reject);
			health.server.listen(health.requestedPort, "0.0.0.0", function _listening()
			{
				health.server.off("error", reject);
				resolve();
			});
		});
	}

	/** Records that the complete authority-and-Kubernetes reconciliation path succeeded. */
	markReady(): void
	{
		if (this.live) this.ready = true;
	}

	/** Removes this pod from readiness as soon as a reconciliation fails. */
	markUnready(): void
	{
		this.ready = false;
	}

	/** Makes probes unready and closes the listener before process termination. */
	async shutdown(): Promise<void>
	{
		this.live = false;
		this.ready = false;
		const health = this;
		await new Promise<void>(function _close(resolve: () => void, reject: (error: Error) => void)
		{
			health.server.close(function _closed(error?: Error)
			{
				if (error === undefined) resolve();
				else reject(error);
			});
		});
	}

	/** Returns the resolved listener port for direct local probe tests. */
	port(): number
	{
		const address = this.server.address();
		if (address === null || typeof address === "string") throw new Error("controller health listener is not running");
		return address.port;
	}
}
