"""API tests with the language model faked, so they are fast and deterministic."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatResult

from assistant.config import Settings, get_settings
from assistant.main import create_app, get_chat_model
from fakes import ScriptedModel


def reply(text: str) -> ScriptedModel:
    return ScriptedModel(script=[AIMessage(content=text)])


class BrokenChatModel(ScriptedModel):
    """A model whose provider is down."""

    def _generate(self, messages: list[BaseMessage], *args: object, **kwargs: object) -> ChatResult:
        raise ConnectionError("connect ECONNREFUSED internal-ollama-host:11434")


def client_with(model: BaseChatModel, max_message_chars: int = 2000) -> TestClient:
    settings = Settings(_env_file=None, max_message_chars=max_message_chars)
    app = create_app()
    app.dependency_overrides[get_chat_model] = lambda: model
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with client_with(reply("Hola, ¿en qué te ayudo?")) as test_client:
        yield test_client


def test_health_reports_the_configured_model(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "provider": "ollama", "model": "qwen3:8b"}


def test_chat_returns_the_model_reply(client: TestClient) -> None:
    response = client.post("/chat", json={"message": "Hola"})

    assert response.status_code == 200
    assert response.json() == {"reply": "Hola, ¿en qué te ayudo?", "proposal": None}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"message": ""},
        {"message": "   "},
        {"message": 42},
        {"message": "hola", "role": "system"},
    ],
)
def test_chat_rejects_invalid_input(client: TestClient, body: dict[str, object]) -> None:
    response = client.post("/chat", json=body)

    assert response.status_code == 422


def test_chat_rejects_a_message_over_the_configured_limit() -> None:
    with client_with(reply("ok"), max_message_chars=10) as client:
        response = client.post("/chat", json={"message": "x" * 11})

    assert response.status_code == 413


def test_chat_hides_provider_details_when_the_model_fails() -> None:
    with client_with(BrokenChatModel(script=[])) as client:
        response = client.post("/chat", json={"message": "Hola"})

    assert response.status_code == 503
    assert "internal-ollama-host" not in response.text
    assert "ECONNREFUSED" not in response.text


def test_chat_treats_an_empty_answer_as_unavailable() -> None:
    with client_with(reply("   ")) as client:
        response = client.post("/chat", json={"message": "Hola"})

    assert response.status_code == 503


def test_interactive_docs_are_disabled(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
