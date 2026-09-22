import { CONVERSATION_A2UI_CATALOGUE, _ParseConversationA2uiMessages } from "../conversation-a2ui-message.validator";
import { _DisplayMessages, _TextComponent } from "./conversation-a2ui.fixtures";

describe("Read-only A2UI payload boundary", function _DisplayPayload()
{
	it("accepts the installed standard catalogue, static layouts and typed data maps", function _Supported()
	{
		const messages = [..._DisplayMessages([{ id: "root", component: { Column: { children: { explicitList: ["body", "divider"] }, distribution: "spaceBetween", alignment: "stretch" } } }, _TextComponent(), { id: "divider", component: { Divider: { axis: "horizontal" } } }], "root"), { beginRendering: { surfaceId: "inventory", root: "root", catalogId: CONVERSATION_A2UI_CATALOGUE } }, { dataModelUpdate: { surfaceId: "inventory", contents: [{ key: "totals", valueMap: [{ key: "label", valueString: "42 units" }, { key: "count", valueNumber: 42 }, { key: "complete", valueBoolean: true }] }] } }];
		expect(_ParseConversationA2uiMessages(JSON.stringify(messages), "inventory")).toEqual(messages);
	});

	it.each([
		{ Button: { child: "body", action: { name: "write" } } },
		{ Image: { url: { literalString: "https://private.example/image" } } },
		{ TextField: { text: { literalString: "secret" } } },
		{ Custom: { html: "<iframe src='https://private.example'></iframe>" } },
		{ Divider: { axis: "vertical" } },
		{ Row: { children: { template: { componentId: "body", dataBinding: "/items" } } } },
		{ Text: { text: { literalString: "text" }, action: { name: "write" } } },
		{ Text: { text: { literalString: "text", path: "/secret" } } },
		{ Text: { text: { literalString: "text" } }, Card: { child: "body" } },
		{ toString: {} },
	])("rejects components outside the finite action-free catalogue: %j", function _Unsupported(component)
	{
		const value = [{ surfaceUpdate: { surfaceId: "inventory", components: [{ id: "body", component }] } }];
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(value), "inventory")).toThrow();
	});

	it.each([
		[], {}, _DisplayMessages()[0],
		[{ beginRendering: { surfaceId: "other", root: "body" } }],
		[{ beginRendering: { surfaceId: "inventory", root: "body", styles: { font: "https://private.example/font" } } }],
		[{ beginRendering: { surfaceId: "inventory", root: "body", catalogId: "https://private.example/catalog" } }],
		[{ beginRendering: { surfaceId: "inventory", root: "body" }, deleteSurface: { surfaceId: "inventory" } }],
		[{ surfaceUpdate: { surfaceId: "inventory", components: [_TextComponent(), _TextComponent()] } }],
	])("rejects unsupported framing, styling, coordinates and ambiguous operations: %j", function _InvalidEnvelope(value)
	{
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(value), "inventory")).toThrow();
	});

	it.each(["/__proto__/secret", "/constructor", "/prototype", "relative", "../secret", "/a.b", "/a[0]"])("rejects unsafe or unsupported binding paths: %s", function _BindingPath(path)
	{
		const value = _DisplayMessages([{ id: "body", component: { Text: { text: { path } } } }]);
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(value), "inventory")).toThrow();
	});

	it.each([
		[{ key: "__proto__", valueString: "private" }],
		[{ key: "count", valueString: "42", valueNumber: 42 }],
		[{ key: "count" }],
		[{ key: ".", valueString: "root primitive" }],
		[{ key: "count", valueString: "40" }, { key: "count", valueString: "42" }],
		[{ key: ".", valueString: "40" }, { key: "count", valueString: "42" }],
		[{ key: "nested", valueMap: [{ key: "constructor", valueString: "private" }] }],
		[{ key: "json", valueString: "{\"private\":42}" }],
		[{ key: "json", valueString: "{private malformed}" }],
		[{ key: "json", valueString: "[42]" }],
	])("rejects ambiguous data and SDK implicit-JSON paths: %j", function _Data(contents)
	{
		const value = [{ dataModelUpdate: { surfaceId: "inventory", contents } }];
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(value), "inventory")).toThrow();
	});

	it("bounds bytes, text, batch length and nesting before the SDK sees input", function _ResourceBounds()
	{
		expect(() => _ParseConversationA2uiMessages(" ".repeat(65_537), "inventory")).toThrow();
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(_DisplayMessages([_TextComponent("body", "a".repeat(16_385))])), "inventory")).toThrow();
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(_DisplayMessages([_TextComponent("a", "😀".repeat(8_000)), _TextComponent("b", "😀".repeat(8_000)), _TextComponent("c", "😀".repeat(8_000))])), "inventory")).toThrow();
		expect(() => _ParseConversationA2uiMessages(JSON.stringify(Array(65).fill({ deleteSurface: { surfaceId: "inventory" } })), "inventory")).toThrow();
		expect(() => _ParseConversationA2uiMessages("[".repeat(20) + "0" + "]".repeat(20), "inventory")).toThrow();
	});
});
