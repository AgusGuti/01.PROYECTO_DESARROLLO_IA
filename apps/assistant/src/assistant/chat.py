"""The conversation logic, independent of HTTP so it can be tested directly."""

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

# The user's text is untrusted input. It is only ever sent as a human message and is never
# concatenated into this system prompt, which limits what a prompt injection can change.
SYSTEM_PROMPT = (
    "Sos el asistente de Print3D Planner, una aplicación para gestionar proyectos de "
    "impresión 3D, calcular sus costos y planificar la cola de impresión. "
    "Respondé siempre en español, de forma breve y clara. "
    "Todavía no tenés acceso a los datos del usuario: si te preguntan por sus proyectos, "
    "piezas, filamentos, impresoras, costos o planificación, decí que esa función aún no "
    "está disponible. Nunca inventes datos."
)


class AssistantUnavailableError(Exception):
    """The language model could not produce an answer."""


async def answer(model: BaseChatModel, message: str) -> str:
    try:
        result = await model.ainvoke([SystemMessage(SYSTEM_PROMPT), HumanMessage(message)])
    except Exception as error:
        # Any provider failure (model not pulled, server down, timeout) becomes one known error.
        raise AssistantUnavailableError from error

    text = result.text.strip() if isinstance(result.text, str) else ""
    if not text:
        raise AssistantUnavailableError("the model returned an empty answer")
    return text
