"""Fixed how-to texts for `ayuda_del_sistema` (no HTTP). They describe the real screens and
routes of apps/web (a test checks every route mentioned exists in app.routes.ts)."""

from collections.abc import Mapping

HELP: Mapping[str, tuple[str, ...]] = {
    "costos": (
        "Pantalla: /costos/ajustes (Ajustes de costos), donde se cargan las tarifas: precio del "
        "kWh, desgaste por hora, costo fijo por trabajo y margen por defecto, en pesos con coma "
        "para los centavos.",
        "Calcular costo está en /costos: elegís una pieza, la cantidad, la bobina, una impresora "
        "(opcional) y si es venta (¿Venta?) con su margen. No se guarda nada.",
        "Costo de un proyecto: en /proyectos, botón Costo; la bobina, la impresora y el margen "
        "se eligen por línea.",
        "El costo fijo por trabajo se suma una sola vez a cada cálculo, sin importar la cantidad.",
        "Si todavía no guardaste los ajustes, los costos se calculan con ceros.",
    ),
    "cola": (
        "Pantalla: /proyectos, botón Cola de cada proyecto (Cola de impresión); se crea "
        "por proyecto.",
        "Se elige el objetivo (cumplir las fechas límite, terminar lo antes posible o minimizar "
        "tiempos muertos), una impresora o varias (de 2 a 10) y cuáles impresoras activas usar.",
        "Cada línea muestra cuántas unidades se imprimieron; los botones +1 impresa y -1 "
        "actualizan el avance.",
        "Podés pedirme que proponga la cola: aparece en el Asistente (/asistente) y se crea "
        "recién cuando la confirmás.",
    ),
    "ventanas": (
        "Pantalla: /disponibilidad (Disponibilidad para intervenir), donde se cargan las "
        "ventanas de intervención.",
        "Indicás en qué horarios podés intervenir la impresora, por semana y en hora de "
        "Argentina; un día sin rangos significa que no intervenís ese día.",
        "Una excepción reemplaza los rangos de la semana para una fecha puntual.",
        "La sección Ausencias de /disponibilidad guarda períodos (desde y hasta, inclusive) en "
        "los que no intervenís; ganan sobre la semana y las excepciones.",
        "Fuera de esos horarios las impresiones corren sin supervisión. Si no guardaste nada, "
        "se usa de 08:00 a 18:00 todos los días.",
    ),
    "simulacion": (
        "Pantalla: /proyectos, botón Simular de cada proyecto (necesita una cola).",
        "La simulación usa el orden de la cola; solo empieza y retira piezas dentro de tus "
        "ventanas de intervención (/disponibilidad).",
        "Las horas son de Argentina y se calcula hasta 14 días desde el inicio elegido.",
        "Muestra cuándo termina, si se cumple la fecha límite y las unidades que no entran. "
        "No se guarda nada.",
    ),
    "optimizacion": (
        "Pantalla: /proyectos, botón Simular y luego «Optimizar y comparar».",
        "Prueba varias formas de ordenar el trabajo, agrupa piezas iguales en una misma placa y "
        "las compara con el orden simple. No se guarda nada.",
        "El ahorro al agrupar piezas se configura en /planificacion/ajustes (0 a 50 %).",
        "Con 0 no se ahorra tiempo; después de guardar el ajuste, volvé a optimizar para ver "
        "el efecto.",
    ),
    "piezas": (
        "Pantalla: /piezas (catálogo); «Nueva pieza» está en /piezas/nueva.",
        "Se cargan nombre, material, medidas en mm (ancho, largo, alto), peso estimado en "
        "gramos, tiempo de impresión, altura de capa y, opcional, la impresora sugerida.",
        "También se puede importar desde un G-code de Cura: elegí primero el material; los "
        "valores se cargan como sugerencia y se pueden corregir.",
        "Si se elimina una pieza, las líneas de proyecto que la usan quedan como pieza eliminada.",
    ),
    "filamentos": (
        "Pantalla: /filamentos (stock de bobinas); «Nuevo filamento» está en /filamentos/nuevo.",
        "Cada bobina tiene marca, material, color, peso inicial y disponible en gramos, costo "
        "de compra en pesos y fecha de compra.",
        "El botón «Descontar material» resta gramos de una bobina.",
        "Los costos usan el costo de compra de la bobina que se elige al calcular.",
    ),
    "impresoras": (
        "Pantalla: /impresoras; «Nueva impresora» está en /impresoras/nueva.",
        "Se cargan nombre, volumen de impresión (ancho, fondo y alto en mm), boquilla, "
        "materiales compatibles, estado y, opcional, velocidad típica y potencia en watts.",
        "La potencia se usa para el costo de electricidad.",
        "Una impresora que usa una cola con trabajo pendiente no se borra: queda «Pendiente de "
        "eliminar» y no se puede elegir en colas nuevas.",
    ),
    "asistente": (
        "Pantalla: /asistente (Asistente): respondo preguntas sobre proyectos, costos, stock y "
        "planificación con los datos del sistema.",
        "Puedo proponer crear un proyecto o una cola; la propuesta aparece en pantalla y no se "
        "crea nada hasta que la confirmás.",
        "No edito ni borro: eso se hace desde las pantallas de la aplicación.",
        "Cada pregunta se responde por separado y mis respuestas pueden contener errores.",
    ),
}
