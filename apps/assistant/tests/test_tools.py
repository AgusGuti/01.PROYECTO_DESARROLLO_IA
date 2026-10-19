"""Each read tool against a fake API: happy path, empty, API errors, bad arguments."""

import json
from datetime import UTC, datetime

import httpx
import pytest

from assistant.tools import MAX_ITEMS, MAX_RESULT_CHARS, date_ar, default_start, duration_seconds
from fakes import PROJECT_ID, FakeApi

pytestmark = pytest.mark.anyio

JSON = {"content-type": "application/json"}


def ok(body: object) -> httpx.Response:
    return httpx.Response(200, json=body, headers=JSON)


def page(items: list[dict[str, object]]) -> httpx.Response:
    return ok({"items": items, "page": 1, "pageSize": 100, "total": len(items)})


def project(name: str = "Soportes", description: str | None = None) -> dict[str, object]:
    return {
        "id": PROJECT_ID,
        "name": name,
        "description": description,
        "priority": "high",
        "deadline": "2026-11-30",
        "itemCount": 2,
        "unitCount": 5,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    }


async def test_list_projects_returns_compact_projects_and_filters_by_search() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([project("Soportes"), project("Llaveros")])})

    out = await api.toolbox().run("list_projects", {"search": "llav"})

    assert "Llaveros" in out
    assert "Soportes" not in out
    assert "createdAt" not in out
    assert api.requests[0].url.params["pageSize"] == "100"


async def test_list_projects_passes_the_priority_filter_to_the_api() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([])})

    await api.toolbox().run("list_projects", {"priority": "urgent"})

    assert api.requests[0].url.params["priority"] == "urgent"


async def test_list_projects_empty_result_is_an_empty_list() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([])})

    out = await api.toolbox().run("list_projects", {})

    assert '"proyectos":[]' in out


async def test_list_projects_caps_the_number_of_items() -> None:
    many = [project(f"P{i}") for i in range(MAX_ITEMS + 20)]
    api = FakeApi({("GET", "/api/v1/projects"): page(many)})

    out = await api.toolbox().run("list_projects", {})

    assert f'"mostrados":{MAX_ITEMS}' in out
    assert f"P{MAX_ITEMS + 1}" not in out


@pytest.mark.parametrize(("total", "flag"), [(1, "false"), (250, "true")])
async def test_search_reports_when_it_only_covered_the_first_page(total: int, flag: str) -> None:
    body = {"items": [project("Soportes")], "page": 1, "pageSize": 100, "total": total}
    no_parts = {"items": [], "page": 1, "pageSize": 100, "total": total - 1}
    api = FakeApi({("GET", "/api/v1/projects"): ok(body), ("GET", "/api/v1/parts"): ok(no_parts)})
    toolbox = api.toolbox()

    assert f'"truncado":{flag}' in await toolbox.run("list_projects", {"search": "sop"})
    assert f'"truncado":{flag}' in await toolbox.run("list_parts", {})


async def test_a_model_chosen_tool_name_is_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO", logger="assistant.tools")

    await FakeApi({}).toolbox().run("evil\nINFO forged line", {})
    await FakeApi({}).toolbox().run("get_cost_settings", {})

    assert "forged" not in caplog.text
    assert "\n" not in "".join(r.getMessage() for r in caplog.records)
    assert "tool=unknown outcome=unknown_tool" in caplog.text


async def test_a_huge_result_is_truncated() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([project("N" * 5000)] * 30)})

    out = await api.toolbox().run("list_projects", {})

    assert "resultado truncado" in out
    assert len(out) < MAX_RESULT_CHARS + 200


