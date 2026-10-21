"""Test doubles: a scripted chat model and a fake Express API. No network, no Ollama."""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel, LanguageModelInput
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from pydantic import Field

from assistant.api_client import ApiClient
from assistant.tools import Toolbox

# Wednesday 2026-10-14 15:07:30 in Argentina (UTC-3).
NOW = datetime(2026, 10, 14, 18, 7, 30, tzinfo=UTC)
PROJECT_ID = "66f0c0ffee0123456789abcd"


SPOOL = "66f0c0ffee0123456789a001"
SPOOL_2 = "66f0c0ffee0123456789a002"


def spool_summary(material: str = "PLA", color: str = "Rojo") -> dict[str, object]:
    """The `filament` object of ProjectItem and QueueLine in packages/api-contracts/openapi.yaml."""
    return {"brand": "Grilon", "material": material, "colorName": color, "availableGrams": 800}


def spool(spool_id: str, color: str, material: str = "PLA") -> dict[str, object]:
    """A Filament of GET /filaments, with only the fields the assistant reads."""
    return {
        "id": spool_id,
        "brand": "Grilon",
        "material": material,
        "colorName": color,
        "initialGrams": 1000,
        "availableGrams": 800,
        "purchaseCostMinor": 1_500_000,
    }


def project_item(
    part_id: str,
    quantity: int,
    part: dict[str, object] | None,
    filament_id: str | None = SPOOL,
    color: str = "Rojo",
) -> dict[str, object]:
    """A ProjectItem exactly as the contract lists it (every required key, null when absent)."""
    material = "PLA" if part is None else str(part["material"])
    return {
        "partId": part_id,
        "filamentId": filament_id,
        "quantity": quantity,
        "part": part,
        "filament": None if filament_id is None else spool_summary(material, color),
    }


def queue_line(
    part_id: str,
    name: str | None,
    quantity: int,
    completed: int,
    filament_id: str | None = SPOOL,
    color: str = "Rojo",
) -> dict[str, object]:
    """A QueueLine exactly as the contract lists it (every required key, null when absent)."""
    return {
        "partId": part_id,
        "filamentId": filament_id,
        "quantity": quantity,
        "completed": completed,
        "pendingUnits": quantity - completed,
        "partName": name,
        "estimatedPrintSeconds": None if name is None else 600,
        "partDeleted": name is None,
        "filament": None if filament_id is None else spool_summary(color=color),
        "filamentDeleted": False,
    }


class ScriptedModel(BaseChatModel):
    """Replays the given AI messages in order (the last one repeats) and records what it saw."""

    script: list[AIMessage]
    seen: list[list[BaseMessage]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(
        self, tools: Sequence[object], **kwargs: object
    ) -> Runnable[LanguageModelInput, AIMessage]:
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: object,
    ) -> ChatResult:
        self.seen.append(list(messages))
        reply = self.script[min(len(self.seen), len(self.script)) - 1]
        return ChatResult(generations=[ChatGeneration(message=reply)])


def call(name: str, args: Mapping[str, object], call_id: str = "c1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": dict(args), "id": call_id}])


class FakeApi:
    """Answers by (method, path); records every request that reaches the "network"."""

    def __init__(self, routes: Mapping[tuple[str, str], httpx.Response | Exception]) -> None:
        self.requests: list[httpx.Request] = []
        self._routes = routes

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        outcome = self._routes.get((request.method, request.url.path))
        if outcome is None:
            return httpx.Response(404, json={"title": "not found"})
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def toolbox(self) -> Toolbox:
        transport = httpx.MockTransport(self.handle)
        return Toolbox(ApiClient("http://api.test", transport=transport), now=lambda: NOW)
