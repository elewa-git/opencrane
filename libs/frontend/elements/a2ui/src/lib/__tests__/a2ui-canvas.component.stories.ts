import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import type { Types } from "@a2ui/angular/v0_8";

import { A2uiCanvasComponent } from "../a2ui-canvas.component.js";
import { provideOpenCraneA2ui } from "../a2ui.providers.js";
import { A2uiEnvelopeVersions, A2uiSurfaceStates, type A2uiSurfacePresentation } from "../a2ui.types.js";

/** Minimal reviewed text surface used by lifecycle visual contracts. */
const _SURFACE_OPERATIONS: readonly Types.ServerToClientMessage[] =
[
	{
		surfaceUpdate:
		{
			surfaceId: "surface-pricing",
			components: [{ id: "pricing-copy", component: { Text: { text: { literalString: "Apply the proposed pricing?" }, usageHint: "h3" } } }]
		}
	},
	{ beginRendering: { surfaceId: "surface-pricing", root: "pricing-copy" } }
];

/** Escape story markdown to demonstrate the same required sanitizer port as production. */
function _sanitizeStoryMarkdown(markdown: string): string
{
	return markdown.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Build a complete visual presentation for one finite lifecycle fixture. */
function _storyPresentation(state: A2uiSurfaceStates, reason?: string): A2uiSurfacePresentation
{
	return {
		version: A2uiEnvelopeVersions.OpenCraneV1,
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

/** Storybook metadata for the constrained A2UI surface boundary. */
const meta: Meta<A2uiCanvasComponent> =
{
	title: "Foundation/A2UI canvas",
	component: A2uiCanvasComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [...provideOpenCraneA2ui(_sanitizeStoryMarkdown)] })],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "Display-only A2UI sink with an exact eleven-component catalogue. Actions leave this component as coordinate-bound intent and remain subject to server authorization."
			}
		}
	},
	args: { presentation: _storyPresentation(A2uiSurfaceStates.Ready) }
};

export default meta;

/** Local Storybook story type for the A2UI canvas. */
type Story = StoryObj<A2uiCanvasComponent>;

/** Ready surface with interaction enabled. */
export const Ready: Story = { tags: ["visual-test"] };

/** Progressive surface with controls inert until the projection becomes ready. */
export const Streaming: Story =
{
	tags: ["visual-test"],
	args: { presentation: _storyPresentation(A2uiSurfaceStates.Streaming) }
};

/** Truthful failed action state with safe server-projected recovery text. */
export const ActionFailed: Story =
{
	tags: ["visual-test"],
	args: { presentation: _storyPresentation(A2uiSurfaceStates.ActionFailed, "Authentication expired. Nothing was changed. Sign in again and retry this action.") }
};

/** Generic unsupported placeholder that never echoes rejected component data. */
export const Unsupported: Story =
{
	tags: ["visual-test"],
	args: { presentation: _storyPresentation(A2uiSurfaceStates.Unsupported, "This reason is deliberately not displayed.") }
};
