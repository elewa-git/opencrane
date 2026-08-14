import { applicationConfig, type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";

import { ConversationComposerComponent, ConversationComposerStates } from "@opencrane/elements/conversation";
import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/state/conversation/elicitation";
import { AgentThreadAccessStates, AgentThreadAdmissionStates, AgentThreadDeliveryKinds, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadSummaryTargetKinds, AgentThreadTimelineEntryKinds, AGENT_THREAD_GATEWAY, type AgentThreadGateway, type AgentThreadSnapshot, type AgentThreadSummaryPresentation } from "@opencrane/state/conversation/agent-threads";

import { AgentThreadAccessChangedComponent } from "../agent-thread-access-changed.component.js";
import { AgentThreadDeliveryComponent } from "../agent-thread-delivery.component.js";
import { AgentThreadMentionControlComponent } from "../agent-thread-mention-control.component.js";
import { AgentThreadPageComponent } from "../agent-thread-page.component.js";
import { AgentThreadSummaryComponent } from "../agent-thread-summary.component.js";
import { AgentThreadUnavailableComponent } from "../agent-thread-unavailable.component.js";
import type { AgentThreadAgentOption } from "../agent-thread-feature.types.js";

/** Display-safe services offered by the controlled group-composer selector. */
const _AGENT_OPTIONS: readonly AgentThreadAgentOption[] =
[
	{ agentServiceId: "service-nova", label: "Nova pod assistant" },
	{ agentServiceId: "service-research", label: "Research assistant" }
];

/** Build one compact parent summary state. */
function _Summary(state: AgentThreadSummaryStates, overrides: Partial<AgentThreadSummaryPresentation> = {}): AgentThreadSummaryPresentation
{
	return { childConversationId: "child-pricing", state, access: AgentThreadAccessStates.Available, title: "Compare supplier pricing", preview: "The counterproposal moves most risk into the renewal clause and changes the payment date.", unreadCount: 2, participants: [{ label: "Alex Kimani", initials: "AK" }, { label: "Jente Rosseel", initials: "JR" }, { label: "Nova Agent", initials: "N" }], replyCount: 7, runCount: 2, updateCount: 9, lastUpdateLabel: "12:14", assetCount: 1, resultLabel: "Pricing comparison", target: { kind: AgentThreadSummaryTargetKinds.Thread, id: "agent-thread-origin" }, ...overrides };
}

/** Complete summary catalogue required by the parent-message contract. */
const _SUMMARIES: readonly AgentThreadSummaryPresentation[] =
[
	_Summary(AgentThreadSummaryStates.Starting),
	_Summary(AgentThreadSummaryStates.Working),
	_Summary(AgentThreadSummaryStates.Waiting),
	_Summary(AgentThreadSummaryStates.Retrying),
	_Summary(AgentThreadSummaryStates.Completed),
	_Summary(AgentThreadSummaryStates.CompletedAfterRetry),
	_Summary(AgentThreadSummaryStates.Failed),
	_Summary(AgentThreadSummaryStates.Cancelled),
	_Summary(AgentThreadSummaryStates.Closed),
	_Summary(AgentThreadSummaryStates.Restricted, { access: AgentThreadAccessStates.Restricted, preview: undefined }),
	_Summary(AgentThreadSummaryStates.CreationFailed),
	_Summary(AgentThreadSummaryStates.Reconnecting)
];

/** Build one full child projection with ordered run, message, and delivery entries. */
function _Snapshot(state: AgentThreadRunStates = AgentThreadRunStates.Working, overrides: Partial<AgentThreadSnapshot> = {}): AgentThreadSnapshot
{
	const delivery = _DeliveryForRun(state);
	return {
		parentConversationId: "group-launch",
		childConversationId: "child-pricing",
		origin: { parentTitle: "nova-pitch", parentMessageId: "root-ask", invokedByName: "Alex Kimani", invokedByInitials: "AK", ask: "@agent compare the supplier counterproposal and flag the renewal risk", timestampLabel: "11:07" },
		summary: _Summary(_SummaryStateForRun(state)),
		recovery: AgentThreadRecoveryStates.Live,
		timeline: [
			{ kind: AgentThreadTimelineEntryKinds.RunBoundary, id: "run-boundary-1", run: { runId: "run-1", ordinal: 1, state, label: _RunLabel(state), detail: _RunDetail(state) } },
			{ kind: AgentThreadTimelineEntryKinds.Message, id: "message-1", message: { id: "message-1", authorName: "Nova", authorInitials: "N", authoredByAgent: true, timestampLabel: "11:08", body: "I am comparing the commercial terms and renewal obligations." } },
			{ kind: AgentThreadTimelineEntryKinds.Delivery, id: "delivery:delivery-1", delivery }
		],
		cursor: "opaque-story-cursor",
		latestPosition: "3",
		representedThroughPosition: "3",
		visibleThroughPosition: "3",
		canSendFollowUp: state === AgentThreadRunStates.Completed,
		...overrides
	};
}

/** Build a truthful delivery for the latest run outcome. */
function _DeliveryForRun(state: AgentThreadRunStates)
{
	if (state === AgentThreadRunStates.Failed) return { id: "delivery-1", kind: AgentThreadDeliveryKinds.Failure, label: "Comparison failed", detail: "Authentication failed. No result was delivered.", timestampLabel: "11:08" } as const;
	return { id: "delivery-1", kind: AgentThreadDeliveryKinds.Status, label: "Review in progress", detail: "The child sent a safe progress update to nova-pitch.", timestampLabel: "11:08" } as const;
}

/** Resolve the summary state belonging to one latest serial run state. */
function _SummaryStateForRun(state: AgentThreadRunStates): AgentThreadSummaryStates
{
	switch (state)
	{
		case AgentThreadRunStates.Queued: return AgentThreadSummaryStates.Starting;
		case AgentThreadRunStates.Working: return AgentThreadSummaryStates.Working;
		case AgentThreadRunStates.Waiting: return AgentThreadSummaryStates.Waiting;
		case AgentThreadRunStates.Retrying: return AgentThreadSummaryStates.Retrying;
		case AgentThreadRunStates.Completed: return AgentThreadSummaryStates.Completed;
		case AgentThreadRunStates.Failed: return AgentThreadSummaryStates.Failed;
		case AgentThreadRunStates.Cancelled: return AgentThreadSummaryStates.Cancelled;
	}
}

/** Resolve concise run copy for the story catalogue. */
function _RunLabel(state: AgentThreadRunStates): string { return `Run 1 · ${state}`; }

/** Resolve browser-safe detail without implying an outcome the run did not reach. */
function _RunDetail(state: AgentThreadRunStates): string
{
	switch (state)
	{
		case AgentThreadRunStates.Queued: return "Waiting for capacity; no position or start time is promised.";
		case AgentThreadRunStates.Working: return "Comparing the current documents.";
		case AgentThreadRunStates.Waiting: return "Waiting for Alex to answer a question.";
		case AgentThreadRunStates.Retrying: return "One failed attempt remains visible while retrying.";
		case AgentThreadRunStates.Completed: return "The result is ready.";
		case AgentThreadRunStates.Failed: return "The run failed without claiming a result.";
		case AgentThreadRunStates.Cancelled: return "Cancellation superseded the active attempt.";
	}
}

/** Build a deterministic generated-client-shaped gateway double for one page story. */
function _Gateway(snapshot: AgentThreadSnapshot): AgentThreadGateway
{
	return { read: async function _Read() { return snapshot; }, sendFollowUp: async function _SendFollowUp() { return { ...snapshot, canSendFollowUp: false }; }, markReadThrough: async function _MarkReadThrough() {} };
}

/** One real participant question composed into the child workspace. */
const _ELICITATION: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-renewal", conversationId: "child-pricing", runId: "run-1", attempt: 1, assignedParticipantId: "participant-alex", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.SingleChoice, prompt: "Which renewal rule should I compare?", choices: [{ value: "current", label: "Current renewal rule" }, { value: "proposed", label: "Supplier proposal" }] }, requiresStepUp: false, requestedAt: "2026-08-12T11:08:00.000Z", expiresAt: "2026-08-12T12:08:00.000Z" };

/** Build only decorators and rendering; visual tags and play functions stay static on each export. */
function _PageStory(snapshot: AgentThreadSnapshot, focusTarget = snapshot.summary.target, elicitation: ConversationElicitation | null = null): Story
{
	return {
		decorators: [applicationConfig({ providers: [{ provide: AGENT_THREAD_GATEWAY, useValue: _Gateway(snapshot) }] })],
		render: function render() { return { props: { parentConversationId: "group-launch", childConversationId: "child-pricing", restore: { parentConversationId: "group-launch", parentMessageId: "root-ask", parentScrollAnchor: "message-root-top" }, focusTarget, elicitation }, template: `<wo-agent-thread-page [parentConversationId]="parentConversationId" [childConversationId]="childConversationId" [parentRestore]="restore" [focusTarget]="focusTarget" [elicitation]="elicitation" />` }; }
	};
}

/** Assert the immutable origin and child heading shared by every full-page journey. */
async function _AssertPage({ canvasElement }: { readonly canvasElement: HTMLElement }): Promise<void>
{
	const canvas = within(canvasElement);
	await expect(await canvas.findByRole("heading", { name: "Compare supplier pricing" })).toBeVisible();
	await expect(canvas.getByText("@agent compare the supplier counterproposal and flag the renewal risk")).toBeVisible();
}

/** Assert the deep-linked child target receives focus after the authorized view renders. */
async function _AssertDeepLinkedPage(context: { readonly canvasElement: HTMLElement }): Promise<void>
{
	await _AssertPage(context);
	const target = context.canvasElement.querySelector<HTMLElement>("#delivery\\:delivery-1");
	await expect(target).toHaveFocus();
}

/** Storybook metadata for group Agent-thread states and route surfaces. */
const meta: Meta<AgentThreadPageComponent> =
{
	title: "Conversations/Agent threads",
	component: AgentThreadPageComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [AgentThreadAccessChangedComponent, AgentThreadDeliveryComponent, AgentThreadMentionControlComponent, AgentThreadSummaryComponent, AgentThreadUnavailableComponent, ConversationComposerComponent] })],
	parameters: { docs: { description: { component: "Group @agent admission, parent summaries, and a breadcrumb child workspace with independent run, access, recovery, and admission states." } } }
};

