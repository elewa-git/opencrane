import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { ConversationSocketFrameKinds } from "@opencrane/models/conversations";
import { __CreateSelfConversationSocketServer, __SubmitSelfConversationSocketCommand } from "../self-conversation-socket";
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

	it("sends AgentSession input to immutable ConversationComputer admission", async function _AdmitsComputerInput()
	{
		const admitted = vi.fn().mockResolvedValue({ outcome: "accepted", inputEntryId: "f8b48e77-9e1c-4dac-8e24-fac21e751ef5" });
		const send = vi.fn();
		await __SubmitSelfConversationSocketCommand(
			{ readyState: 1, send } as never,
			{ authority: { submitMessage: vi.fn() }, computerInputs: { admit: admitted }, logger: { error: vi.fn() } } as never,
			{ siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.test", subjectId: "user-1" },
			"conversation-1",
			JSON.stringify({ type: ConversationSocketFrameKinds.ComputerInputSubmit, requestId: "667f1b39-8033-492a-b7c7-4a3c689dbfc8", inputId: "f8b48e77-9e1c-4dac-8e24-fac21e751ef5", text: "Hello" }),
		);

		expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: ConversationSocketFrameKinds.ComputerInputAccepted, requestId: "667f1b39-8033-492a-b7c7-4a3c689dbfc8", outcome: "accepted", inputEntryId: "f8b48e77-9e1c-4dac-8e24-fac21e751ef5" });
		expect(admitted).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.test", subjectId: "user-1" }, "conversation-1", { inputId: "f8b48e77-9e1c-4dac-8e24-fac21e751ef5", text: "Hello" });
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
