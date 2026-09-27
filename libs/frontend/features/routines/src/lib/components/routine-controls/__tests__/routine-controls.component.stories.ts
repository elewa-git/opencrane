import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { RoutineCommandStates, RoutineControlActions } from "../../../routine-presentation.types";
import { RoutineControlsComponent } from "../routine-controls.component";

const meta: Meta<RoutineControlsComponent> =
{
	title: "Routines/Controls",
	component: RoutineControlsComponent,
	tags: ["autodocs", "routine-test"],
	argTypes:
	{
		reviseRequested: { action: "reviseRequested" },
		pauseRequested: { action: "pauseRequested" },
		resumeRequested: { action: "resumeRequested" },
		retireRequested: { action: "retireRequested" },
		runNowRequested: { action: "runNowRequested" },
		retryRequested: { action: "retryRequested" }
	},
	parameters: { docs: { description: { component: "Server-hinted routine controls with focused confirmation for permanent retirement." } } }
};
export default meta;
type Story = StoryObj<RoutineControlsComponent>;

const CAPABILITIES = { revise: true, pause: true, resume: false, retire: true, runNow: true };

/** Retirement remains inert until the focused confirmation action is explicitly accepted. */
export const RetireConfirmation: Story = { tags: ["visual-test"], args: { capabilities: CAPABILITIES, retireRequested: fn() }, play: async function _RetireConfirmation({ canvasElement, args })
{
	const canvas = within(canvasElement);
	const documentBody = within(canvasElement.ownerDocument.body);
	const retire = canvas.getByRole("button", { name: "Retire" });
	await userEvent.click(retire);
	const dialog = await documentBody.findByRole("alertdialog", { name: "Retire this routine?" });
	await waitFor(() => expect(dialog).toBeVisible());
	const accept = within(dialog).getByRole("button", { name: "Retire routine" });
	await expect(accept).toBeVisible();
	await accept.focus();
	await expect(accept).toHaveFocus();
	await expect(args.retireRequested).not.toHaveBeenCalled();
	await userEvent.click(accept);
	await waitFor(() => expect(args.retireRequested).toHaveBeenCalledOnce());
} };

/** An uncertain command exposes only its exact saved retry action. */
export const UncertainRunNow: Story = { tags: ["visual-test"], args: { capabilities: CAPABILITIES, state: RoutineCommandStates.Uncertain, retryAction: RoutineControlActions.RunNow, retryRequested: fn() }, play: async function _UncertainRunNow({ canvasElement })
{
	const canvas = within(canvasElement);
	await expect(canvas.getByRole("button", { name: "Retry run now" })).toBeEnabled();
	await expect(canvas.getByRole("button", { name: "Revise" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Pause" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Run now" })).toBeDisabled();
} };

/** A malformed uncertain state without a retained action remains locked and exposes no fresh command. */
export const UncertainWithoutRetry: Story = { tags: ["visual-test"], args: { capabilities: CAPABILITIES, state: RoutineCommandStates.Uncertain, retryAction: null }, play: async function _UncertainWithoutRetry({ canvasElement })
{
	const canvas = within(canvasElement);
	await expect(canvas.queryByRole("button", { name: /^Retry /u })).not.toBeInTheDocument();
	await expect(canvas.getByRole("button", { name: "Revise" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Pause" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Run now" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Retire" })).toBeDisabled();
} };

/** A saved destructive retry retains the original confirmation boundary. */
export const UncertainRetire: Story = { tags: ["visual-test"], args: { capabilities: CAPABILITIES, state: RoutineCommandStates.Uncertain, retryAction: RoutineControlActions.Retire, retryRequested: fn() }, play: async function _UncertainRetire({ canvasElement, args })
{
	const canvas = within(canvasElement);
	const documentBody = within(canvasElement.ownerDocument.body);
	await userEvent.click(canvas.getByRole("button", { name: "Retry retire" }));
	const dialog = await documentBody.findByRole("alertdialog", { name: "Retry retiring this routine?" });
	await waitFor(() => expect(dialog).toBeVisible());
	const accept = within(dialog).getByRole("button", { name: "Retry retirement" });
	await accept.focus();
	await expect(accept).toHaveFocus();
	await expect(args.retryRequested).not.toHaveBeenCalled();
	await userEvent.click(accept);
	await waitFor(() => expect(args.retryRequested).toHaveBeenCalledOnce());
} };
