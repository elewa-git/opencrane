"""Fixed wire, filesystem, and retry bounds for the agent-runtime process.

Values in this module are policy-relevant defaults, not mutable runtime state. Keeping them together
makes protocol-version changes, mounted-path changes, and bounded-retry changes visible in review.
Environment overrides are resolved by ``config.py`` or the owning component; this module never reads
the environment itself.
"""

# Wire identity echoed on every stream open and candidate.
# Changing this value is a protocol migration, not a cosmetic application-version change: the
# control plane uses it to decide which request and candidate shapes it can interpret.
PROTOCOL_VERSION = "opencrane.agent-runtime/v1"

# Paths fixed by the Kubernetes runtime contract. The supported path settings may override
# these defaults, but the container never falls back to an unprojected credential source.
DEFAULT_TOKEN_PATH = "/var/run/opencrane/tokens/runtime.token"
DEFAULT_CHECKPOINT_DIR = "/tmp/opencrane/checkpoints"
DEFAULT_PROOF_EVIDENCE_PATH = "/tmp/opencrane/proof-evidence.json"

# The checkpoint version guards the local optimisation format; it is unrelated to the wire protocol.
# Keep these versions separate so a replaceable local serialization can evolve without claiming a
# new server contract, and a wire migration cannot accidentally bless an incompatible checkpoint.
CHECKPOINT_VERSION = 1
CHECKPOINT_FILENAME = "checkpoint.enc"

# Resource and retry ceilings. These caps prevent an untrusted peer or unavailable control plane from
# causing unbounded buffering or reconnect loops.
# The frame bound rejects oversized lines before command decoding; transport buffering remains owned
# by the HTTP client. The terminal delay is intentionally fixed: the candidate id remains unchanged
# while only ambiguous delivery is retried, so application-level exponential work stays out of here.
MAX_FRAME_BYTES = 65_536
TERMINAL_DELIVERY_RETRY_SECONDS = 1.0
