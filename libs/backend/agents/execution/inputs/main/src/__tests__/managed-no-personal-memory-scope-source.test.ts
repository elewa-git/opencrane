import { describe, expect, it } from "vitest";

import { ManagedNoPersonalMemoryScopeSource } from "../managed-no-personal-memory-scope-source.js";

describe("ManagedNoPersonalMemoryScopeSource", function _DescribeManagedNoPersonalMemoryScopeSource()
{
	it("seals managed work with an explicit empty memory policy", async function _LoadsNoMemoryPolicy()
	{
		await expect(new ManagedNoPersonalMemoryScopeSource().load({} as never, { agentKind: "managed", agentServiceId: "service-1" } as never, { kind: "service", agentServiceId: "service-1" } as never, { messageIds: [] }, {} as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, memoryFacts: [] } });
	});

	it("refuses personal work instead of becoming an accidental memory fallback", async function _RefusesPersonal()
	{
		await expect(new ManagedNoPersonalMemoryScopeSource().load({} as never, { agentKind: "personal", agentServiceId: "service-1" } as never, { kind: "user" } as never, { messageIds: [] }, {} as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
	});
});
