import { generateKeyPairSync } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { Es256PublicJwk } from "@opencrane/models/authorization";

import { __ComputeEs256JwkThumbprint } from "../capability-proof.js";
import { __CreateRuntimeBootstrapRouter } from "../runtime-bootstrap.router.js";
import type { RuntimeBootstrapClaim, RuntimeBootstrapConsumptionResult } from "../runtime-proof.types.js";
import type { RuntimeBootstrapExchangeRecord, RuntimeBootstrapReviewedIdentity, RuntimeBootstrapExchangeRepository } from "../runtime-bootstrap.types.js";

/** Fixed opaque bootstrap reference matching the provisioning grammar. */
const _BOOTSTRAP_REFERENCE = `bootstrap-v1_${"a".repeat(64)}`;

/** Reviewed runtime identity accepted by the deterministic token reviewer. */
const _identity: RuntimeBootstrapReviewedIdentity = { subject: "system:serviceaccount:runtime-ns:agent-runtime-personal", namespace: "runtime-ns", serviceAccountName: "agent-runtime-personal", podUid: "pod-1" };

/** Generate one valid P-256 public JWK plus its RFC 7638 thumbprint for a real submission. */
function _proofKey(): { proofPublicJwk: Es256PublicJwk; proofKeyThumbprint: string }
{
	const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
	const proofPublicJwk: Es256PublicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
	return { proofPublicJwk, proofKeyThumbprint: __ComputeEs256JwkThumbprint(proofPublicJwk) };
}

/** Build a consistent durable record whose bootstrap and assignment sources agree. */
function _record(overrides: Partial<RuntimeBootstrapExchangeRecord> = {}): RuntimeBootstrapExchangeRecord
{
	return {
		bootstrapId: _BOOTSTRAP_REFERENCE,
		bootstrapSiloId: "silo-1",
		bootstrapSubjectId: "user-1",
		bootstrapAudience: "opencrane-agent-runtime",
		bootstrapServiceAccountName: "agent-runtime-personal",
		bootstrapNamespace: "runtime-ns",
		bootstrapWorkloadKind: "job",
		bootstrapWorkloadUid: "wl-1",
		bootstrapRunId: "run-1",
		bootstrapAgentServiceId: "svc-1",
		bootstrapAttempt: 1,
		bootstrapAgentRevisionId: "rev-1",
		bootstrapExpiresAtEpochMs: Date.parse("2026-07-20T00:05:00.000Z"),
		assignmentSiloId: "silo-1",
		assignmentSubjectId: "user-1",
		assignmentAudience: "opencrane-agent-runtime",
		assignmentWorkloadKind: "job",
		assignmentWorkloadUid: "wl-1",
		assignmentPodUid: "pod-1",
		assignmentRunId: "run-1",
		assignmentAgentServiceId: "svc-1",
		assignmentAttempt: 1,
		assignmentAgentRevisionId: "rev-1",
		...overrides,
	};
}

/** Build a router app around a fake repository and a deterministic reviewer/clock. */
function _app(options: { record: RuntimeBootstrapExchangeRecord | null; consumption: RuntimeBootstrapConsumptionResult; identity?: RuntimeBootstrapReviewedIdentity | null })
{
	const consume = vi.fn(async function _consume(_claim: RuntimeBootstrapClaim) { return options.consumption; });
	const repository: RuntimeBootstrapExchangeRepository = {
		async loadBootstrapExchange() { return options.record; },
		consumeAndBindProofKeyAtomically: consume,
	};
	const app = express();
	app.use(express.json());
	app.use("/api/internal/agent-runtime", __CreateRuntimeBootstrapRouter({
		tokenReviewer: { async __Review(token: string) { return token === "valid" ? (options.identity === undefined ? _identity : options.identity) : null; } },
		runtimeNamespaces: ["runtime-ns", "managed-runtime-ns"],
		repository,
		clock: { nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } },
		logger: { error() {} },
	}));
	return { app, consume };
}

describe("__CreateRuntimeBootstrapRouter", function _describeBootstrapRouter()
{
	it("consumes a valid bootstrap exactly once and returns its receipt", async function _consumesOnce()
	{
		const { app, consume } = _app({ record: _record(), consumption: { status: "consumed", receiptId: "receipt-1" } });
		const key = _proofKey();

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ...key });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ receiptId: "receipt-1" });
		expect(consume).toHaveBeenCalledTimes(1);
	});

	it("preserves the managed audience and namespace through bootstrap consumption", async function _ConsumesManagedBootstrap()
	{
		const managedIdentity: RuntimeBootstrapReviewedIdentity = { subject: "system:serviceaccount:managed-runtime-ns:managed-agent-runtime-default", namespace: "managed-runtime-ns", serviceAccountName: "managed-agent-runtime-default", podUid: "pod-1" };
		const record = _record({
			bootstrapAudience: "opencrane-managed-agent-runtime",
			bootstrapNamespace: "managed-runtime-ns",
			bootstrapServiceAccountName: "managed-agent-runtime-default",
			assignmentAudience: "opencrane-managed-agent-runtime",
		});
		const { app, consume } = _app({ record, identity: managedIdentity, consumption: { status: "consumed", receiptId: "receipt-managed" } });

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ..._proofKey() });

		expect(response.status).toBe(200);
		expect(consume).toHaveBeenCalledWith(expect.objectContaining({ audience: "opencrane-managed-agent-runtime", namespace: "managed-runtime-ns", serviceAccountName: "managed-agent-runtime-default" }));
	});

	it("fails closed on a replayed bootstrap", async function _replay()
	{
		const { app } = _app({ record: _record(), consumption: { status: "already_consumed" } });
		const key = _proofKey();

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ...key });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "bootstrap_replay" });
	});

	it("returns bootstrap_unavailable when no durable binding exists", async function _missing()
	{
		const { app, consume } = _app({ record: null, consumption: { status: "conflict" } });
		const key = _proofKey();

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ...key });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "bootstrap_unavailable" });
		expect(consume).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated caller before loading any bootstrap state", async function _unauthenticated()
	{
		const { app, consume } = _app({ record: _record(), consumption: { status: "consumed", receiptId: "receipt-1" } });
		const key = _proofKey();

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer nope").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ...key });

		expect(response.status).toBe(401);
		expect(consume).not.toHaveBeenCalled();
	});

	it("fails closed when the reviewed Pod differs from the assignment Pod", async function _podMismatch()
	{
		const { app, consume } = _app({ record: _record(), consumption: { status: "consumed", receiptId: "receipt-1" }, identity: { ..._identity, podUid: "pod-2" } });
		const key = _proofKey();

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: _BOOTSTRAP_REFERENCE, ...key });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "pod_mismatch" });
		expect(consume).not.toHaveBeenCalled();
	});

	it("rejects a malformed submission before authority evaluation", async function _malformed()
	{
		const { app, consume } = _app({ record: _record(), consumption: { status: "consumed", receiptId: "receipt-1" } });

		const response = await request(app).post("/api/internal/agent-runtime/bootstrap").set("authorization", "Bearer valid").send({ bootstrapReference: "not-a-reference", proofKeyThumbprint: "x", proofPublicJwk: { kty: "EC", crv: "P-256", x: "a", y: "b" } });

		expect(response.status).toBe(400);
		expect(consume).not.toHaveBeenCalled();
	});
});
