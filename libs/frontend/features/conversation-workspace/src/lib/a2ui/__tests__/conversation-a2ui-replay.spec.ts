import type { TextNode } from "@a2ui/web_core/v0_8";
import type { ConversationA2uiComponent } from "@opencrane/contracts";
import { ConversationA2uiDisplayStates } from "../conversation-a2ui-display.types";
import type { ConversationA2uiMessage } from "../conversation-a2ui-message.types";
import { _ConversationA2uiDisplays } from "../conversation-a2ui-replay";
import { _DisplayEntry, _DisplayMessages, _RemoveEntry, _TextComponent } from "./conversation-a2ui.fixtures";

/** Reconstructs one or more history entries using the real installed SDK. */
function _Replay(messages = _DisplayMessages(), patches: ConversationA2uiMessage[][] = [])
{
	const entries = [_DisplayEntry(), ...patches.map((_, index) => _DisplayEntry(index + 2, { operation: "patch" }))];
	const payloads = Object.fromEntries([messages, ...patches].map((batch, index) => [`payload-${index + 1}`, JSON.stringify(batch)]));
	return _ConversationA2uiDisplays(entries, payloads);
}

/** Reads the projected literal, never a raw data model. */
function _Text(result: ReturnType<typeof _Replay>, id = "display-1")
{
	return (result.get(id)?.surface?.componentTree as TextNode | null)?.properties.text.literalString;
}

