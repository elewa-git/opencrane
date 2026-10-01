import { isAbsolute } from "node:path";

import type { OpenCraneMcpConnectionConfig } from "./mcp-connection-config.types";

/** Require explicit process coordinates before composing credential custody or remote dispatch. */
export function _ReadMcpConnectionConfig(): OpenCraneMcpConnectionConfig
{
	const credentialNamespace = _namespace("MCP_CONNECTION_CREDENTIAL_NAMESPACE");
	const serverNamespace = _namespace("POD_NAMESPACE");
	if (credentialNamespace === serverNamespace)
		throw new Error("MCP connection credentials require a namespace separate from the server");
	return {
		credentialNamespace,
		materialKeyringPath: _absolutePath("MCP_CONNECTION_MATERIAL_KEYRING_PATH"),
		serverNamespace,
		serverPodUid: _required("POD_UID"),
		serverServiceAccountName: _namespace("MCP_SERVER_SERVICE_ACCOUNT_NAME"),
		tokenPath: _absolutePath("MCP_SERVER_TOKEN_PATH"),
	};
}

/** Refuse missing process configuration without including its value in an error. */
function _required(name: string): string
{
	const value = process.env[name]?.trim() ?? "";
	if (value.length === 0)
		throw new Error(`${name} is required`);
	return value;
}

/** Accept one Kubernetes label so a setting cannot name an alternate scope or path. */
function _namespace(name: string): string
{
	const value = _required(name);
	if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u.test(value))
		throw new Error(`${name} must be a Kubernetes DNS label`);
	return value;
}

/** Keep credential and projected-token reads bound to explicit mounted file paths. */
function _absolutePath(name: string): string
{
	const value = _required(name);
	if (!isAbsolute(value))
		throw new Error(`${name} must be an absolute mounted file path`);
	return value;
}
