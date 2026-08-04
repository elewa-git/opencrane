"""Fixed wire, filesystem, and retry bounds for the agent-runtime process.

Values in this module are policy-relevant defaults, not mutable runtime state. Keeping them together
makes protocol-version changes, mounted-path changes, and bounded-retry changes visible in review.
Environment overrides are resolved by ``config.py`` or the owning component; this module never reads
the environment itself.
"""

# Wire identity echoed on every stream open and candidate.
PROTOCOL_VERSION = "opencrane.agent-runtime/v1"

# Paths fixed by the Kubernetes Job projection contract. The supported path settings may override
# these defaults, but the container never falls back to an unprojected credential source.
DEFAULT_TOKEN_PATH = "/var/run/opencrane/tokens/runtime.token"
DEFAULT_BOOTSTRAP_PATH = "/var/run/opencrane/bootstrap/reference"
DEFAULT_LITELLM_KEY_PATH = "/var/run/opencrane/litellm/key"
DEFAULT_CHECKPOINT_DIR = "/tmp/opencrane/checkpoints"

# The checkpoint version guards the local optimisation format; it is unrelated to the wire protocol.
CHECKPOINT_VERSION = 1
CHECKPOINT_FILENAME = "checkpoint.enc"

# Resource and retry ceilings. These caps prevent an untrusted peer or unavailable control plane from
# causing unbounded buffering or server-selected sleeps.
MAX_FRAME_BYTES = 65_536
MAX_CANDIDATE_RETRY_DELAY_SECONDS = 30.0
TERMINAL_DELIVERY_RETRY_SECONDS = 1.0

# Hard timeout for one direct approved tool invocation against Obot's MCP proxy.
OBOT_INVOCATION_TIMEOUT_SECONDS = 30.0
