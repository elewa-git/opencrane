import type { Meta, StoryObj } from "@storybook/angular";

import { ScopeLevel } from "@opencrane/core";
import { LedgerCardComponent } from "../ledger-card.component";
import { LedgerCardKinds } from "../ledger-card.types";

/** Storybook catalogue metadata for retained ledger states. */
const meta: Meta<LedgerCardComponent> =
{
	title: "Foundation/Ledger card",
	component: LedgerCardComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A presentational record of a supplied observation, policy, or action. It preserves the provenance and scope a feature gives it, but never infers or changes that record's authority."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the ledger catalogue. */
type Story = StoryObj<LedgerCardComponent>;

/** Observation, policy, and action states with representative metadata. */
export const KindsAndScopes: Story =
{
	parameters: { docs: { description: { story: "Observation, policy, and action cards shown with distinct owner-supplied scopes. This is the comparison fixture for semantic labels, references, and compact ledger density." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { kinds: LedgerCardKinds, scopes: ScopeLevel },
			template: `
				<div style="display:grid;gap:var(--oc-space-2);max-width:38rem;padding:var(--oc-space-6);background:var(--oc-surface-paper)">
					<wo-ledger-card entryId="R1" [kind]="kinds.Observation" label="ARR target implies 18% quarter-on-quarter growth" [scope]="scopes.Department" entryRef="product-strategy-q3.md" />
					<wo-ledger-card entryId="P1" [kind]="kinds.Policy" label="Resourcing decisions require VP sign-off" [scope]="scopes.Organization" entryRef="org-policy.v2.1" status="applied" />
					<wo-ledger-card entryId="A1" [kind]="kinds.Action" label="Recommendation note prepared" [scope]="scopes.Personal" entryRef="decision-note.md" status="done" />
				</div>
			`
		};
	}
};

/** Resolved action keeps its evidence legible while visually receding. */
export const Resolved: Story =
{
	parameters: { docs: { description: { story: "A completed action that visually recedes while retaining its evidence reference. Resolution is displayed from the supplied record rather than inferred from styling or client-side behaviour." } } },
	tags: ["visual-test"],
	args:
	{
		entryId: "A2",
		kind: LedgerCardKinds.Action,
		label: "Decision note shared with the project owner",
		scope: ScopeLevel.Project,
		entryRef: "decision-note.md",
		status: "resolved",
		dimmed: true
	}
};
