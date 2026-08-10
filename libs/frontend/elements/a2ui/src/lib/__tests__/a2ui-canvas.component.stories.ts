import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiOperation } from "@opencrane/contracts";

import { A2uiCanvasComponent } from "../a2ui-canvas.component.js";
import { provideOpenCraneA2ui } from "../a2ui.providers.js";
import { type A2uiSurfacePresentation } from "../a2ui.types.js";

/** Reviewed interactive form used by every canonical lifecycle visual contract. */
const _SURFACE_OPERATIONS: readonly AgUiA2uiOperation[] =
[
	{
		surfaceUpdate:
		{
			surfaceId: "surface-pricing",
			components:
			[
				{ id: "pricing-form", component: { List: { children: { explicitList: ["pricing-copy", "pricing-reason", "apply-button"] }, direction: "vertical", alignment: "stretch" } } },
				{ id: "pricing-copy", component: { Text: { text: { literalString: "Apply the proposed pricing?" }, usageHint: "h3" } } },
				{ id: "pricing-reason", component: { TextField: { label: { literalString: "Reason" }, text: { literalString: "Validated customer evidence" }, textFieldType: "shortText" } } },
				{ id: "apply-label", component: { Text: { text: { literalString: "Request approval" }, usageHint: "body" } } },
				{ id: "apply-button", component: { Button: { child: "apply-label", primary: true, action: { name: "apply-pricing", context: [{ key: "decision", value: { literalString: "apply" } }] } } } }
			]
		}
	},
	{ beginRendering: { surfaceId: "surface-pricing", root: "pricing-form" } }
];

/** Escape story markdown to demonstrate the same required sanitizer port as production. */
function _sanitizeStoryMarkdown(markdown: string): string
{
	return markdown.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Build a complete visual presentation for one finite lifecycle fixture. */
function _storyPresentation(state: AgUiA2uiSurfaceStates, reason?: string): A2uiSurfacePresentation
{
	return {
		version: AG_UI_A2UI_ENVELOPE_VERSION,
		conversationId: "conversation-story",
		runId: "run-story",
		messageId: "message-story",
		surfaceId: "surface-pricing",
		sequence: 1,
		state,
		operations: _SURFACE_OPERATIONS,
		reason
	};
}

/** Build one screenshot-backed story with its explicit server/browser authority boundary. */
function _lifecycleStory(state: AgUiA2uiSurfaceStates, description: string, reason?: string): Story
{
	return {
		args: { presentation: _storyPresentation(state, reason) },
		parameters: { docs: { description: { story: description } } }
	};
}

/** Storybook metadata for the constrained A2UI surface boundary. */
const meta: Meta<A2uiCanvasComponent> =
{
	title: "Foundation/A2UI canvas",
	component: A2uiCanvasComponent,
	tags: ["autodocs", "visual-test"],
	decorators: [applicationConfig({ providers: [...provideOpenCraneA2ui(_sanitizeStoryMarkdown)] })],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "Display-only A2UI sink with the exact pinned nine-component catalogue. Actions leave this component as full-coordinate intent and remain subject to authenticated server authorization."
			}
		}
	},
	args: { presentation: _storyPresentation(AgUiA2uiSurfaceStates.Ready) }
};

export default meta;

/** Local Storybook story type for the A2UI canvas. */
type Story = StoryObj<A2uiCanvasComponent>;

/** Progressive operations remain visible but inert until the authoritative projection is ready. */
export const Streaming: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Streaming, "The server projection says operations are still arriving. The browser preserves their order and focus identity but cannot authorize an action.");

/** Ready is the only browser-interactive state; action admission still belongs to the server. */
export const Ready: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Ready, "The server projection permits the displayed controls to emit a coordinate-bound intent. The browser still grants no command authority.");

/** A displayed action is locally inert while the server owns admission and idempotency. */
export const ActionPending: Story = _lifecycleStory(AgUiA2uiSurfaceStates.ActionPending, "The browser has emitted an intent and now suppresses duplicates. The server owns admission, one-use fencing, and the next authoritative projection.", "Waiting for authoritative admission. Nothing has been applied yet.");

/** Submitted truthfully reflects server acceptance without claiming downstream completion. */
export const Submitted: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Submitted, "The server accepted the displayed action. This render-only state does not independently claim that a later run or tool side effect completed.", "The action was accepted and the surface is now read-only.");

/** Validation feedback is display-safe server evidence and never a local authorization decision. */
export const ValidationError: Story = _lifecycleStory(AgUiA2uiSurfaceStates.ValidationError, "The server rejected the displayed values. The browser renders the safe reason and keeps the surface inert until a newer ready projection arrives.", "Add the customer segment used to validate this pricing change.");

/** Failure never guesses success or retries a command from the presentational component. */
export const ActionFailed: Story = _lifecycleStory(AgUiA2uiSurfaceStates.ActionFailed, "The authoritative action path failed without claiming success. Retry sequencing remains with the host and server, not this renderer.", "Authentication expired. Nothing was changed. Sign in again and retry this action.");

/** Expiry is server-declared and prevents the browser from replaying a stale action. */
export const Expired: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Expired, "The server says the action window expired. The browser disables the old controls and cannot extend or reconstruct authority.", "This approval window expired. Ask the agent to prepare a current proposal.");

/** One-use consumption is authoritative and suppresses duplicate browser submission. */
export const AlreadyUsed: Story = _lifecycleStory(AgUiA2uiSurfaceStates.AlreadyUsed, "The server reports that this one-use action was already consumed. The browser presents that result without inventing a replacement action.", "This action was already used and cannot be submitted again.");

/** Actor authorization remains server-owned and is never inferred from visible control state. */
export const Unauthorized: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Unauthorized, "The authenticated server denied this actor. The browser displays the bounded explanation and cannot elevate access.", "You do not have permission to approve this pricing change.");

/** Unsupported content fails closed without echoing rejected provider payload or reason. */
export const Unsupported: Story = _lifecycleStory(AgUiA2uiSurfaceStates.Unsupported, "The browser rejected or cannot render the admitted component shape. It exposes only a generic placeholder; server and raw provider details remain outside the DOM.", "This reason is deliberately not displayed.");
