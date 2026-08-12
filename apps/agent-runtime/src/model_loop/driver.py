"""Adapt the bounded Pydantic AI loop into framework-neutral runtime events.

Pydantic AI and OpenAI-compatible client objects stop at this module. Callers receive plain
dictionaries for text, usage, errors, and tool calls, so framework-specific classes and identifiers
never become OpenCrane protocol contracts. This adapter performs no direct tool execution, memory
access, provider fallback, or implicit retry.
"""

import asyncio
import threading
from collections.abc import Callable, Iterator

from ..config import environment, read_attempt_litellm_key
from ..constants import DEFAULT_LITELLM_KEY_PATH


def absorb_steering(steering_buffer: list[str]) -> list[str]:
    """Take only the steering messages already buffered when a model request is about to start.

    The copy-then-prefix-delete sequence preserves text appended after the copy by another producer:
    only the entries observed in ``drained`` are removed. Callers must invoke this immediately before
    starting a model request, never while a request or tool call is in flight.
    """
    # Snapshot before deletion rather than swapping the list object: producers retain the same shared
    # buffer reference, and entries appended after the snapshot survive for the next request boundary.
    drained = steering_buffer[:]
    del steering_buffer[: len(drained)]
    return drained


def zero_retry_openai_settings() -> dict[str, int]:
    """Describe every retry setting that OpenCrane explicitly disables.

    Provider HTTP/model-request retries share the OpenAI client's ``max_retries`` setting. Tool and
    output validation retries belong to the Pydantic agent. Keeping all four names visible makes it
    difficult for a framework upgrade to reintroduce an unnoticed default retry path.
    """
    # Keep each conceptual retry surface explicit even where the current SDK collapses two settings
    # onto one transport knob. This is a review checklist against dependency-default drift.
    return {
        "model_request_retries": 0,
        "provider_http_retries": 0,
        "tool_validation_retries": 0,
        "output_validation_retries": 0,
    }


def build_zero_retry_agent(
    model_alias: str,
    base_url: str,
    attempt_key: str,
    instructions: str,
    *,
    agent_cls: Callable[..., object] | None = None,
    model_cls: Callable[..., object] | None = None,
    provider_cls: Callable[..., object] | None = None,
    async_openai: Callable[..., object] | None = None,
) -> object:
    """Construct an attempt-scoped agent with every implicit retry path disabled.

    The constructor seams are injectable for offline proof that each zero reaches the correct
    framework layer. Real dependencies are imported lazily so protocol tests need neither Pydantic AI
    nor the OpenAI client installed.

    Raises:
        RuntimeError: If the two settings mapped to the shared OpenAI transport disagree.
        ImportError: If production dependencies are unavailable when the real driver is used.
    """
    # Resolve only missing constructors. A test can replace one layer without having to fake the
    # complete Pydantic/OpenAI package graph.
    if agent_cls is None or model_cls is None or provider_cls is None:
        from pydantic_ai import Agent
        from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider

        agent_cls = agent_cls or Agent
        model_cls = model_cls or OpenAIModel
        provider_cls = provider_cls or OpenAIProvider
    if async_openai is None:
        from openai import AsyncOpenAI

        async_openai = AsyncOpenAI

    settings = zero_retry_openai_settings()
    # Both named retry settings land on one AsyncOpenAI value. If they ever disagreed, the setting
    # would be misleading, so reject it before constructing the client.
    if settings["provider_http_retries"] != settings["model_request_retries"]:
        raise RuntimeError("provider HTTP and model-request retries must agree on the transport")
    # The mounted attempt key and compiled alias are the only provider capabilities admitted here. No
    # provider fallback, master key, or ambient client default may select a broader route.
    openai_client = async_openai(
        base_url=base_url,
        api_key=attempt_key,
        max_retries=settings["provider_http_retries"],
    )
    provider = provider_cls(openai_client=openai_client)
    model = model_cls(model_alias, provider=provider)
    return agent_cls(
        model,
        system_prompt=instructions,
        retries=settings["tool_validation_retries"],
        output_retries=settings["output_validation_retries"],
    )