describe("Saved read-only A2UI replay", function _SavedDisplay()
{
	it("renders literal text matching ids and usage hints without SDK reference confusion", function _StringCollision()
	{
		const result = _Replay();
		expect(result.get("display-1")?.state).toBe(ConversationA2uiDisplayStates.Ready);
		expect(_Text(result)).toBe("body");
		expect(result.get("display-1")?.surface?.dataModel.size).toBe(0);
		expect(result.get("display-1")?.surface?.components.size).toBe(0);
		expect(_Text(_Replay(_DisplayMessages([_TextComponent("body", "display:body")])))).toBe("display:body");
	});

	it("coalesces patches at the newest position and restarts from the same saved history", function _ReplayPatch()
	{
		const patch = [{ surfaceUpdate: { surfaceId: "inventory", components: [_TextComponent("body", "Kisumu: 42 units")] } }];
		const first = _Replay(_DisplayMessages(), [patch]);
		expect([...first.keys()]).toEqual(["display-2"]);
		expect(_Text(first, "display-2")).toBe("Kisumu: 42 units");
		expect(_Replay(_DisplayMessages(), [patch])).toEqual(first);
	});

	it("waits for a root and missing children, then renders a later patch", function _PartialGraph()
	{
		const begin = [{ beginRendering: { surfaceId: "inventory", root: "body" } }];
		expect(_Replay(begin).get("display-1")).toMatchObject({ state: ConversationA2uiDisplayStates.Waiting, surface: null });
		expect(_Replay([{ surfaceUpdate: { surfaceId: "inventory", components: [_TextComponent()] } }]).get("display-1")?.state).toBe(ConversationA2uiDisplayStates.Waiting);
		const complete = _Replay(begin, [[{ surfaceUpdate: { surfaceId: "inventory", components: [_TextComponent()] } }]]);
		expect(_Text(complete, "display-2")).toBe("body");
	});

	it("drops a previously visible tree while the replacement child is missing", function _NoStaleTree()
	{
		const patch = [{ surfaceUpdate: { surfaceId: "inventory", components: [{ id: "body", component: { Card: { child: "missing" } } }] } }];
		expect(_Replay(_DisplayMessages(), [patch]).get("display-2")).toMatchObject({ state: ConversationA2uiDisplayStates.Waiting, surface: null });
	});

	it("resolves ordered string bindings but drops all unrendered data", function _BindingUpdates()
	{
		const component = { id: "body", component: { Text: { text: { path: "/count" } } } };
		const initial = [..._DisplayMessages([component]), { dataModelUpdate: { surfaceId: "inventory", contents: [{ key: "count", valueString: "40 units" }, { key: "private", valueString: "not displayed" }] } }];
		const patch = [{ dataModelUpdate: { surfaceId: "inventory", path: "/count", contents: [{ key: ".", valueString: "42 units" }] } }];
		expect(_Text(_Replay(initial))).toBe("40 units");
		const updated = _Replay(initial, [patch]);
		expect(_Text(updated, "display-2")).toBe("42 units");
		expect(JSON.stringify(updated.get("display-2"))).not.toContain("not displayed");
		expect(_Replay(_DisplayMessages([component])).get("display-1")?.state).toBe(ConversationA2uiDisplayStates.Waiting);
	});

	it("does not display objects or numbers as text or stringify private data", function _WrongBindingType()
	{
		const component = { id: "body", component: { Text: { text: { path: "/count" } } } };
		const messages = [..._DisplayMessages([component]), { dataModelUpdate: { surfaceId: "inventory", contents: [{ key: "count", valueNumber: 42 }] } }];
		expect(_Replay(messages).get("display-1")).toMatchObject({ state: ConversationA2uiDisplayStates.Unavailable, surface: null });
	});

	it("removes displays through either history removal or the protocol delete message", function _Removal()
	{
		const payload = JSON.stringify(_DisplayMessages());
		expect(_ConversationA2uiDisplays([_DisplayEntry(), _RemoveEntry()], { "payload-1": payload }).size).toBe(0);
		expect(_Replay(_DisplayMessages(), [[{ deleteSurface: { surfaceId: "inventory" } }]]).size).toBe(0);
		expect(_Replay(_DisplayMessages(), [[{ deleteSurface: { surfaceId: "inventory" } }, ..._DisplayMessages()]]).get("display-2")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
	});

	it("limits operation and byte accumulation between fresh baselines", function _FrameBounds()
	{
		const message = { beginRendering: { surfaceId: "inventory", root: "body" } };
		const repeated = Array.from({ length: 8 }, () => Array(64).fill(message));
		expect(_Replay(_DisplayMessages(), repeated.slice(0, 7)).get("display-8")?.state).toBe(ConversationA2uiDisplayStates.Ready);
		expect(_Replay(_DisplayMessages(), repeated).get("display-9")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		const large = _DisplayMessages([_TextComponent("body", "a".repeat(16_000)), _TextComponent("extra", "b".repeat(16_000))]);
		expect(_Replay(large, Array(15).fill(large)).get("display-16")?.state).toBe(ConversationA2uiDisplayStates.Ready);
		expect(_Replay(large, Array(17).fill(large)).get("display-18")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
	});

	it("requires Replace after removal or a patch without any baseline", function _NoRevival()
	{
		const patch = _DisplayEntry(3, { operation: "patch" });
		const payload = JSON.stringify(_DisplayMessages());
		expect(_ConversationA2uiDisplays([patch], { "payload-3": payload }).get(patch.id)?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		const entries = [_DisplayEntry(), _RemoveEntry(), patch];
		expect(_ConversationA2uiDisplays(entries, { "payload-1": payload, "payload-3": payload }).get(patch.id)?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		expect(_ConversationA2uiDisplays([...entries, _DisplayEntry(4)], { "payload-1": payload, "payload-3": payload, "payload-4": payload }).get("display-4")?.state).toBe(ConversationA2uiDisplayStates.Ready);
	});

	it("discards an invalid patch until a fresh Replace and never exposes the private error", function _InvalidPatch()
	{
		const entries = [_DisplayEntry(), _DisplayEntry(2, { operation: "patch" }), _DisplayEntry(3, { operation: "patch" })];
		const payload = JSON.stringify(_DisplayMessages());
		const payloads = { "payload-1": payload, "payload-2": "private malformed payload", "payload-3": payload, "payload-4": payload };
		const failed = _ConversationA2uiDisplays(entries, payloads);
		expect(failed.get("display-3")).toMatchObject({ state: ConversationA2uiDisplayStates.Unavailable, surface: null });
		expect(JSON.stringify([...failed.values()])).not.toContain("private malformed");
		expect(_ConversationA2uiDisplays([...entries, _DisplayEntry(4)], payloads).get("display-4")?.state).toBe(ConversationA2uiDisplayStates.Ready);
	});

	it("isolates identical surface ids across conversations and authors, but not display-name edits", function _Identity()
	{
		const first = _DisplayEntry();
		const second = _DisplayEntry(2, { author: { ...first.author, kind: "agent", agentIdentityId: "agent-2", agentServiceId: "service-2", name: "Nova", avatarArtifactRevisionId: null } });
		const third = _DisplayEntry(3, { conversationId: "conversation-2" });
		const payload = JSON.stringify(_DisplayMessages());
		const payloads = { "payload-1": payload, "payload-2": payload, "payload-3": payload, "payload-4": payload };
		expect(_ConversationA2uiDisplays([first, second, third], payloads).size).toBe(3);
		const renamed = _DisplayEntry(4, { operation: "patch", author: { ...first.author, name: "Renamed" } });
		expect([..._ConversationA2uiDisplays([first, renamed], payloads).keys()]).toEqual(["display-4"]);
	});

	it("reconstructs from current authorized inputs without cached content after access or selection loss", function _PurgedHistory()
	{
		const entry = _DisplayEntry();
		const payloads = { "payload-1": JSON.stringify(_DisplayMessages()) };
		expect(_ConversationA2uiDisplays([entry], payloads).get(entry.id)?.state).toBe(ConversationA2uiDisplayStates.Ready);
		expect(_ConversationA2uiDisplays([], {}).size).toBe(0);
		expect(_ConversationA2uiDisplays([entry], {}).get(entry.id)).toMatchObject({ state: ConversationA2uiDisplayStates.Unavailable, surface: null });
	});

	it("resets definitions and data on Replace instead of retaining a prior root", function _NewBaseline()
	{
		const entries = [_DisplayEntry(), _DisplayEntry(2)];
		const payloads = { "payload-1": JSON.stringify(_DisplayMessages()), "payload-2": JSON.stringify([{ beginRendering: { surfaceId: "inventory", root: "body" } }]) };
		expect(_ConversationA2uiDisplays(entries, payloads).get("display-2")).toMatchObject({ state: ConversationA2uiDisplayStates.Waiting, surface: null });
	});

	it("bounds cycles, expanded DAGs, nesting and accumulated components before SDK work", function _GraphBounds()
	{
		const cycle = [{ id: "body", component: { Card: { child: "body" } } }];
		const chain: ConversationA2uiComponent[] = Array.from({ length: 17 }, (_, index) => ({ id: String(index), component: { Card: { child: String(index + 1) } } }));
		const repeated: ConversationA2uiComponent[] = [{ id: "root", component: { Row: { children: { explicitList: Array(64).fill("row") } } } }, { id: "row", component: { Row: { children: { explicitList: Array(64).fill("body") } } } }, _TextComponent()];
		for (const messages of [_DisplayMessages(cycle), _DisplayMessages(chain, "0"), _DisplayMessages(repeated, "root")])
			expect(_Replay(messages).get("display-1")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		const components = Array.from({ length: 256 }, (_, index) => _TextComponent(String(index)));
		const patch = [{ surfaceUpdate: { surfaceId: "inventory", components: [_TextComponent("extra")] } }];
		expect(_Replay(_DisplayMessages(components, "0"), [patch]).get("display-2")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
	});

	it("limits concurrently retained displays and permits replacement of an existing one", function _DisplayBounds()
	{
		const entries = Array.from({ length: 33 }, (_, index) => _DisplayEntry(index + 1, { surfaceId: `surface-${index}` }));
		const payloads = Object.fromEntries(entries.map(entry => [entry.payloadRef, JSON.stringify(_DisplayMessages()).replaceAll("inventory", entry.surfaceId)]));
		const result = _ConversationA2uiDisplays(entries, payloads);
		expect([...result.values()].filter(display => display.state === ConversationA2uiDisplayStates.Ready)).toHaveLength(32);
		expect(result.get("display-33")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		const replacement = _DisplayEntry(34, { surfaceId: "surface-0" });
		expect(_ConversationA2uiDisplays([...entries, replacement], { ...payloads, "payload-34": payloads["payload-1"]! }).get("display-34")?.state).toBe(ConversationA2uiDisplayStates.Ready);
	});

	it("bounds invalid rows too and frees a slot after removal", function _InvalidDisplayBounds()
	{
		const invalid = Array.from({ length: 1_000 }, (_, index) => _DisplayEntry(index + 1, { surfaceId: `surface-${index}` }));
		const result = _ConversationA2uiDisplays(invalid, {});
		expect(result.size).toBe(33);
		expect(result.get("display-33")).toMatchObject({ authorName: "OpenCrane", surfaceId: "replay-overflow" });
		const removed = { ..._RemoveEntry(1_001), surfaceId: "surface-0" };
		const final = _DisplayEntry(1_002);
		const afterRemoval = _ConversationA2uiDisplays([...invalid, removed, final], { "payload-1002": JSON.stringify(_DisplayMessages()) });
		expect(afterRemoval.size).toBe(33);
		expect(afterRemoval.get(final.id)?.state).toBe(ConversationA2uiDisplayStates.Ready);
	});

	it("keeps one generic overflow notice when skipped displays are later removed or deleted", function _StickyOverflow()
	{
		const entries = Array.from({ length: 34 }, (_, index) => _DisplayEntry(index + 1, { surfaceId: `surface-${index}` }));
		const payloads = Object.fromEntries(entries.map(entry => [entry.payloadRef, JSON.stringify(_DisplayMessages()).replaceAll("inventory", entry.surfaceId)]));
		const removed = { ..._RemoveEntry(35), surfaceId: "surface-33" };
		const deleted = _DisplayEntry(36, { operation: "patch", surfaceId: "surface-32" });
		payloads[deleted.payloadRef] = JSON.stringify([{ deleteSurface: { surfaceId: deleted.surfaceId } }]);
		const result = _ConversationA2uiDisplays([...entries, removed, deleted], payloads);
		expect(result.size).toBe(33);
		expect(result.get("display-33")).toMatchObject({ authorName: "OpenCrane", surfaceId: "replay-overflow", detail: "Display history exceeds this page's limit. Some results may be omitted." });
		expect(result.has(removed.id)).toBe(false);
		expect(result.has(deleted.id)).toBe(false);
	});

	it("counts cumulative UTF-8 bytes rather than characters across Replace entries", function _Utf8ReplayBound()
	{
		const payload = JSON.stringify(_DisplayMessages([_TextComponent("body", "界".repeat(10_000))]));
		const entries = Array.from({ length: 145 }, (_, index) => _DisplayEntry(index + 1));
		const payloads = Object.fromEntries(entries.map(entry => [entry.payloadRef, payload]));
		expect(_ConversationA2uiDisplays(entries.slice(0, 100), payloads).get("display-100")?.state).toBe(ConversationA2uiDisplayStates.Ready);
		expect(_ConversationA2uiDisplays(entries, payloads).get("display-145")?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
	});

	it("stops encoding payloads after aggregate exhaustion but still processes removals", function _StoppedReplayWork()
	{
		const payload = JSON.stringify(_DisplayMessages([_TextComponent("body", "界".repeat(10_000))]));
		const entries = Array.from({ length: 1_000 }, (_, index) => _DisplayEntry(index + 1));
		const payloads = Object.fromEntries(entries.map(entry => [entry.payloadRef, payload]));
		const encode = vi.spyOn(TextEncoder.prototype, "encode");
		try
		{
			expect(_ConversationA2uiDisplays([...entries, _RemoveEntry(1_001)], payloads).size).toBe(0);
			// Each admitted payload is encoded for accounting and by the public parser; the
			// first over-limit payload is measured once, and later history never reaches either.
			expect(encode.mock.calls.length).toBeLessThan(300);
		}
		finally
		{
			encode.mockRestore();
		}
	});

	it("rejects unsupported schema and missing payloads without poisoning another author", function _IndependentFailure()
	{
		const invalid = _DisplayEntry(1, { a2uiSchemaVersion: "0.9" });
		const valid = _DisplayEntry(2, { conversationId: "another" });
		const payloads = { "payload-1": JSON.stringify(_DisplayMessages()), "payload-2": JSON.stringify(_DisplayMessages()) };
		const result = _ConversationA2uiDisplays([invalid, valid], payloads);
		expect(result.get(invalid.id)?.state).toBe(ConversationA2uiDisplayStates.Unavailable);
		expect(result.get(valid.id)?.state).toBe(ConversationA2uiDisplayStates.Ready);
	});
});
