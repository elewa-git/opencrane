"""Count real proxy dispatches and verify the installed no-forward producer.

Normal execution checks the derived image's actual imports. The explicit local
source fixture uses the repository's producer and a configuration-only singleton;
it emits a different marker and never qualifies an image or endpoint authentication.
No Router, limiter, or processor method is replaced by this test.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import importlib.metadata
import importlib.util
import json
import logging
import os
from pathlib import Path
import signal
import sys
import tempfile
import types
import unittest


signal.signal(signal.SIGALRM, lambda _signal, _frame: os._exit(124))
signal.alarm(120)
arguments = argparse.ArgumentParser()
arguments.add_argument("--source-fixture", action="store_true")
options = arguments.parse_args()
NETWORK_ATTEMPTS = []


def deny_network(event, args):
    """Block network attempts before importing any proxy or provider dependency."""
    if (event == "socket.__new__" and args[1] in (2, 10)) or event in (
        "socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg",
    ):
        NETWORK_ATTEMPTS.append(event)
        raise RuntimeError("Network disabled in the pre-forward contract")


sys.addaudithook(deny_network)
for name in list(os.environ):
    if name.startswith(("OPENAI_", "ANTHROPIC_", "LITELLM_", "AZURE_", "AWS_", "GOOGLE_")):
        del os.environ[name]
CACHE = tempfile.TemporaryDirectory(prefix="opencrane-preforward-contract-", dir="/tmp")
os.environ.update({
    "LITELLM_LOCAL_MODEL_COST_MAP": "True", "LITELLM_MODE": "PRODUCTION", "DO_NOT_TRACK": "1",
    "HF_HUB_OFFLINE": "1", "TIKTOKEN_CACHE_DIR": CACHE.name,
})
if importlib.metadata.version("litellm") != "1.81.0" or importlib.metadata.version("openai") != "2.9.0":
    raise RuntimeError("This contract requires LiteLLM 1.81.0 and OpenAI SDK 2.9.0")
spec = importlib.util.find_spec("litellm")
if spec is None or spec.origin is None:
    raise RuntimeError("The pinned LiteLLM package must be installed")
PACKAGE_ROOT = Path(spec.origin).resolve().parent
SOURCE_HASHES = {
    "router.py": "d24726b2f9a0e39d15d0289c2aa121c97c8f5b5441cc14dbf825c6f94f22f78a",
    "proxy/common_request_processing.py": "bd2c0319395ec1befc2dc434a6117f11363e0d45ef4cf638eadf9f4eb0ca85cf",
    "proxy/utils.py": "cfea9da4df409eec4cd1e301e21c536f8b858daebdb13530190ab969a8e50a61",
    "proxy/hooks/parallel_request_limiter_v3.py": "a0b2a474822112505965e02b0a898eb340f25156e4d652ce3a4b9288895fdd88",
    "proxy/litellm_pre_call_utils.py": "477019b09aeb56ae0bc4b2daa70c7f5a28df30ea96a20ced4efb45e5b8b66847",
    "proxy/route_llm_request.py": "9318fdd63f319a4d6ca98e3eac85cab48837be51bcfdbfeddd591dd5eb6d6cf0",
    "proxy/hooks/__init__.py": "3f842939642ac33cc42854041161464d564e8e683774bf8cd69042162608cd08",
    "proxy/proxy_server.py": "a2b884240935b9866359c0a08278ae43765728b241ee924537cf028dbb458dfd",
    "litellm_core_utils/logging_callback_manager.py": "0add130c99765a60ceea3f7bd72899216dd83d162e8efd42ef49ca44f265c1d1",
}
for source, expected in SOURCE_HASHES.items():
    if hashlib.sha256((PACKAGE_ROOT / source).read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"Unqualified proxy source: {source}")

if options.source_fixture:
    source_root = Path(__file__).resolve().parents[4] / "libs/backend/server/gateways/model-routing/main/src/proxy"
    producer_spec = importlib.util.spec_from_file_location(
        "opencrane_litellm_proxy", source_root / "__init__.py", submodule_search_locations=[str(source_root)],
    )
    producer_package = importlib.util.module_from_spec(producer_spec)
    sys.modules[producer_spec.name] = producer_package
    producer_spec.loader.exec_module(producer_package)
    configuration = types.ModuleType("litellm.proxy.proxy_server")
    sys.modules[configuration.__name__] = configuration

import httpx
import litellm
import openai
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from litellm import DualCache, Router
from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy._types import ProxyException, UserAPIKeyAuth

if not options.source_fixture:
    # Preserve the image's real route and hook selection; never install bindings here.
    from litellm.proxy import proxy_server as configuration

from opencrane_litellm_proxy.context import CONTRACT_HEADER, CONTRACT_VERSION, DEADLINE_HEADER, FENCE_HEADER, KEY_DOMAIN, MESSAGE_DOMAIN, NONCE_HEADER, RECEIPT_HEADER
from opencrane_litellm_proxy.processor import ReceiptProcessor
from opencrane_litellm_proxy.limiter import ReceiptLimiter
from litellm.proxy.hooks import PROXY_HOOKS
from litellm.proxy.hooks.model_max_budget_limiter import _PROXY_VirtualKeyModelMaxBudgetLimiter
from litellm.proxy.utils import ProxyLogging

if not options.source_fixture:
    if configuration.ProxyBaseLLMRequestProcessing is not ReceiptProcessor:
        raise RuntimeError("The real proxy route did not select the owned processor")
    if next(iter(PROXY_HOOKS)) != "parallel_request_limiter" or PROXY_HOOKS["parallel_request_limiter"] is not ReceiptLimiter:
        raise RuntimeError("The real proxy hooks did not select the owned limiter first")
else:
    # The explicit source fixture reproduces the import-time callback with its real class.
    # Only default execution imports the complete image's real authenticated route.
    configuration.model_max_budget_limiter = _PROXY_VirtualKeyModelMaxBudgetLimiter(DualCache())
    litellm.logging_callback_manager.add_litellm_callback(configuration.model_max_budget_limiter)

STARTUP_CALLBACKS = tuple(litellm.callbacks)
if configuration.model_max_budget_limiter not in STARTUP_CALLBACKS:
    raise RuntimeError("The actual import-time model budget safeguard must be present")

litellm.telemetry = False
litellm.set_verbose = False
logging.disable(logging.CRITICAL)
KEY = "sk-synthetic-attempt-key-not-a-credential"
KEY_ALIAS = "attempt-synthetic-proof-1"
NOW = datetime.now(timezone.utc)
NOW_MS = int(NOW.timestamp() * 1000)
GUARDS = {"num_retries": 0, "max_retries": 0, "disable_fallbacks": True}
EVIDENCE = []


class SpoofAfterFailure(CustomLogger):
    async def async_post_call_failure_hook(self, request_data, original_exception, user_api_key_dict):
        return HTTPException(429, {"receipt": {"version": CONTRACT_VERSION}}, headers={RECEIPT_HEADER: "0" * 64})


class DispatchThenReenterLimiter(CustomLogger):
    """Exercise a real prior dispatch before a second call to the owned limiter."""

    def __init__(self, limiter):
        self.limiter = limiter

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        try:
            await data["client"].with_options(max_retries=0).chat.completions.create(
                model="gpt-4o-mini", messages=[{"role": "user", "content": "Synthetic prior dispatch"}],
            )
        except openai.APIStatusError:
            pass
        user_api_key_dict.rpm_limit = 0
        await self.limiter.async_pre_call_hook(user_api_key_dict, cache, data, call_type)


class ProducerContract(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, *, limited=False, spoof_hook=False, provider_status=429, nonce="a" * 64,
                       auth_mismatch=False, deadline=NOW_MS + 25_000, preceding_hook=False, reenter=False, budget_exceeded=False):
        calls = []
        litellm.callbacks = list(STARTUP_CALLBACKS)

        async def provider(request):
            calls.append(request)
            self.assertEqual(request.url.host, "provider.invalid")
            self.assertEqual(request.headers["authorization"], "Bearer synthetic-provider-key")
            self.assertNotIn(KEY, request.content.decode())
            self.assertTrue(all(not name.startswith("x-opencrane-") for name in request.headers))
            content = {"error": {"message": "synthetic failure", "type": "synthetic"}}
            if provider_status == 200:
                content = {
                    "id": "synthetic-chat", "object": "chat.completion", "created": 1, "model": "gpt-4o-mini",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Synthetic response"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
            return httpx.Response(provider_status, json=content, headers={RECEIPT_HEADER: "0" * 64}, request=request)

        client = openai.AsyncOpenAI(
            api_key="synthetic-provider-key", base_url="https://provider.invalid/v1",
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(provider), trust_env=False),
        )
        router = Router(model_list=[{"model_name": "primary", "litellm_params": {
            "model": "openai/gpt-4o-mini", "api_key": "synthetic-provider-key", "api_base": "https://provider.invalid/v1",
        }}])
        # Only runtime configuration is supplied in memory; no route or method is replaced.
        configuration.llm_router = router
        configuration.premium_user = False
        configuration.prisma_client = None
        configuration.open_telemetry_logger = None
        configuration.shared_aiohttp_session = None
        configuration.general_settings = {}
        proxy_logging = ProxyLogging(user_api_key_cache=DualCache())
        before_registration = tuple(litellm.callbacks)
        # Execute the real pinned startup traversal, including the installed registration binding.
        proxy_logging._init_litellm_callbacks(router)
        limiter = proxy_logging.get_proxy_hook("parallel_request_limiter")
        self.assertIs(type(limiter), ReceiptLimiter)
        self.assertIs(litellm.callbacks[0], limiter)
        self.assertEqual([callback for callback in litellm.callbacks if callback in before_registration], list(before_registration))
        # The pinned manager retains an existing logger with the same class and public scalar
        # settings instead of adding the new mapped instance. Check that registered key, while
        # the preceding assertion still requires every earlier instance in its original order.
        manager = litellm.logging_callback_manager
        registered_keys = [manager._get_custom_logger_key(callback) for callback in litellm.callbacks if isinstance(callback, CustomLogger)]
        for callback in [*proxy_logging.proxy_hook_mapping.values(), proxy_logging.service_logging_obj]:
            self.assertIn(manager._get_custom_logger_key(callback), registered_keys)
        self.assertIn(configuration.model_max_budget_limiter, litellm.callbacks)
        # The original limiter exposes this clock dependency; no limiter method is replaced.
        limiter._time_provider = lambda: NOW
        if preceding_hook:
            litellm.callbacks.insert(0, SpoofAfterFailure())
        if spoof_hook:
            litellm.callbacks.append(SpoofAfterFailure())
        if reenter:
            litellm.callbacks.append(DispatchThenReenterLimiter(limiter))
        key_hash = hashlib.sha256(KEY.encode()).hexdigest()
        # This fixture has the same type and fields as the authenticated route result.
        # It does not prove the route's authentication, database lookup, or revocation checks.
        auth = UserAPIKeyAuth(
            api_key="wrong" if auth_mismatch else key_hash, models=["primary"], key_alias=KEY_ALIAS,
            metadata={"opencrane_scope": "agent-runtime-attempt", "opencrane_key_alias": KEY_ALIAS},
            rpm_limit=1 if limited else None,
        )
        if limited:
            for suffix, value in (("window", int(NOW.timestamp()) - 59), ("requests", 2)):
                await proxy_logging.internal_usage_cache.async_set_cache(
                    key=f"{{api_key:{auth.api_key}}}:{suffix}", value=value,
                    ttl=60, litellm_parent_otel_span=None, local_only=True,
                )
        if budget_exceeded:
            await proxy_logging.call_details["user_api_key_cache"].async_set_cache(
                key="None_user_api_key_user_id", value={"max_budget": 1, "spend": 2},
            )
        body = {
            "model": "primary", "messages": [{"role": "user", "content": "Synthetic request"}],
            "max_tokens": 10, "n": 1, "stream": False, **GUARDS,
        }
        raw = json.dumps(body, separators=(",", ":")).encode()
        request = Request({
            "type": "http", "method": "POST", "scheme": "http", "server": ("proxy.invalid", 80),
            "path": "/v1/chat/completions", "query_string": b"", "headers": [
                (b"authorization", f"Bearer {KEY}".encode()),
                (CONTRACT_HEADER.encode(), CONTRACT_VERSION.encode()),
                (NONCE_HEADER.encode(), nonce.encode()), (FENCE_HEADER.encode(), b"b" * 64),
                (DEADLINE_HEADER.encode(), str(deadline).encode()), (RECEIPT_HEADER.encode(), b"0" * 64),
            ],
        })
        request._body = raw
        processor = ReceiptProcessor({**body, "client": client})
        response = Response()
        try:
            try:
                result = await processor.base_process_llm_request(
                    request=request, fastapi_response=response, user_api_key_dict=auth,
                    route_type="acompletion", proxy_logging_obj=proxy_logging, general_settings={},
                    proxy_config=None, llm_router=router,
                )
            except Exception as error:
                try:
                    await processor._handle_llm_api_exception(e=error, user_api_key_dict=auth, proxy_logging_obj=proxy_logging)
                except (ProxyException, HTTPException) as rendered:
                    result = rendered
            self.assertEqual(NETWORK_ATTEMPTS, [])
            self.assertNotIn(RECEIPT_HEADER, response.headers)
            return result, calls, raw
        finally:
            router.reset()
            await client.close()

    async def test_real_local_limiter_receipt(self):
        result, calls, raw = await self.exercise(limited=True)
        self.assertIsInstance(result, JSONResponse)
        self.assertEqual(len(calls), 0)
        self.assertEqual(result.headers["content-type"], "application/json")
        self.assertLessEqual(len(result.body), 2048)
        receipt = json.loads(result.body)["receipt"]
        self.assertEqual(receipt["requestBodySha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt["retryAtEpochMs"], (int(NOW.timestamp()) + 1) * 1000)
        derived = hmac.new(KEY.encode(), KEY_DOMAIN, hashlib.sha256).digest()

        def mac_for(value, key=derived):
            canonical = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
            return hmac.new(key, MESSAGE_DOMAIN + canonical, hashlib.sha256).hexdigest()

        self.assertTrue(hmac.compare_digest(result.headers[RECEIPT_HEADER], mac_for(receipt)))
        EVIDENCE.append({"name": "local-limiter", "providerCalls": 0, "verifiedReceipt": True})
        for field, changed in (
            ("physicalNonce", "c" * 64), ("logicalFence", "c" * 64), ("requestBodySha256", "c" * 64),
            ("deadlineEpochMs", NOW_MS + 26_000), ("retryAtEpochMs", NOW_MS + 2000), ("version", "unknown"),
        ):
            self.assertFalse(hmac.compare_digest(result.headers[RECEIPT_HEADER], mac_for({**receipt, field: changed})))
            EVIDENCE.append({"name": f"tampered-{field}", "providerCalls": 0, "verifiedReceipt": False})
        self.assertFalse(hmac.compare_digest(result.headers[RECEIPT_HEADER], mac_for(receipt, b"wrong-key")))
        EVIDENCE.append({"name": "wrong-mac-key", "providerCalls": 0, "verifiedReceipt": False})

    async def test_provider_and_postcall_spoofs(self):
        for spoof in (False, True):
            result, calls, _ = await self.exercise(spoof_hook=spoof)
            self.assertEqual(len(calls), 1)
            self.assertNotIn(RECEIPT_HEADER, result.headers or {})
            EVIDENCE.append({"name": f"postcall-spoof-{str(spoof).lower()}", "providerCalls": 1, "verifiedReceipt": False})

    async def test_provider_success_and_server_error(self):
        for status in (200, 500, 418):
            result, calls, _ = await self.exercise(provider_status=status)
            self.assertEqual(len(calls), 1)
            if status == 200:
                self.assertEqual(result.choices[0].message.content, "Synthetic response")
            else:
                self.assertNotIn(RECEIPT_HEADER, result.headers or {})
            EVIDENCE.append({"name": f"provider-{status}", "providerCalls": 1, "verifiedReceipt": False})

    async def test_limiter_reentry_after_dispatch(self):
        result, calls, _ = await self.exercise(reenter=True)
        self.assertEqual(len(calls), 1)
        self.assertNotIn(RECEIPT_HEADER, result.headers or {})
        EVIDENCE.append({"name": "limiter-reentry-after-dispatch", "providerCalls": 1, "verifiedReceipt": False})

    async def test_unknown_coordinates_fail_closed(self):
        for inputs in ({"nonce": "invalid"}, {"auth_mismatch": True}, {"deadline": NOW_MS + 1}, {"preceding_hook": True}):
            result, calls, _ = await self.exercise(limited=True, **inputs)
            self.assertEqual(len(calls), 0)
            self.assertNotIn(RECEIPT_HEADER, result.headers or {})
            EVIDENCE.append({"name": next(iter(inputs)), "providerCalls": 0, "verifiedReceipt": False})

    async def test_existing_budget_hook_still_rejects_without_receipt(self):
        result, calls, _ = await self.exercise(budget_exceeded=True)
        self.assertEqual(len(calls), 0)
        self.assertNotIn(RECEIPT_HEADER, result.headers or {})


def load_tests(loader, tests, pattern):
    """Require the producer's own unit contracts in the same isolated runtime."""
    for module in ("test_context", "test_limiter", "test_processor", "test_registration"):
        tests.addTests(loader.loadTestsFromName("opencrane_litellm_proxy.tests." + module))
    return tests


if __name__ == "__main__":
    result = unittest.main(argv=[sys.argv[0]], verbosity=2, exit=False).result
    CACHE.cleanup()
    if not result.wasSuccessful() or len(EVIDENCE) != 18 or NETWORK_ATTEMPTS:
        sys.exit(1)
    marker = "OPENCRANE_LITELLM_PREFORWARD_SOURCE_V1=" if options.source_fixture else "OPENCRANE_LITELLM_PREFORWARD_CONTRACT_V1="
    receipt = {"schema": 1, "contract": CONTRACT_VERSION, "cases": sorted(EVIDENCE, key=lambda item: item["name"]), "networkAttempts": 0}
    print(marker + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
