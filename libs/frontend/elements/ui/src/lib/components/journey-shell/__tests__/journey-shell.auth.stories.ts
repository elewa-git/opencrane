import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent } from "../journey-shell.component";
import { JourneyShellLayouts } from "../journey-shell.types";

/** Storybook metadata for OIDC entry and recovery states. */
const meta: Meta<JourneyShellComponent> =
{
	title: "Foundation/Journey shell",
	component: JourneyShellComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The shared visual frame for the identity boundary. These fixtures demonstrate user-facing handoff and recovery states without treating the component as an authentication authority."
			}
		}
	},
	decorators: [moduleMetadata({ imports: [ButtonModule, MessageModule, ProgressSpinnerModule] })]
};

export default meta;

/** Local Storybook story type for authentication journeys. */
type Story = StoryObj<JourneyShellComponent>;

/** OIDC-only sign-in state with one primary identity-provider action. */
export const SsoSignIn: Story =
{
	parameters: { docs: { description: { story: "The only supported sign-in entry: hand off to the organisation's identity provider. It makes the password boundary explicit and supplies one clear, non-local credential action." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="Sign in to your workspace" description="Continue through your organisation's identity provider. OpenCrane never asks for or stores your password." [layout]="layouts.Compact">
					<div style="display:grid;gap:var(--oc-space-4)">
						<div style="padding:var(--oc-space-4);border:1px solid var(--oc-border-subtle);border-radius:var(--oc-radius-card);background:var(--oc-surface-subtle);color:var(--oc-ink-muted)">Elewa Group workspace</div>
						<p-button label="Continue with identity provider" icon="pi pi-arrow-right" iconPos="right" [fluid]="true" />
					</div>
				</wo-journey-shell>
			`
		};
	}
};

/** Identity-provider handoff state with a bounded cancel action. */
export const IdentityHandoff: Story =
{
	parameters: { docs: { description: { story: "The transitional state while the browser is handed to the identity provider. It communicates that the user will return here and offers a bounded cancel action without claiming an authentication outcome." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="Opening your identity provider" description="You will return here after your organisation confirms your identity." [layout]="layouts.Compact" [busy]="true">
					<div style="display:grid;justify-items:center;gap:var(--oc-space-4);padding:var(--oc-space-6)" role="status">
						<p-progressspinner ariaLabel="Opening identity provider" data-visual-target="progress-spinner" />
						<span style="color:var(--oc-ink-muted)">Waiting for secure handoff…</span>
					</div>
					<p-button journey-actions label="Cancel" severity="secondary" [text]="true" />
				</wo-journey-shell>
			`
		};
	}
};

/** Blocking authority error with one explicit recovery action. */
export const Error: Story =
{
	parameters: { docs: { description: { story: "A blocking onboarding-read failure with one safe recovery action. The message explicitly says that saved survey, persona, and conversation data remain unchanged while the authority is unavailable." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="We could not load your onboarding position" description="OpenCrane has not moved or restarted your journey." [layout]="layouts.Compact">
					<p-message journey-status severity="error" [closable]="false">The onboarding authority is unavailable. Retry when the service is ready.</p-message>
					<p style="margin:0;color:var(--oc-ink-muted);line-height:1.6">Your saved survey, approved persona, and first conversation remain unchanged.</p>
					<p-button journey-actions label="Retry" icon="pi pi-refresh" />
				</wo-journey-shell>
			`
		};
	}
};