async def test_get_project_returns_lines() -> None:
    body = {
        **project(),
        "items": [
            {"partId": PROJECT_ID, "quantity": 3, "part": {"name": "Gancho", "material": "PLA"}},
            {"partId": PROJECT_ID, "quantity": 1, "part": None},
        ],
    }
    api = FakeApi({("GET", f"/api/v1/projects/{PROJECT_ID}"): ok(body)})

    out = await api.toolbox().run("get_project", {"proyecto": PROJECT_ID})

    assert "Gancho" in out
    assert '"cantidad":3' in out


async def test_get_project_not_found_gives_a_clear_message() -> None:
    api = FakeApi({})

    out = await api.toolbox().run("get_project", {"proyecto": PROJECT_ID})

    assert out == "ERROR: No existe ese proyecto."


async def test_queue_progress_returns_lines_and_totals() -> None:
    body = {
        "projectId": PROJECT_ID,
        "goal": "fastest",
        "mode": "single",
        "printerIds": [],
        "lines": [
            {
                "partId": PROJECT_ID,
                "quantity": 10,
                "completed": 4,
                "pendingUnits": 6,
                "partName": "Gancho",
                "estimatedPrintSeconds": 600,
                "partDeleted": False,
            }
        ],
        "totals": {
            "totalUnits": 10,
            "completedUnits": 4,
            "pendingUnits": 6,
            "pendingSeconds": 3600,
        },
        "version": 1,
    }
    api = FakeApi({("GET", f"/api/v1/queues/{PROJECT_ID}"): ok(body)})

    out = await api.toolbox().run("get_queue_progress", {"proyecto": PROJECT_ID})

    assert '"completadas":4' in out
    assert '"tiempo_de_impresion_pendiente":"1 h 0 min"' in out


async def test_queue_progress_404_says_there_is_no_queue() -> None:
    out = await FakeApi({}).toolbox().run("get_queue_progress", {"proyecto": PROJECT_ID})

    assert "no hay cola" in out


async def test_list_filaments_returns_stock() -> None:
    filament = {
        "id": PROJECT_ID,
        "brand": "Grilon3",
        "material": "PLA",
        "colorName": "Negro",
        "initialGrams": 1000,
        "availableGrams": 420,
        "purchaseCostMinor": 1500000,
    }
    api = FakeApi({("GET", "/api/v1/filaments"): page([filament])})

    out = await api.toolbox().run("list_filaments", {})

    assert '"gramos_disponibles":420' in out
    assert '"costo_de_compra_pesos":15000.0' in out


async def test_list_printers_returns_name_and_status() -> None:
    printer: dict[str, object] = {
        "id": PROJECT_ID,
        "name": "Ender 3",
        "status": "available",
        "compatibleMaterials": ["PLA"],
        "nozzle": {"diameterMm": 0.4, "material": "brass"},
        "archivedAt": None,
    }
    api = FakeApi({("GET", "/api/v1/printers"): page([printer])})

    out = await api.toolbox().run("list_printers", {})

    assert "Ender 3" in out
    assert '"estado":"disponible"' in out


async def test_list_parts_filters_by_search() -> None:
    def part(name: str) -> dict[str, object]:
        return {
            "id": PROJECT_ID,
            "name": name,
            "description": None,
            "material": "PETG",
            "dimensionsMm": {"x": 10, "y": 20, "z": 30},
            "estimatedWeightGrams": 12,
            "estimatedPrintSeconds": 900,
            "suggestedPrinterName": None,
        }

    api = FakeApi({("GET", "/api/v1/parts"): page([part("Gancho"), part("Tapa")])})

    out = await api.toolbox().run("list_parts", {"search": "tapa"})

    assert "Tapa" in out
    assert "Gancho" not in out
    assert '"tiempo_de_impresion":"15 min"' in out
    assert '"medidas_mm":"10 x 20 x 30"' in out


