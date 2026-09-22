import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ConversationA2uiDisplayStates } from "../../../a2ui/conversation-a2ui-display.types";
import { ConversationA2uiDisplayComponent } from "../conversation-a2ui-display.component";
import { _ConversationA2uiDisplayFixture } from "./conversation-a2ui-display.fixtures";

/** Canonical read-only result states; history admission and reconstruction remain with the workspace. */
const meta: Meta<ConversationA2uiDisplayComponent> = {
	title: "Conversations/Structured display",
	component: ConversationA2uiDisplayComponent,
	tags: ["autodocs", "read-only-a2ui"],
	parameters: { docs: { description: { component: "Displays a validated structured result from authorized history. It never interprets raw payloads, submits an action, or grants access." } } },
	args: { presentation: _ConversationA2uiDisplayFixture() }
};
export default meta;
/** Stories share the component's declared input contract. */
type Story = StoryObj<ConversationA2uiDisplayComponent>;

/** Every admitted static component appears without adding controls or network content. */
export const Ready: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "A completed static result uses cards, rows, columns, text and a horizontal divider. Every heading hint renders as h2 beneath the route heading, while retaining its typography. Rendering does not authorize a question, action or private tool result." } } },
	play: async function _StaticResult({ canvasElement })
	{
		const canvas = within(canvasElement);
		expect(canvas.getByRole("heading", { name: "Customer summary", level: 2 })).toBeVisible();
		expect(canvas.getByText("Customer records checked.")).toBeVisible();
		expect(canvasElement.querySelector("button, input, textarea, select, a, img, iframe, audio, video")).toBeNull();
	}
};

/** Long literal text wraps in the supported narrow viewport without interpreting markup. */
export const NarrowEscapedText: Story = {
	tags: ["visual-test", "visual-test-narrow"],
	args: { presentation: _ConversationA2uiDisplayFixture(`${"Customer evidence remains readable. ".repeat(8)}<img src='https://example.invalid/private'> [Open](https://example.invalid)`) },
	parameters: { docs: { description: { story: "A narrow result preserves long literal content and escapes apparent HTML and links. No media loading or navigation is granted by the display." } } },
	play: async function _EscapedContent({ canvasElement })
	{
		expect(canvasElement.querySelector("img, a")).toBeNull();
		expect(canvasElement.textContent).toContain("<img src=");
	}
};

/** A retained request for display data does not show stale content or promise an agent completion. */
export const Waiting: Story = {
	tags: ["visual-test"],
	args: { presentation: { state: ConversationA2uiDisplayStates.Waiting, authorName: "Company assistant", surfaceId: "waiting", surface: null, detail: "Waiting for the structured result…" } },
	parameters: { docs: { description: { story: "History has not supplied a complete renderable result. The visual component announces waiting but does not poll, create work or retain an earlier result." } } }
};

/** An unsupported or damaged result is explained without repeating its rejected payload. */
export const Unavailable: Story = {
	tags: ["visual-test"],
	args: { presentation: { state: ConversationA2uiDisplayStates.Unavailable, authorName: "Company assistant", surfaceId: "unavailable", surface: null, detail: "This structured result is unavailable." } },
	parameters: { docs: { description: { story: "The workspace could not reconstruct a supported result. The component shows a safe explanation without disclosing rejected content, adding retry controls or changing permissions." } } }
};
