import { afterEach, describe, expect, it, vi } from "vitest";

import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

afterEach(function _RestoreMocks() { vi.restoreAllMocks(); });

describe("model tool names select immutable MCP revisions", function _ModelNames()
{
	it("resolves the model name while retaining the original MCP name and proposal after restart", async function _SavedSelection()
	{
		const f = await _ToolContinuationHarness();
		f.toolFlags.pending = true;
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending" });
		const saved = (await f.store.load(f.step))!;
		const [turn, candidate, command] = f.proposals.admit.mock.calls[0]! as unknown as [unknown, typeof f.candidate, { toolRevisionId: string }];
		expect(turn).toMatchObject({ toolSelection: saved.toolSelection });
		expect(candidate.compiledInput.tools[0]).toMatchObject({ name: "records.lookup", modelName: f.call.name });
		expect(command.toolRevisionId).toBe("tool-1");
		const declaration = await f.custody.loadDeclaration(saved);
		expect(declaration?.declaration.call.name).toBe(f.call.name);
		f.toolFlags.pending = false;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect((await f.store.load(f.step))?.toolSelection).toEqual(saved.toolSelection);
		expect(f.toolFlags.executions).toBe(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it.each(["records.lookup", "other_revision_alias", "not.a.model.name"])("refuses %s before proposal admission", async function _NoNameFallback(name)
	{
		const f = await _ToolContinuationHarness();
		f.call.name = name;
		await f.authority.advance(f.step);
		expect(f.proposals.admit).not.toHaveBeenCalled();
		expect((await f.store.load(f.step))?.toolSelection).toBeNull();
		expect(f.rows.size).toBe(0);
		await f.restart().advance(f.step);
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(0);
	});

	it("rejects ambiguous model names before selecting either revision", async function _AmbiguousName()
	{
		const f = await _ToolContinuationHarness();
		const tool = f.candidate.compiledInput.tools[0]!;
		Object.assign(f.candidate.compiledInput, { tools: [tool, { ...tool, toolRevisionId: "tool-2" }] });
		await f.authority.advance(f.step);
		expect(f.proposals.admit).not.toHaveBeenCalled();
		expect((await f.store.load(f.step))?.toolSelection).toBeNull();
	});

	it("cannot rebind a saved proposal when a recovered declaration names another offered revision", async function _ChangedSavedAlias()
	{
		const f = await _ToolContinuationHarness();
		const tool = f.candidate.compiledInput.tools[0]!;
		Object.assign(f.candidate.compiledInput, { tools: [tool, { ...tool, modelName: "second_lookup", toolRevisionId: "tool-2" }] });
		f.toolFlags.pending = true;
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending" });
		const saved = (await f.store.load(f.step))!;
		const original = (await f.custody.loadDeclaration(saved))!;
		vi.spyOn(f.custody, "loadDeclaration").mockResolvedValue({ ...original, declaration: { ...original.declaration, call: { ...original.declaration.call, name: "second_lookup" } } });
		await f.restart().advance(f.step);
		expect((await f.store.load(f.step))?.toolSelection).toEqual(saved.toolSelection);
		expect(f.proposals.admit).toHaveBeenCalledOnce();
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
	});
});
