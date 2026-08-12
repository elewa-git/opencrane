"""Checks the questions a model asks the participant, and describes them to the model in the first place.

Two things live here, and they are two halves of the same job:

- ``elicitation_tool_schema`` tells the model what a well-formed question looks like, by describing the
  built-in ``opencrane_request_input`` tool to the provider.
- ``elicitation_proposal`` checks what actually came back. It is the half that decides, because a model
  can ignore a schema, and the provider is not obliged to enforce one.

Neither half chooses who answers, when the question expires, which run it belongs to, or what its
request id is. The server works all of that out for itself; a model may only describe the question.
"""

import hashlib
import json
import re


# Length-limited, and with control characters excluded, so an identifier the model made up cannot carry
# terminal escapes or line breaks into a log line or onto a rendered card.
_IDENTIFIER = re.compile(r"^[^\x00-\x1f\x7f]{1,256}$")
_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
_BODY_KINDS = {"approval", "single_choice", "multiple_choice", "free_text"}
# The two reasons a model is allowed to ask for. The other two reasons the platform supports — approving
# a tool call, and permission to read personal memory — are raised by the server from what it can see for
# itself. A model must not be able to ask for either, because it would then be writing the description of
# a consequence that nobody checked.
_PURPOSES = {"runtime_input", "a2ui_action"}
# Name of the built-in tool a model calls to ask a question. A compiled tool list that reuses this name
# is rejected in ``model_loop.driver._external_toolsets``, so a granted tool cannot pose as this one.
ELICITATION_TOOL_NAME = "opencrane_request_input"


def elicitation_tool_schema() -> dict[str, object]:
    """Describe the built-in question tool to the model, as JSON Schema.

    This is the parameter schema for ``opencrane_request_input``. It is handed to the model framework as
    a tool definition, reaches the provider with the request, and is how the model learns that a
    question has four possible shapes and what each one needs. Writing it out here, rather than deriving
    it, is what keeps it readable next to the checks in ``elicitation_proposal`` that have to agree with
    it — but the two are separate copies of one shape, and changing either alone will let the model
    produce questions that are then refused.

    Nothing here enforces anything. Providers treat a schema as guidance, models can ignore it, and a
    question that arrives in the wrong shape is caught by ``elicitation_proposal`` instead.

    Called by: ``_external_toolsets`` in ``model_loop/driver.py``.

    Returns:
        The parameter schema, as plain dictionaries and lists, ready to pass to the framework's
        ``ToolDefinition``.
    """
    # Every object below sets ``additionalProperties: False``, matching how strictly
    # ``elicitation_proposal`` reads the same shapes. Being looser here would tell the model an extra
    # field is welcome and then reject the question containing it, which reads to the model as a
    # failure it cannot correct.
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
    # The four question shapes, in the order a model is most likely to reach for them: free text, pick
    # one, pick several, and approve-or-refuse. ``oneOf`` below makes the model commit to exactly one.
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
    # What the model may fill in: a key of its own choosing, why it is asking, the question itself, and
    # how long it would like to wait. There is deliberately no field for who should answer, which run
    # this belongs to, or a wall-clock deadline — the server decides all three.
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
    """Check a question the model asked, and rebuild it from the fields we recognise.

    This is the half that decides. ``elicitation_tool_schema`` told the model what to send, but a model
    can send something else, so every field is checked again here. Each shape is rebuilt from the values
    that passed rather than passed through, which is how an unrecognised field is prevented from
    reaching the participant's card.

    Called by: ``RuntimeEventProjector._emit_elicitation`` in ``event_projector.py``, and again by
    ``translate_framework_event`` in ``model_loop/driver.py`` so that a malformed question is reported
    as such while the adapter can still describe it.

    Returns:
        The question, ready for the server to attach its own coordinates to, or ``None`` when any field
        the model filled in is unusable. The result names no participant, no run, and no deadline; the
        projector and the server add those.
    """
    # Accept exactly the members of one of the two valid shapes: with the A2UI payload, or without it. An
    # unexpected member means the adapter is sending something this function does not know how to check,
    # so refuse instead of ignoring whatever was added.
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
    # Hold the wait to between 30 seconds and 15 minutes. Below that it can expire before the
    # participant has read the question; above it, a run sits paused for as long as the model felt like
    # asking for. The server sets the real deadline from this and may shorten it.
    if not _identifier(request_key) or purpose not in _PURPOSES or not _bounded_int(expires_in_seconds, 30, 900):
        return None
    body = _body(neutral_event.get("body"))
    if body is None:
        return None
    if purpose == "runtime_input":
        # A plain question has no A2UI action behind it, so it must not carry the payload that points at
        # one. A model sending it here would be attaching itself to an action nobody reviewed.
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
        # Digest the payload even when there is none. Hashing ``None`` gives the server one shape to
        # compare against every time, instead of a field it has to handle as sometimes-missing.
        "purposePayloadDigest": canonical_json_digest(purpose_payload),
        "expiresInSeconds": expires_in_seconds,
    }
    # The payload itself travels only for the reason that has one.
    if purpose == "a2ui_action":
        proposal["purposePayload"] = purpose_payload
    return proposal