async def test_cost_settings_use_spanish_keys_pesos_and_percent() -> None:
    body = {
        "kwhPriceMinor": 8050,
        "wearPerHourMinor": 2000,
        "fixedPerJobMinor": 123456,
        "defaultMarginBasisPoints": 1250,
        "version": 2,
        "updatedAt": None,
    }
    api = FakeApi({("GET", "/api/v1/costs/settings"): ok(body)})

    out = await api.toolbox().run("get_cost_settings", {})

    assert json.loads(out.split("\n")[1]) == {
        "precio_del_kwh_pesos": 80.5,
        "desgaste_de_la_impresora_por_hora_pesos": 20.0,
        "costo_fijo_por_trabajo_pesos": 1234.56,
        "margen_por_defecto_porcentaje": 12.5,
    }


@pytest.mark.parametrize(
    ("seconds", "text"), [(0, "0 min"), (90, "2 min"), (3600, "1 h 0 min"), (5400, "1 h 30 min")]
)
def test_durations_are_human_text(seconds: int, text: str) -> None:
    assert duration_seconds(seconds) == text


def test_dates_are_shown_day_first() -> None:
    assert date_ar("2026-11-30") == "30-11-2026"
    assert date_ar("2026-10-16T09:00") == "16-10-2026 09:00"
    assert date_ar(None) is None


async def test_intervention_schedule_is_readable_by_weekday() -> None:
    day = {"ranges": [{"startMinute": 480, "endMinute": 1080}]}
    body = {
        "weekly": [day] + [{"ranges": []}] * 6,
        "exceptions": [{"date": "2026-12-25", "ranges": []}],
        "absences": [
            {"from": "2026-11-02", "to": "2026-11-09"},
            {"from": "2026-12-01", "to": "2026-12-01"},
        ],
        "version": 1,
        "updatedAt": None,
    }
    api = FakeApi({("GET", "/api/v1/availability/schedule"): ok(body)})

    out = json.loads((await api.toolbox().run("get_intervention_schedule", {})).split("\n")[1])

    assert out["horario_semanal"]["lunes"] == ["08:00-18:00"]
    assert out["horario_semanal"]["domingo"] == []
    assert out["excepciones"] == {"25-12-2026": []}
    assert out["ausencias"] == ["02-11-2026 a 09-11-2026", "01-12-2026"]


async def test_intervention_schedule_without_absences_field_has_none() -> None:
    body = {"weekly": [{"ranges": []}] * 7, "exceptions": [], "version": 0}
    api = FakeApi({("GET", "/api/v1/availability/schedule"): ok(body)})

    out = json.loads((await api.toolbox().run("get_intervention_schedule", {})).split("\n")[1])

    assert out["ausencias"] == []


SIMULATION = {
    "projectId": PROJECT_ID,
    "goal": "fastest",
    "startAt": "2026-10-14T15:15",
    "jobs": [{"order": 1}],
    "printers": [],
    "totals": {
        "placedJobs": 3,
        "unplacedJobs": 1,
        "finishAt": "2026-10-16T09:00",
        "totalBusyMinutes": 300,
        "totalIdleMinutes": 45,
    },
    "deadline": {"date": "2026-10-15", "met": False},
    "unplaced": [{"partId": PROJECT_ID, "partName": "Gancho", "units": 2}],
    "warnings": [{"code": "availability_not_configured"}],
}


async def test_simulate_defaults_the_start_to_argentina_time_rounded_up() -> None:
    api = FakeApi({("POST", "/api/v1/simulations"): ok(SIMULATION)})

    out = await api.toolbox().run("simulate_project", {"proyecto": PROJECT_ID})

    sent = json.loads(api.requests[0].content)
    assert sent == {"projectId": PROJECT_ID, "startAt": "2026-10-14T15:15"}
    assert '"fecha_limite_cumplida":false' in out
    assert '"tiempo_total_de_espera":"45 min"' in out
    assert '"jobs"' not in out


async def test_simulate_uses_the_given_start() -> None:
    api = FakeApi({("POST", "/api/v1/simulations"): ok(SIMULATION)})

    await api.toolbox().run(
        "simulate_project", {"proyecto": PROJECT_ID, "start_at": "2026-11-02T08:00"}
    )

    assert json.loads(api.requests[0].content)["startAt"] == "2026-11-02T08:00"


