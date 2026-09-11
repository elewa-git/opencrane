import { ConversationStatusTones } from "@opencrane/elements/conversation";
import type { MessageEntry, ToolCallLogEntry } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, type ConversationCreationDirectory, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import { _ConversationEntryViews, _ConversationOnboardingContinuationPresentation, _ConversationRailIdentityPresentation, _ConversationSessionRailItems, _ConversationSummaryPresentation, _ConversationToolStatus } from "../conversation-workspace.mapper";
import { ConversationSessionRailIconStates } from "../conversation-workspace-feature.types";
import { ConversationWorkspaceTranscriptEntryKinds } from "../presentation/conversation-workspace-presentation.types";

/** Builds a direct-conversation summary without introducing display names. */
function _Summary(): ConversationSummary
{
	return { id: "conversation-1", mode: ConversationModes.Direct, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["subject-secret", "other-secret"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T11:08:00.000Z" };
}

/** Builds the member directory already loaded for conversation creation. */
function _Directory(): ConversationCreationDirectory
{
	return { companyAssistants: [], participants: [{ participantRef: "subject-secret", isSelf: true, label: "You" }, { participantRef: "other-secret", isSelf: false, label: "Amina" }, { participantRef: "member-3", isSelf: false, label: "Kamau" }, { participantRef: "member-4", isSelf: false, label: "Amina" }, { participantRef: "member-5", isSelf: false, label: "Grace" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Nova" } };
}

/** Builds a participant message containing unsafe markup. */
function _Message(): MessageEntry
{
	return { schemaVersion: 1, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId: "conversation-1", position: "1", author: { kind: "human", principalId: "principal-1", participantId: "participant-1", issuer: "https://issuer.example", authenticatedAt: "2026-08-12T11:08:00.000Z", name: "Jente Rosseel", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: "command-1", correlationId: "request-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-08-12T11:08:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:digest" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };
}

/** Builds one canonical tool lifecycle fact without any result payload. */
function _Tool(phase: ToolCallLogEntry["phase"], position: string, toolName = "Customer records"): ToolCallLogEntry
{
	return { schemaVersion: 1, id: `tool-entry-${position}`, conversationId: "conversation-1", position, author: { kind: "system", systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: "run-private", causationId: "cause-private", correlationId: "correlation-private", idempotencyKey: `tool-entry-${position}`, occurredAt: "2026-08-12T11:08:01.000Z", attestation: null, kind: "log", summary: "Tool status", detailsRef: null, logKind: "tool_call", toolCallId: "tool-call-private", toolKind: "mcp", toolName, phase, resultArtifactRevisionId: phase === "completed" ? "artifact-private" : null };
}

describe("Conversation workspace presentation", function _ConversationWorkspacePresentation()
{
	it("uses generic participant labels without exposing opaque references", function _GenericLabels()
	{
		const summary = _ConversationSummaryPresentation(_Summary(), null);
		expect(summary).toMatchObject({ title: "Direct conversation", participantLabel: "2 participants" });
		expect(JSON.stringify(summary)).not.toContain("subject-secret");
		expect(JSON.stringify(summary)).not.toContain("other-secret");
	});

	it("uses the selected member's name for a direct chat", function _NamedDirect()
	{
		const summary = _ConversationSummaryPresentation(_Summary(), _Directory());
		expect(summary).toMatchObject({ title: "Amina", participantLabel: "You and Amina" });
		expect(JSON.stringify(summary)).not.toContain("other-secret");
	});

	it("makes a company assistant chat's shared participant audience explicit", function _SharedAssistantAudience()
	{
		const directory = { ..._Directory(), companyAssistants: [{ agentServiceId: "company", displayName: "Company assistant" }] };
		const summary = _ConversationSummaryPresentation({ ..._Summary(), mode: ConversationModes.AgentSession, agentServiceId: "company", participantRefs: ["subject-secret", "other-secret", "member-3"] }, directory);
		expect(summary).toMatchObject({ title: "Company assistant", participantLabel: "Shared assistant chat · 3 participants" });
		expect(JSON.stringify(summary)).not.toContain("subject-secret");
	});

	it("preserves the personal assistant's private participant label", function _PersonalAssistantAudience()
	{
		const summary = _ConversationSummaryPresentation({ ..._Summary(), mode: ConversationModes.AgentSession, agentServiceId: "agent-1", participantRefs: ["subject-secret"] }, _Directory());
		expect(summary).toMatchObject({ title: "Nova", participantLabel: "You and your Agent" });
	});

	it("names groups from other members and counts names beyond the first two", function _NamedGroup()
	{
		const summary = _ConversationSummaryPresentation({ ..._Summary(), mode: ConversationModes.Group, participantRefs: ["other-secret", "subject-secret", "member-3", "member-4", "member-5"] }, _Directory());
		expect(summary).toMatchObject({ title: "Amina, Kamau +2", participantLabel: "5 participants" });
	});

	it("keeps different members with the same display name in the group title", function _DuplicateNames()
	{
		const summary = _ConversationSummaryPresentation({ ..._Summary(), mode: ConversationModes.Group, participantRefs: ["subject-secret", "other-secret", "member-4"] }, _Directory());
		expect(summary).toMatchObject({ title: "Amina, Amina", participantLabel: "3 participants" });
	});

	it("uses generic text when a participant is absent from the current directory", function _MissingMember()
	{
		const summary = _ConversationSummaryPresentation({ ..._Summary(), mode: ConversationModes.Group, participantRefs: ["subject-secret", "other-secret", "removed-secret"] }, _Directory());
		expect(summary).toMatchObject({ title: "Amina, Participant", participantLabel: "3 participants" });
		expect(JSON.stringify(summary)).not.toContain("removed-secret");
	});

	it("sanitizes message markup and keeps authorship generic", function _SafeMessage()
	{
		const view = _ConversationEntryViews([_Message()], { "payload-1": "Hello <script>alert('secret')</script>" })[0]!;
		expect(view.kind).toBe(ConversationWorkspaceTranscriptEntryKinds.Message);
		if (view.kind !== ConversationWorkspaceTranscriptEntryKinds.Message)
			throw new Error("Expected a message presentation.");
		expect(view.message.authorName).toBe("Jente Rosseel");
		expect(view.richText.html).not.toContain("<script");
		expect(view.richText.html).toContain("Hello");
	});

	it("maps every tool phase without claiming that a final answer exists", function _ToolPhases()
	{
		const phases: readonly ToolCallLogEntry["phase"][] = ["requested", "running", "completed", "failed", "cancelled", "recovery_required"];
		const views = phases.map((phase, index) => _ConversationEntryViews([_Tool(phase, `${index + 1}`)], {})[0]!);
		expect(views.map(view => view.kind)).toEqual(phases.map(() => ConversationWorkspaceTranscriptEntryKinds.ToolActivity));
		expect(views.map(view => view.kind === ConversationWorkspaceTranscriptEntryKinds.ToolActivity ? view.status.label : null)).toEqual(["Tool requested", "Tool running", "Tool result received", "Tool could not finish", "Tool stopped", "Tool needs attention"]);
		expect(views.map(view => view.kind === ConversationWorkspaceTranscriptEntryKinds.ToolActivity ? view.status.tone : null)).toEqual([ConversationStatusTones.Neutral, ConversationStatusTones.Neutral, ConversationStatusTones.Neutral, ConversationStatusTones.Danger, ConversationStatusTones.Danger, ConversationStatusTones.Attention]);
		expect(views[2]!.kind === ConversationWorkspaceTranscriptEntryKinds.ToolActivity ? views[2]!.status.detail : "").toContain("may still be preparing its answer");
		expect(views.every(view => view.kind !== ConversationWorkspaceTranscriptEntryKinds.ToolActivity || view.status.detail?.startsWith("Customer records:") === true)).toBe(true);
	});

	it("preserves a long display-safe tool name as text for the presentation component to escape", function _ToolName()
	{
		const toolName = `${"Customer records archive ".repeat(6)}<review>`;
		const view = _ConversationEntryViews([_Tool("completed", "1", toolName)], {})[0]!;
		expect(view.kind).toBe(ConversationWorkspaceTranscriptEntryKinds.ToolActivity);
		if (view.kind !== ConversationWorkspaceTranscriptEntryKinds.ToolActivity)
			throw new Error("Expected tool activity presentation.");
		expect(view.status.detail).toBe(`${toolName}: result received. The assistant may still be preparing its answer.`);
	});

	it("rejects an unsupported tool phase instead of returning an empty status", function _FutureToolPhase()
	{
		expect(function _MapFuturePhase() { return _ConversationToolStatus({ ..._Tool("completed", "1"), phase: "future-phase" as never }); }).toThrow("Unsupported tool-call phase: future-phase");
	});

	it("coalesces each tool call at its latest chronological position without exposing coordinates", function _LatestToolFact()
	{
		const answer = { ..._Message(), id: "answer", position: "4", author: { kind: "agent", agentIdentityId: "agent-1", agentServiceId: "service-1", name: "Company assistant", avatarArtifactRevisionId: null }, runId: "run-private", blocks: [{ ..._Message().blocks[0]!, id: "answer-block" }] } satisfies MessageEntry;
		const views = _ConversationEntryViews([_Message(), _Tool("running", "2"), _Tool("completed", "3"), answer], { "payload-1": "Saved answer" });
		expect(views.map(view => view.kind)).toEqual([ConversationWorkspaceTranscriptEntryKinds.Message, ConversationWorkspaceTranscriptEntryKinds.ToolActivity, ConversationWorkspaceTranscriptEntryKinds.Message]);
		expect(views[1]).toMatchObject({ kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity, status: { label: "Tool result received" } });
		const rendered = JSON.stringify(views);
		expect(rendered).not.toContain("tool-call-private");
		expect(rendered).not.toContain("artifact-private");
		expect(rendered).not.toContain("run-private");
		expect(rendered).toContain("Customer records");
	});

	it("places completed onboarding inside one session rail without a fake conversation id", function _UnifiedRail()
	{
		const onboarding = { id: "onboarding-1", title: "Welcome to OpenCrane", completedLabel: "09:15" };
		const rows = _ConversationSessionRailItems([_ConversationSummaryPresentation(_Summary(), null)], onboarding);

		expect(rows[0]).toMatchObject({ title: "Welcome", iconState: ConversationSessionRailIconStates.Completed, conversationId: null, archived: false });
		expect(rows[1]).toMatchObject({ title: "Direct conversation", iconState: ConversationSessionRailIconStates.Direct, conversationId: "conversation-1" });
		expect("detail" in rows[0]!).toBe(false);
		expect("updatedLabel" in rows[0]!).toBe(false);
	});

	it("maps every chat type and lets closed status override its type", function _SemanticRailStates()
	{
		const direct = _ConversationSummaryPresentation(_Summary(), null);
		const agent = _ConversationSummaryPresentation({ ..._Summary(), id: "agent", mode: ConversationModes.AgentSession }, _Directory());
		const group = _ConversationSummaryPresentation({ ..._Summary(), id: "group", mode: ConversationModes.Group }, null);
		const closed = _ConversationSummaryPresentation({ ..._Summary(), id: "closed", mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Closed }, null);

		expect([direct.iconState, agent.iconState, group.iconState, closed.iconState]).toEqual([ConversationSessionRailIconStates.Direct, ConversationSessionRailIconStates.AgentSession, ConversationSessionRailIconStates.Group, ConversationSessionRailIconStates.Closed]);
	});

	it("uses only the generic directory self label in the rail footer", function _SafeRailIdentity()
	{
		const identity = _ConversationRailIdentityPresentation({ companyAssistants: [], participants: [{ participantRef: "opaque-secret", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });

		expect(identity).toEqual({ name: "You", detail: "Private workspace", initials: "Y" });
		expect(JSON.stringify(identity)).not.toContain("opaque-secret");
	});

	it("keeps history continuation truthful for every personal Agent status", function _HistoryContinuation()
	{
		const self = { participantRef: "subject-secret", isSelf: true, label: "You" } as const;
		const participants = [self, { participantRef: "other-secret", isSelf: false, label: "Participant 1" }] as const;
		const ready = _ConversationOnboardingContinuationPresentation({ companyAssistants: [], participants: [self], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-secret", displayName: "Nova" } });
		const unavailable = _ConversationOnboardingContinuationPresentation({ participants, personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });
		const ambiguous = _ConversationOnboardingContinuationPresentation({ participants, personalAgentStatus: ConversationPersonalAgentStatuses.Ambiguous, personalAgent: null });
		const withoutDestination = _ConversationOnboardingContinuationPresentation({ companyAssistants: [], participants: [self], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });
		const unknown = _ConversationOnboardingContinuationPresentation(null);
		const withoutMembership = _ConversationOnboardingContinuationPresentation({ companyAssistants: [], participants: [], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });

		expect(ready.capabilityNote).toContain("continue with your Agent");
		expect(unavailable.capabilityNote).toContain("Direct and group sessions are available");
		expect(ambiguous.capabilityNote).toContain("repairs the personal Agent assignment");
		expect([ready, unavailable, ambiguous].every(presentation => presentation.canStartNewChat)).toBe(true);
		expect(withoutDestination.capabilityNote).toContain("No participant or personal Agent");
		expect([withoutDestination, unknown, withoutMembership].every(presentation => !presentation.canStartNewChat)).toBe(true);
	});
});
