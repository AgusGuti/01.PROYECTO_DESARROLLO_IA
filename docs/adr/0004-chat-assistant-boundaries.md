# 0004. Chat assistant boundaries

- **Status:** accepted
- **Date:** 2026-10-13

## Context

The project adds a chat assistant, written in Python with LangChain, to a MEAN application. The
developer wants it to answer questions about his data and to carry out actions he confirms. A
language model is not a trustworthy component: its output can be wrong, and text it reads
(including data typed into the application) can steer it. It must not become a way around the
validation and rules that the API enforces.

## Decision

- **Separate service:** `apps/assistant`, FastAPI + LangChain, Python 3.12, managed with `uv` in
  a project-local virtual environment.
- **Reached through the API:** the browser talks only to the Express API, which forwards chat
  requests to the assistant. One public surface, one place for limits and (later) authentication.
- **Data only through the API:** the assistant calls the Express REST endpoints over HTTP. It
  never connects to MongoDB. A guard forbids importing a MongoDB driver there.
- **Reads are tools; writes are proposals.** A read tool calls a `GET` endpoint. For a change,
  the model returns a _proposal_ (endpoint, validated payload, Spanish summary); the Angular app
  shows it; the user confirms; the **browser** sends the request. The model never holds the
  ability to write.
- **Model:** local Ollama with `qwen3:8b` by default, selected by configuration
  (`LLM_PROVIDER`, `LLM_MODEL`) so another provider can be added in one place.
- **Order of work:** built after CU01–CU10. Until then the service is a stub with a health
  endpoint and a chat endpoint that has no tools.

## Alternatives considered

- **Assistant reads MongoDB directly:** simpler to write, but duplicates access rules, bypasses
  validation, and gives the model's tool layer database credentials.
- **Model executes writes after a "yes" in the chat:** the confirmation would itself be model
  input, which injected text can fake. Confirmation must happen outside the model.
- **LangChain inside the Node process (LangChain.js):** one runtime fewer, but the requirement is
  a Python chatbot.
- **Hosted model by default:** better tool calling, but it costs money, needs a key, and sends
  application data to a third party. Local first; hosted remains a configuration change plus an
  ADR about what data may leave the machine.

## Consequences

- Every capability the assistant has must first exist as an API endpoint, which keeps the API
  complete and the assistant thin.
- An extra network hop and a second process to run in development (`npm run dev` starts all
  three).
- A small local model is weaker at choosing and calling tools. Tools must be few, narrowly
  described and well tested; answers may be slower on modest hardware.
- Prompt injection is reduced, not eliminated: a manipulated model can still produce a misleading
  _proposal_. The summary shown to the user must be generated from the validated payload, not
  from free text written by the model.
