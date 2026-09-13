import type { Meta, StoryObj } from "@storybook/angular";
import { McpApprovalStatus } from "@opencrane/core";
import { CatalogueAdminRowComponent } from "../catalogue-admin-row.component";
import { TOOL_STORY_SERVER } from "../../../../state/__tests__/tools-story.fixtures";

/** Every governance lifecycle renders through the same table-row owner. */
const meta: Meta<CatalogueAdminRowComponent> = { title: "Tools/Governance row", component: CatalogueAdminRowComponent, tags: ["autodocs"], args: { server: TOOL_STORY_SERVER }, render: function _Render(args) { return { props: args, template: '<table class="wo-table"><tbody><tr wo-catalogue-admin-row [server]="server" [busy]="busy"></tr></tbody></table>' }; } };
export default meta;
type Story = StoryObj<CatalogueAdminRowComponent>;
/** Review offers approval or rejection. */
export const PendingReview: Story = { tags: ["visual-test"] };
/** Approved servers may be published. */
export const Approved: Story = { args: { server: { ...TOOL_STORY_SERVER, approvalStatus: McpApprovalStatus.Approved } } };
/** Published servers may be disabled. */
export const Published: Story = { args: { server: { ...TOOL_STORY_SERVER, approvalStatus: McpApprovalStatus.Published } } };
/** Disabled servers may be enabled again. */
export const Disabled: Story = { tags: ["visual-test"], args: { server: { ...TOOL_STORY_SERVER, approvalStatus: McpApprovalStatus.Disabled } } };
/** Pending commands disable every conflicting action in the row. */
export const Saving: Story = { args: { busy: true } };
