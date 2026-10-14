"""Request and response shapes. Pydantic validates them at runtime (standard §5.2)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints


class _Strict(BaseModel):
    # Unknown fields are rejected instead of silently ignored.
    model_config = ConfigDict(extra="forbid", frozen=True)


class ChatRequest(_Strict):
    # The upper bound here is a hard ceiling; the configured limit is enforced in the route.
    message: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)
    ]


class ChatResponse(_Strict):
    reply: str


class HealthResponse(_Strict):
    status: Literal["ok"]
    provider: str
    model: str


class ErrorResponse(_Strict):
    detail: str
