import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority, ConversationHistoryModes } from "@opencrane/backend/server/conversations/history";
import { __RequestConversationModel } from "@opencrane/backend/server/gateways/model-routing";
import { _KurrentHistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _McpModelNameAuthority } from "./conversation-mcp-model-tool-name.integration.sql.fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

const _KURRENT_URL = process.env["KURRENTDB_INTEGRATION_URL"];
const _DATABASE_URL = process.env["DATABASE_URL"];
const _RUN_REAL_PROOF = _KURRENT_URL !== undefined && _DATABASE_URL !== undefined;
const _PrismaClients: PrismaClient[] = [];
const _KurrentClients: KurrentDBClient[] = [];

it.skipIf(_RUN_REAL_PROOF)("skips the MCP model-name journey because PostgreSQL or KurrentDB is unset", function _Skipped()
{
	expect(_DATABASE_URL === undefined || _KURRENT_URL === undefined).toBe(true);
});

describe.skipIf(!_RUN_REAL_PROOF)("MCP model-name selection across PostgreSQL and KurrentDB", function _Suite()
{
	afterEach(function _Restore() { vi.unstubAllGlobals(); });
	afterAll(async function _Disconnect()
	{
		await Promise.all(_PrismaClients.map(client => client.$disconnect()));
		await Promise.all(_KurrentClients.map(client => client.dispose()));
	});

	it("selects a compiled model name and dispatches the exact discovered MCP name once across restart", async function _McpModelName()
	{
		const sourceName = `records.${"long_segment_".repeat(8)}lookup`;
		const fixture = await _SeedConversationToolProposalSqlFixture({ tool: { name: sourceName, description: "Read one record through a long discovered name", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } }, additionalProperties: false }, arguments: { query: "dedicated record" } } });
		const prisma = _Prisma();
		const history = _History();
		await history.append(new ConversationHistoryAuthority(history).genesisAppend({ schemaVersion: 1, siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, mode: ConversationHistoryModes.AgentSession, agentServiceId: fixture.turn.binding.agentServiceId, createdByPrincipalId: fixture.principalId, createdAt: new Date().toISOString() }, randomUUID()));
		let modelRequests = 0;
		const requestModel = async function _RequestModel(input: Parameters<typeof __RequestConversationModel>[0])
		{
			modelRequests++;
			const call = { id: `call-${randomUUID()}`, name: fixture.tool.modelName, arguments: JSON.stringify(fixture.proposal.arguments), content: null };
			const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] } }] }), { headers: { "content-type": "application/json; charset=utf-8" } }));
			vi.stubGlobal("fetch", fetchMock);
			const result = await __RequestConversationModel(input);
			const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body));
			expect(body.tools).toEqual([{ type: "function", function: { name: fixture.tool.modelName, description: fixture.tool.description, parameters: fixture.tool.parametersSchema } }]);
			expect(JSON.stringify(body.tools)).not.toContain(sourceName);
			return result;
		};
		const first = _McpModelNameAuthority(prisma, history, fixture, requestModel);
		const turn = await first.start();
		await expect(first.authority.advance(turn.bootstrapId)).resolves.toMatchObject({ outcome: "tool_pending", waitFor: "result" });
		const registered = (await first.runtime.register())!;
		const commandClaimed = await first.runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		const command = commandClaimed === null || typeof commandClaimed === "string" ? commandClaimed : commandClaimed.command;
		if (command === null || typeof command === "string" || command.kind !== "invocation")
			throw new Error("Expected the model-selected MCP invocation");
		expect(command).toMatchObject({ toolName: sourceName, arguments: fixture.proposal.arguments });

		const restartedInput = await fixture.recompile();
		expect(restartedInput).toEqual(fixture.candidate.compiledInput);
		const restarted = _McpModelNameAuthority(_Prisma(), _History(), { ...fixture, candidate: { ...fixture.candidate, compiledInput: restartedInput } }, requestModel);
		await expect(restarted.authority.advance(turn.bootstrapId)).resolves.toMatchObject({ outcome: "tool_pending", waitFor: "result" });
		expect(modelRequests).toBe(1);
		expect(await prisma.toolInvocation.count({ where: { runId: fixture.runId } })).toBe(1);
		expect(await prisma.mcpRuntimeExecution.count({ where: { siloId: fixture.siloId } })).toBe(1);
	});
});

/** Create one independent Prisma client for restart proof. */
function _Prisma(): PrismaClient
{
	const client = new PrismaClient({ datasourceUrl: _DATABASE_URL });
	_PrismaClients.push(client);
	return client;
}

/** Create one independent Kurrent client for restart proof. */
function _History(): _KurrentHistoryStore
{
	const client = KurrentDBClient.connectionString(_KURRENT_URL ?? "");
	_KurrentClients.push(client);
	return new _KurrentHistoryStore(client);
}
