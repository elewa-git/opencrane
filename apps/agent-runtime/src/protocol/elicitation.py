"""Validate neutral participant-input events and build bounded elicitation proposals.

The model adapter may describe ordinary runtime input or a reviewed A2UI action. This module turns
only those two exact neutral shapes into server-admitted proposals. It never chooses the participant,
expiry timestamp, run coordinates, or durable request identity.
"""

import hashlib
import json
import re


_IDENTIFIER = re.compile(r"^[^\x00-\x1f\x7f]{1,256}$")
_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
_BODY_KINDS = {"approval", "single_choice", "multiple_choice", "free_text"}
_PURPOSES = {"runtime_input", "a2ui_action"}
ELICITATION_TOOL_NAME = "opencrane_request_input"


def elicitation_tool_schema() -> dict[str, object]:
    """Return the model-visible JSON Schema for the execution-free built-in input tool.

    Called by: ``model_loop.driver._external_toolsets``. This schema helps the model produce the
    supported shapes; ``elicitation_proposal`` remains the fail-closed runtime authority.
    """
    choice = {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "label"],
        "properties": {
            "value": {"type": "string", "minLength": 1, "maxLength": 256},
            "label": {"type": "string", "minLength": 1, "maxLength": 500},
            "description": {"type": "string", "minLength": 1, "maxLength": 1_000},
        },
    }
    bodies = [
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "prompt", "maximumLength", "allowEmpty"],
            "properties": {
                "kind": {"const": "free_text"},
                "prompt": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "maximumLength": {"type": "integer", "minimum": 1, "maximum": 20_000},
                "allowEmpty": {"type": "boolean"},
            },
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "prompt", "choices"],
            "properties": {
                "kind": {"const": "single_choice"},
                "prompt": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "choices": {"type": "array", "minItems": 1, "maxItems": 50, "items": choice},
            },
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "prompt", "choices", "minimumSelections", "maximumSelections"],
            "properties": {
                "kind": {"const": "multiple_choice"},
                "prompt": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "choices": {"type": "array", "minItems": 1, "maxItems": 50, "items": choice},
                "minimumSelections": {"type": "integer", "minimum": 0, "maximum": 50},
                "maximumSelections": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "prompt", "action", "target", "dataUse", "consequence"],
            "properties": {
                "kind": {"const": "approval"},
                "prompt": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "action": {"type": "string", "minLength": 1, "maxLength": 1_000},
                "target": {"type": "string", "minLength": 1, "maxLength": 1_000},
                "dataUse": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "externalSystem": {"type": "string", "minLength": 1, "maxLength": 500},
                "consequence": {"type": "string", "minLength": 1, "maxLength": 2_000},
                "cost": {"type": "string", "minLength": 1, "maxLength": 500},
            },
        },
    ]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["requestKey", "purpose", "body", "expiresInSeconds"],
        "properties": {
            "requestKey": {"type": "string", "minLength": 1, "maxLength": 256},
            "purpose": {"type": "string", "enum": ["runtime_input", "a2ui_action"]},
            "body": {"oneOf": bodies},
            "purposePayload": {
                "type": "object",
                "additionalProperties": False,
                "required": ["displayedActionId", "sourceComponentId", "actionDigest"],
                "properties": {
                    "displayedActionId": {"type": "string", "minLength": 1, "maxLength": 256},
                    "sourceComponentId": {"type": "string", "minLength": 1, "maxLength": 256},
                    "actionDigest": {"type": "string", "pattern": "^sha256:[a-f0-9]{64}$"},
                },
            },
            "expiresInSeconds": {"type": "integer", "minimum": 30, "maximum": 900},
        },
    }


def elicitation_proposal(neutral_event: dict[str, object]) -> dict[str, object] | None:
    """Return one strict bounded proposal, or ``None`` when any model-owned field is invalid.

    Called by: ``RuntimeEventProjector`` for the explicit ``elicitation_request`` neutral event.
    The returned mapping contains no command or participant coordinates; the projector and server
    add those independently.
    """
    if set(neutral_event) != {"type", "frameworkCallId", "requestKey", "purpose", "body", "expiresInSeconds"} and set(neutral_event) != {
        "type",
        "frameworkCallId",
        "requestKey",
        "purpose",
        "body",
        "purposePayload",
        "expiresInSeconds",
    }:
        return None
    if neutral_event.get("type") != "elicitation_request":
        return None
    request_key = neutral_event.get("requestKey")
    purpose = neutral_event.get("purpose")
    expires_in_seconds = neutral_event.get("expiresInSeconds")
    if not _identifier(request_key) or purpose not in _PURPOSES or not _bounded_int(expires_in_seconds, 30, 900):
        return None
    body = _body(neutral_event.get("body"))
    if body is None:
        return None
    if purpose == "runtime_input":
        if "purposePayload" in neutral_event:
            return None
        purpose_payload: object = None
    else:
        purpose_payload = _a2ui_payload(neutral_event.get("purposePayload"))
        if purpose_payload is None:
            return None
    proposal = {
        "requestKey": request_key,
        "purpose": purpose,
        "body": body,
        "purposePayloadDigest": canonical_json_digest(purpose_payload),
        "expiresInSeconds": expires_in_seconds,
    }
    if purpose == "a2ui_action":
        proposal["purposePayload"] = purpose_payload
    return proposal


