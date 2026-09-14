import { describe, expect, it } from "vitest";

import { _ServerCheckpointOperationLeaseSeconds } from "../mcp-workflow-composition";

const _CONFIG = { mcpRemoteTimeoutMilliseconds: 60_000, ociRegistryTimeoutMilliseconds: 120_000 };

describe("server checkpoint lease", function _Suite()
{
	it("covers a maximum memory call beyond the old two-minute claim", function _MemoryMaximum()
	{
		expect(_ServerCheckpointOperationLeaseSeconds(_CONFIG, 300_000)).toBe(360);
	});

	it("also covers longer configured calls from the other server workflow users", function _SharedEngine()
	{
		expect(_ServerCheckpointOperationLeaseSeconds(_CONFIG, 30_000)).toBe(180);
	});

	it("never shortens the ordinary two-minute claim for short calls", function _Minimum()
	{
		expect(_ServerCheckpointOperationLeaseSeconds({ mcpRemoteTimeoutMilliseconds: 1_000, ociRegistryTimeoutMilliseconds: 1_000 }, 1_000)).toBe(120);
	});

	it.each([NaN, Infinity, 0, -1, 300_001])("refuses an invalid memory timeout before constructing the engine", function _Invalid(timeout)
	{
		expect(function _Compose() { return _ServerCheckpointOperationLeaseSeconds(_CONFIG, timeout); }).toThrow("bounded external-call timeouts");
	});
});
