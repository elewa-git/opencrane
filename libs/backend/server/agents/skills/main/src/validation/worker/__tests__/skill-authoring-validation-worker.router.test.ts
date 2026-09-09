import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateSkillAuthoringValidationWorkerRouter } from "../skill-authoring-validation-worker.router";
import { SkillAuthoringValidationWorkerOutcomes, type SkillAuthoringValidationWorkerRouterDependencies } from "../skill-authoring-validation-worker.types";

/** Opaque reference shape accepted by the shared bootstrap contract. */
const _BOOTSTRAP_REFERENCE = `skill-bootstrap-v1_${"a".repeat(64)}`;

/** Return the fixed authoring Pod identity accepted by worker routes. */
function _Identity()
{
	return { subject: "system:serviceaccount:authoring:skill-authoring-default", namespace: "authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };
}

/** Build an internal Express app with configurable worker protocol dependencies. */
function _App(overrides: Partial<SkillAuthoringValidationWorkerRouterDependencies> = {})
{
	const dependencies: SkillAuthoringValidationWorkerRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_Identity()) },
		authority: {
			loadBootstrap: vi.fn().mockResolvedValue({ validationId: "validation-1", namespace: "authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" }),
			consumeBootstrap: vi.fn().mockResolvedValue("consumed"),
			loadInput: vi.fn().mockResolvedValue({ siloId: "silo-a", artifactId: "artifact-1", artifactRevisionId: "artifact-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 4, mediaType: "application/zip" }),
			complete: vi.fn().mockResolvedValue("completed"),
		},
		artifactReader: { read: vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([1, 2, 3, 4])); controller.close(); } })) },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillAuthoringValidationWorkerRouter(dependencies));
	return { app, dependencies };
}

describe("skill authoring validation worker router", function _DescribeWorkerRouter()
{
	it("spends an opaque bootstrap only after TokenReview matches its fixed Pod", async function _Bootstraps()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-authoring-validations:bootstrap").set("authorization", "Bearer projected-token").send({ bootstrapReference: _BOOTSTRAP_REFERENCE });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ acknowledged: true, validationId: "validation-1" });
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
		expect(dependencies.authority.consumeBootstrap).toHaveBeenCalledWith(expect.stringMatching(/^sha256:[a-f0-9]{64}$/u), _Identity());
	});

	it("does not spend a bootstrap when TokenReview resolves another Pod", async function _RejectsBootstrapPodMismatch()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ ..._Identity(), podUid: "other-pod" }) } });
		const response = await request(app).post("/skill-authoring-validations:bootstrap").set("authorization", "Bearer projected-token").send({ bootstrapReference: _BOOTSTRAP_REFERENCE });

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "worker_identity_denied" });
		expect(dependencies.authority.consumeBootstrap).not.toHaveBeenCalled();
	});

	it("streams the server-selected artifact with its immutable content address", async function _StreamsInput()
	{
		const { app, dependencies } = _App();
		const response = await request(app).get("/skill-authoring-validations/validation-1/input").set("authorization", "Bearer projected-token").buffer(true).parse(function _Parse(responseStream, callback): void
		{
			const chunks: Buffer[] = [];
			responseStream.on("data", function _Append(chunk: Buffer): void { chunks.push(chunk); });
			responseStream.on("end", function _Finish(): void { callback(null, Buffer.concat(chunks)); });
		});

		expect(response.status).toBe(200);
		expect(response.headers["x-opencrane-content-address"]).toBe(`sha256:${"a".repeat(64)}`);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.body).toEqual(Buffer.from([1, 2, 3, 4]));
		expect(dependencies.authority.loadInput).toHaveBeenCalledWith("validation-1", _Identity());
	});

	it("rejects an artifact that exceeds the fixed archive size before storage is read", async function _RejectsOversizedInput()
	{
		const input = { siloId: "silo-a", artifactId: "artifact-1", artifactRevisionId: "artifact-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: (16 * 1024 * 1024) + 1, mediaType: "application/zip" };
		const authority = { loadBootstrap: vi.fn(), consumeBootstrap: vi.fn(), loadInput: vi.fn().mockResolvedValue(input), complete: vi.fn() };
		const artifactReader = { read: vi.fn() };
		const { app } = _App({ authority, artifactReader });
		const response = await request(app).get("/skill-authoring-validations/validation-1/input").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "authoring_input_unavailable" });
		expect(artifactReader.read).not.toHaveBeenCalled();
	});

	it("accepts one bounded successful completion from the reviewed Pod", async function _Completes()
	{
		const { app, dependencies } = _App();
		const command = { validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Succeeded, testReport: { passed: true, summary: "tests passed", checksRun: 3 }, scanResult: { passed: true, summary: "scan passed", checksRun: 2 } };
		const response = await request(app).post("/skill-authoring-validations:complete").set("authorization", "Bearer projected-token").send(command);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ completed: true });
		expect(dependencies.authority.complete).toHaveBeenCalledWith(command, _Identity());
	});

	it("rejects a nominal success when either validation report failed", async function _RejectsFailedSuccessReport()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-authoring-validations:complete").set("authorization", "Bearer projected-token").send({ validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Succeeded, testReport: { passed: false, summary: "tests failed", checksRun: 3 }, scanResult: { passed: true, summary: "scan passed", checksRun: 2 } });

		expect(response.status).toBe(400);
		expect(dependencies.authority.complete).not.toHaveBeenCalled();
	});

	it("rejects completion payloads with extra worker-controlled data", async function _RejectsUnboundedCompletion()
	{
		const { app, dependencies } = _App();
		const command = { validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Failed, failureCode: "tests_failed", commandOutput: "secret output" };
		const response = await request(app).post("/skill-authoring-validations:complete").set("authorization", "Bearer projected-token").send(command);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "invalid_completion" });
		expect(dependencies.authority.complete).not.toHaveBeenCalled();
	});
});