def canonical_json_digest(value: object) -> str:
    """Digest the bounded JSON shapes owned here using their RFC-8785-compatible representation."""
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _body(value: object) -> dict[str, object] | None:
    """Validate one participant-facing body without carrying unknown fields forward."""
    if not isinstance(value, dict) or value.get("kind") not in _BODY_KINDS:
        return None
    kind = value["kind"]
    prompt = _trimmed_text(value.get("prompt"), 2_000)
    if prompt is None:
        return None
    if kind == "approval":
        return _approval_body(value, prompt)
    if kind == "single_choice":
        return _choice_body(value, prompt, multiple=False)
    if kind == "multiple_choice":
        return _choice_body(value, prompt, multiple=True)
    return _free_text_body(value, prompt)


def _approval_body(value: dict[object, object], prompt: str) -> dict[str, object] | None:
    """Validate an exact approval disclosure body."""
    required = {"kind", "prompt", "action", "target", "dataUse", "consequence"}
    optional = {"externalSystem", "cost"}
    if not required.issubset(value) or not set(value).issubset(required | optional):
        return None
    limits = {"action": 1_000, "target": 1_000, "dataUse": 2_000, "consequence": 2_000}
    fields: dict[str, str] = {}
    for name, limit in limits.items():
        text = _trimmed_text(value.get(name), limit)
        if text is None:
            return None
        fields[name] = text
    for name in optional:
        if name not in value:
            continue
        text = _trimmed_text(value.get(name), 500)
        if text is None:
            return None
        fields[name] = text
    return {"kind": "approval", "prompt": prompt, **fields}


def _choice_body(value: dict[object, object], prompt: str, *, multiple: bool) -> dict[str, object] | None:
    """Validate one exact single- or multiple-choice body with distinct values."""
    required = {"kind", "prompt", "choices"}
    if multiple:
        required |= {"minimumSelections", "maximumSelections"}
    if set(value) != required:
        return None
    raw_choices = value.get("choices")
    if not isinstance(raw_choices, list) or not 1 <= len(raw_choices) <= 50:
        return None
    choices: list[dict[str, object]] = []
    values: set[str] = set()
    for raw_choice in raw_choices:
        choice = _choice(raw_choice)
        if choice is None or choice["value"] in values:
            return None
        values.add(str(choice["value"]))
        choices.append(choice)
    result: dict[str, object] = {"kind": value["kind"], "prompt": prompt, "choices": choices}
    if not multiple:
        return result
    minimum = value.get("minimumSelections")
    maximum = value.get("maximumSelections")
    if not _bounded_int(minimum, 0, 50) or not _bounded_int(maximum, 1, 50):
        return None
    if minimum > maximum or maximum > len(choices):
        return None
    result.update({"minimumSelections": minimum, "maximumSelections": maximum})
    return result


def _choice(value: object) -> dict[str, object] | None:
    """Validate one exact choice entry."""
    if not isinstance(value, dict) or set(value) not in ({"value", "label"}, {"value", "label", "description"}):
        return None
    identifier = value.get("value")
    label = _trimmed_text(value.get("label"), 500)
    if not _identifier(identifier) or label is None:
        return None
    choice: dict[str, object] = {"value": identifier, "label": label}
    if "description" in value:
        description = _trimmed_text(value.get("description"), 1_000)
        if description is None:
            return None
        choice["description"] = description
    return choice


def _free_text_body(value: dict[object, object], prompt: str) -> dict[str, object] | None:
    """Validate one exact bounded free-text body."""
    if set(value) != {"kind", "prompt", "maximumLength", "allowEmpty"}:
        return None
    maximum_length = value.get("maximumLength")
    allow_empty = value.get("allowEmpty")
    if not _bounded_int(maximum_length, 1, 20_000) or not isinstance(allow_empty, bool):
        return None
    return {
        "kind": "free_text",
        "prompt": prompt,
        "maximumLength": maximum_length,
        "allowEmpty": allow_empty,
    }


def _a2ui_payload(value: object) -> dict[str, object] | None:
    """Validate the only protected A2UI coordinates a neutral adapter may propose."""
    if not isinstance(value, dict) or set(value) != {"displayedActionId", "sourceComponentId", "actionDigest"}:
        return None
    displayed_action_id = value.get("displayedActionId")
    source_component_id = value.get("sourceComponentId")
    action_digest = value.get("actionDigest")
    if not _identifier(displayed_action_id) or not _identifier(source_component_id):
        return None
    if not isinstance(action_digest, str) or _DIGEST.fullmatch(action_digest) is None:
        return None
    return {
        "displayedActionId": displayed_action_id,
        "sourceComponentId": source_component_id,
        "actionDigest": action_digest,
    }


def _trimmed_text(value: object, maximum_length: int) -> str | None:
    """Apply the public contract's trim, non-empty, and Unicode-code-point bounds."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if 1 <= len(trimmed) <= maximum_length else None


def _identifier(value: object) -> bool:
    """Recognise one bounded identifier with no control characters."""
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _bounded_int(value: object, minimum: int, maximum: int) -> bool:
    """Recognise a JSON integer while excluding Python booleans and non-finite numbers."""
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum
