import { describe, expect, it } from "vitest";

import type { CompiledModelRoute, CompiledToolDefinition, RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { PROMPT_COMPILER_VERSION, __AppendCompiledTool, __CompileRunInput } from "../prompt-compiler.js";
import type { PromptCompilerRepositories } from "../prompt-compiler.types.js";

/** Build a snapshot fixture whose references the fake repositories can resolve. */
function _snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "svc-1",
		agentRevisionId: "rev-1",
		snapshotVersion: 1,
		threadId: "thread-1",
		messageIds: ["m-1", "m-2"],
		personaRevisionId: "persona-1",
		preferenceFactIds: [],
		artifactRevisionIds: ["art-2", "art-1"],
		skillRevisionIds: ["skill-1"],
		memoryFacts: [{ datasetId: "d-1", factId: "fact-2", contentDigest: "sha256:a", provenance: [] }, { datasetId: "d-1", factId: "fact-1", contentDigest: "sha256:b", provenance: [] }],
		memoryQueryPolicy: {},
		toolGrantIds: ["grant-b", "grant-a"],
		modelRoute: { alias: "silo-default" },
		budgetPolicy: { maxTurns: 4, maxTotalTokens: 4096, maxCostUsdMicros: 500000, maxToolInvocations: 8, wallClockDeadlineEpochMs: 1_800_000_000_000 },
		identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 3, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "k1", fleetMembershipAssertionId: "a1", fleetMembershipPayloadDigest: "sha256:c", fleetMembershipTrustedUntil: "2026-07-21T00:00:00.000Z" },
		capabilitySetDigest: "sha256:cap",
		effectiveContractDigest: "sha256:contract",
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: "sha256:snap",
		compiledAt: "2026-07-20T00:00:00.000Z",
		...overrides,
	};
}

/** Two tool definitions returned in grant order to prove name ordering is applied. */
function _tools(): readonly CompiledToolDefinition[]
{
	return [
		{ name: "zulu", toolRevisionId: "tr-z", description: "last by name", requiresApproval: false, parametersSchema: { type: "object" } },
		{ name: "alpha", toolRevisionId: "tr-a", description: "first by name", requiresApproval: true, parametersSchema: { type: "object" } },
	];
}

/** Build fake repositories that echo their inputs deterministically for compiler assertions. */
function _repositories(overrides: Partial<PromptCompilerRepositories> = {}): PromptCompilerRepositories
{
	const model: CompiledModelRoute = { modelAlias: "silo-default", maxOutputTokens: 1024 };
	return {
		loadPersonaInstructions: async function _persona(id): Promise<string> { return id === null ? "" : "You are a careful assistant."; },
		loadMessages: async function _messages(ids): Promise<readonly { role: "user"; content: string }[]> { return ids.map(function _turn(id): { role: "user"; content: string } { return { role: "user", content: `msg:${id}` }; }); },
		loadToolDefinitions: async function _toolDefs(): Promise<readonly CompiledToolDefinition[]> { return _tools(); },
		loadMemoryFactStatements: async function _memory(ids): Promise<readonly string[]> { return ids.map(function _fact(id): string { return `remembered ${id}`; }); },
		loadArtifactSummaries: async function _artifacts(ids): Promise<readonly string[]> { return ids.map(function _summary(id): string { return `artifact ${id}`; }); },
		loadSkillSummaries: async function _skills(ids): Promise<readonly string[]> { return ids.map(function _summary(id): string { return `skill ${id}`; }); },
		resolveModelRoute: async function _route(): Promise<CompiledModelRoute> { return model; },
		...overrides,
	};
}

describe("__CompileRunInput", function _describeCompiler()
{
	it("stamps the compiler version and preserves message order", async function _stampsVersion()
	{
		const compiled = await __CompileRunInput(_snapshot(), _repositories());

		expect(compiled.promptCompilerVersion).toBe(PROMPT_COMPILER_VERSION);
		expect(compiled.messages.map(function _content(m): string { return m.content; })).toEqual(["msg:m-1", "msg:m-2"]);
	});

	it("orders tools by name regardless of grant iteration order", async function _ordersTools()
	{
		const compiled = await __CompileRunInput(_snapshot(), _repositories());

		expect(compiled.tools.map(function _name(t): string { return t.name; })).toEqual(["alpha", "zulu"]);
	});

	it("resolves literal budget numbers from the opaque budget policy", async function _resolvesBudget()
	{
		const compiled = await __CompileRunInput(_snapshot(), _repositories());

		expect(compiled.budget).toEqual({ maxTurns: 4, maxTotalTokens: 4096, maxCostUsdMicros: 500000, maxToolInvocations: 8, wallClockDeadlineEpochMs: 1_800_000_000_000 });
	});

	it("nulls malformed or absent budget limits rather than inventing them", async function _nullsBadBudget()
	{
		const compiled = await __CompileRunInput(_snapshot({ budgetPolicy: { maxTotalTokens: "lots" as unknown as JsonValue } }), _repositories());

		expect(compiled.budget).toEqual({ maxTurns: null, maxTotalTokens: null, maxCostUsdMicros: null, maxToolInvocations: null, wallClockDeadlineEpochMs: null });
	});

	it("assembles persona, memory, artifact, and skill sections in canonical order", async function _assembles()
	{
		const compiled = await __CompileRunInput(_snapshot(), _repositories());

		expect(compiled.instructions).toBe(
			"You are a careful assistant.\n\n"
			+ "Durable memory available for this run:\n- remembered fact-1\n- remembered fact-2\n\n"
			+ "Artifacts available for this run:\n- artifact art-1\n- artifact art-2\n\n"
			+ "Skills available for this run:\n- skill skill-1",
		);
	});

	it("produces byte-identical output for the same snapshot across repeated compilations", async function _deterministic()
	{
		const first = await __CompileRunInput(_snapshot(), _repositories());
		const second = await __CompileRunInput(_snapshot(), _repositories());

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		expect(second.digest).toBe(first.digest);
		expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("changes the digest when any compiled input changes", async function _digestSensitive()
	{
		const base = await __CompileRunInput(_snapshot(), _repositories());
		const changed = await __CompileRunInput(_snapshot(), _repositories({ loadPersonaInstructions: async function _other(): Promise<string> { return "Different persona."; } }));

		expect(changed.digest).not.toBe(base.digest);
	});

	it("fails closed when the snapshot targets a different compiler version", async function _versionMismatch()
	{
		await expect(__CompileRunInput(_snapshot({ promptCompilerVersion: "opencrane.prompt-compiler/other" }), _repositories())).rejects.toThrow(/cannot compile snapshot version/);
	});
});

describe("__AppendCompiledTool", function _describeAppend()
{
	it("orders the added first-party tool and reseals the changed payload", async function _Reseals()
	{
		const input = await __CompileRunInput(_snapshot(), _repositories());
		const updated = __AppendCompiledTool(input, { name: "upgrade_session", toolRevisionId: "opencrane:personal:upgrade_session:v1", description: "future change", requiresApproval: false, parametersSchema: { type: "object" } });

		expect(updated.tools.map(function _name(tool): string { return tool.name; })).toEqual(["alpha", "upgrade_session", "zulu"]);
		expect(updated.digest).not.toBe(input.digest);
	});

	it("rejects a duplicate tool name so an MCP descriptor cannot shadow a first-party tool", async function _RejectsDuplicateName()
	{
		const input = await __CompileRunInput(_snapshot(), _repositories());
		expect(function _appendDuplicateName(): void { __AppendCompiledTool(input, { name: "alpha", toolRevisionId: "opencrane:personal:upgrade_session:v1", description: "shadow", requiresApproval: false, parametersSchema: { type: "object" } }); }).toThrow(/already contains tool/);
	});
});
