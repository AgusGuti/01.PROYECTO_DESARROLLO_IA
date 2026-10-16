import pytest


@pytest.fixture
def anyio_backend() -> str:
    # anyio ships a pytest plugin; run async tests on asyncio only (no trio installed).
    return "asyncio"
