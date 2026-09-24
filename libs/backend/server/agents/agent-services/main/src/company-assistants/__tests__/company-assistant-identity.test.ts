import { AgentIdentityStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { __EnsureCompanyAssistantIdentity } from "../company-assistant-identity";

const _RESULT = { created: true, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", principalId: "company-principal", agentIdentityId: "identity-1", name: "Company assistant", createdAt: "2026-09-07T10:00:00.000Z", createdByPrincipalId: "admin", identityEventId: "13a9a2a4-4312-4f98-8ea1-bf385afed81a" };

/** Keeps append failures and independently checked current identity reads observable. */
function _History()
{
	return { load: vi.fn().mockResolvedValue(null), append: vi.fn().mockResolvedValue({}), loadActive: vi.fn().mockResolvedValue({ identity: { kind: "managed", state: AgentIdentityStates.Active } }) };
}

describe("__EnsureCompanyAssistantIdentity", function _Suite()
{
	it("uses committed creation facts and the persisted UUID for one NoStream append", async function _Creates()
	{
		const history = _History();
		await __EnsureCompanyAssistantIdentity(history as never, _RESULT);
		expect(history.append).toHaveBeenCalledExactlyOnceWith({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: _RESULT.identityEventId, identity: expect.objectContaining({ kind: "managed", id: "identity-1", principalId: "company-principal", createdByPrincipalId: "admin", createdAt: _RESULT.createdAt }) });
		expect(history.loadActive).toHaveBeenCalledWith({ siloId: "silo-1", agentIdentityId: "identity-1", agentServiceId: "service-1", principalId: "company-principal" });
	});

	it("accepts an uncertain append only after the exact active identity can be read", async function _Recovers()
	{
		const history = _History();
		history.append.mockRejectedValue(new Error("response lost"));
		await expect(__EnsureCompanyAssistantIdentity(history as never, _RESULT)).resolves.toBeUndefined();
		history.loadActive.mockRejectedValue(new Error("identity missing"));
		await expect(__EnsureCompanyAssistantIdentity(history as never, _RESULT)).rejects.toThrow("identity missing");
	});

	it("never appends over a suspended identity during a setup retry", async function _KeepsSuspension()
	{
		const history = _History();
		history.load.mockResolvedValue({ identity: { kind: "managed", state: AgentIdentityStates.Suspended } });
		history.loadActive.mockRejectedValue(new Error("identity suspended"));
		await expect(__EnsureCompanyAssistantIdentity(history as never, _RESULT)).rejects.toThrow("identity suspended");
		expect(history.append).not.toHaveBeenCalled();
	});
});
