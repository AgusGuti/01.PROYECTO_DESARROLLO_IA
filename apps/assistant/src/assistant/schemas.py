"""Request and response shapes. Pydantic validates them at runtime (standard §5.2)."""

import re
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StringConstraints,
    model_serializer,
)


class _Strict(BaseModel):
    # Unknown fields are rejected instead of silently ignored.
    model_config = ConfigDict(extra="forbid", frozen=True)


class ChatRequest(_Strict):
    # The upper bound here is a hard ceiling; the configured limit is enforced in the route.
    message: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)
    ]


class ProposalItem(_Strict):
    partId: str
    quantity: int


class ProposalPayload(_Strict):
    """The body of POST /api/v1/projects; absent optionals are omitted, never sent as null."""

    name: str
    description: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    deadline: str | None = None
    items: list[ProposalItem] | None = None

    @model_serializer(mode="wrap")
    def _omit_none(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        return {key: value for key, value in handler(self).items() if value is not None}


class ProposalItemName(_Strict):
    partId: str
    name: str


class CreateProjectProposal(_Strict):
    """A suggested action, built by code from validated tool arguments, never from model text."""

    kind: Literal["create_project"]
    payload: ProposalPayload
    itemNames: list[ProposalItemName]


class QueuePayload(_Strict):
    """The body of POST /api/v1/queues without `lines` (the API copies the project lines)."""

    projectId: str
    goal: Literal["deadline", "fastest", "minimal_idle"]
    mode: Literal["single", "multi"]
    printerIds: list[str]


class PrinterName(_Strict):
    printerId: str
    name: str


class CreateQueueProposal(_Strict):
    kind: Literal["create_queue"]
    payload: QueuePayload
    projectName: str
    printerNames: list[PrinterName]


class ProgressLine(_Strict):
    partId: str
    quantity: int
    completed: int


class ProgressPayload(_Strict):
    """The body of PATCH /api/v1/queues/{projectId}: the version seen and ALL the lines."""

    projectId: str
    version: int
    lines: list[ProgressLine]


class UpdateQueueProgressProposal(_Strict):
    kind: Literal["update_queue_progress"]
    payload: ProgressPayload
    projectName: str
    lineNames: list[ProposalItemName]


Material = Literal[
    "PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "HIPS", "PVA", "PP", "PLA_CF", "PETG_CF",
    "PA_CF", "PA_GF",
]  # fmt: skip

_BAD_FOLDER_CHARS = re.compile(r"[\x00-\x1f\x7f<>:\"|?*]")


def _safe_folder(value: str) -> str:
    """A relative sub-folder of GCODE_ROOT. The MCP server checks containment again."""
    if _BAD_FOLDER_CHARS.search(value) or value[0] in "/\\":
        raise ValueError("folder must be a relative path")
    if ".." in re.split(r"[/\\]", value):
        raise ValueError("folder must stay inside the G-code folder")
    return value


Folder = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(_safe_folder),
]


class GcodeImportPayload(_Strict):
    """Body of POST /gcode-imports and of the proposal: one material per batch (ADR 0035)."""

    material: Material
    folder: Folder | None = None

    @model_serializer(mode="wrap")
    def _omit_none(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        return {key: value for key, value in handler(self).items() if value is not None}


class ImportGcodesProposal(_Strict):
    kind: Literal["import_gcodes"]
    payload: GcodeImportPayload


class GcodeImportResult(_Strict):
    created: int
    updated: int
    unchanged: int
    skipped: int
    errors: int


Proposal = Annotated[
    CreateProjectProposal
    | CreateQueueProposal
    | UpdateQueueProgressProposal
    | ImportGcodesProposal,
    Field(discriminator="kind"),
]


class ChatResponse(_Strict):
    reply: str
    proposal: Proposal | None = None


class HealthResponse(_Strict):
    status: Literal["ok"]
    provider: str
    model: str


class ErrorResponse(_Strict):
    detail: str
