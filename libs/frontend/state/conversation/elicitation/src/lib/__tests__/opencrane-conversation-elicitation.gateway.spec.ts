import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

import { OpenCraneConversationElicitationGateway } from "../opencrane-conversation-elicitation.gateway";

const _ELICITATION = {
	version: CONVERSATION_ELICITATION_VERSION,
	requestId: "request-1",
	conversationId: "conversation-1",
	runId: "run-1",
	attempt: 1,
	assignedParticipantId: "user-1",
	purpose: ElicitationPurposes.RuntimeInput,
	state: ElicitationRequestStates.Requested,
	body: { kind: ElicitationBodyKinds.FreeText, prompt: "Which option should I use?", maximumLength: 200, allowEmpty: false },
	requiresStepUp: false,
	requestedAt: "2026-08-11T08:00:00.000Z",
	expiresAt: "2026-08-11T09:00:00.000Z",
};

/** Construct the adapter with a controlled generated client. */
function _Gateway(client: object): OpenCraneConversationElicitationGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationElicitationGateway(); });
}

describe("OpenCraneConversationElicitationGateway", function _Suite()
{
	it("lists validated pending requests for the selected conversation", async function _ListsOpen()
	{
		const GET = vi.fn().mockResolvedValue({ data: { elicitations: [_ELICITATION] }, error: undefined, response: { ok: true, status: 200 } });
		const elicitations = await _Gateway({ GET }).listOpen("conversation-1");
		expect(GET).toHaveBeenCalledWith("/me/conversations/{conversationId}/elicitations", { params: { path: { conversationId: "conversation-1" } } });
		expect(elicitations).toEqual([_ELICITATION]);
	});

	it("rejects a malformed request before it enters browser state", async function _RejectsMalformedRequest()
	{
		const GET = vi.fn().mockResolvedValue({ data: { elicitations: [{ ..._ELICITATION, assignedParticipantId: "" }] }, error: undefined, response: { ok: true, status: 200 } });
		await expect(_Gateway({ GET }).listOpen("conversation-1")).rejects.toThrow("elicitation response has invalid coordinates");
	});

	it("rejects a response above the server-owned list bound", async function _RejectsOversizedList()
	{
		const GET = vi.fn().mockResolvedValue({ data: { elicitations: Array.from({ length: 51 }, function _Request() { return _ELICITATION; }) }, error: undefined, response: { ok: true, status: 200 } });
		await expect(_Gateway({ GET }).listOpen("conversation-1")).rejects.toThrow("open elicitation list exceeds its response bound");
	});

	it("rejects a request projected from another conversation", async function _RejectsMismatchedConversation()
	{
		const GET = vi.fn().mockResolvedValue({ data: { elicitations: [{ ..._ELICITATION, conversationId: "conversation-2" }] }, error: undefined, response: { ok: true, status: 200 } });
		await expect(_Gateway({ GET }).listOpen("conversation-1")).rejects.toThrow("open elicitation list does not match the selected conversation");
	});
});
