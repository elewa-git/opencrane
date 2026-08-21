import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationEventStreamMessageError, type ConversationEventStream } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, ConversationWorkspaceGatewayErrorKinds } from "@opencrane/state/conversation/workspace";

import { OpenCraneConversationWorkspaceGateway } from "../opencrane-conversation-workspace.gateway";

/** Creates the workspace gateway with the selected conversation transport port. */
function _Gateway(stream: ConversationEventStream): OpenCraneConversationWorkspaceGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: {} } }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }] });
	return runInInjectionContext(injector, function _Create(): OpenCraneConversationWorkspaceGateway { return new OpenCraneConversationWorkspaceGateway(); });
}

describe("OpenCraneConversationWorkspaceGateway", function _Suite()
{
	it("submits participant messages through the workspace event-stream port", async function _SubmitsThroughPort()
	{
		const submit = vi.fn().mockResolvedValue(undefined);
		const stream = { stream: vi.fn(), submit } as unknown as ConversationEventStream;
		await expect(_Gateway(stream).send({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] })).resolves.toBeUndefined();
		expect(submit).toHaveBeenCalledWith({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] });
	});

	it("maps a transport-proven access loss to the workspace authority error", async function _MapsAccessLoss()
	{
		const submit = vi.fn().mockRejectedValue(new ConversationEventStreamMessageError("conversation_unavailable"));
		const stream = { stream: vi.fn(), submit } as unknown as ConversationEventStream;
		await expect(_Gateway(stream).send({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] })).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
	});
});
