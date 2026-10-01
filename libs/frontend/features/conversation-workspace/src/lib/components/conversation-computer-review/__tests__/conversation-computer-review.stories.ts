import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationComputerReviewComponent } from "../conversation-computer-review.component";

/** Active-computer review states rendered without a server or browser endpoint. */
const meta: Meta<ConversationComputerReviewComponent> = {
	title: "Conversations/Computer review",
	component: ConversationComputerReviewComponent,
	tags: ["autodocs"],
	args: {
		busy: false,
		error: null,
		file: "export function total(values: number[]): number { return values.reduce((sum, value) => sum + value, 0); }",
		diff: { exitCode: 0, outcome: "completed", output: "+ export const currency = 'KES';", truncated: false },
		command: { exitCode: 0, outcome: "completed", output: "4 tests passed", truncated: false },
		browserTargets: [{ id: "page-1", title: "Inventory dashboard", url: "http://localhost:5173/inventory" }],
		screenshotUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMTgwIiB2aWV3Qm94PSIwIDAgNjQwIDE4MCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIxODAiIHJ4PSIxMiIgZmlsbD0iI2U4ZWVmNSIvPjxyZWN0IHg9IjI0IiB5PSIyNCIgd2lkdGg9IjU5MiIgaGVpZ2h0PSIxMzIiIHJ4PSI4IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNiOGM3ZDkiLz48Y2lyY2xlIGN4PSI1MiIgY3k9IjUwIiByPSI2IiBmaWxsPSIjZDk2MzYzIi8+PGNpcmNsZSBjeD0iNzIiIGN5PSI1MCIgcj0iNiIgZmlsbD0iI2Q2YTg0YiIvPjxjaXJjbGUgY3g9IjkyIiBjeT0iNTAiIHI9IjYiIGZpbGw9IiM2M2E1NmYiLz48dGV4dCB4PSI0OCIgeT0iMTA0IiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiMyODQzNWQiPkxvY2FsaG9zdCBwcmV2aWV3PC90ZXh0Pjx0ZXh0IHg9IjQ4IiB5PSIxMzIiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzYwNzg4ZiI+aHR0cDovL2xvY2FsaG9zdDo0MjAwPC90ZXh0Pjwvc3ZnPg==",
		preview: "<!doctype html><title>Inventory dashboard</title>"
	}
};

export default meta;
type Story = StoryObj<ConversationComputerReviewComponent>;

/** Typical review renders every result region and exposes focus plus one inspect intent. */
export const Typical: Story = {
	tags: ["visual-test"],
	render: function _Render(args)
	{
		return {
			props: { ...args, inspectCount: 0 },
			template: `<wo-conversation-computer-review [busy]="busy" [error]="error" [file]="file" [diff]="diff" [command]="command" [browserTargets]="browserTargets" [screenshotUrl]="screenshotUrl" [preview]="preview" (inspectRequested)="inspectCount = inspectCount + 1" /><output data-testid="inspect-count" [attr.data-count]="inspectCount"></output>`
		};
	},
	play: async function _Inspect({ canvasElement })
	{
		const canvas = within(canvasElement);
		const path = canvas.getByLabelText("Workspace file path");
		await userEvent.type(path, "src/main.ts");
		await userEvent.tab();
		const inspect = canvas.getByRole("button", { name: "Inspect" });
		await expect(inspect).toHaveFocus();
		await userEvent.click(inspect);
		await expect(canvas.getByTestId("inspect-count")).toHaveAttribute("data-count", "1");
		await expect(canvas.getByRole("img", { name: "Captured localhost preview" })).toBeVisible();
	}
};

/** A pending failed read keeps safe feedback visible and disables every command action. */
export const BusyWithError: Story = {
	tags: ["visual-test"],
	args: { busy: true, error: "Computer review is temporarily unavailable." },
	play: async function _Busy({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent("temporarily unavailable");
		for (const name of ["Inspect", "Run", "Open page", "Screenshot", "View response source", "Refresh pages"])
			await expect(canvas.getByRole("button", { name })).toBeDisabled();
	}
};

/** Bounded long output remains reviewable inside a narrow context panel. */
export const LongOutputNarrow: Story = {
	tags: ["visual-test", "visual-test-narrow"],
	args: {
		screenshotUrl: null,
		diff: { exitCode: null, outcome: "output_limited", output: "diff output ".repeat(180), truncated: true },
		command: { exitCode: null, outcome: "timed_out", output: "command output ".repeat(180), truncated: true },
		preview: "<main>localhost response source</main>".repeat(80)
	}
};
