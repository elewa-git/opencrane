import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";
import { ModelProvider } from "@opencrane/state/provider-key/adapter";
import { ModelKeyRowComponent } from "../model-key-row.component";

/** Provider status and write-only input states in a valid table row. */
const meta: Meta<ModelKeyRowComponent> = { title: "Tools/Model key row", component: ModelKeyRowComponent, tags: ["autodocs"], args: { row: { provider: ModelProvider.OpenAi, label: "OpenAI", configured: false, litellmRegistered: false, updatedAt: null, updatedAtLabel: "—" }, draft: "", busy: false }, render: function _Render(args) { return { props: args, template: '<table class="wo-table"><tbody><tr wo-model-key-row [row]="row" [draft]="draft" [busy]="busy"></tr></tbody></table>' }; } };
export default meta;
type Story = StoryObj<ModelKeyRowComponent>;
/** No key is stored, and the save action requires a draft. */
export const Unconfigured: Story = { tags: ["visual-test"], play: async function _Empty({ canvasElement }) { await expect(within(canvasElement).getByRole("button", { name: "Save" })).toBeDisabled(); await expect(within(canvasElement).getByLabelText("OpenAI API key")).toHaveAttribute("type", "password"); } };
/** A draft stays masked before submission. */
export const Draft: Story = { args: { draft: "story-only-draft" } };
/** Active keys render status without returning key material. */
export const Active: Story = { args: { row: { provider: ModelProvider.OpenAi, label: "OpenAI", configured: true, litellmRegistered: true, updatedAt: null, updatedAtLabel: "Today" } } };
/** A stored key can require registration recovery. */
export const SecretOnly: Story = { tags: ["visual-test"], args: { row: { provider: ModelProvider.OpenAi, label: "OpenAI", configured: true, litellmRegistered: false, updatedAt: null, updatedAtLabel: "Today" } } };
/** Pending writes disable the password field and actions. */
export const Saving: Story = { tags: ["visual-test"], args: { draft: "story-only-draft", busy: true }, play: async function _Busy({ canvasElement }) { await expect(within(canvasElement).getByLabelText("OpenAI API key")).toBeDisabled(); } };
