import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AGENT_RUNTIME_PROTOCOL_V1, type RuntimeCandidate, type RuntimeCommandEnvelope } from "@opencrane/contracts";

import { _RegisterInternalAgentRuntimeStream } from "../agent-runtime-stream.js";
import { RuntimeCommandWakeup } from "../runtime-command-wakeup.js";
import type { RuntimeCommandStreamAuthority } from "../agent-runtime-stream.types.js";

/** Build a transport app with a deterministic projected-token reviewer. */
function _CreateApp(admit: RuntimeCommandStreamAuthority["__AdmitCandidate"], commandWakeup?: RuntimeCommandWakeup)
{
	const app = express();
	app.use(_RegisterInternalAgentRuntimeStream({
		tokenReviewer: {
			async __Review(token)
			{
				return token === "valid-token"
					? { subject: "system:serviceaccount:tenant:agent-runtime", namespace: "tenant", serviceAccountName: "agent-runtime", podUid: "11111111-1111-1111-1111-111111111111" }
					: null;
			},
		},
		authority: {
			async __NextCommand() { return null; },
			__AdmitCandidate: admit,
		},
		maxBodyBytes: 64 * 1024,
		heartbeatMilliseconds: 60_000,
		commandRecoveryMilliseconds: 1_000,
		commandWakeup,
	}));
	return app;
}

/** Minimum valid event candidate, with its durable admission intentionally stubbed. */
const _candidate: RuntimeCandidate = {
	protocolVersion: AGENT_RUNTIME_PROTOCOL_V1,
	runtimeInstanceId: "runtime-1234",
	commandId: "command-1",
	candidateId: "candidate-1",
	runId: "run-1" as RuntimeCandidate["runId"],
	attempt: 0,
	fence: 1,
	kind: "event",
	eventType: "run.started",
	payload: {},
};

/** Valid external action that may make a deferred resume command due after durable execution. */
const _externalActionCandidate: RuntimeCandidate = {
	..._candidate,
	kind: "external_action",
	toolRevisionId: "mcp-server:search",
	toolInvocationId: "invocation-1",
	argumentsDigest: "sha256:arguments",
	arguments: { query: "example" },
};

/** Valid stream-open identity for the deterministic projected-token test reviewer. */
const _streamOpen = {
	protocolVersion: AGENT_RUNTIME_PROTOCOL_V1,
	runtimeInstanceId: "runtime-1234",
	podUid: "11111111-1111-1111-1111-111111111111",
};

/** Close a test server after its stream response has been deliberately disconnected. */
function _CloseServer(server: Server): Promise<void>
{
	return new Promise(function _close(resolve, reject)
	{
		server.close(function _closed(error) { error ? reject(error) : resolve(); });
	});
}

