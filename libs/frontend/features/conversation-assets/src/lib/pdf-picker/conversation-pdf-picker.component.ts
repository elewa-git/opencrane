import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";

/** Lets a participant choose PDF files while leaving upload state with the parent store. */
@Component({ selector: "wo-conversation-pdf-picker", standalone: true, templateUrl: "./conversation-pdf-picker.component.html", styleUrl: "./conversation-pdf-picker.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationPdfPickerComponent
{
	/** Prevents the native chooser while the conversation cannot accept input. */
	public readonly disabled = input(false);
	/** Reports one PDF batch without starting a read or upload. */
	public readonly filesSelected = output<readonly File[]>();
	/** Explains a chooser result that contains anything other than PDF files. */
	public readonly error = signal<string | null>(null);

	/** Emits the chosen files and resets the input so the same file can be chosen again. */
	protected selectFiles(event: Event): void
	{
		const inputElement = event.target;
		if (!(inputElement instanceof HTMLInputElement) || this.disabled())
			return;
		const files = Array.from(inputElement.files ?? []);
		inputElement.value = "";
		if (files.length === 0)
			return;
		if (!files.every(_IsPdf))
		{
			this.error.set("Choose PDF files only.");
			return;
		}
		this.error.set(null);
		this.filesSelected.emit(files);
	}
}

/** Accepts declared PDFs and PDF filenames when the browser omits a useful media type. */
function _IsPdf(file: File): boolean
{
	if (file.type === "application/pdf")
		return true;
	return (file.type.trim().length === 0 || file.type === "application/octet-stream") && file.name.toLowerCase().endsWith(".pdf");
}
