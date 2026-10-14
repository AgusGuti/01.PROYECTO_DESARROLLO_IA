"""Entry point: `python -m assistant` (or `npm run dev:assistant` from the repository root)."""

import uvicorn

from assistant.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "assistant.main:app",
        host=settings.assistant_host,
        port=settings.assistant_port,
        server_header=False,
    )


if __name__ == "__main__":
    main()
