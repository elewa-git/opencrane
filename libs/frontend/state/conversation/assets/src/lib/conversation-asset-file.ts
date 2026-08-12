import { ___DecideConversationAssetBatch, type ConversationAssetBatchDecision } from "@opencrane/models/conversation-assets";

const _MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".mp3": "audio/mpeg",
	".pdf": "application/pdf",
	".png": "image/png",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".zip": "application/zip"
};

const _UNSPECIFIED_MEDIA_TYPE = "application/octet-stream";

/** Resolve only an exact declared type or a known extension when the browser supplies no type. */
export function _ConversationAssetFileMediaType(file: File): string
{
	if (file.type.trim().length > 0 && file.type !== _UNSPECIFIED_MEDIA_TYPE) return file.type;
	const name = file.name.toLowerCase();
	const extension = Object.keys(_MEDIA_TYPES_BY_EXTENSION).find(function _Matches(candidate) { return name.endsWith(candidate); });
	return extension === undefined ? file.type : _MEDIA_TYPES_BY_EXTENSION[extension] ?? file.type;
}

/** Apply the complete message-level policy before hashing or reserving any selected file. */
export function _DecideConversationAssetFiles(files: readonly File[]): ConversationAssetBatchDecision
{
	return ___DecideConversationAssetBatch(files.map(function _Item(file) { return { mediaType: _ConversationAssetFileMediaType(file), byteLength: file.size }; }));
}

/** Compute the immutable content address used for exact retry identity. */
export async function _ConversationAssetContentAddress(file: File): Promise<string>
{
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
	const hex = Array.from(new Uint8Array(digest), function _Hex(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
	return `sha256:${hex}`;
}