def canonical_json_digest(value: object) -> str:
    """Hash a payload the same way the server will hash it.

    The server hashes the payload it receives and compares that against the digest sent alongside it, so
    both sides have to encode the value identically before hashing. The three settings below are what
    make that true: they follow the JSON Canonicalization Scheme, which exists for exactly this problem.

    Called by: ``elicitation_proposal`` in this module, for the A2UI payload and for its absence.

    Returns:
        The hash, prefixed ``sha256:`` to match how digests are written everywhere else in the protocol.

    @see https://www.rfc-editor.org/rfc/rfc8785 — JSON Canonicalization Scheme, the rules being followed
        here.
    """
    # Sorting the keys and dropping the spaces after separators means the same values hash the same way
    # regardless of the order they were built in. ``ensure_ascii=False`` writes text as itself instead of
    # as escapes, so text outside the ASCII range hashes the same on both sides.
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _body(value: object) -> dict[str, object] | None:
    """Check the question itself and hand it to the checker for its shape.

    Returns ``None`` for anything unrecognised. Each of the four shape checkers rebuilds its result from
    the fields that passed, so a field this code does not know about cannot reach the participant.
    """
    if not isinstance(value, dict) or value.get("kind") not in _BODY_KINDS:
        return None
    kind = value["kind"]
    # All four shapes show the participant a prompt, so check it once here instead of in each branch.
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
    """Check an approve-or-refuse question, which has to say what it is asking permission for.

    ``action``, ``target``, ``dataUse`` and ``consequence`` are all required, because without them the
    participant is being asked to approve something they cannot see. A question missing any of them is
    refused rather than shown as a bare yes-or-no. ``externalSystem`` and ``cost`` may be left out, but
    have to be well-formed when present.
    """
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
    # Skip the optional fields that were left out, but check the ones that were sent. A blank or
    # over-long cost line is a broken disclosure, not an absent one.
    for name in optional:
        if name not in value:
            continue
        text = _trimmed_text(value.get(name), 500)
        if text is None:
            return None
        fields[name] = text
    return {"kind": "approval", "prompt": prompt, **fields}


def _choice_body(value: dict[object, object], prompt: str, *, multiple: bool) -> dict[str, object] | None:
    """Check a pick-one or pick-several question and make sure no two options share a value.

    Args:
        value: The question as the model sent it.
        prompt: The prompt, already checked by ``_body``.
        multiple: Whether several options may be picked, which is what makes the selection counts
            required rather than not allowed.
    """
    required = {"kind", "prompt", "choices"}
    if multiple:
        required |= {"minimumSelections", "maximumSelections"}
    # Require the fields to match, rather than merely include what is needed. Selection counts on a
    # pick-one question would state a rule the participant's control has no way to apply.
    if set(value) != required:
        return None
    raw_choices = value.get("choices")
    if not isinstance(raw_choices, list) or not 1 <= len(raw_choices) <= 50:
        return None
    choices: list[dict[str, object]] = []
    values: set[str] = set()
    for raw_choice in raw_choices:
        choice = _choice(raw_choice)
        # Refuse two options that carry the same value. The answer names the value and nothing else, so
        # the model would have no way to tell which of the two the participant picked.
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
    # Refuse counts that nothing could satisfy. Asking for more picks than there are options, or a
    # minimum above the maximum, leaves the participant unable to submit anything at all.
    if minimum > maximum or maximum > len(choices):
        return None
    result.update({"minimumSelections": minimum, "maximumSelections": maximum})
    return result


def _choice(value: object) -> dict[str, object] | None:
    """Check one option of a pick-one or pick-several question.

    ``value`` is the token the model gets back when this option is picked, and it means nothing to the
    participant. ``label`` and the optional ``description`` are what they actually read, and both have
    length limits so a single option cannot take over the card.
    """
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
    """Check a type-an-answer question.

    ``maximumLength`` and ``allowEmpty`` are both required. The browser control and the server's own
    check of the reply both read these two values, so neither side may be left to pick a default: if they
    picked different ones, an answer the participant was allowed to type would then be rejected.
    """
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
    """Check the three fields that point at an A2UI action the server already showed.

    The model may say which displayed action it means, but never what that action does. The server looks
    the action up from these fields and reads the description from its own record, so a model cannot ask
    a participant to confirm something that was never on screen.
    """
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
    """Trim text the participant will read, and check that something is left and it is not too long.

    Returns the trimmed text, which is what callers keep — not the original. Text that is only
    whitespace trims away to nothing and is refused, so a card cannot end up with an empty prompt or a
    blank option label.
    """
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    # Python counts a string's length in code points, which is what the browser contract counts too, so
    # both ends agree on whether text containing characters outside the ASCII range fits.
    return trimmed if 1 <= len(trimmed) <= maximum_length else None


def _identifier(value: object) -> bool:
    """Check one identifier: a string, not too long, with no control characters in it."""
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _bounded_int(value: object, minimum: int, maximum: int) -> bool:
    """Check a whole number within a range, rejecting the booleans that Python counts as numbers."""
    # In Python ``True`` is an ``int`` equal to 1, so without the second test a boolean could set a
    # selection count or a wait time.
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum
