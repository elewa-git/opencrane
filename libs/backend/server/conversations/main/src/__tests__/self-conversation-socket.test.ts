import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";

import { describe, expect, it } from "vitest";

import { __CreateSelfConversationSocketServer } from "../self-conversation-socket";
import type { SelfConversationSocketDependencies } from "../self-conversation-socket.types";

describe("__CreateSelfConversationSocketServer", function _SelfConversationSocketServer()
{
	it("closes a public upgrade that is not a conversation socket", async function _ClosesUnrelatedUpgrade()
	{
		const server = createServer();
		const sockets = __CreateSelfConversationSocketServer({} as SelfConversationSocketDependencies);
		sockets.attach(server);
		await new Promise<void>(function _Listen(resolve) { server.listen(0, "127.0.0.1", resolve); });
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("test server did not select a TCP port");
		const client = connect(address.port, "127.0.0.1");
		await once(client, "connect");
		client.write("GET /not-a-conversation HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
		await expect(_ClosedWithin(client, 250)).resolves.toBe(true);
		await new Promise<void>(function _Close(resolve) { server.close(function _Closed() { resolve(); }); });
	});
});

/** Wait for the rejected TCP client to close without leaving a runaway test connection. */
function _ClosedWithin(client: import("node:net").Socket, milliseconds: number): Promise<boolean>
{
	return new Promise<boolean>(function _Wait(resolve)
	{
		const timeout = setTimeout(function _TimedOut() { client.destroy(); resolve(false); }, milliseconds);
		client.once("close", function _Closed() { clearTimeout(timeout); resolve(true); });
	});
}
