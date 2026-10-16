"""Request and response shapes. Pydantic validates them at runtime (standard §5.2)."""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
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


class Proposal(_Strict):
    """A suggested action, built by code from validated tool arguments, never from model text."""

    kind: Literal["create_project"]
    payload: ProposalPayload
    itemNames: list[ProposalItemName]


class ChatResponse(_Strict):
    reply: str
    proposal: Proposal | None = None


class HealthResponse(_Strict):
    status: Literal["ok"]
    provider: str
    model: str


class ErrorResponse(_Strict):
    detail: str
