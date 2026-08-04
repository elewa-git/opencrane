import { describe, expect, it } from "vitest";

import { __FakeObotMcpInvocationAdapter } from "../fake-obot-mcp-invocation.js";
import { __AssertToolAllowed, ObotMcpInvocationUnavailableError, ObotMcpToolNotAllowedError } from "../obot-mcp-invocation.js";
import type { ObotMcpToolInvocationCommand } from "../obot-mcp-invocation.types.js";
import { __UnavailableObotMcpInvocationAdapter } from "../unavailable-obot-mcp-invocation.js";

/** Builds an invocation command with an allow-list of one tool by default. */
function _command(overrides: Partial<ObotMcpToolInvocationCommand> = {}): ObotMcpToolInvocationCommand
{
	return { siloId: "silo-1", integrationId: "integ-1", obotCustodyReference: "obot-ref-opaque", toolName: "slack.listChannels", arguments: {}, allowedTools: ["slack.listChannels", "slack.getMessages"], ...overrides };
}

describe("MCP tool allow-list enforcement", function _AllowListSuite()
{
	it("permits an allow-listed tool", function _Permits()
	{
		expect(() => __AssertToolAllowed(_command())).not.toThrow();
	});

	it("rejects a tool outside the allow-list", function _Rejects()
	{
		expect(() => __AssertToolAllowed(_command({ toolName: "slack.deleteChannel" }))).toThrow(ObotMcpToolNotAllowedError);
	});

	it("rejects everything when the allow-list is empty", function _EmptyAllowList()
	{
		expect(() => __AssertToolAllowed(_command({ allowedTools: [] }))).toThrow(ObotMcpToolNotAllowedError);
	});
});

describe("fake transport", function _FakeSuite()
{
	it("invokes an allow-listed tool and never receives a credential", async function _Invokes()
	{
		const fake = new __FakeObotMcpInvocationAdapter({ content: { channels: [] } });
		const result = await fake.invokeTool(_command());
		expect(result).toEqual({ content: { channels: [] } });
		expect(fake.invocations).toHaveLength(1);
		// Only the opaque custody reference crosses the boundary — never a credential value.
		expect(JSON.stringify(fake.invocations[0])).not.toMatch(/secret|token|password|apiKey/i);
		expect(fake.invocations[0].obotCustodyReference).toBe("obot-ref-opaque");
	});

	it("rejects a non-allow-listed tool before any call is recorded", async function _RejectsBeforeCall()
	{
		const fake = new __FakeObotMcpInvocationAdapter();
		await expect(fake.invokeTool(_command({ toolName: "slack.deleteChannel" }))).rejects.toBeInstanceOf(ObotMcpToolNotAllowedError);
		expect(fake.invocations).toHaveLength(0);
	});
});

describe("unavailable transport", function _UnavailableSuite()
{
	it("enforces the allow-list first, then fails closed for an allow-listed tool", async function _FailsClosed()
	{
		const stub = new __UnavailableObotMcpInvocationAdapter();
		await expect(stub.invokeTool(_command({ toolName: "slack.deleteChannel" }))).rejects.toBeInstanceOf(ObotMcpToolNotAllowedError);
		await expect(stub.invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpInvocationUnavailableError);
	});
});
