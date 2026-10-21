"""Typed settings. The only module that reads the environment (standard §6.5)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import AnyHttpUrl, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _find_env_file() -> Path | None:
    """Locate the repository's .env by walking up to the folder that holds .env.example."""
    for parent in Path(__file__).resolve().parents:
        if (parent / ".env.example").is_file():
            return parent / ".env"
    return None


class Settings(BaseSettings):
    """Validated at startup; a missing or malformed value stops the service immediately."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    assistant_host: str = "127.0.0.1"
    assistant_port: int = Field(default=8000, ge=1, le=65535)

    llm_provider: Literal["ollama"] = "ollama"
    llm_model: str = Field(default="qwen3:8b", min_length=1)
    llm_timeout_seconds: float = Field(default=120.0, gt=0)
    ollama_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:11434")

    # The assistant reaches data only through the Express API, never MongoDB (ADR-0004).
    api_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:3000")

    # Folder of .gcode files the assistant may scan and import (ADR 0035). Off when unset: the
    # model is never offered the G-code tools. It is configuration, never model input.
    gcode_root: Path | None = None

    max_message_chars: int = Field(default=2000, ge=1, le=20_000)

    # Set only by the container image, where the port is published on the host loopback.
    containerized: bool = False

    @model_validator(mode="after")
    def _gcode_root_is_a_folder(self) -> Self:
        if self.gcode_root is not None and not self.gcode_root.is_dir():
            raise ValueError("GCODE_ROOT must be an existing folder")
        return self

    @model_validator(mode="after")
    def _loopback_only_without_auth(self) -> Self:
        # EXC-0001: there is no authentication yet, so the service must not face the network.
        if not self.containerized and self.assistant_host not in _LOOPBACK_HOSTS:
            raise ValueError(
                "ASSISTANT_HOST must be a loopback address while there is no "
                "authentication (EXC-0001)"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
