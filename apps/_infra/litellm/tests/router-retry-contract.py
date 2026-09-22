"""Count provider requests through the pinned Router, adapter, and OpenAI SDK.

Only the provider transport is fake. These tests do not replace Router methods
or copy its retry logic. The negative cases show why the request controls do not
protect against arbitrary deployment settings or a shared Router retry policy.
This is not a running-proxy or real-provider qualification.

The source checks bind this proof to the exact upstream implementation:
https://github.com/BerriAI/litellm/tree/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm
"""

import hashlib
import importlib.metadata
import importlib.util
import json
import logging
import os
from pathlib import Path
import signal
import sys
import tempfile
from types import MappingProxyType
import unittest


# End the test process even if dependency startup hangs or its container client exits.
signal.signal(signal.SIGALRM, lambda _signal, _frame: os._exit(124))
signal.alarm(120)

UPSTREAM_COMMIT = "790a5ce0b323c1eefa70c2df25b2780097aa3f80"
EXPECTED_LITELLM_VERSION = "1.81.0"
EXPECTED_OPENAI_VERSION = "2.9.0"
EXPECTED_SOURCES = {
    "router.py": "d24726b2f9a0e39d15d0289c2aa121c97c8f5b5441cc14dbf825c6f94f22f78a",
    "main.py": "09be8c796fa5acce184d2bd4e149e3b8d1ae509c8cb303fbf3c329d5cc03c0ef",
    "llms/openai/openai.py": "d9b62f0b5b6d300d036abb2fb69b117dd0e589aee9f92c05b1ece6b0fd82e998",
    "router_utils/get_retry_from_policy.py": "443a13ce5effe9a31aaa4bf13781710a2de6d35f8b91bdb4e220c93b01705a9c",
}
NETWORK_ATTEMPTS = []
GUARDS = MappingProxyType({
    "num_retries": 0,
    "max_retries": 0,
    "disable_fallbacks": True,
})
SYNTHETIC_KEY = "synthetic-not-a-credential"
EVIDENCE = []


def deny_network(event, args):
    """Reject network attempts, including attempts made while dependencies import."""
    creates_network_socket = event == "socket.__new__" and args[1] in (2, 10)
    if creates_network_socket or event in (
        "socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg",
    ):
        NETWORK_ATTEMPTS.append(event)
        raise RuntimeError("Network disabled in the counted-provider contract")


sys.addaudithook(deny_network)

# Ignore ambient provider settings. Every test supplies the same synthetic key.
for key in list(os.environ):
    if key.startswith(("OPENAI_", "ANTHROPIC_", "LITELLM_", "AZURE_", "AWS_", "GOOGLE_")):
        del os.environ[key]
CACHE = tempfile.TemporaryDirectory(prefix="opencrane-litellm-contract-", dir="/tmp")
os.environ.update({
    "LITELLM_LOCAL_MODEL_COST_MAP": "True",
    "LITELLM_MODE": "PRODUCTION",
    "DO_NOT_TRACK": "1",
    "HF_HUB_OFFLINE": "1",
    "TIKTOKEN_CACHE_DIR": CACHE.name,
})

package_spec = importlib.util.find_spec("litellm")
if package_spec is None or package_spec.origin is None:
    raise RuntimeError("The pinned LiteLLM package must already be installed")
PACKAGE_ROOT = Path(package_spec.origin).resolve().parent
LITELLM_VERSION = importlib.metadata.version("litellm")
if LITELLM_VERSION != EXPECTED_LITELLM_VERSION:
    raise RuntimeError("The counted-provider contract requires LiteLLM 1.81.0")
