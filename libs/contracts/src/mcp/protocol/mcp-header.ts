import { McpProtocolError } from "./mcp-protocol.types";

/** Describes one schema property mirrored into an HTTP request header. */
interface _McpHeaderBinding
{
	/** Supplies the suffix of the `Mcp-Param-*` header. */
	readonly name: string;
	/** Locates the argument value through object properties. */
	readonly path: readonly string[];
	/** Selects the permitted primitive conversion. */
	readonly type: string;
}

/** Returns schema paths that mirror primitive tool arguments into HTTP headers. */
export function _McpHeaderBindings(inputSchema: unknown): readonly _McpHeaderBinding[]
{
	if (!_Record(inputSchema) || inputSchema["type"] !== "object")
		throw new McpProtocolError("MCP tool input schema was invalid");
	const bindings: _McpHeaderBinding[] = [];
	const names = new Set<string>();
	_ScanSchema(inputSchema, [], true, bindings, names);
	return bindings;
}

/** Scans annotations while retaining whether the path is statically reachable. */
function _ScanSchema(value: unknown, path: readonly string[], reachable: boolean, bindings: _McpHeaderBinding[], names: Set<string>): void
{
	if (!_Record(value))
		return;
	if (Object.hasOwn(value, "x-mcp-header"))
	{
		const name = value["x-mcp-header"];
		const type = value["type"];
		if (!reachable || path.length === 0 || typeof name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || names.has(name.toLowerCase()) || type !== "string" && type !== "integer" && type !== "boolean")
			throw new McpProtocolError("MCP tool header annotation was invalid");
		names.add(name.toLowerCase());
		bindings.push({ name, path, type });
	}
	for (const [key, child] of Object.entries(value))
	{
		if (key === "properties" && reachable && _Record(child))
		{
			for (const [property, schema] of Object.entries(child))
				_ScanSchema(schema, [...path, property], true, bindings, names);
			continue;
		}
		if (key !== "properties")
			_ScanSchema(child, path, false, bindings, names);
	}
}

/** Accepts a non-array object while walking a JSON Schema. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
