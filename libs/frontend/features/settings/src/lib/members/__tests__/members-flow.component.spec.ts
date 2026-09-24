import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ChangeDetectionStrategy, Component, EventEmitter, type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { ConfirmationService, type Confirmation } from "primeng/api";
import { ConfirmDialogModule } from "primeng/confirmdialog";
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
@Component({ selector: "wo-member-directory", standalone: true, inputs: ["activeCount", "pendingCount", "activeRows", "pendingRows", "searchQuery"], outputs: ["searchChanged", "resendRequested", "removalRequested"], template: "<button id=\"refresh-invitation\" type=\"button\" (click)=\"resendRequested.emit('invite-1')\">Refresh invitation link</button>", changeDetection: ChangeDetectionStrategy.OnPush })
class _MemberDirectoryStub
{
	public activeCount = 0;
	public pendingCount = 0;
	public activeRows: readonly unknown[] = [];
	public pendingRows: readonly unknown[] = [];
	public searchQuery = "";
	public readonly searchChanged = new EventEmitter<string>();
	public readonly resendRequested = new EventEmitter<string>();
	public readonly removalRequested = new EventEmitter<string>();
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
		activeRows: [{ id: "member-1", kind: MemberDirectoryRowKinds.Member, initials: "JR", name: "Jente", email: "jente@example.com", roleLabel: "Owner", roleTone: ScopeChipTones.Warning, detail: "Active member", isCurrentUser: true, canResend: false, resending: false, canRemove: false, removing: false, removalDetail: "Owner protected" }],
		pendingRows: [{ id: "invite-1", kind: MemberDirectoryRowKinds.Invitation, initials: "A", name: "alex@example.com", email: "alex@example.com", roleLabel: "Pending", roleTone: ScopeChipTones.Warning, detail: "Pending invitation", isCurrentUser: false, canResend: true, resending: false, canRemove: false, removing: false, removalDetail: null }],
		searchQuery: "",
		refreshError: null,
		inviteState: OrganizationInviteCommandStates.Editing,
		inviteIssues: [],
		inviteError: null,
		inviteLinks: [],
		resentInviteLink,
		resendError: null, removalMessage: null, removalError: null
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
	if (_clipboardDescriptor === undefined)
		Reflect.deleteProperty(globalThis.navigator, "clipboard");
	else Object.defineProperty(globalThis.navigator, "clipboard", _clipboardDescriptor);
});
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("members resend presentation", function _MembersResendPresentationSuite()
{
	it("renders the rotated shareable link after a refresh-link click", function _RendersRotatedLink()
	{
		const template = readFileSync(join(process.cwd(), "src/lib/members/members-view.component.html"), "utf8");
		TestBed.overrideComponent(MembersViewComponent, { set: { imports: [ButtonModule, ConfirmDialogModule, MessageModule, SkeletonModule, _SectionHeadingStub, _MemberDirectoryStub, _MemberInviteFormStub, _MemberInviteLinkStub], templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [] } });
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

/** Uses the real MembersView and PrimeNG confirmation with small unrelated display doubles. */
function _RemovalFixture()
{
	const template = readFileSync(join(process.cwd(), "src/lib/members/members-view.component.html"), "utf8");
	TestBed.overrideComponent(MembersViewComponent, { set: { imports: [ButtonModule, ConfirmDialogModule, MessageModule, SkeletonModule, _SectionHeadingStub, _MemberDirectoryStub, _MemberInviteFormStub, _MemberInviteLinkStub], templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [] } });
	const fixture = TestBed.createComponent(MembersViewComponent);
	const view = { ..._View(), activeRows: [{ ..._View().activeRows[0]!, name: "<img src=x onerror=alert(1)>", canRemove: true, removalDetail: null }] };
	_SetInput(fixture.componentInstance.view, view);
	fixture.detectChanges();
	const confirmation = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), "confirm");
	const removed = vi.fn();
	fixture.componentInstance.removalRequested.subscribe(removed);
	const open = (fixture.componentInstance as unknown as { confirmRemoval(id: string): void }).confirmRemoval.bind(fixture.componentInstance);
	return { fixture, view, confirmation, removed, open };
}

describe("member removal confirmation", function _RemovalConfirmation()
{
	it("defaults to Cancel, preserves escaped identity text and emits the exact target once", async function _ExactConfirmation()
	{
		const f = _RemovalFixture();
		expect(f.fixture.nativeElement.querySelector("p-dialog")?.getAttribute("role")).toBe("presentation");
		expect(f.fixture.nativeElement.querySelector("[role='alertdialog']")).toBeNull();
		f.open("member-1"); f.fixture.detectChanges();
		await f.fixture.whenStable();
		f.fixture.detectChanges();
		const options: Confirmation = f.confirmation.mock.calls[0]![0];
		expect(options).toMatchObject({ key: "member-removal", header: "Remove access", defaultFocus: "reject", acceptButtonProps: { label: "Remove access", severity: "danger" }, rejectButtonProps: { label: "Cancel" } });
		expect(f.removed).not.toHaveBeenCalled();
		expect(document.querySelector(".p-dialog img")).toBeNull();
		expect(document.querySelectorAll("[role='alertdialog']")).toHaveLength(1);
		expect(document.querySelector(".p-dialog[role='alertdialog']")?.getAttribute("aria-labelledby")).toBeTruthy();
		expect(document.querySelector("button[data-pc-name='pcclosebutton']")?.getAttribute("aria-label")).toBe("Cancel removal");
		expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
		options.accept?.(); options.accept?.();
		expect(f.removed).toHaveBeenCalledExactlyOnceWith("member-1");
	});

	it("cancels without emitting and refuses a foreign row coordinate", function _Cancel()
	{
		const f = _RemovalFixture();
		const trigger = f.fixture.nativeElement.querySelector("#refresh-invitation") as HTMLButtonElement;
		trigger.focus();
		f.open("foreign");
		expect(f.confirmation).not.toHaveBeenCalled();
		f.open("member-1");
		trigger.blur();
		f.confirmation.mock.calls[0]![0].reject?.();
		expect(f.removed).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(trigger);
	});

	it.each([true, false])("refuses stale acceptance after access or target capability changes: %s", function _StaleConfirmation(forbidden)
	{
		const f = _RemovalFixture();
		f.open("member-1");
		const accepted = f.confirmation.mock.calls[0]![0].accept;
		_SetInput(f.fixture.componentInstance.view, { ...f.view, directoryState: forbidden ? OrganizationMemberDirectoryStates.Forbidden : OrganizationMemberDirectoryStates.Ready, activeRows: [{ ...f.view.activeRows[0]!, canRemove: false }] });
		f.fixture.detectChanges();
		accepted?.();
		expect(f.removed).not.toHaveBeenCalled();
	});

	it("hides private invitation controls and links immediately on a denied projection", function _ForbiddenView()
	{
		const f = _RemovalFixture();
		(f.fixture.componentInstance as unknown as { openInvite(): void }).openInvite();
		_SetInput(f.fixture.componentInstance.view, { ...f.view, directoryState: OrganizationMemberDirectoryStates.Forbidden, inviteLinks: ["private-link"], resentInviteLink: "private-link", removalMessage: "old result" });
		f.fixture.detectChanges();
		expect(f.fixture.nativeElement.querySelector("wo-member-invite-form")).toBeNull();
		expect(f.fixture.nativeElement.querySelector("wo-member-invite-link")).toBeNull();
		expect(f.fixture.nativeElement.querySelector("wo-member-directory")).toBeNull();
		expect(f.fixture.nativeElement.textContent).not.toContain("Invite people");
		expect(f.fixture.nativeElement.textContent).not.toContain("private-link");
	});
});
