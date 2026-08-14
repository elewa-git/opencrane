/**
 * OpenAPI path fragment describing the one route a signed-in owner uses to steer their own run.
 *
 * This is the published shape, not a description of the handler: it is spread into the assembled
 * document and from there into the generated TypeScript client, so editing a schema or a status here
 * changes what every client is typed against. Keep it in step with
 * `steering-ingest.router.ts`, which is the code that actually enforces these rules.
 *
 * Two things about the responses are easy to misread. 202 and 200 both mean accepted: 202 is a row
 * this call created, 200 is the row an identical earlier call already created, and the body is the
 * same either way. And 409 is used for two different refusals, told apart by the `error` code in the
 * body - `run_not_steerable` when the owned run has no live attempt to steer, and
 * `steering_idempotency_conflict` when the retry key was already used for different text.
 *
 * The two `maxLength` values are copies. 4000 mirrors `_MAX_STEERING_CHARACTERS` and 128 mirrors the
 * key limit checked in `_body`, both in `steering-ingest.router.ts`; a client that trusts this schema
 * would start seeing unexplained 400s if either pair drifted apart.
 *
 * Called by: `libs/backend/server/api-spec/main/src/domain-openapi-paths.ts`, which spreads this
 * fragment into the server's assembled OpenAPI document.
 *
 * @see steering-ingest.router.ts for which outcome produces each status.
 */
export const _RuntimeSteeringOpenapiPaths = {
	"/me/runs/{runId}/steering": {
		post: {
			operationId: "submitRuntimeSteering",
			summary: "Queue one signed-in owner's instruction for a running agent",
			description: "The server derives the owner, silo, and current attempt. The instruction is queued durably and exact retries reuse the same client key before consumption at the runtime's fenced safe boundary.",
			tags: ["Runs"],
			parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" }, description: "Opaque run identifier." }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text", "idempotencyKey"], additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 4000 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 } } } } } },
			responses: {
				202: { description: "Steering request queued for the current run attempt.", content: { "application/json": { schema: { type: "object", required: ["steeringRequestId", "attempt", "state"], properties: { steeringRequestId: { type: "string" }, attempt: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["pending"] } } } } } },
				200: { description: "The exact steering retry was already queued.", content: { "application/json": { schema: { type: "object", required: ["steeringRequestId", "attempt", "state"], properties: { steeringRequestId: { type: "string" }, attempt: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["pending"] } } } } } },
				400: { description: "The body is not one bounded text instruction.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The run is absent or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				// This description covers `run_not_steerable` only. The route also answers 409 with
				// `steering_idempotency_conflict` when a retry key is reused for different text, so the
				// text below is narrower than the status it documents.
				409: { description: "The owned run has no steerable live attempt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not persist the instruction.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
