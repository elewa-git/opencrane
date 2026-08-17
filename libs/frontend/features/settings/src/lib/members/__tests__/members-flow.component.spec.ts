import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ChangeDetectionStrategy, Component, EventEmitter, type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";
import { MessageModule } from "primeng/message";
import { SkeletonModule } from "primeng/skeleton";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { OrganizationInviteCommandStates, OrganizationMemberDirectoryStates } from "@opencrane/state/organization/members";

import { MemberDirectoryRowKinds, type MembersViewModel } from "../member-directory.types";
import { MemberInviteLinkComponent } from "../member-invite-link.component";
import { MembersViewComponent } from "../members-view.component";

/** Clipboard descriptor restored after each focused component test. */
const _clipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

/** Section-heading test double that retains the real action projection seam. */
@Component({ selector: "wo-section-heading", standalone: true, inputs: ["title", "subtitle", "level"], template: "<ng-content select=\"[heading-actions]\" />", changeDetection: ChangeDetectionStrategy.OnPush })
class _SectionHeadingStub
{
	public title = "";
	public subtitle = "";
	public level: unknown;
}

/** Directory test double that exposes the real resend output seam. */
@Component({ selector: "wo-member-directory", standalone: true, inputs: ["activeCount", "pendingCount", "activeRows", "pendingRows", "searchQuery"], outputs: ["searchChanged", "resendRequested"], template: "<button id=\"refresh-invitation\" type=\"button\" (click)=\"resendRequested.emit('invite-1')\">Refresh invitation link</button>", changeDetection: ChangeDetectionStrategy.OnPush })
class _MemberDirectoryStub
{
	public activeCount = 0;
	public pendingCount = 0;
	public activeRows: readonly unknown[] = [];
	public pendingRows: readonly unknown[] = [];
	public searchQuery = "";
	public readonly searchChanged = new EventEmitter<string>();
	public readonly resendRequested = new EventEmitter<string>();
}

/** Invite-form test double that preserves the members-view binding contract. */
@Component({ selector: "wo-member-invite-form", standalone: true, inputs: ["state", "issues", "error", "links"], outputs: ["cancelled", "submitted"], template: "", changeDetection: ChangeDetectionStrategy.OnPush })
class _MemberInviteFormStub
{
	public state: unknown;
	public issues: readonly unknown[] = [];
	public error: string | null = null;
	public links: readonly string[] = [];
	public readonly cancelled = new EventEmitter<void>();
	public readonly submitted = new EventEmitter<unknown>();
}

/** Link test double that exposes the accessible result rendered by the real members template. */
@Component({ selector: "wo-member-invite-link", standalone: true, inputs: ["link"], template: "<input aria-label=\"Shareable invitation link\" [value]=\"link\" readonly />", changeDetection: ChangeDetectionStrategy.OnPush })
class _MemberInviteLinkStub
{
	public link = "";
}

/** Build one ready view whose returned-link field can be replaced after resend. */
function _View(resentInviteLink: string | null = null): MembersViewModel
{
	return {
		directoryState: OrganizationMemberDirectoryStates.Ready,
		activeCount: 1,
		pendingCount: 1,
		activeRows: [{ id: "member-1", kind: MemberDirectoryRowKinds.Member, initials: "JR", name: "Jente", email: "jente@example.com", roleLabel: "Owner", roleTone: ScopeChipTones.Warning, detail: "Active member", isCurrentUser: true, canResend: false, resending: false }],
		pendingRows: [{ id: "invite-1", kind: MemberDirectoryRowKinds.Invitation, initials: "A", name: "alex@example.com", email: "alex@example.com", roleLabel: "Pending", roleTone: ScopeChipTones.Warning, detail: "Pending invitation", isCurrentUser: false, canResend: true, resending: false }],
		searchQuery: "",
		refreshError: null,
		inviteState: OrganizationInviteCommandStates.Editing,
		inviteIssues: [],
		inviteError: null,
		inviteLinks: [],
		resentInviteLink,
		resendError: null
	};
}

/** Set one signal input directly because source-mode JIT cannot discover `input()` fields. */
function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetTestBed()
{
	TestBed.resetTestingModule();
	if (_clipboardDescriptor === undefined) Reflect.deleteProperty(globalThis.navigator, "clipboard");
	else Object.defineProperty(globalThis.navigator, "clipboard", _clipboardDescriptor);
});
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("members resend presentation", function _MembersResendPresentationSuite()
{
	it("renders the rotated shareable link after a refresh-link click", function _RendersRotatedLink()
	{
		const template = readFileSync(join(process.cwd(), "src/lib/members/members-view.component.html"), "utf8");
		TestBed.overrideComponent(MembersViewComponent, { set: { imports: [ButtonModule, MessageModule, SkeletonModule, _SectionHeadingStub, _MemberDirectoryStub, _MemberInviteFormStub, _MemberInviteLinkStub], templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [] } });
		const fixture = TestBed.createComponent(MembersViewComponent);
		const rotatedLink = "https://example.com/invitations/rotated";
		const resendRequested = vi.fn(function _Rotate(invitationId: string): void
		{
			expect(invitationId).toBe("invite-1");
			_SetInput(fixture.componentInstance.view, _View(rotatedLink));
		});
		fixture.componentInstance.resendRequested.subscribe(resendRequested);
		_SetInput(fixture.componentInstance.view, _View());
		fixture.detectChanges();

		(fixture.nativeElement.querySelector("#refresh-invitation") as HTMLButtonElement).click();
		fixture.detectChanges();

		expect(resendRequested).toHaveBeenCalledTimes(1);
		const linkInput = fixture.nativeElement.querySelector("input[aria-label='Shareable invitation link']") as HTMLInputElement;
		expect(linkInput.readOnly).toBe(true);
		expect(linkInput.value).toBe(rotatedLink);
		expect(fixture.nativeElement.textContent).toContain("replacement link");
	});

	it("copies the rendered server link and announces completion", async function _CopiesReturnedLink()
	{
		const template = readFileSync(join(process.cwd(), "src/lib/members/member-invite-link.component.html"), "utf8");
		TestBed.overrideComponent(MemberInviteLinkComponent, { set: { imports: [ButtonModule, InputTextModule], templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [] } });
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText } });
		const fixture = TestBed.createComponent(MemberInviteLinkComponent);
		const rotatedLink = "https://example.com/invitations/rotated";
		_SetInput(fixture.componentInstance.link, rotatedLink);
		fixture.detectChanges();

		(fixture.nativeElement.querySelector("button") as HTMLButtonElement).click();
		await fixture.whenStable();
		fixture.detectChanges();

		expect(writeText).toHaveBeenCalledWith(rotatedLink);
		expect(fixture.nativeElement.querySelector("[aria-live='polite']")?.textContent).toContain("Invitation link copied.");
	});
});