def pydantic_ai_event_source(
    compiled_input: dict[str, object],
    cancel_event: threading.Event,
    steering_buffer: list[str],
) -> Iterator[dict[str, object]]:
    """Run a new compiled input and yield ordered framework-neutral events.

    The synchronous iterator is the seam consumed by attempt execution. Internally, one asynchronous
    Pydantic run is collected, with cancellation checked before each node and streamed event.
    Steering is absorbed only immediately before a model request node is opened.
    """
    from pydantic_ai import Agent

    agent = _agent_for(compiled_input)

    async def _collect() -> list[dict[str, object]]:
        """Collect one fresh framework run without leaking async objects out of this adapter."""
        # Buffer plain events until the async run closes; framework-owned nodes and contexts never
        # escape into the synchronous attempt executor or checkpoint format.
        events: list[dict[str, object]] = []
        async with agent.iter(prompt(compiled_input)) as run:
            async for node in run:
                # Avoid intentionally opening a node after observed cancellation. The in-stream check
                # below still suppresses output if cancellation races this check-to-open boundary.
                if cancel_event.is_set():
                    break
                if Agent.is_model_request_node(node):
                    # This is the sole steering injection boundary: the request has not started and
                    # no tool or provider operation is currently in flight.
                    apply_steering_to_request(node, absorb_steering(steering_buffer))
                    async with node.stream(run.ctx) as request_stream:
                        async for event in request_stream:
                            # Check inside the stream as well: node-level cancellation alone would still
                            # allow buffered provider deltas to cross the runtime protocol seam.
                            if cancel_event.is_set():
                                break
                            events.append(translate_framework_event(event))
        # Usage is translated after the framework closes the run so the counters represent the whole
        # bounded request sequence rather than an intermediate node.
        usage = run.usage()
        events.append(
            {
                "type": "usage",
                "inputTokens": getattr(usage, "input_tokens", 0),
                "outputTokens": getattr(usage, "output_tokens", 0),
            },
        )
        return events

    # Attempt execution is already isolated on a worker thread, so it can own this event loop without
    # blocking the command-stream reader.
    for event in asyncio.run(_collect()):
        if cancel_event.is_set():
            break
        yield event


def pydantic_ai_resume_source(
    compiled_input: dict[str, object],
    tool_results: object,
    cancel_event: threading.Event,
    steering_buffer: list[str],
) -> Iterator[dict[str, object]]:
    """Resume from attempt-owned compiled context and control-plane-authorised tool results.

    The attempts layer supplies the one coordinate-checked compiled input recovery and owns every
    checkpoint/cipher decision. This persistence-free adapter only translates that exact immutable
    context into a bounded framework resume, so it cannot reread a checkpoint with a different
    process cipher or silently select stale tool grants.
    """
    from pydantic_ai import Agent

    agent = _agent_for(compiled_input)

    async def _collect() -> list[dict[str, object]]:
        """Collect one authorised resume while keeping its framework state inside this adapter."""
        # Resume uses a fresh framework runner but only the server-returned deferred results. The
        # adapter never calls the external tool or recreates a result from pending-call metadata.
        events: list[dict[str, object]] = []
        async with agent.iter(
            prompt(compiled_input),
            deferred_tool_results=tool_results,
        ) as run:
            async for node in run:
                # A resumed graph is no less cancellable than a fresh graph; do not enter another node
                # after the shared attempt signal has been set.
                if cancel_event.is_set():
                    break
                if Agent.is_model_request_node(node):
                    # Resume steering follows the same pre-request rule as a fresh start. The optional
                    # framework dependency container is checked defensively here inside the adapter.
                    # Drain once per request node. Steering arriving after this point waits for the next
                    # model boundary rather than mutating an in-flight prompt.
                    for steer in absorb_steering(steering_buffer):
                        deps = getattr(run.ctx, "deps", None)
                        if hasattr(deps, "steering"):
                            deps.steering.append(steer)
                    async with node.stream(run.ctx) as request_stream:
                        async for event in request_stream:
                            if cancel_event.is_set():
                                break
                            events.append(translate_framework_event(event))
        usage = run.usage()
        events.append(
            {
                "type": "usage",
                "inputTokens": getattr(usage, "input_tokens", 0),
                "outputTokens": getattr(usage, "output_tokens", 0),
            },
        )
        return events

    for event in asyncio.run(_collect()):
        if cancel_event.is_set():
            break
        yield event


