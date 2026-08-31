"""Name the bounded reasons that can pause one runtime command.

The runtime can prove only that it proposed an outside action or participant input. It cannot
classify approvals, because the server decides those after checking the saved tool definition,
arguments, capabilities, and policy.
"""

from enum import Enum


class RuntimeWaitReason(str, Enum):
    """Closed runtime-owned reasons that suppress local run completion."""

    EXTERNAL_ACTION = "external_action"
    PARTICIPANT_INPUT = "participant_input"
