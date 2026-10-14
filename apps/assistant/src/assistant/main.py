"""HTTP surface of the assistant: thin routes over `assistant.chat`."""

import logging
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from langchain_core.language_models import BaseChatModel

from assistant.chat import AssistantUnavailableError, answer
from assistant.config import Settings, get_settings
from assistant.llm import build_chat_model
from assistant.schemas import ChatRequest, ChatResponse, ErrorResponse, HealthResponse

logger = logging.getLogger("assistant")

UNAVAILABLE_MESSAGE = "El asistente no está disponible en este momento. Intentá de nuevo más tarde."
TOO_LONG_MESSAGE = "El mensaje es demasiado largo."


@lru_cache(maxsize=1)
def _cached_chat_model() -> BaseChatModel:
    return build_chat_model(get_settings())


def get_chat_model() -> BaseChatModel:
    """FastAPI dependency. Tests replace it with a fake model."""
    return _cached_chat_model()


SettingsDep = Annotated[Settings, Depends(get_settings)]
ChatModelDep = Annotated[BaseChatModel, Depends(get_chat_model)]


def create_app() -> FastAPI:
    # Interactive docs are off: the public contract is the Express API, not this service.
    app = FastAPI(title="Print3D Assistant", version="0.1.0", docs_url=None, redoc_url=None)

    @app.get("/health")
    async def health(settings: SettingsDep) -> HealthResponse:
        return HealthResponse(status="ok", provider=settings.llm_provider, model=settings.llm_model)

    @app.post(
        "/chat",
        responses={
            status.HTTP_413_CONTENT_TOO_LARGE: {"model": ErrorResponse},
            status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
        },
    )
    async def chat(
        request: ChatRequest, settings: SettingsDep, model: ChatModelDep
    ) -> ChatResponse:
        if len(request.message) > settings.max_message_chars:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LONG_MESSAGE)
        try:
            return ChatResponse(reply=await answer(model, request.message))
        except AssistantUnavailableError:
            # Log the cause for the operator; the client gets a safe, generic message.
            logger.exception("chat model failed")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE) from None

    return app


app = create_app()
