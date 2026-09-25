import { signal } from "@angular/core";
import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";
import { McpConnectionStatus, McpInstallStates } from "@opencrane/core";
import { InstalledToolRowComponent } from "../installed-tool-row.component";
import { PersonalMcpConnectionControlComponent } from "../../personal-mcp-connection-control/personal-mcp-connection-control.component";
import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds, type PersonalMcpConnectionControlView } from "../../personal-mcp-connection-control/personal-mcp-connection-control.types";
import { TOOL_STORY_SERVER } from "../../../state/__tests__/tools-story.fixtures";

/** Renders the row inside its production table anatomy. */
const meta: Meta<InstalledToolRowComponent> = { title: "Tools/Installed row", component: InstalledToolRowComponent, tags: ["autodocs"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.Credentialless, connectionGeneration: null, credentialUpdatedAt: null, failureCode: null, lastUsed: "Today" } } }, render: function _Render(args) { return { props: args, template: '<table class="wo-table"><tbody><tr wo-installed-tool-row [row]="row" [busy]="busy"></tr></tbody></table>' }; } };
export default meta;
type Story = StoryObj<InstalledToolRowComponent>;
/** The installation requires no provider credential. */
export const Ready: Story = {};
/** Saved removal remains visible and prevents another command after the request ends. */
export const Removing: Story = {
 tags: ["visual-test"],
 args: { busy: false, row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Removing, connectionStatus: McpConnectionStatus.Active, connectionGeneration: 1, credentialUpdatedAt: null, failureCode: null, lastUsed: "Today" } } },
 play: async function _SavedRemoval({ canvasElement })
 {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("Removing")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Uninstall" })).toBeDisabled();
 }
};
/** The row-only fixture shows that a connection still needs setup. */
export const NeedsCredential: Story = { tags: ["visual-test"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.NeedsCredential, connectionGeneration: null, credentialUpdatedAt: null, failureCode: null, lastUsed: null } } } };
/** Credential custody and discovery are still running. */
export const Activating: Story = { tags: ["visual-test"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 1, credentialUpdatedAt: "2026-09-12T12:00:00.000Z", failureCode: null, lastUsed: null } } } };
/** The saved generation can pass current execution admission. */
export const Active: Story = { tags: ["visual-test"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.Active, connectionGeneration: 1, credentialUpdatedAt: "2026-09-12T12:00:00.000Z", failureCode: null, lastUsed: "Today" } } } };
/** Uncertain custody blocks use until an authorized revocation. */
export const RecoveryRequired: Story = { tags: ["visual-test"], args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.RecoveryRequired, connectionGeneration: 1, credentialUpdatedAt: null, failureCode: null, lastUsed: null } } } };

/** Proves the credential control remains usable inside the production row's action cell. */
export const ConnectWithinRow: Story = {
	tags: ["visual-test"],
	decorators: [moduleMetadata({ imports: [PersonalMcpConnectionControlComponent] })],
	args: { row: { server: TOOL_STORY_SERVER, installed: { serverId: TOOL_STORY_SERVER.id, lifecycleState: McpInstallStates.Installed, connectionStatus: McpConnectionStatus.NeedsCredential, connectionGeneration: null, credentialUpdatedAt: null, failureCode: null, lastUsed: null } } },
	render: function _Composed(args)
	{
		const connectionView = signal<PersonalMcpConnectionControlView>({ controlId: "row-connection", serverName: TOOL_STORY_SERVER.name, state: PersonalMcpConnectionControlStates.Connect, credentialInput: PersonalMcpCredentialInputKinds.Bearer, draft: "", canReplace: false, canRevoke: false, failureMessage: null });
		return {
			props: { ...args, connectionView, submitRequested: fn(), draftChanged: function _Draft(value: string) { connectionView.update(current => ({ ...current, draft: value })); } },
			template: '<div style="max-width:760px;overflow-x:auto" role="region" aria-label="Installed tools" tabindex="0"><table class="wo-table"><tbody><tr wo-installed-tool-row [row]="row" [busy]="busy"><wo-personal-mcp-connection-control connection-control [view]="connectionView()" (draftChanged)="draftChanged($event)" (submitRequested)="submitRequested()" /></tr></tbody></table></div>',
		};
	},
	play: async function _ComposedControl({ canvasElement })
	{
		const canvas = within(canvasElement);
		const credential = canvas.getByLabelText(`Access token for ${TOOL_STORY_SERVER.name}`);
		await expect(credential.closest("td")).not.toBeNull();
		await expect(canvas.getByRole("button", { name: "Connect" })).toBeDisabled();
		await userEvent.type(credential, "synthetic-story-token");
		await expect(canvas.getByRole("button", { name: "Connect" })).toBeEnabled();
		await expect(canvas.getByRole("button", { name: "Uninstall" })).toBeVisible();
		await userEvent.clear(credential);
	}
};
