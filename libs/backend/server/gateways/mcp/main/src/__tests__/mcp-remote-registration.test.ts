import { describe, expect, it, vi } from "vitest";

import type { DurableExecutionTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorRepository, McpOperatorServerRecord, McpOperatorTransaction, McpOperatorUnitOfWork, McpRemoteServerRegistrationRecord } from "../core/mcp-operator-repository.types";
import { McpRemoteServerRegistrationValidationError, registerRemoteServer } from "../era-probe/mcp-remote-registration";
import { McpRemoteServerRegistrationOutcomes } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeWorkflow, McpRemoteServerRegistrationCommand } from "../era-probe/mcp-era-probe.types";

/** Return one valid admin registration command. */
function _Command(): McpRemoteServerRegistrationCommand
{
	return { idempotencyKey: "registration-1", name: "Example MCP", description: "Public tools", endpoint: "https://mcp.example.test/" };
}

/** Build a draft row from normalized registration fields. */
function _Server(registration: McpRemoteServerRegistrationRecord): McpOperatorServerRecord
{
	return { id: "server-1", name: registration.name, description: registration.description, publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "PendingReview", credentialSchema: [], entitlementSummary: null, endpoint: registration.endpoint, registrationKeyDigest: registration.registrationKeyDigest, registrationDigest: registration.registrationDigest, eraProbeStatus: "Pending", eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 };
}

/** Return a stateful transaction that identifies a retried registration without another audit. */
function _Harness(): { unitOfWork: McpOperatorUnitOfWork; workflow: McpEraProbeWorkflow; audit: ReturnType<typeof vi.fn>; admit: ReturnType<typeof vi.fn> }
{
	let stored: McpOperatorServerRecord | null = null;
	const audit = vi.fn().mockResolvedValue(undefined);
	const repository = {
		createOrFindRemoteServer: vi.fn().mockImplementation(function _Create(registration: McpRemoteServerRegistrationRecord)
		{
			if (stored) return Promise.resolve({ created: false, server: stored });
			stored = _Server(registration);
			return Promise.resolve({ created: true, server: stored });
		}),
		appendAudit: audit,
	} as unknown as McpOperatorRepository;
	const durableExecution: DurableExecutionTransaction = { client: {} };
	const transaction = { mcp: repository, durableExecution } as unknown as McpOperatorTransaction;
	const unitOfWork: McpOperatorUnitOfWork = { execute: async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return await operation(transaction); } };
	const admit = vi.fn().mockResolvedValue({ taskKey: "task-key", receipt: { taskId: "task-1", taskName: "mcp-era-probe.probe", idempotencyKey: "task-key" } });
	return { unitOfWork, workflow: { admit }, audit, admit };
}

describe("remote MCP registration", function _RemoteRegistrationSuite()
{
	it("returns the same server and task input when the same request is retried", async function _RetriesWithoutAnotherSideEffect()
	{
		const harness = _Harness();
		const caller = { siloId: "silo-1", principalId: "admin-1" };

		const first = await registerRemoteServer(harness.unitOfWork, harness.workflow, caller, _Command());
		const retried = await registerRemoteServer(harness.unitOfWork, harness.workflow, caller, _Command());

		expect(first).toEqual(retried);
		expect(first.outcome).toBe(McpRemoteServerRegistrationOutcomes.Registered);
		expect(harness.audit).toHaveBeenCalledTimes(1);
		expect(harness.audit).toHaveBeenCalledWith("Created", "McpServer/server-1", "Remote MCP server server-1 registered for protocol check", { siloId: "silo-1", actorPrincipalId: "admin-1" });
		expect(harness.admit).toHaveBeenCalledTimes(2);
		expect(harness.admit.mock.calls[0][1]).toEqual(harness.admit.mock.calls[1][1]);
	});

	it("returns a conflict when the same key is retried with different input", async function _RejectsChangedRetry()
	{
		const harness = _Harness();
		const caller = { siloId: "silo-1", principalId: "admin-1" };

		await registerRemoteServer(harness.unitOfWork, harness.workflow, caller, _Command());
		const result = await registerRemoteServer(harness.unitOfWork, harness.workflow, caller, { ..._Command(), endpoint: "https://other.example.test/" });

		expect(result.outcome).toBe(McpRemoteServerRegistrationOutcomes.Conflict);
		expect(harness.admit).toHaveBeenCalledTimes(1);
	});

	it.each([
		["malformed URL", { endpoint: "not a URL" }],
		["query", { endpoint: "https://mcp.example.test/?token=no" }],
		["fragment", { endpoint: "https://mcp.example.test/#section" }],
		["short idempotency key", { idempotencyKey: "short" }],
		["IP literal", { endpoint: "https://127.0.0.1/" }],
		["private host name", { endpoint: "https://service.internal/" }],
	] as const)("rejects a %s before a transaction starts", function _RejectsUnsafeInput(_name, override)
	{
		const harness = _Harness();
		expect(function _Register() { return registerRemoteServer(harness.unitOfWork, harness.workflow, { siloId: "silo-1", principalId: "admin-1" }, { ..._Command(), ...override }); }).toThrow(McpRemoteServerRegistrationValidationError);
		expect(harness.admit).not.toHaveBeenCalled();
		expect(harness.audit).not.toHaveBeenCalled();
	});
});