describe("_RegisterInternalAgentRuntimeStream", function _runtimeTransportSuite()
{
	it("fails closed before candidate admission when the projected token is absent", async function _missingToken()
	{
		const admit = vi.fn<RuntimeCommandStreamAuthority["__AdmitCandidate"]>();
		await request(_CreateApp(admit)).post("/candidates").send(_candidate).expect(401, { code: "UNAUTHORIZED" });
		expect(admit).not.toHaveBeenCalled();
	});

	it("forwards only a syntactically complete authenticated candidate to the injected authority", async function _candidateAdmission()
	{
		const admit = vi.fn<RuntimeCommandStreamAuthority["__AdmitCandidate"]>().mockResolvedValue({ accepted: true });
		await request(_CreateApp(admit))
			.post("/candidates")
			.set("Authorization", "Bearer valid-token")
			.send(_candidate)
			.expect(202, { accepted: true });
		expect(admit).toHaveBeenCalledTimes(1);
	});

	it("wakes waiting streams only after an accepted external action may make a resume command due", async function _wakesAfterCandidateAcceptance()
	{
		const wakeup = new RuntimeCommandWakeup();
		const waiting = wakeup.waitForChange(wakeup.currentRevision(), 30_000);
		await request(_CreateApp(async function _accept() { return { accepted: true }; }, wakeup))
			.post("/candidates")
			.set("Authorization", "Bearer valid-token")
			.send(_externalActionCandidate)
			.expect(202, { accepted: true });
		await expect(waiting).resolves.toBeUndefined();
	});

	it("returns a bounded retryable result for an admitted action whose durable reservation is unavailable", async function _retryableCandidateAdmission()
	{
		const admit = vi.fn<RuntimeCommandStreamAuthority["__AdmitCandidate"]>().mockResolvedValue({ accepted: false, reason: "external_action_dispatch_retryable", retryable: true, retryAfterMilliseconds: 1_000 });
		await request(_CreateApp(admit))
			.post("/candidates")
			.set("Authorization", "Bearer valid-token")
			.send(_candidate)
			.expect(503, { accepted: false, reason: "external_action_dispatch_retryable", retryable: true, retryAfterMilliseconds: 1_000 });
	});

	it("rejects incomplete event candidates before the durable authority sees them", async function _malformedCandidate()
	{
		const admit = vi.fn<RuntimeCommandStreamAuthority["__AdmitCandidate"]>();
		const { payload: _, ...missingPayload } = _candidate;
		await request(_CreateApp(admit))
			.post("/candidates")
			.set("Authorization", "Bearer valid-token")
			.send(missingPayload)
			.expect(401, { code: "UNAUTHORIZED" });
		expect(admit).not.toHaveBeenCalled();
	});

	it("keeps one response alive for heartbeats and multiple strictly newer commands", async function _commandPump()
	{
		const nextCommand = vi.fn()
			.mockResolvedValueOnce({ sequence: 1 } as RuntimeCommandEnvelope)
			.mockResolvedValueOnce({ sequence: 2 } as RuntimeCommandEnvelope)
			.mockResolvedValue(null);
		const app = express();
		app.use(_RegisterInternalAgentRuntimeStream({
			tokenReviewer: { async __Review() { return { subject: "system:serviceaccount:tenant:agent-runtime", namespace: "tenant", serviceAccountName: "agent-runtime", podUid: _streamOpen.podUid }; } },
			authority: { __NextCommand: nextCommand, async __AdmitCandidate() { return { accepted: false }; } },
			maxBodyBytes: 64 * 1024,
			heartbeatMilliseconds: 5,
			commandRecoveryMilliseconds: 2,
		}));
		const server = createServer(app);
		await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", resolve); });
		const address = server.address() as AddressInfo;
		let stream = "";
		try
		{
			await new Promise<void>(function _consume(resolve, reject)
			{
				const timer = setTimeout(function _timedOut() { reject(new Error("stream did not emit commands and heartbeats")); }, 1_000);
				const clientRequest = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/stream", method: "POST", headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" } }, function _response(response)
				{
					response.setEncoding("utf8");
					response.on("data", function _data(chunk)
					{
						stream += chunk;
						if ((stream.match(/event: command/g) ?? []).length >= 2 && (stream.match(/event: heartbeat/g) ?? []).length >= 2)
						{
							clearTimeout(timer);
							response.destroy();
							resolve();
						}
					});
					response.on("error", reject);
				});
				clientRequest.on("error", reject);
				clientRequest.end(JSON.stringify(_streamOpen));
			});
		}
		finally
		{
			await _CloseServer(server);
		}
		expect(nextCommand).toHaveBeenCalledWith(expect.anything(), _streamOpen, 0);
		expect(nextCommand).toHaveBeenCalledWith(expect.anything(), _streamOpen, 1);
	});

	it("signals stream loss to the authority when the connection closes", async function _releaseOnClose()
	{
		const release = vi.fn<NonNullable<RuntimeCommandStreamAuthority["__ReleaseStream"]>>().mockResolvedValue(undefined);
		const app = express();
		app.use(_RegisterInternalAgentRuntimeStream({
			tokenReviewer: { async __Review() { return { subject: "system:serviceaccount:tenant:agent-runtime", namespace: "tenant", serviceAccountName: "agent-runtime", podUid: _streamOpen.podUid }; } },
			authority: { async __NextCommand() { return null; }, async __AdmitCandidate() { return { accepted: false }; }, __ReleaseStream: release },
			maxBodyBytes: 64 * 1024,
			heartbeatMilliseconds: 5,
			commandRecoveryMilliseconds: 2,
		}));
		const server = createServer(app);
		await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", resolve); });
		const address = server.address() as AddressInfo;
		try
		{
			await new Promise<void>(function _consume(resolve, reject)
			{
				const timer = setTimeout(function _timedOut() { reject(new Error("stream never opened")); }, 1_000);
				const clientRequest = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/stream", method: "POST", headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" } }, function _response(response)
				{
					response.setEncoding("utf8");
					response.on("data", function _data() { clearTimeout(timer); response.destroy(); resolve(); });
					response.on("error", reject);
				});
				clientRequest.on("error", reject);
				clientRequest.end(JSON.stringify(_streamOpen));
			});
			await vi.waitFor(function _released() { expect(release).toHaveBeenCalledWith(expect.objectContaining({ podUid: _streamOpen.podUid }), _streamOpen); });
		}
		finally
		{
			await _CloseServer(server);
		}
	});
});
