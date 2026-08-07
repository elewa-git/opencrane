/** Largest recall query the gateway will forward to Cognee. */
const _MAX_QUERY_CHARACTERS = 2_000;

/** Largest number of stored passages one recall may request. */
const _MAX_TOP_K = 50;

/** The only Cognee search mode this gateway forwards: stored passages, never a generated completion. */
const _ALLOWED_SEARCH_TYPE = "CHUNKS";

/** Exactly the keys one authorized search request may carry; anything else is rejected unread. */
const _ALLOWED_KEYS = ["query", "search_type", "dataset_ids", "top_k"] as const;

/** RFC-4122 UUID string shape required for every forwarded Cognee dataset id. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Typed refusal raised when a request body violates the gateway's search contract. */
export class MemorySearchContractViolation extends Error
{
	/** Creates a contract violation that never carries request payload content. */
	constructor(detail: string)
	{
		super(`memory search request violates the gateway contract: ${detail}`);
		this.name = "MemorySearchContractViolation";
	}
}

/**
 * Validate one raw search body against the gateway's fixed request-shape contract.
 *
 * The gateway owns request-shape authorization for the private Cognee plane: only an object with
 * exactly `query` (non-empty string of at most 2000 characters), `search_type` ("CHUNKS"),
 * `dataset_ids` (exactly one RFC-4122 UUID string), and `top_k` (integer 1..50) may transit.
 * The returned buffer is a canonical re-serialization of the validated fields, so no unvalidated
 * byte of the original request ever reaches Cognee.
 *
 * @param body - Raw request bytes read at the proxy boundary.
 * @returns The canonical JSON body to forward.
 * @throws MemorySearchContractViolation when any field, key, or shape falls outside the contract.
 */
export function _ValidateSearchRequest(body: Buffer): Buffer
{
	// 1. Parse defensively: malformed JSON is a contract violation, never a forwarded byte stream.
	let parsed: unknown;
	try
	{
		parsed = JSON.parse(body.toString("utf8")) as unknown;
	}
	catch
	{
		throw new MemorySearchContractViolation("body is not valid JSON");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new MemorySearchContractViolation("body must be a JSON object");
	const request = parsed as Record<string, unknown>;

	// 2. Refuse unknown keys before validating values so no unmodelled field can transit the boundary.
	for (const key of Object.keys(request))
	{
		if (!(_ALLOWED_KEYS as readonly string[]).includes(key)) throw new MemorySearchContractViolation("unknown key");
	}

	// 3. Enforce each field's exact type and bound, failing closed on the first violation.
	const query = request["query"];
	if (typeof query !== "string" || query.trim().length === 0 || query.length > _MAX_QUERY_CHARACTERS) throw new MemorySearchContractViolation("query must be a non-empty string of at most 2000 characters");
	if (request["search_type"] !== _ALLOWED_SEARCH_TYPE) throw new MemorySearchContractViolation("search_type must be CHUNKS");
	const datasetIds = request["dataset_ids"];
	if (!Array.isArray(datasetIds) || datasetIds.length !== 1 || typeof datasetIds[0] !== "string" || !_UUID_PATTERN.test(datasetIds[0])) throw new MemorySearchContractViolation("dataset_ids must contain exactly one RFC-4122 UUID string");
	const topK = request["top_k"];
	if (typeof topK !== "number" || !Number.isSafeInteger(topK) || topK < 1 || topK > _MAX_TOP_K) throw new MemorySearchContractViolation("top_k must be an integer from 1 through 50");

	// 4. Re-serialize only the validated fields so nothing unvalidated transits to Cognee.
	return Buffer.from(JSON.stringify({ query, search_type: _ALLOWED_SEARCH_TYPE, dataset_ids: [datasetIds[0]], top_k: topK }), "utf8");
}
