import { McpAccessPolicy, McpApprovalStatus, McpConnectionStatus, McpDirectory, McpEntitledUser, McpInstalledServer, McpServer, McpServerType } from "../../models/mcp.types";

/**
 * Mock MCP catalogue backing the dev/default {@link McpServer} reads until the
 * live OpenCrane `/api/v1/mcp` endpoints exist (backend P0, in parallel).
 *
 * Covers every governance state the catalogue renders: published + entitled
 * servers users can install, an `approved`-but-unpublished one, two
 * `pending-review` servers only admins see, and a `disabled` one.
 */
export const MCP_CATALOGUE: McpServer[] =
[
	{
		id: "github",
		name: "github",
		description: "Repos, pull requests, issues and Actions across your org.",
		publisher: "GitHub, Inc.",
		glyph: "Gh",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema: [],
		entitlementSummary: "Everyone (org)"
	},
	{
		id: "notion",
		name: "notion",
		description: "Search and read your team's docs & knowledge base.",
		publisher: "Notion Labs",
		glyph: "No",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema: [],
		entitlementSummary: "Product, Eng (2 grp)"
	},
	{
		id: "slack",
		name: "slack",
		description: "Post and read messages in channels you belong to.",
		publisher: "Slack Technologies",
		glyph: "Sl",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema: [],
		entitlementSummary: "Everyone (org)"
	},
	{
		id: "stripe",
		name: "stripe",
		description: "Query payments, balances and customers (read-only).",
		publisher: "Stripe, Inc.",
		glyph: "St",
		type: McpServerType.SingleUser,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema:
		[
			{ key: "apiToken", label: "API token", required: true, sensitive: true, placeholder: "sk_live_••••••••••••••••", hint: "A restricted, read-only key is recommended. Write-only — once saved it is never returned to the browser." },
			{ key: "workspace", label: "Workspace", required: false, sensitive: false, placeholder: "acme-prod", hint: "Optional; scopes the connection if the server supports it." }
		],
		entitlementSummary: "Finance (4)"
	},
	{
		id: "postgres-prod",
		name: "postgres-prod",
		description: "Analytics read replica. Shared key managed by your admin.",
		publisher: "Internal · Platform team",
		glyph: "Pg",
		type: McpServerType.MultiUser,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema: [],
		entitlementSummary: "Data (6)"
	},
	{
		id: "google-drive",
		name: "google-drive",
		description: "Find and read files from your connected Drive.",
		publisher: "Google LLC",
		glyph: "Gd",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.Published,
		credentialSchema: [],
		entitlementSummary: "Everyone (org)"
	},
	{
		id: "linear",
		name: "linear",
		description: "Issue tracking & project planning.",
		publisher: "Linear Orbit, Inc.",
		glyph: "Li",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.PendingReview,
		credentialSchema: [],
		entitlementSummary: "— not assigned"
	},
	{
		id: "figma",
		name: "figma",
		description: "Design files & comments (read).",
		publisher: "Figma, Inc.",
		glyph: "Fg",
		type: McpServerType.RemoteOauth,
		approvalStatus: McpApprovalStatus.PendingReview,
		credentialSchema: [],
		entitlementSummary: "— not assigned"
	},
	{
		id: "sentry",
		name: "sentry",
		description: "Error & performance monitoring.",
		publisher: "Functional Software",
		glyph: "Se",
		type: McpServerType.SingleUser,
		approvalStatus: McpApprovalStatus.Disabled,
		credentialSchema:
		[
			{ key: "apiToken", label: "Auth token", required: true, sensitive: true, placeholder: "sntrys_••••••••", hint: "Write-only; stored server-side." }
		],
		entitlementSummary: "Eng (11)"
	}
];

/**
 * Mock installed-server set for the demo user, covering every connection state
 * the My Tools view renders: a credential owed, OAuth connected, token
 * connected, an admin-managed shared key, and one still activating.
 */
export const MCP_INSTALLED: McpInstalledServer[] =
[
	{ serverId: "stripe", connectionStatus: McpConnectionStatus.NeedsCredential, lastUsed: null },
	{ serverId: "github", connectionStatus: McpConnectionStatus.OauthConnected, lastUsed: "2 minutes ago", connectedAccount: "jente@acme.com" },
	{ serverId: "notion", connectionStatus: McpConnectionStatus.Connected, lastUsed: "Yesterday, 16:40" },
	{ serverId: "postgres-prod", connectionStatus: McpConnectionStatus.SharedKey, lastUsed: "3 days ago" },
	{ serverId: "slack", connectionStatus: McpConnectionStatus.Activating, lastUsed: null }
];

/** Directory of users an admin can entitle (mock). */
const _USERS: Record<string, McpEntitledUser> =
{
	jente: { id: "jente", name: "Jente Rosseel", initials: "JR" },
	maya: { id: "maya", name: "Maya Adeyemi", initials: "MA" },
	tom: { id: "tom", name: "Tom Lindqvist", initials: "TL" },
	dana: { id: "dana", name: "Dana Okonkwo", initials: "DA" }
};

/** Assignable users + groups for the access-policy editor (mock). */
export const MCP_DIRECTORY: McpDirectory =
{
	users: Object.values(_USERS),
	groups: ["Engineering", "Product", "Finance", "Data", "Marketing"]
};

/** Mock access policies keyed by server id (admin access-policy editor). */
export const MCP_ACCESS_POLICIES: Record<string, McpAccessPolicy> =
{
	github: { serverId: "github", everyoneInOrg: true, groups: ["Engineering", "Product"], users: [_USERS["jente"], _USERS["maya"], _USERS["tom"]] },
	notion: { serverId: "notion", everyoneInOrg: false, groups: ["Product", "Engineering"], users: [_USERS["maya"]] },
	slack: { serverId: "slack", everyoneInOrg: true, groups: [], users: [] },
	stripe: { serverId: "stripe", everyoneInOrg: false, groups: ["Finance"], users: [_USERS["dana"]] },
	"postgres-prod": { serverId: "postgres-prod", everyoneInOrg: false, groups: ["Data"], users: [_USERS["tom"], _USERS["maya"]] },
	"google-drive": { serverId: "google-drive", everyoneInOrg: true, groups: [], users: [] },
	linear: { serverId: "linear", everyoneInOrg: false, groups: [], users: [] },
	figma: { serverId: "figma", everyoneInOrg: false, groups: [], users: [] },
	sentry: { serverId: "sentry", everyoneInOrg: false, groups: ["Engineering"], users: [] }
};
