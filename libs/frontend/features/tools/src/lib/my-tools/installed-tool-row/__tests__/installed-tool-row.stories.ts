import type { Meta, StoryObj } from "@storybook/angular";
import { McpConnectionStatus } from "@opencrane/core";
import { InstalledToolRowComponent } from "../installed-tool-row.component";
import { TOOL_STORY_SERVER } from "../../../state/__tests__/tools-story.fixtures";

/** Renders the row inside its production table anatomy. */
const meta: Meta<InstalledToolRowComponent> = { title: "Tools/Installed row", component: InstalledToolRowComponent, tags: ["autodocs"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, connectionStatus: McpConnectionStatus.SharedKey, lastUsed: "Today" } } }, render: function _Render(args) { return { props: args, template: '<table class="wo-table"><tbody><tr wo-installed-tool-row [row]="row" [busy]="busy"></tr></tbody></table>' }; } };
export default meta;
type Story = StoryObj<InstalledToolRowComponent>;
/** Shared administrator key makes the installation usable. */
export const Ready: Story = {};
/** Removal keeps the row visible while its command is pending. */
export const Removing: Story = { tags: ["visual-test"], args: { busy: true } };
/** Credential activation is displayed without inventing a browser activation command. */
export const NeedsCredential: Story = { tags: ["visual-test"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, connectionStatus: McpConnectionStatus.NeedsCredential, lastUsed: null } } } };
