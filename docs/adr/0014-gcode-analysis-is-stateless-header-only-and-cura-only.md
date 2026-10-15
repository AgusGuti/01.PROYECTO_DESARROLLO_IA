# 0014. G-code analysis is a stateless, header-only, Cura-only endpoint in its own module

- **Status:** accepted
- **Date:** 2026-10-15

## Context

To estimate costs, Agustín wants to import the G-code he is going to print and have the system
extract what it needs. He mainly uses Cura. A Cura G-code writes its estimates as comments in the
first lines. The request is untrusted text, so this falls under standard §8.5 and the threat model
below. He decided: keep only the extracted data, never the file; build it inside CU02.

## Decision

- A separate `gcode` module with **`POST /api/v1/gcode-analyses`** answers 200, stores nothing and
  has no database, clock or logger access to the text. `parts` does not import it; the browser
  composes the two calls.
- **Transport:** the browser reads `file.slice(0, 65536).text()` and sends `{ head, material? }` in
  a normal JSON body through the existing `express.json` (100 kb limit) and the existing rate
  limit. No multipart, no disk, no dependency. `head` is 1..65,536 characters and is not trimmed or
  normalised. The file name is **not** part of the request: the analyser does not use it.
- **Parser:** the pure function `parseCuraHeader(text)`:
  - Reads at most the first 65,536 characters and 2,000 lines, found with an `indexOf` loop (no
    splitting of the whole text). Lines over 500 characters are skipped. A leading BOM is removed.
  - Reads only the leading comment lines and stops at the first non-empty line that does not start
    with `;`. The **first occurrence** of each key wins.
  - Recognises a Cura header only with `;Generated with Cura_SteamEngine ` and `;FLAVOR:` equal to
    `Marlin` or `RepRap`, plus a valid time and filament length. Griffin, UltiGCode and volumetric
    (`mm3`) headers are unsupported and answer 400.
  - Uses anchored regexes with bounded quantifiers on digit-only values, then range checks:
    `;TIME:` 1..2,592,000 s; `;Filament used:` up to 8 comma-separated values like `1.234m`, each
    converted to integer millimetres and summed, total 1..100,000,000 mm; `;Layer height:`
    10..2000 µm; `;MINX..;MAXZ` coordinates -1000..1000 mm; `;TARGET_MACHINE.NAME:` kept only if
    printable ASCII 1..100 characters, otherwise `null`.
  - `;TIME:6666` together with `0m` of filament is the placeholder that slicers write when the
    header was never filled, so it is unusable.
  - Never returns NaN or Infinity, and never echoes file text, except the constrained machine name.
- **Response:** `{ slicer: 'cura', estimatedPrintSeconds, filamentMm, filamentGrams | null,
layerHeightUm | null, dimensionsMm | null, targetMachineName | null, warnings: [{ code }] }`.
  - Dimensions are computed in integer micrometres: `x` and `y` are
    `ceil((MAX - MIN) / 1000)`, and `z` is `ceil(MAXZ)` (because `MINZ` is the first layer
    height). They include skirt and brim. A side outside 1..1000 gives `null`.
  - Grams: `round(filamentMm × π × 0.875² × density / 1000)` (ADR 0015); `null` without material
    or above 20,000.
  - Warning codes are an enum in the contract: `GRAMS_FROM_DENSITY_TABLE`, `MATERIAL_NOT_SELECTED`,
    `WEIGHT_OUT_OF_RANGE`, `LAYER_HEIGHT_UNAVAILABLE`, `DIMENSIONS_UNAVAILABLE`,
    `DIMENSIONS_INCLUDE_SKIRT_OR_BRIM`, `MULTIPLE_EXTRUDERS_SUMMED`. The web maps each to Spanish
    with a `Record`, so a new code breaks the build.
  - An unrecognised or unusable header is 400 `validation_failed` with an issue on `head` and a
    fixed English message that never contains file text.
- **Not decided here:** whether the part fits a printer. That is a part-by-printer question whose
  natural home is CU07 and CU01, where a printer is assigned. If wanted earlier, it can be added
  without breaking the contract (an optional build volume in the request and a warning code).
- **Phase 2:** `.3mf` (ZIP and XML: zip bombs, XXE and two dependencies) is not built or designed
  here and needs its own threat model.

### Threat model

Assets: the API process (CPU, memory), part data, and the numbers that CU03 will turn into prices.
Actors: the user, another program on the same machine (EXC-0001, loopback only), and a corrupt or
hostile `.gcode` file. Flow: file, browser slice, `POST /gcode-analyses`, pure parser, 200 with
numbers, prefilled form, user edits, `POST /parts`. The file text is never stored, logged or
returned.

| Scenario                                           | Control                                                                                     | Test                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A huge body or `head` exhausts memory or CPU       | `head` <= 65,536; `express.json` limit; rate limit                                          | 65,537 characters gives 400; a body over the limit gives 413                |
| Regular-expression denial of service               | Bounded input, 2,000 lines, 500-character lines, anchored linear regexes, early stop        | Hostile inputs (`;;;;`, digits, one huge line) finish within a fixed budget |
| Numbers that poison costs (negative, NaN, `1e999`) | Digit-only regexes plus range checks; out of range drops the value or answers 400           | A table of hostile values per field; the response never contains NaN        |
| A later duplicate key overrides an honest one      | First occurrence wins; extruders are summed with a cap                                      | Duplicate-key test                                                          |
| File text reaches the page as HTML                 | The response has numbers and fixed codes only; `fileName` is shown by Angular interpolation | A file named `<img src=x onerror=...>` renders as text                      |
| A client invents `source.analyzedAt`               | Strict schema; the server stamps it from the clock                                          | Sending it gives 400                                                        |
| A forged header makes the user trust wrong numbers | Not preventable (the file is the user's own); values are editable suggestions with warnings | Imported fields are editable and flagged                                    |
| Logs leak the file                                 | `head` and parsed lines are never logged                                                    | A logger spy never receives the text                                        |

Residual risks, accepted by Agustín: time (±10-20 %) and weight (±3 %) are the slicer's and a
table's estimates, shown as such; anyone on the machine can call the endpoint while EXC-0001 holds
(it stores nothing); only Cura is recognised.

## Alternatives considered

- **Multipart upload:** a new middleware, disk handling and file rules, for no gain.
- **Parsing inside `parts`:** mixes a stateless concern with persistence.
- **Sending the whole file:** up to hundreds of megabytes for a header in the first kilobyte.
- **Running CuraEngine on the server:** heavy external code, rejected in the plan.
- **A parsing library:** the format is a dozen comment lines; no dependency (§2.2).

## Consequences

- A fixed-time hostile-input suite is required, and fixtures must come from real Cura files; the
  first ones are reconstructed from the CuraEngine source and must be completed with real heads.
- A head full of control characters can exceed the JSON limit and gets a 413, which is right; the
  web maps it to its own Spanish message.
- Other slicers get an honest "load by hand" answer until supported.
