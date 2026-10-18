"""The only door to the Express API: fixed base URL, short timeouts, capped responses.

Everything the API answers is untrusted input: it is parsed with a Pydantic model before use
and any failure becomes a short Spanish `ToolError` (never a URL, a body or a stack trace).
"""

import logging
from collections.abc import Mapping
from typing import Literal, Self

import httpx
from pydantic import BaseModel, ValidationError

logger = logging.getLogger("assistant.api")

MAX_BODY_BYTES = 256 * 1024
DEFAULT_TIMEOUT_SECONDS = 5.0

_STATUS_MESSAGES = {
    400: "La API rechazó la consulta.",
    404: "No se encontró lo pedido.",
}
# The only POSTs the assistant may send: all are stateless and save nothing (ADR 0030).
_POST_ALLOWED = frozenset(
    {
        "/api/v1/simulations",
        "/api/v1/simulations/optimizations",
        "/api/v1/costs/estimates",
        "/api/v1/costs/project-estimates",
    }
)
_UNAVAILABLE = "La API no está disponible en este momento."


class ToolError(Exception):
    """A failure whose message is safe to show to the model (short, Spanish, no internals)."""


class ApiClient:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # No redirects: a redirect could send the call to a host that is not the configured API.
        self._client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            follow_redirects=False,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self._client.aclose()

    async def request[M: BaseModel](
        self,
        method: Literal["GET", "POST"],
        path: str,
        model: type[M],
        *,
        params: Mapping[str, str | int] | None = None,
        json_body: Mapping[str, object] | None = None,
        read_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        status_messages: Mapping[int, str] | None = None,
    ) -> M:
        """Only GET and the stateless POSTs above are expressible here. `path` is built
        by the tools from validated values only."""
        if method == "POST" and path not in _POST_ALLOWED:  # exact match: no query, no traversal
            logger.error("blocked POST to a path that is not allowed")
            raise ToolError("Esa operación no está permitida.")
        try:
            async with self._client.stream(
                method, path, params=params, json=json_body, timeout=read_seconds
            ) as response:
                if response.status_code >= 400:
                    messages = {**_STATUS_MESSAGES, **(status_messages or {})}
                    raise ToolError(messages.get(response.status_code, _UNAVAILABLE))
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BODY_BYTES:
                        raise ToolError("La respuesta de la API es demasiado grande.")
        except httpx.TimeoutException as error:
            logger.warning("api timeout: %s", type(error).__name__)
            raise ToolError("La API tardó demasiado en responder.") from None
        except httpx.HTTPError as error:
            logger.warning("api unreachable: %s", type(error).__name__)
            raise ToolError(_UNAVAILABLE) from None

        try:
            return model.model_validate_json(bytes(body))
        except ValidationError:
            logger.warning("api answered an unexpected shape on %s", method)
            raise ToolError("La API respondió algo inesperado.") from None
