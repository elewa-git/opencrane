import { describe, expect, it } from "vitest";

import { CONVERSATION_A2UI_SURFACE_PLACEHOLDER, ___ConversationA2uiComponentSchema, ___ConversationA2uiDisplaySchema } from "../conversation-a2ui.validator";
import type { ConversationA2uiDisplay } from "../conversation-a2ui.types";
import { ___ConversationFinalOutputSchema } from "../conversation-final-output.validator";

/** Supplies official operations using the placeholder before server ownership is assigned. */
function _display(): ConversationA2uiDisplay
{
	return [
		{ surfaceUpdate: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, components: [
			{ id: "root", component: { Column: { children: { explicitList: ["title"] } } } },
			{ id: "title", component: { Text: { text: { literalString: "  Ready 👩🏽‍💻\n" }, usageHint: "h3" } } },
		] } },
		{ beginRendering: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, root: "root" } },
	];
}

describe("conversation final answer shape", function _Suite()
{
	it("retains the ordinary fallback and optional display without changing accepted text", function _PreservesText()
	{
		const answer = { text: "  Résultat 👩🏽‍💻\n", display: _display() };
		expect(___ConversationFinalOutputSchema.parse(answer)).toEqual(answer);
		expect(___ConversationFinalOutputSchema.parse({ text: answer.text })).toEqual({ text: answer.text });
	});

	it.each([{}, { text: " " }, { text: "\ud800" }, { text: "é".repeat(32_769) }, { text: "ok", display: null }, { text: "ok", commands: [] }, { text: "ok", display: [] }])("refuses missing, oversized or ambiguous answer fields: %j", function _InvalidEnvelope(answer)
	{
		expect(___ConversationFinalOutputSchema.safeParse(answer).success).toBe(false);
	});

	it("accepts the exact text byte boundary and rejects a display exceeding its separate custody limit", function _Bytes()
	{
		expect(___ConversationFinalOutputSchema.safeParse({ text: "é".repeat(32_768) }).success).toBe(true);
		const display = _display();
		const components = Array.from({ length: 5 }, function _LargeText(_, index) { return { id: `text-${index}`, component: { Text: { text: { literalString: "é".repeat(8_000) } } } }; });
		expect(___ConversationA2uiDisplaySchema.safeParse([{ surfaceUpdate: { ...display[0].surfaceUpdate, components } }, display[1]]).success).toBe(false);
	});

	it("requires the complete pair in order and prevents the model selecting display ownership", function _Operations()
	{
		const display = _display();
		for (const invalid of [[display[0]], [...display].reverse(), [...display, display[1]], [{ surfaceUpdate: { ...display[0].surfaceUpdate, surfaceId: "another-display" } }, display[1]], [display[0], { beginRendering: { ...display[1].beginRendering, surfaceId: "another-display" } }], [display[0], { beginRendering: { ...display[1].beginRendering, catalogId: "https://untrusted.invalid" } }]])
			expect(___ConversationA2uiDisplaySchema.safeParse(invalid).success).toBe(false);
	});

	it.each([
		{ Button: { child: "title", action: { name: "execute" } } }, { Image: { url: { literalString: "https://untrusted.invalid" } } },
		{ Text: { text: { path: "/result" } } }, { Text: { text: { literalString: "ok" }, action: { name: "execute" } } },
		{ Column: { children: { template: { componentId: "title", dataBinding: "/rows" } } } },
		{ Text: { text: { literalString: "ok" } }, Divider: {} },
	])("refuses generated extensions, actions and bindings: %j", function _UnsupportedComponent(component)
	{
		const display = _display();
		expect(___ConversationA2uiDisplaySchema.safeParse([{ surfaceUpdate: { ...display[0].surfaceUpdate, components: [{ id: "root", component }] } }, display[1]]).success).toBe(false);
	});

	it("keeps data-bound text available to existing history consumers", function _ConsumerBinding()
	{
		const bound = { id: "title", component: { Text: { text: { path: "/result" } } } };
		expect(___ConversationA2uiComponentSchema.parse(bound)).toEqual(bound);
		expect(___ConversationA2uiComponentSchema.safeParse({ id: "title", component: { Text: { text: { path: "/__proto__/value" } } } }).success).toBe(false);
	});

	it("leaves complete graph validation to the producer owner while preserving all references", function _ShapeBoundary()
	{
		const display = _display();
		const missingRoot = [display[0], { beginRendering: { ...display[1].beginRendering, root: "not-defined" } }];
		expect(___ConversationA2uiDisplaySchema.safeParse(missingRoot).success).toBe(true);
	});
});
