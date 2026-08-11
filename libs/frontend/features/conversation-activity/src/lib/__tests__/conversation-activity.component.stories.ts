import type { Meta, StoryObj } from "@storybook/angular";

import { ElicitationRequestStates } from "@opencrane/contracts";
import { ConversationActivityKinds, type ConversationActivityRow } from "@opencrane/state/conversation/elicitation";

import { ConversationActivityComponent } from "../conversation-activity.component.js";

/** Canonical rows proving requests and visible retry failures together. */
const _ROWS: readonly ConversationActivityRow[] = [
	{ kind: ConversationActivityKinds.Elicitation, id: "request-1", label: "Which report should I continue with?", occurredAt: "2026-08-11T08:00:00.000Z", status: ElicitationRequestStates.Requested, target: { conversationId: "conversation-1", runId: "run-1", requestId: "request-1" } },
	{ kind: ConversationActivityKinds.ToolFailure, id: "tool-1:0", label: "Authentication failed.", occurredAt: "2026-08-11T08:01:00.000Z", retrying: true, technicalDetails: { externalSystem: "Customer portal", toolIdentifier: "publish-report", toolRevision: "r7", failureCategory: "authentication", providerCode: "invalid_token", httpStatus: 401, occurredAt: "2026-08-11T08:01:00.000Z", retryCount: 1, retryLimit: 3 }, target: { conversationId: "conversation-1", runId: "run-1", toolCallId: "tool-1" } }
];

/** Storybook metadata for the safe derived Activity index. */
const meta: Meta<ConversationActivityComponent> = { title: "Conversation/Activity", component: ConversationActivityComponent, tags: ["autodocs", "visual-test"], parameters: { docs: { description: { component: "Derived canonical references. A failed attempt is visible while retrying; bounded technical fields remain behind native disclosure." } } } };
export default meta;

/** Local story type. */
type Story = StoryObj<ConversationActivityComponent>;

/** Mixed activity with a still-visible failed tool attempt during retry. */
export const RequestsAndRetryingFailure: Story = { args: { rows: _ROWS } };

/** Empty derived index. */
export const Empty: Story = { args: { rows: [] } };
