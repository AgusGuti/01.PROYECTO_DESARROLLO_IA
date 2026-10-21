"""Bridge to the local MCP server that scans and imports .gcode files (ADR 0034, ADR 0035).

The server (`scripts/mcp/gcode-import-server.mjs`) is started as a child process for each call,
with `--root GCODE_ROOT` taken from configuration: the model chooses only a material and a
sub-folder, never the root. Everything the server answers is untrusted input (file names are
chosen by whoever put the files there), so it is parsed with a model, classified into a closed
set of outcomes, sanitised and capped before the model sees it.
"""

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Literal, Protocol

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import TextContent
from pydantic import BaseModel, ConfigDict, ValidationError

from assistant.api_client import ToolError
from assistant.schemas import GcodeImportPayload, GcodeImportResult

logger = logging.getLogger("assistant.gcode")

# Inside the 50 s the chat loop has per request (chat.py); an import has its own, longer ceiling.
SCAN_SECONDS = 40.0
IMPORT_SECONDS = 300.0
SHOWN_FILES = 15
MAX_NAME_CHARS = 80

# apps/assistant/src/assistant/gcode_import.py -> repository root.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SERVER_SCRIPT = _REPO_ROOT / "scripts" / "mcp" / "gcode-import-server.mjs"

_UNAVAILABLE = "El importador de G-code no está disponible en este momento."

Outcome = Literal["created", "updated", "unchanged", "skipped", "errors"]


class _Row(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    path: str
    result: str
    grams: int | None = None
    minutes: int | None = None


class _Report(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    files: list[_Row]


def classify(result: str) -> Outcome:
    """The server's free-form `result` text becomes one of five known outcomes."""
    if result in ("create", "created"):
        return "created"
    if result in ("update", "updated"):
        return "updated"
    if result == "unchanged":
        return "unchanged"
    if result.startswith("skipped"):
        return "skipped"
    return "errors"


def clean_name(path: str) -> str:
    """A file name is text a stranger may have chosen: printable characters only, short."""
    printable = "".join(char if char.isprintable() else "?" for char in path)
    return printable if len(printable) <= MAX_NAME_CHARS else printable[:MAX_NAME_CHARS] + "…"


class ArchivoEscaneado(BaseModel):
    archivo: str
    accion: Literal["crear", "actualizar", "sin cambios", "omitido", "error"]
    gramos: int | None
    minutos: int | None


class EscaneoGcode(BaseModel):
    material: str
    carpeta: str
    para_crear: int
    para_actualizar: int
    sin_cambios: int
    omitidos: int
    con_error: int
    archivos: list[ArchivoEscaneado]
    nota: str


_ACTION: dict[Outcome, Literal["crear", "actualizar", "sin cambios", "omitido", "error"]] = {
    "created": "crear",
    "updated": "actualizar",
    "unchanged": "sin cambios",
    "skipped": "omitido",
    "errors": "error",
}


def summarise(payload: GcodeImportPayload, report: _Report) -> EscaneoGcode:
    outcomes = [classify(row.result) for row in report.files]
    shown = report.files[:SHOWN_FILES]
    return EscaneoGcode(
        material=payload.material,
        carpeta=clean_name(payload.folder) if payload.folder else "(toda la carpeta)",
        para_crear=outcomes.count("created"),
        para_actualizar=outcomes.count("updated"),
        sin_cambios=outcomes.count("unchanged"),
        omitidos=outcomes.count("skipped"),
        con_error=outcomes.count("errors"),
        archivos=[
            ArchivoEscaneado(
                archivo=clean_name(row.path),
                accion=_ACTION[classify(row.result)],
                gramos=row.grams,
                minutos=row.minutes,
            )
            for row in shown
        ],
        nota=(
            f"Se muestran {len(shown)} de {len(report.files)} archivos. Esto es un ensayo: no se "
            "creó nada. Para importar hay que PROPONERLO y el usuario debe confirmar en pantalla."
        ),
    )


def count(report: _Report) -> GcodeImportResult:
    outcomes = [classify(row.result) for row in report.files]
    return GcodeImportResult(
        created=outcomes.count("created"),
        updated=outcomes.count("updated"),
        unchanged=outcomes.count("unchanged"),
        skipped=outcomes.count("skipped"),
        errors=outcomes.count("errors"),
    )


class GcodeImporter(Protocol):
    async def scan(self, payload: GcodeImportPayload) -> EscaneoGcode: ...

    async def run_import(self, payload: GcodeImportPayload) -> GcodeImportResult: ...


class McpGcodeImporter:
    def __init__(self, root: Path) -> None:
        self._root = root

    async def scan(self, payload: GcodeImportPayload) -> EscaneoGcode:
        report = await self._call("scan_gcodes", payload, SCAN_SECONDS, confirm=False)
        return summarise(payload, report)

    async def run_import(self, payload: GcodeImportPayload) -> GcodeImportResult:
        """Only the confirmation endpoint calls this; the model has no tool that reaches it."""
        report = await self._call("import_gcodes", payload, IMPORT_SECONDS, confirm=True)
        return count(report)

    async def _call(
        self, tool: str, payload: GcodeImportPayload, seconds: float, *, confirm: bool
    ) -> _Report:
        node = shutil.which("node")
        if node is None or not _SERVER_SCRIPT.is_file():
            logger.error("gcode importer cannot start: node or the server script is missing")
            raise ToolError(_UNAVAILABLE)
        params = StdioServerParameters(
            command=node,
            args=[str(_SERVER_SCRIPT), "--root", str(self._root)],
            cwd=_REPO_ROOT,
        )
        arguments: dict[str, object] = payload.model_dump()
        if confirm:
            arguments["confirm"] = True
        try:
            async with (
                asyncio.timeout(seconds),
                stdio_client(params) as (read, write),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                result = await session.call_tool(tool, arguments)
        except TimeoutError:
            logger.warning("gcode importer timed out in %s", tool)
            raise ToolError("El importador de G-code tardó demasiado.") from None
        except Exception as error:
            logger.warning("gcode importer failed in %s: %s", tool, type(error).__name__)
            raise ToolError(_UNAVAILABLE) from None

        text = next((item.text for item in result.content if isinstance(item, TextContent)), None)
        if result.isError or text is None:
            logger.warning("gcode importer answered an error in %s", tool)
            raise ToolError(_UNAVAILABLE)
        try:
            return _Report.model_validate_json(text)
        except ValidationError:
            logger.warning("gcode importer answered an unexpected shape in %s", tool)
            raise ToolError("El importador de G-code respondió algo inesperado.") from None