async def test_simulate_without_a_queue_explains_it() -> None:
    api = FakeApi({("POST", "/api/v1/simulations"): httpx.Response(400, json={})})

    out = await api.toolbox().run("simulate_project", {"proyecto": PROJECT_ID})

    assert "no tiene cola" in out


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (datetime(2026, 10, 14, 18, 0, 0, tzinfo=UTC), "2026-10-14T15:00"),
        (datetime(2026, 10, 14, 18, 0, 1, tzinfo=UTC), "2026-10-14T15:15"),
        (datetime(2026, 10, 14, 18, 46, 0, tzinfo=UTC), "2026-10-14T16:00"),
        (datetime(2026, 10, 15, 2, 50, 0, tzinfo=UTC), "2026-10-15T00:00"),
    ],
)
def test_default_start_rounds_up_to_quarter_hours(moment: datetime, expected: str) -> None:
    assert default_start(moment) == expected


# --- failures and hostile arguments ----------------------------------------------------------

ID_TOOLS = ["get_project", "get_queue_progress", "simulate_project"]


@pytest.mark.parametrize("tool", ID_TOOLS)
@pytest.mark.parametrize("bad_ref", ["", "   ", "x" * 101, 5])
async def test_an_empty_or_oversized_project_reference_is_rejected_before_any_request(
    tool: str, bad_ref: object
) -> None:
    api = FakeApi({})

    out = await api.toolbox().run(tool, {"proyecto": bad_ref})

    assert out.startswith("ERROR: argumentos inválidos (proyecto)")
    assert api.requests == []


@pytest.mark.parametrize("tool", ID_TOOLS)
@pytest.mark.parametrize(
    "hostile", ["../x", "../../etc/passwd", PROJECT_ID[:-1], PROJECT_ID + "0", "a?b=c#"]
)
async def test_a_hostile_name_is_never_put_in_a_url_path(tool: str, hostile: str) -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([project("Soportes")])})

    out = await api.toolbox().run(tool, {"proyecto": hostile})

    assert out == "ERROR: No encontré un proyecto con ese nombre."
    assert [r.url.path for r in api.requests] == ["/api/v1/projects"]


def named(name: str, project_id: str) -> dict[str, object]:
    return {**project(name), "id": project_id}


OTHER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"


async def test_a_name_is_resolved_by_exact_match_first() -> None:
    projects = [named("Soportes para el taller", PROJECT_ID), named("Soportes", OTHER_ID)]
    api = FakeApi(
        {
            ("GET", "/api/v1/projects"): page(projects),
            ("GET", f"/api/v1/queues/{OTHER_ID}"): ok({}),
        }
    )

    await api.toolbox().run("get_queue_progress", {"proyecto": "soportes"})

    assert api.requests[-1].url.path == f"/api/v1/queues/{OTHER_ID}"


async def test_a_name_is_resolved_by_contains() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([named("Soportes para el taller", OTHER_ID)])})

    await api.toolbox().run("get_project", {"proyecto": "taller"})

    assert api.requests[-1].url.path == f"/api/v1/projects/{OTHER_ID}"


async def test_an_ambiguous_name_lists_the_matches() -> None:
    projects = [named("Soportes A", PROJECT_ID), named("Soportes B", OTHER_ID)]
    api = FakeApi({("GET", "/api/v1/projects"): page(projects)})

    out = await api.toolbox().run("simulate_project", {"proyecto": "soportes"})

    assert out.startswith("ERROR: Hay varios proyectos que coinciden:")
    assert "Soportes A" in out
    assert "Soportes B" in out
    assert len(api.requests) == 1  # nothing was simulated