export default meta;
type Story = StoryObj<AgentThreadPageComponent>;

/** Mention admission catalogue covers available, queued, denied, missing-Agent, and in-flight states. */
export const MentionAdmissionStates: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { states: Object.values(AgentThreadAdmissionStates), options: _AGENT_OPTIONS }, template: `<div style="display:grid;gap:14px;max-width:780px;padding:20px">@for (state of states; track state) { <div><strong>{{ state }}</strong><wo-agent-thread-mention-control [state]="state" [suggestions]="options" /></div> }</div>` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole("combobox")).toHaveLength(2);
		await userEvent.click(canvas.getAllByRole("combobox")[0]);
		await userEvent.type(canvas.getAllByRole("combobox")[0], "Nova");
		await expect(canvas.getAllByRole("combobox")[0]).toHaveFocus();
	}
};

/** All parent-summary states, unread counts, participants, and long preview copy remain compact. */
export const SummaryStateCatalogue: Story =
{
	tags: ["visual-test"],
	render: function render() { return { props: { summaries: _SUMMARIES }, template: `<div style="display:grid;gap:10px;max-width:880px;padding:20px">@for (summary of summaries; track summary.state) { <wo-agent-thread-summary parentConversationId="group-launch" parentMessageId="root-ask" parentScrollAnchor="message-root-top" [summary]="summary" /> }</div>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole("article")).toHaveLength(12);
		await expect(canvas.getByText("Completed after retry")).toBeVisible();
		await expect(canvas.getByText("Restricted")).toBeVisible();
	}
};

/** Atomic first-run admission renders a durable queued child with a disabled composer. */
export const ChildQueued: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Queued)), tags: ["visual-test"], play: _AssertPage };

/** The active foreground run streams inside the child workspace. */
export const ChildWorking: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Working)), tags: ["visual-test"], play: _AssertPage };

/** A deep-linked participant question remains anchored to the immutable root ask. */
export const ChildDeepLinkedAsk: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Waiting, { summary: _Summary(AgentThreadSummaryStates.Waiting, { target: { kind: AgentThreadSummaryTargetKinds.WaitingRequest, id: "delivery:delivery-1" } }) }), { kind: AgentThreadSummaryTargetKinds.WaitingRequest, id: "delivery:delivery-1" }, _ELICITATION), tags: ["visual-test"], play: _AssertDeepLinkedPage };

/** Completion makes the controlled composer available for the next serial run. */
export const ChildCompleted: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Completed)), tags: ["visual-test"], play: _AssertPage };

/** A second completed run stays ordered after the first run and follow-up message. */
export const ChildSecondRun: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Completed, { timeline: [..._Snapshot(AgentThreadRunStates.Completed).timeline, { kind: AgentThreadTimelineEntryKinds.Message, id: "message-follow-up", message: { id: "message-follow-up", authorName: "Alex Kimani", authorInitials: "AK", authoredByAgent: false, timestampLabel: "11:12", body: "Compare the renewal notice period too." } }, { kind: AgentThreadTimelineEntryKinds.RunBoundary, id: "run-boundary-2", run: { runId: "run-2", ordinal: 2, state: AgentThreadRunStates.Completed, label: "Run 2 · completed", detail: "The follow-up completed." } }] })), tags: ["visual-test"], play: _AssertPage };

/** Failure remains visible and never claims a result. */
export const ChildFailed: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Failed)), tags: ["visual-test"], play: _AssertPage };

/** Cancellation remains distinct from failure and completion. */
export const ChildCancelled: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Cancelled)), tags: ["visual-test"], play: _AssertPage };

/** A closed child keeps its history and disables future follow-ups. */
export const ChildClosed: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Completed, { summary: _Summary(AgentThreadSummaryStates.Closed), canSendFollowUp: false })), tags: ["visual-test"], play: _AssertPage };

/** Reconnect keeps the accepted child projection visible while commands are disabled. */
export const ChildReconnecting: Story = { ..._PageStory(_Snapshot(AgentThreadRunStates.Working, { recovery: AgentThreadRecoveryStates.Reconnecting })), tags: ["visual-test"], play: _AssertPage };

/** A compact reconnect composition proves the draft stays visible at 390 by 844 pixels. */
export const CompactReconnectDraft: Story =
{
	tags: ["visual-test", "visual-test-narrow"],
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: function render() { return { props: { draft: "Keep the renewal question in my draft.", state: ConversationComposerStates.Disabled }, template: `<div style="width:390px;min-height:844px;padding:8px"><p><strong>Reconnecting</strong><br>The accepted transcript stays visible.</p><wo-conversation-composer [draft]="draft" [state]="state" label="Follow up in this Agent thread" /></div>` }; },
	play: async function play({ canvasElement }) { await expect(within(canvasElement).getByDisplayValue("Keep the renewal question in my draft.")).toBeDisabled(); }
};

/** Proven revocation copy differs from the deliberately indistinguishable unavailable route. */
export const AccessChangedAndUnavailable: Story =
{
	tags: ["visual-test"],
	render: function render() { return { template: `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:20px"><wo-agent-thread-access-changed /><wo-agent-thread-unavailable /></div>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const accessChangedHeading = canvas.getByRole("heading", { name: "This Agent thread is no longer available" });
		await expect(accessChangedHeading).toBeInTheDocument();
		await expect(accessChangedHeading).toHaveFocus();
		await expect(canvas.getByRole("heading", { name: "Agent thread unavailable" })).toBeInTheDocument();
	}
};

/** Immediate-parent delivery catalogue covers status, question, approval, result, failure, and final asset references. */
export const ParentDeliveryKinds: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { kinds: Object.values(AgentThreadDeliveryKinds) }, template: `<div style="display:grid;gap:10px;max-width:760px;padding:20px">@for (kind of kinds; track kind) { <wo-agent-thread-delivery [delivery]="{ id: 'delivery-' + kind, kind: kind, label: kind, detail: kind === 'failure' ? 'Authentication failed. No result was delivered.' : 'Display-safe delivery to the immediate parent.', timestampLabel: '11:12' }"><p agent-thread-delivery-technical>No credentials, tokens, request bodies, or raw provider output are shown.</p></wo-agent-thread-delivery> }</div>` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		for (const kind of Object.values(AgentThreadDeliveryKinds)) await expect(canvas.getByText(kind)).toBeInTheDocument();
	}
};
