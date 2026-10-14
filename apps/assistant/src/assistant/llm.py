"""Builds the chat model from settings. Adding a provider means adding a branch here."""

from typing import assert_never

from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama

from assistant.config import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    match settings.llm_provider:
        case "ollama":
            return ChatOllama(
                model=settings.llm_model,
                base_url=str(settings.ollama_base_url),
                temperature=0.2,
                # Keep the model's private "thinking" out of the reply shown to the user.
                reasoning=False,
                client_kwargs={"timeout": settings.llm_timeout_seconds},
            )
        case _:
            assert_never(settings.llm_provider)
