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
