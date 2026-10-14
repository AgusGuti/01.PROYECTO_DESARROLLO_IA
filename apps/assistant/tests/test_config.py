import pytest
from pydantic import ValidationError

from assistant.config import Settings

LAN_ADDRESS = "192.168.1.10"


def test_defaults_are_local_and_safe() -> None:
    settings = Settings(_env_file=None)

    assert settings.assistant_host == "127.0.0.1"
    assert settings.llm_provider == "ollama"
    assert str(settings.api_base_url) == "http://127.0.0.1:3000/"


def test_refuses_a_network_address_while_there_is_no_authentication() -> None:
    with pytest.raises(ValidationError, match="loopback"):
        Settings(_env_file=None, assistant_host=LAN_ADDRESS)


def test_allows_a_network_address_inside_the_container_image() -> None:
    settings = Settings(_env_file=None, assistant_host=LAN_ADDRESS, containerized=True)

    assert settings.assistant_host == LAN_ADDRESS


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("assistant_port", 0),
        ("assistant_port", 70_000),
        ("llm_provider", "something-else"),
        ("ollama_base_url", "not a url"),
        ("llm_timeout_seconds", 0),
        ("llm_model", ""),
    ],
)
def test_rejects_invalid_values(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Settings.model_validate({field: value})