async def test_an_unknown_name_says_so() -> None:
    api = FakeApi({("GET", "/api/v1/projects"): page([project("Soportes")])})

    out = await api.toolbox().run("get_project", {"proyecto": "Inexistente"})

    assert out == "ERROR: No encontré un proyecto con ese nombre."


async def test_an_id_needs_no_lookup() -> None:
    api = FakeApi({("GET", f"/api/v1/projects/{PROJECT_ID}"): ok(project())})

    await api.toolbox().run("get_project", {"proyecto": PROJECT_ID})

    assert [r.url.path for r in api.requests] == [f"/api/v1/projects/{PROJECT_ID}"]


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("list_projects", {"search": "x" * 5000}),
        ("list_parts", {"search": "x" * 101}),
        ("list_projects", {"priority": "critical"}),
        ("list_projects", {"search": 5}),
        ("list_filaments", {"extra": 1}),
        ("simulate_project", {"proyecto": PROJECT_ID, "start_at": "mañana"}),
        ("simulate_project", {"proyecto": PROJECT_ID, "start_at": "2026-10-14T15:15:00Z"}),
    ],
)
async def test_invalid_arguments_are_rejected_before_any_request(
    tool: str, args: dict[str, object]
) -> None:
    api = FakeApi({})

    out = await api.toolbox().run(tool, args)

    assert out.startswith("ERROR: argumentos inválidos")
    assert api.requests == []


async def test_an_unknown_tool_is_refused() -> None:
    out = await FakeApi({}).toolbox().run("delete_project", {"proyecto": PROJECT_ID})

    assert out == "ERROR: esa herramienta no existe."


@pytest.mark.parametrize(
    ("outcome", "message"),
    [
        (httpx.Response(500, text="Traceback: mongo at 10.0.0.5"), "no está disponible"),
        (httpx.ConnectTimeout("http://api.test/secret"), "tardó demasiado"),
        (httpx.ConnectError("refused http://api.test"), "no está disponible"),
        (httpx.Response(200, text="not json"), "inesperado"),
        (httpx.Response(200, json={"items": "nope"}), "inesperado"),
        (httpx.Response(200, content=b"x" * (300 * 1024)), "demasiado grande"),
    ],
)
async def test_api_failures_become_short_safe_messages(
    outcome: httpx.Response | Exception, message: str
) -> None:
    api = FakeApi({("GET", "/api/v1/filaments"): outcome})

    out = await api.toolbox().run("list_filaments", {})

    assert out.startswith("ERROR:")
    assert message in out
    assert "10.0.0.5" not in out
    assert "api.test" not in out


async def test_redirects_are_not_followed() -> None:
    redirect = httpx.Response(302, headers={"location": "http://evil.example/"})
    api = FakeApi({("GET", "/api/v1/filaments"): redirect})

    out = await api.toolbox().run("list_filaments", {})

    assert out.startswith("ERROR:")
    assert len(api.requests) == 1


async def test_only_get_and_the_simulation_post_exist() -> None:
    api = FakeApi(
        {
            ("GET", "/api/v1/projects"): page([]),
            ("GET", "/api/v1/filaments"): page([]),
            ("GET", "/api/v1/printers"): page([]),
            ("GET", "/api/v1/parts"): page([]),
            ("GET", "/api/v1/costs/settings"): ok({}),
            ("GET", "/api/v1/availability/schedule"): ok({}),
            ("POST", "/api/v1/simulations"): ok(SIMULATION),
        }
    )
    toolbox = api.toolbox()

    for name in ["list_projects", "list_filaments", "list_printers", "list_parts"]:
        await toolbox.run(name, {})
    await toolbox.run("get_cost_settings", {})
    await toolbox.run("get_intervention_schedule", {})
    await toolbox.run("simulate_project", {"proyecto": PROJECT_ID})

    assert {r.method for r in api.requests} == {"GET", "POST"}
    assert [r.url.path for r in api.requests if r.method == "POST"] == ["/api/v1/simulations"]