for relative_path, expected_hash in EXPECTED_SOURCES.items():
    actual_hash = hashlib.sha256((PACKAGE_ROOT / relative_path).read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        raise RuntimeError(f"Unqualified LiteLLM source: {relative_path}: {actual_hash}")
if importlib.metadata.version("openai") != EXPECTED_OPENAI_VERSION:
    raise RuntimeError("The counted-provider contract requires OpenAI SDK 2.9.0")

import httpx
import openai
import litellm
from litellm import Router
from litellm.types.router import RetryPolicy

if Path(litellm.__file__).resolve().parent != PACKAGE_ROOT:
    raise RuntimeError("Imported LiteLLM differs from the checked source")
if openai.__version__ != EXPECTED_OPENAI_VERSION:
    raise RuntimeError("Imported OpenAI SDK differs from the checked version")
litellm.telemetry = False
litellm.set_verbose = False
logging.disable(logging.CRITICAL)


class RouterRetryContract(unittest.IsolatedAsyncioTestCase):
    """Check dispatch counts without contacting a provider or changing Router code."""

    async def counted(self, name, failure, expected_calls, guards, *,
                      deployment_retries=None, retry_policy=None, fallback=False,
                      expected_sdk_retries=0, expected_router_dispatches=None):
        """Run one real Router call and retain evidence only after every check passes."""
        calls = []

        async def provider(request):
            self.assertEqual(request.url.host, "provider.invalid")
            self.assertEqual(request.url.path, "/v1/chat/completions")
            self.assertEqual(request.headers["authorization"], f"Bearer {SYNTHETIC_KEY}")
            payload = json.loads(request.content)
            self.assertTrue({
                "num_retries", "max_retries", "disable_fallbacks", "fallbacks", "retry_policy",
            }.isdisjoint(payload), "Proxy retry controls must not become provider request fields")
            calls.append(payload)
            if failure == "timeout":
                raise httpx.ReadTimeout("synthetic timeout", request=request)
            if failure == "transport":
                raise httpx.ConnectError("synthetic connection loss", request=request)
            return httpx.Response(failure, request=request, json={
                "error": {"message": "synthetic failure", "type": "synthetic", "code": str(failure)},
            })

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(provider), trust_env=False)
        client = openai.AsyncOpenAI(
            api_key=SYNTHETIC_KEY, base_url="https://provider.invalid/v1", http_client=http_client,
        )
        params = {
            "model": "openai/gpt-4o-mini", "api_key": SYNTHETIC_KEY,
            "api_base": "https://provider.invalid/v1",
        }
        if deployment_retries is not None:
            params["num_retries"] = deployment_retries
        models = [{"model_name": "primary", "litellm_params": params}]
        options = {}
        if retry_policy is not None:
            options["retry_policy"] = retry_policy
        if fallback:
            models.append({
                "model_name": "fallback", "litellm_params": {**params, "model": "openai/gpt-4o"},
            })
            options["fallbacks"] = [{"primary": ["fallback"]}]
        router = Router(model_list=models, **options)
        try:
            expected_error = {
                429: litellm.RateLimitError, 500: litellm.InternalServerError,
                "timeout": litellm.Timeout, "transport": litellm.InternalServerError,
            }[failure]
            with self.assertRaises(expected_error):
                await router.acompletion(
                    model="primary", messages=[{"role": "user", "content": "Count this synthetic request."}],
                    client=client, **guards,
                )
            self.assertEqual(router.num_retries, 2)
            self.assertEqual(len(calls), expected_calls)
            self.assertEqual(client.max_retries, expected_sdk_retries)
            self.assertEqual(
                sum(router.total_calls.values()),
                expected_calls if expected_router_dispatches is None else expected_router_dispatches,
            )
            expected_models = ["gpt-4o-mini"] * expected_calls
            if fallback and not guards.get("disable_fallbacks", False):
                expected_models[-1] = "gpt-4o"
            self.assertEqual([call["model"] for call in calls], expected_models)
            self.assertEqual(NETWORK_ATTEMPTS, [], "A test or import attempted network I/O")
            EVIDENCE.append({"name": name, "dispatches": len(calls)})
        finally:
            router.reset()
            await client.close()

    async def test_guarded_failures(self):
        for failure in (429, 500, "timeout", "transport"):
            with self.subTest(failure=failure):
                await self.counted(f"guarded-{failure}", failure, 1, GUARDS)

    async def test_current_defaults(self):
        for failure in (429, 500, "timeout", "transport"):
            with self.subTest(failure=failure):
                await self.counted(f"defaults-{failure}", failure, 3, {})

    async def test_deployment_retry_override(self):
        # The pinned deployment override enables one SDK retry and one Router retry.
        for failure in (429, 500, "timeout", "transport"):
            with self.subTest(failure=failure):
                await self.counted(
                    f"deployment-override-{failure}", failure, 4, GUARDS,
                    deployment_retries=1, expected_sdk_retries=1, expected_router_dispatches=2,
                )

    async def test_retry_policy_override(self):
        policy = RetryPolicy(RateLimitErrorRetries=1, InternalServerErrorRetries=1, TimeoutErrorRetries=1)
        # The pinned mapper does not implement its declared InternalServerErrorRetries field.
        for failure, expected_calls in ((429, 2), (500, 1), ("timeout", 2)):
            with self.subTest(failure=failure):
                await self.counted(
                    f"retry-policy-{failure}", failure, expected_calls, GUARDS, retry_policy=policy,
                )

    async def test_explicit_fallback_suppression(self):
        await self.counted("fallback-guarded", 500, 1, GUARDS, fallback=True)

    async def test_configured_fallback_without_guard(self):
        await self.counted("fallback-enabled", 500, 2, {"num_retries": 0, "max_retries": 0}, fallback=True)


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False).result
    CACHE.cleanup()
    if not result.wasSuccessful() or len(EVIDENCE) != 17 or NETWORK_ATTEMPTS:
        sys.exit(1)
    receipt = {
        "schema": 1,
        "routerSha256": EXPECTED_SOURCES["router.py"],
        "upstreamCommit": UPSTREAM_COMMIT,
        "litellmVersion": LITELLM_VERSION,
        "openaiVersion": openai.__version__,
        "cases": sorted(EVIDENCE, key=lambda case: case["name"]),
        "networkAttempts": 0,
    }
    print("OPENCRANE_LITELLM_RETRY_CONTRACT_V1=" + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
