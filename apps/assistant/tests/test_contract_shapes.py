"""The fake API and the proposals must not drift from packages/api-contracts/openapi.yaml.

The assistant has no YAML parser, so the `required` list of a schema is read with a regex: the
file is generated, and its layout (schemas at 4 spaces, `required` at 6) is stable.
"""

import re
from pathlib import Path

import pytest

from assistant.schemas import ProgressLine, ProposalItem
from fakes import project_item, queue_line

CONTRACT = Path(__file__).resolve().parents[3] / "packages" / "api-contracts" / "openapi.yaml"


def required(schema: str) -> set[str]:
    text = CONTRACT.read_text(encoding="utf-8")
    block = re.search(rf"^    {schema}:\n(.*?)(?=^    \w+:\n|\Z)", text, re.DOTALL | re.MULTILINE)
    assert block is not None, f"{schema} is not in the contract"
    names = re.search(r"^      required:\n((?:        - .+\n)+)", block.group(1), re.MULTILINE)
    assert names is not None, f"{schema} lists no required keys"
    return {line.strip().removeprefix("- ") for line in names.group(1).splitlines()}


@pytest.mark.parametrize(
    ("schema", "built"),
    [
        ("ProjectItem", project_item("a", 1, None)),
        ("QueueLine", queue_line("a", "x", 1, 0)),
    ],
)
def test_the_response_fixtures_have_every_key_the_contract_requires(
    schema: str, built: dict[str, object]
) -> None:
    assert set(built) == required(schema)


@pytest.mark.parametrize(
    ("schema", "fields"),
    [
        ("ProjectItemInput", set(ProposalItem.model_fields)),
        ("QueueLineEdit", set(ProgressLine.model_fields)),
    ],
)
def test_the_proposal_lines_are_exactly_what_the_api_accepts(schema: str, fields: set[str]) -> None:
    assert fields == required(schema)
