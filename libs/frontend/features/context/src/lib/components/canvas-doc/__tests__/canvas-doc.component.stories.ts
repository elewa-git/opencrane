import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { CanvasDocumentLifecycles, CanvasDocumentSaveStates, CanvasInitiativeStates, CanvasRiskSeverities, type CanvasDocument, ResourceBoundaryKind } from "@opencrane/core";

import { CanvasDocComponent } from "../canvas-doc.component";

/** Review fixture that proves the renderer accepts document content only through its typed input. */
const _DOCUMENT: CanvasDocument =
{
	navigationTitle: "Strategy canvas",
	title: "Partner adoption strategy",
	lifecycle: CanvasDocumentLifecycles.Draft,
	provenance: "Generated from the admitted planning brief",
	metadata: ["Product", "draft", "2026-08-09"],
	executiveSummary: "Prioritise the partner onboarding bottleneck, confirm the commercial assumption with the account team, and retain the cited evidence for review.",
	metrics:
	[
		{ label: "Adoption target", value: "35%", note: "of invited partners" },
		{ label: "Activation time", value: "< 2 days", note: "from acceptance" }
	],
	initiatives:
	[
		{ name: "Partner onboarding", owner: "Product", target: "Remove approval delay", timeline: "August", status: CanvasInitiativeStates.OnTrack },
		{ name: "Commercial review", owner: "Sales", target: "Confirm pricing assumption", timeline: "September", status: CanvasInitiativeStates.AtRisk }
	],
	risks:
	[
		{ risk: "The adoption target is at risk if account teams cannot validate the commercial assumption in time.", severity: CanvasRiskSeverities.High },
		{ risk: "Source freshness may require another retrieval before the document is published.", severity: CanvasRiskSeverities.Medium }
	],
	citationCount: 6,
	citationBoundaryKinds: [ResourceBoundaryKind.Group]
};

/** Storybook metadata for a feature-local, input-driven canvas document renderer. */
const meta: Meta<CanvasDocComponent> =
{
	title: "Context/Canvas document",
	component: CanvasDocComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A presentational document canvas that renders only an owner-supplied CanvasDocument. Save and export remain output intents; this component never stores a document or invents a successful save."
			}
		}
	},
	args:
	{
		document: _DOCUMENT
	}
};

export default meta;

/** Local Storybook story type for the canvas document contracts. */
type Story = StoryObj<CanvasDocComponent>;

/** The honest empty state before the owner supplies a selected document. */
export const Empty: Story =
{
	parameters: { docs: { description: { story: "No content is fabricated when no document is selected. The visual layer remains available and explains which admitted data will appear after selection." } } },
	tags: ["visual-test"],
	args:
	{
		document: null
	}
};

/** A read-only draft with metrics, initiatives, risk treatments, and citation scopes. */
export const Ready: Story =
{
	parameters: { docs: { description: { story: "A complete owner-supplied draft. It is the baseline for document metadata, semantic initiative states, risk severity, and provenance without relying on production demo content." } } },
	tags: ["visual-test"]
};

/** An owner-confirmed saved state whose feedback is supplied rather than created locally. */
export const Saved: Story =
{
	parameters: { docs: { description: { story: "A ready document after the owner confirms its save. The check treatment reflects the supplied lifecycle only; the component neither waits nor transitions state itself." } } },
	tags: ["visual-test"],
	args:
	{
		saveState: CanvasDocumentSaveStates.Saved
	}
};

/** Long localized content within a narrow reading surface. */
export const NarrowLongContent: Story =
{
	parameters: { docs: { description: { story: "Longer localized document content at a constrained width. It protects document title, summary, table, and citation information from clipping when data is more detailed than the standard fixture." } } },
	tags: ["visual-test"],
	render: function render(args)
	{
		return {
			props:
			{
				...args,
				document:
				{
					..._DOCUMENT,
					navigationTitle: "Strategische partnergroei",
					title: "Strategie voor duurzame adoptie door internationale uitvoeringspartners",
					executiveSummary: "Bevestig de commerciële aanname met iedere regionale accountverantwoordelijke, behoud de herleidbare bronverwijzingen en maak onzekerheid zichtbaar voordat de strategie wordt gepubliceerd.",
					metadata: ["Productontwikkeling", "concept ter beoordeling", "9 augustus 2026"]
				},
				saveState: CanvasDocumentSaveStates.Idle
			},
			template: `<div style="max-width:24rem;height:48rem"><wo-canvas-doc [document]="document" [saveState]="saveState" /></div>`
		};
	}
};

/** Save and export emit intent for the parent without performing a local document mutation. */
export const InteractionActions: Story =
{
	parameters: { docs: { description: { story: "The action boundary: each control emits one parent-owned intent. The interaction test proves that the renderer does not persist, export, or fabricate a save result on its own." } } },
	render: function render(args)
	{
		return {
			props: { ...args, saveRequests: 0, exportRequests: 0 },
			template: `<wo-canvas-doc [document]="document" (saveRequested)="saveRequests = saveRequests + 1" (exportRequested)="exportRequests = exportRequests + 1" /><output hidden data-testid="canvas-actions" [attr.data-save]="saveRequests" [attr.data-export]="exportRequests"></output>`
		};
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Save" }));
		await userEvent.click(canvas.getByRole("button", { name: "Export" }));
		await expect(canvasElement.querySelector("[data-testid='canvas-actions']")).toHaveAttribute("data-save", "1");
		await expect(canvasElement.querySelector("[data-testid='canvas-actions']")).toHaveAttribute("data-export", "1");
	}
};
