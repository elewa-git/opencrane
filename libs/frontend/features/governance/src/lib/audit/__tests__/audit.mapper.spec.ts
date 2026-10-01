import { describe, expect, it } from "vitest";

import { _AuditRows } from "../audit.mapper";

describe("audit presentation mapper", function _Mapper()
{
	it("maps only supported row fields without interpreting raw text", function _PublicFields()
	{
		const row = { timestamp: "2026-09-22T09:00:00.000Z", tenant: "optional-tenant", action: "Updated", resource: "Group/group-1", message: "<script>text only</script>" };
		const rows = _AuditRows({ data: [row, row], pagination: { limit: 100, hasMore: true, nextCursor: "opaque" } });
		expect(rows).toEqual([{ id: "0", timestamp: row.timestamp, action: row.action, resource: row.resource, message: row.message }, { id: "1", timestamp: row.timestamp, action: row.action, resource: row.resource, message: row.message }]);
		expect(rows[0]).not.toHaveProperty("tenant");
		expect(rows[0]).not.toHaveProperty("actor");
	});

	it("keeps absent and filtered-empty pages empty", function _Empty()
	{
		expect(_AuditRows(null)).toEqual([]);
		expect(_AuditRows({ data: [], pagination: { limit: 100, hasMore: true, nextCursor: "continue" } })).toEqual([]);
	});
});
