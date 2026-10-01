import { Injector, signal } from "@angular/core";
import { describe, expect, it } from "vitest";

import { SessionStore } from "@opencrane/state/core";
import { CONVERSATION_CURRENT_SUBJECT, CONVERSATION_PERSONAL_RUNS_GATEWAY, CONVERSATION_GROUP_CHILD_GATEWAY, CONVERSATION_COMPUTER_REVIEW_GATEWAY, CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY, OpenCraneConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";

import { provideConversationWorkspaceComposition } from "../conversation-workspace.providers";

describe("Conversation workspace app providers", function _ConversationWorkspaceAppProviders()
{
	it("projects only the current verified session subject and stays empty before authentication", function _SessionSubject()
	{
		const user = signal<{ sub: string } | undefined>(undefined);
		const injector = Injector.create({ providers: [...provideConversationWorkspaceComposition(), { provide: SessionStore, useValue: { user } }] });
		const subject = injector.get(CONVERSATION_CURRENT_SUBJECT);
		expect(subject()).toBeNull();
		user.set({ sub: "verified-current-subject" });
		expect(subject()).toBe("verified-current-subject");
		user.set(undefined);
		expect(subject()).toBeNull();
	});

	it("binds typed workspace, stream, and asset ports to concrete web adapters", function _TypedBindings()
	{
		expect(provideConversationWorkspaceComposition()).toEqual(expect.arrayContaining([
			OpenCraneConversationEventStream,
			OpenCraneConversationWorkspaceGateway,
			{ provide: CONVERSATION_WORKSPACE_GATEWAY, useExisting: OpenCraneConversationWorkspaceGateway },
			{ provide: CONVERSATION_PERSONAL_RUNS_GATEWAY, useExisting: OpenCraneConversationWorkspaceGateway },
			{ provide: CONVERSATION_GROUP_CHILD_GATEWAY, useExisting: OpenCraneConversationWorkspaceGateway },
			{ provide: CONVERSATION_COMPUTER_REVIEW_GATEWAY, useExisting: OpenCraneConversationWorkspaceGateway },
			{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useExisting: OpenCraneConversationEventStream },
			{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway },
			{ provide: ELICITATION_GATEWAY, useClass: OpenCraneConversationElicitationGateway }
		]));
	});
});
