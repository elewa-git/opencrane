import { McpApprovalStatus, McpServerType, type McpServer } from "@opencrane/core";

/** Browser-safe tool description used by the tools component stories. */
export const TOOL_STORY_SERVER: McpServer = { id: "farm-reports", name: "Farm reports", description: "Read stock levels and sales reports for the selected branch.", publisher: "Elewa", glyph: "FR", type: McpServerType.MultiUser, approvalStatus: McpApprovalStatus.PendingReview, credentialSchema: [], entitlementSummary: "Approved branch teams" };
