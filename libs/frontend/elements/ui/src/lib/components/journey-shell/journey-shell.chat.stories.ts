import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";
import { TextareaModule } from "primeng/textarea";

import { AvatarCircleComponent } from "../avatar-circle/avatar-circle.component";
import { AvatarSizes, AvatarTones } from "../avatar-circle/avatar-circle.types";
import { ScopeChipComponent } from "../scope-chip/scope-chip.component";
import { ScopeChipTones } from "../scope-chip/scope-chip.types";
import { JourneyShellComponent } from "./journey-shell.component";
import { JourneyShellLayouts } from "./journey-shell.types";

/** Storybook metadata for bounded first-chat states. */
const meta: Meta<JourneyShellComponent> =
{
	title: "Foundation/Journey shell",
	component: JourneyShellComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [AvatarCircleComponent, ButtonModule, MessageModule, ProgressSpinnerModule, ScopeChipComponent, TextareaModule] })]
};

export default meta;

/** Local Storybook story type for first-chat journeys. */
type Story = StoryObj<JourneyShellComponent>;

/** One-person onboarding conversation with citations and a bounded composer. */
export const FirstChat: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, avatarTones: AvatarTones, avatarSizes: AvatarSizes, chipTones: ScopeChipTones },
			template: `
				<wo-journey-shell title="Meet your personal agent" description="This private first conversation calibrates how you will work together." [layout]="layouts.Wide">
					<section aria-label="First conversation" style="display:grid;gap:var(--oc-space-5);min-height:34rem;padding:var(--oc-space-6);border:1px solid var(--oc-border-default);border-radius:var(--oc-radius-panel);background:var(--oc-surface-paper)">
						<header style="display:flex;align-items:center;gap:var(--oc-space-3);padding-bottom:var(--oc-space-4);border-bottom:1px solid var(--oc-border-subtle)"><wo-avatar-circle initials="OC" label="OpenCrane personal agent" [tone]="avatarTones.Brand" [size]="avatarSizes.Medium" /><div style="display:grid"><strong>Your personal agent</strong><span style="font-size:var(--oc-text-sm);color:var(--oc-success)">Ready</span></div></header>
						<div style="display:grid;align-content:start;gap:var(--oc-space-4)" aria-live="polite"><article style="max-width:42rem;padding:var(--oc-space-4);border-radius:var(--oc-radius-card);background:var(--oc-surface-subtle);line-height:1.6"><p style="margin:0 0 var(--oc-space-3)">I’ll start evidence-first and keep uncertainty visible. Would you rather see my recommendation or alternatives first?</p><wo-scope-chip label="persona interview · approved" [tone]="chipTones.Personal" /></article><div style="justify-self:end;max-width:34rem;padding:var(--oc-space-3) var(--oc-space-4);border-radius:var(--oc-radius-card);background:var(--oc-accent-soft)">Lead with your recommendation, then show the strongest alternative.</div><article style="max-width:42rem;padding:var(--oc-space-4);border-radius:var(--oc-radius-card);background:var(--oc-surface-subtle);line-height:1.6">Good. How directly should I challenge a premise that looks weak?</article></div>
						<div style="align-self:end;display:grid;gap:var(--oc-space-2)"><textarea pTextarea rows="3" aria-label="Message your personal agent" placeholder="Write your answer…" style="width:100%;resize:none"></textarea><div style="display:flex;justify-content:flex-end"><p-button label="Send" icon="pi pi-arrow-right" iconPos="right" /></div></div>
					</section>
				</wo-journey-shell>`
		};
	}
};

/** Recoverable reconnect state that keeps the authoritative transcript visible. */
export const Reconnecting: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="Meet your personal agent" description="Your conversation is saved. Reconnecting to new events…" [layout]="layouts.Wide" [busy]="true">
					<p-message journey-status severity="warn" [closable]="false">Reconnecting. You can read the saved conversation while OpenCrane restores the live connection.</p-message>
					<section style="display:grid;gap:var(--oc-space-4);min-height:22rem;padding:var(--oc-space-6);border:1px solid var(--oc-border-default);border-radius:var(--oc-radius-panel);background:var(--oc-surface-paper)"><article style="max-width:42rem;padding:var(--oc-space-4);border-radius:var(--oc-radius-card);background:var(--oc-surface-subtle)">I’ll keep evidence and inference separate.</article><div style="display:flex;align-items:center;gap:var(--oc-space-3);color:var(--oc-ink-muted)" role="status"><p-progressspinner ariaLabel="Reconnecting to new events" data-visual-target="progress-spinner" [style]="{ width: '20px', height: '20px' }" strokeWidth="5" /><span>Waiting for the next event</span></div><textarea pTextarea rows="3" aria-label="Message your personal agent" placeholder="Reconnecting…" disabled style="width:100%;align-self:end;resize:none"></textarea></section>
				</wo-journey-shell>`
		};
	}
};
