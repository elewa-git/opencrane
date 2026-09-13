import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { PersonalMcpConnectionControlComponent } from "../personal-mcp-connection-control.component";
import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds, type PersonalMcpConnectionControlView } from "../personal-mcp-connection-control.types";

const _BASE: PersonalMcpConnectionControlView = { controlId: "weather-connection", serverName: "Weather service", state: PersonalMcpConnectionControlStates.Connect, credentialInput: PersonalMcpCredentialInputKinds.Bearer, draft: "", canReplace: false, canRevoke: false, failureMessage: null };

/** Renders every state inside the narrow action-region width used by the installed row. */
const meta: Meta<PersonalMcpConnectionControlComponent> = { title: "Tools/Personal MCP connection control", component: PersonalMcpConnectionControlComponent, tags: ["autodocs"], args: { view: _BASE, busy: false, error: null }, render: function _Render(args) { return { props: args, template: '<div style="max-width: 22rem; padding: 1rem"><wo-personal-mcp-connection-control [view]="view" [busy]="busy" [error]="error" /></div>' }; } };
export default meta;
type Story = StoryObj<PersonalMcpConnectionControlComponent>;

/** A new bearer connection uses the write-only field. */
export const BearerConnect: Story = { tags: ["visual-test"], play: async function _Bearer({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByLabelText("Access token for Weather service")).toHaveAttribute("type", "password"); } };
/** A credentialless connection needs only an explicit command. */
export const CredentiallessConnect: Story = { args: { view: { ..._BASE, credentialInput: PersonalMcpCredentialInputKinds.None } } };
/** Accepted activation disables a duplicate start while preserving revocation. */
export const Activating: Story = { args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.Activating, canRevoke: true } } };
/** An active bearer generation may be replaced or revoked. */
export const Active: Story = { tags: ["visual-test"], args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.Active, canReplace: true, canRevoke: true } } };
/** Replacement uses a fresh empty controlled field and an explicit cancel intent. */
export const Replace: Story = { args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.Replace } } };
/** Uncertain completion locks the retained draft and exposes only exact Retry. */
export const AmbiguousRetry: Story = { tags: ["visual-test", "visual-test-narrow"], args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.Ambiguous, draft: "retained-write-only-value" } }, play: async function _Locked({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByLabelText("Access token for Weather service")).toBeDisabled(); await expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled(); } };
/** Recovery copy is fixed by the presenter and revocation is the only mutation. */
export const RecoveryRequired: Story = { tags: ["visual-test"], args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.RecoveryRequired, canRevoke: true, failureMessage: "This connection must be disconnected before it can be replaced." } } };
/** Removal exposes no connection command. */
export const Removing: Story = { args: { view: { ..._BASE, state: PersonalMcpConnectionControlStates.Removing } } };
