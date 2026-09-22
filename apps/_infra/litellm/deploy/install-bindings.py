"""Install the three reviewed bindings into the pinned vendor image at build time.

The image keeps the vendor entrypoint. Request processing belongs to the model-routing
library; this script only checks and installs its selected processor and limiter.
"""

import hashlib
import importlib.util
import json
from pathlib import Path


BINDINGS = {
    "proxy/utils.py": {
        "before": "6577a1fa135e5fd83dffeeb03de636e7847a529e6c0e1bb632e222934625879d",
        "after": "cfea9da4df409eec4cd1e301e21c536f8b858daebdb13530190ab969a8e50a61",
        "replacements": [
            (
                "            self.proxy_hook_mapping[hook] = proxy_hook_obj\n\n    def get_proxy_hook",
                "            self.proxy_hook_mapping[hook] = proxy_hook_obj\n\n"
                "        from opencrane_litellm_proxy.registration import establish_limiter_first\n\n"
                "        establish_limiter_first(self)\n\n    def get_proxy_hook",
            ),
        ],
    },
    "proxy/hooks/__init__.py": {
        "before": "f250200db1a3ff19b576ca9e4630c82bd99d2e60f0273b4f851073534fd06a4b",
        "after": "3f842939642ac33cc42854041161464d564e8e683774bf8cd69042162608cd08",
        "replacements": [
            (
                "from .responses_id_security import ResponsesIDSecurity\n",
                "from .responses_id_security import ResponsesIDSecurity\n"
                "from opencrane_litellm_proxy.limiter import ReceiptLimiter\n",
            ),
            (
                "PROXY_HOOKS = {\n"
                '    "max_budget_limiter": _PROXY_MaxBudgetLimiter,\n'
                '    "parallel_request_limiter": _PROXY_MaxParallelRequestsHandler_v3,',
                "PROXY_HOOKS = {\n"
                '    "parallel_request_limiter": ReceiptLimiter,\n'
                '    "max_budget_limiter": _PROXY_MaxBudgetLimiter,',
            ),
            (
                "PROXY_HOOKS.update(ENTERPRISE_PROXY_HOOKS)\n",
                "PROXY_HOOKS.update(ENTERPRISE_PROXY_HOOKS)\n\n"
                'if PROXY_HOOKS["parallel_request_limiter"] is not ReceiptLimiter or next(iter(PROXY_HOOKS)) != "parallel_request_limiter":\n'
                '    raise RuntimeError("Unqualified LiteLLM hook configuration")\n',
            ),
        ],
    },
    "proxy/proxy_server.py": {
        "before": "f5669121942b35ff400e5be0b85b611b11da6a3ee9cbab62c24c1d032dd4e428",
        "after": "a2b884240935b9866359c0a08278ae43765728b241ee924537cf028dbb458dfd",
        "replacements": [
            (
                "from litellm.proxy.common_request_processing import (\n"
                "    ProxyBaseLLMRequestProcessing,\n"
                "    create_response,\n"
                ")\n",
                "from litellm.proxy.common_request_processing import create_response\n"
                "from opencrane_litellm_proxy.processor import ReceiptProcessor as ProxyBaseLLMRequestProcessing\n",
            ),
        ],
    },
}


def replace_verified(source, binding):
    """Reject changed vendor bytes or ambiguous replacement locations before returning new bytes."""
    if hashlib.sha256(source).hexdigest() != binding["before"]:
        raise ValueError("Vendor binding preimage differs from the reviewed source")
    text = source.decode("utf-8")
    for before, after in binding["replacements"]:
        if text.count(before) != 1:
            raise ValueError("Vendor binding replacement must match exactly once")
        text = text.replace(before, after, 1)
    result = text.encode("utf-8")
    if hashlib.sha256(result).hexdigest() != binding["after"]:
        raise ValueError("Vendor binding postimage differs from the reviewed source")
    return result


def install_bindings(package_root, receipt_path):
    """Validate every source file before changing any; a failed build cannot yield an image."""
    replacements = []
    for relative, binding in BINDINGS.items():
        path = package_root / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError("Vendor binding must be a regular source file")
        replacements.append((path, replace_verified(path.read_bytes(), binding)))
    for path, source in replacements:
        path.write_bytes(source)
    receipt_path.write_text(json.dumps({
        "schema": 1,
        "bindings": {relative: binding["after"] for relative, binding in BINDINGS.items()},
    }, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    specification = importlib.util.find_spec("litellm")
    if specification is None or specification.origin is None:
        raise RuntimeError("The pinned LiteLLM package must already be installed")
    install_bindings(Path(specification.origin).resolve().parent, Path(__file__).with_name("bindings.json"))