def prompt(compiled_input: dict[str, object]) -> str:
    """Join the message text the server compiled, keeping the order it was accepted in.

    Prompt selection is intentionally boring: the runtime does not reinterpret roles, fetch more
    context, or author instructions. Missing or malformed message collections produce an empty
    prompt and remain visible to the model executor rather than triggering an alternate source.
    """
    # Consume only the literal, ordered server projection. The runtime performs no conversation lookup
    # and cannot supplement this snapshot from local or provider state.
    messages = compiled_input.get("messages")
    if not isinstance(messages, list):
        return ""
    parts = [
        message.get("content")
        for message in messages
        if isinstance(message, dict) and isinstance(message.get("content"), str)
    ]
    return "\n".join(part for part in parts if isinstance(part, str))


def translate_framework_event(event: object) -> dict[str, object]:
    """Translate the supported Pydantic event shapes into plain dictionaries.

    Text deltas and complete tool-call parts are the only framework shapes admitted here. Unknown
    shapes become an empty text delta rather than leaking arbitrary framework objects across the
    protocol seam; the protocol normaliser decides what becomes a candidate.
    """
    # Duck typing is contained here so framework upgrades cannot leak new object shapes directly into
    # the wire protocol. Every admitted output is reconstructed as an owned primitive dictionary.
    delta = getattr(getattr(event, "delta", None), "content_delta", None)
    if isinstance(delta, str):
        return {"type": "output_text", "text": delta}
    tool_name = getattr(getattr(event, "part", None), "tool_name", None)
    if isinstance(tool_name, str):
        part = event.part
        return {
            "type": "tool_call",
            "toolName": tool_name,
            "toolCallId": getattr(part, "tool_call_id", ""),
            "arguments": getattr(part, "args_as_json_str", lambda: "{}")(),
        }
    return {"type": "output_text", "text": ""}


def apply_steering_to_request(model_request_node: object, steering: list[str]) -> None:
    """Append accepted steering text to a request that has not yet been sent.

    The function is deliberately duck-typed because framework classes do not belong in signatures
    outside this adapter. If the expected mutable request parts are absent, steering is not applied;
    the runtime never mutates a request through an unrecognised fallback path.
    """
    if not steering:
        return
    # Mutate only the recognised request-parts list. If the framework changes shape, dropping steering
    # is safer than guessing at a new internal object and corrupting an in-flight request.
    parts = getattr(getattr(model_request_node, "request", None), "parts", None)
    if isinstance(parts, list):
        parts.extend({"content": text} for text in steering)


def _agent_for(compiled_input: dict[str, object]) -> object:
    """Build the model adapter from only the control-plane-compiled route and mounted key.

    The model alias comes from the immutable input snapshot. The base URL is process configuration,
    and the attempt-scoped key is read at the point of use so no master or provider credential enters
    the runtime.
    """
    # Configuration chooses only the in-cluster proxy endpoint and key mount. The immutable compiled
    # snapshot remains the sole authority for the actual model alias and instructions.
    base_url = environment("OPENCRANE_RUNTIME_LITELLM_BASE_URL")
    key_path = environment("OPENCRANE_RUNTIME_LITELLM_KEY_PATH", DEFAULT_LITELLM_KEY_PATH)
    # Read the secret at point of use so it is neither retained in process configuration nor exposed in
    # candidate/checkpoint state. The key is scoped to this attempt, never a LiteLLM master key.
    attempt_key = read_attempt_litellm_key(key_path)
    model_route = compiled_input.get("model")
    model_alias = model_route.get("modelAlias") if isinstance(model_route, dict) else None
    if not isinstance(model_alias, str) or not model_alias:
        # Do not fall back to a provider/model default: that would bypass the admitted model route.
        raise RuntimeError("compiled input is missing a model alias")
    instructions = compiled_input.get("instructions")
    return build_zero_retry_agent(
        model_alias,
        base_url,
        attempt_key,
        instructions if isinstance(instructions, str) else "",
    )
