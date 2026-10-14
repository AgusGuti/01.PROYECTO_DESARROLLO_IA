# Propuesta de Proyecto

## Sistema de Gestión y Optimización de Impresiones 3D

| | |
|---|---|
| **Curso / Materia** | `Curso Universitario en Arquitectura de Agentes y AI-Augmented Software Engineering` |
| **Fecha de entrega** | `29/09/2026` |
| **Modalidad** | Proyecto individual |
| **Grupo** | `20` |

---

## Datos del integrante

| Campo | Dato |
|---|---|
| **Apellido y nombre** | `Agustín Adrián Gutiérrez` |
| **Mail** | `ruso9204@gmail.com` |
| **Usuario de GitHub** | `https://github.com/AgusGuti` |

---

# 1. Tema

Sistema web para gestionar proyectos de impresión 3D FDM, calcular sus costos y optimizar la cola de impresión.

El sistema integra tres necesidades:

- **Gestión de proyectos de impresión:** qué piezas hay que fabricar, cuántas y para qué proyecto.
- **Cálculo de costos:** cuánto cuesta producir cada pieza y cada proyecto completo.
- **Planificación y optimización:** en qué orden conviene imprimir las piezas, teniendo en cuenta la disponibilidad de la impresora y las ventanas de tiempo en las que el usuario puede intervenir.

El sistema no se limita a registrar impresiones. Su componente diferencial es un **optimizador de planificación**, capaz de proponer una secuencia de trabajos que aproveche mejor las horas disponibles y reduzca los tiempos muertos.

## 1.1. Objetivo

Desarrollar una herramienta que permita planificar y controlar un conjunto de impresiones 3D, desde la definición de un proyecto hasta la generación de una cola de impresión optimizada.

El sistema deberá permitir responder preguntas como:

- ¿Qué piezas hay que imprimir y cuántas unidades se necesitan?
- ¿Cuánto va a costar y cuánto filamento se va a utilizar?
- ¿Qué impresora conviene utilizar?
- ¿Qué piezas conviene imprimir primero?
- ¿Qué conviene imprimir durante la noche para no tener que intervenir?
- ¿Cómo quedaría distribuida la producción antes de comenzar?

---

# 2. Casos de uso

## 2.1. Resumen

| ID | Caso de uso | Módulo |
|---|---|---|
| CU01 | Registrar proyecto de impresión | Gestión |
| CU02 | Gestionar piezas y modelos | Gestión |
| CU03 | Calcular costo de una impresión | Costos |
| CU04 | Consultar costo total de un proyecto | Costos |
| CU05 | Gestionar inventario de filamentos | Gestión |
| CU06 | Registrar impresoras | Gestión |
| CU07 | Crear cola de impresión | Planificación |
| CU08 | Optimizar el orden de impresión | Planificación |
| CU09 | Definir ventanas de impresión | Planificación |
| CU10 | Simular la planificación | Planificación |

**Actor principal:** Usuario (persona que gestiona y opera las impresoras).

## 2.2. Detalle

### CU01 — Registrar proyecto de impresión

Permite crear un proyecto de impresión indicando información general y las piezas que lo componen.

**Datos:** nombre, descripción, prioridad, fecha límite (opcional), piezas requeridas y cantidad de cada pieza.

**Ejemplo:**

```text
Proyecto: "Set de terreno para campaña"
  4 × Muro
  2 × Torre
  8 × Columna
 10 × Decoración
```

### CU02 — Gestionar piezas y modelos

Permite registrar y administrar las piezas que pueden formar parte de los proyectos. Cada pieza almacena la información necesaria para estimar costos y tiempos. Una misma pieza puede utilizarse en diferentes proyectos.

**Datos:** nombre, descripción, archivo/modelo asociado, dimensiones, peso estimado, tiempo estimado de impresión, material y configuración de impresión.

### CU03 — Calcular costo de una impresión

Calcula el costo estimado de producir una pieza antes de imprimirla.

**Componentes del cálculo:**

- Cantidad de filamento utilizada y su costo.
- Tiempo de impresión.
- Consumo eléctrico.
- Otros costos configurables.
- Margen adicional (opcional), para utilizar el sistema también en la definición de precios de venta.

### CU04 — Consultar costo total de un proyecto

A partir de las piezas y cantidades de un proyecto, calcula el costo total estimado de producción y el material requerido.

```text
Proyecto: Set de terreno

  4 × Muros          $X
  2 × Torres         $Y
  8 × Columnas       $Z
 10 × Decoraciones   $W
--------------------------
 Total estimado      $TOTAL
```

### CU05 — Gestionar inventario de filamentos

Permite administrar los filamentos disponibles. El inventario se utiliza para calcular costos y, potencialmente, verificar si hay material suficiente para completar un proyecto.

**Datos:** marca, material, color, peso inicial, peso disponible, costo de adquisición y fecha de compra.

### CU06 — Registrar impresoras

Permite registrar las impresoras disponibles y sus características, para que la planificación las tenga en cuenta.

**Datos:** nombre, volumen de impresión, tipo de boquilla, materiales compatibles, velocidad o configuración habitual y estado/disponibilidad.

### CU07 — Crear cola de impresión

Permite seleccionar las piezas pendientes de un proyecto y generar una cola de trabajos, que funciona como entrada del optimizador.

**El usuario indica:** qué piezas imprimir, cantidad, prioridad, impresora disponible y restricciones específicas.

```text
Cola inicial
  Torre       × 2
  Muro        × 4
  Columna     × 8
  Decoración  × 10
```

### CU08 — Optimizar el orden de impresión

Componente central del proyecto. El sistema analiza los trabajos pendientes y propone un orden de impresión que aproveche mejor el tiempo disponible. No se trata simplemente de ordenar las piezas por duración.

**Factores a considerar:**

- Duración, prioridad y cantidad de cada trabajo.
- Disponibilidad de la impresora.
- Ventanas en las que el usuario puede intervenir y horarios en los que no puede cambiar una pieza.
- Fecha límite del proyecto.
- Posibilidad de encadenar impresiones.
- Minimización de tiempos muertos.

**Ejemplo:**

```text
08:00–18:00 → el usuario puede cambiar piezas
18:00–08:00 → el usuario no puede intervenir
```

Una pieza de 8 horas conviene programarla durante la noche. Una pieza de 1 hora conviene durante el día, ya que al terminar permite iniciar otra impresión inmediatamente.

### CU09 — Definir ventanas de impresión

Permite indicar cuándo el usuario puede o no puede intervenir en la impresora. Estas restricciones son utilizadas por el optimizador.

**Tipos de ventana posibles:** disponible, no disponible, prioridad alta, horario nocturno, horario de trabajo y horario en el que la impresora no puede utilizarse.

### CU10 — Simular la planificación

Antes de confirmar la cola, el sistema muestra cómo quedarían distribuidas las impresiones en el tiempo. Permite modificar parámetros y volver a ejecutar la planificación antes de comenzar a imprimir.

**Ejemplo conceptual** (ventana de intervención 08:00–18:00):

```text
08:00  Muro #1      ────── 10:00
10:00  Muro #2      ────── 12:00
12:00  Muro #3      ────── 14:00
14:00  Muro #4      ────── 16:00
16:00  Columna #1   ── 16:45
16:45  Columna #2   ── 17:30
17:30  Torre #1     ─────────────── 22:30   (corre sin intervención)
```

**La interfaz muestra:** orden de impresión, hora de inicio, hora estimada de finalización, impresora asignada, tiempo total, tiempos muertos, trabajos pendientes y cumplimiento de restricciones.

---

# 3. Flujo principal del sistema

```text
Crear proyecto
      ↓
Agregar piezas y cantidades
      ↓
Configurar impresoras y filamentos
      ↓
Calcular costos
      ↓
Seleccionar trabajos pendientes
      ↓
Definir disponibilidad / restricciones
      ↓
Generar cola de impresión
      ↓
Optimizar orden
      ↓
Simular planificación
      ↓
Confirmar cola
```

## 3.1. Ejemplo de funcionamiento

Proyecto de piezas de terreno para una campaña de TTRPG:

```text
Proyecto "Set de terreno"
  4 × Muro        → 2 h cada uno
  2 × Torre       → 5 h cada una
  8 × Columna     → 45 min cada una
 10 × Decoración  → 20 min cada una
```

Con la restricción de intervención 08:00–18:00, el sistema busca colocar trabajos suficientemente largos en los períodos sin intervención, evitando situaciones como:

```text
23:00 → comienza impresión
03:00 → termina impresión
03:00–08:00 → impresora parada
```

El resultado se visualiza como una línea temporal que puede ajustarse antes de confirmar la cola.

---

# 4. Stack de tecnología

El proyecto se desarrollará con el **stack MEAN**:

| Capa | Tecnología | Rol en el proyecto |
|---|---|---|
| Base de datos | **MongoDB** | Base de datos NoSQL. Almacena proyectos, piezas, impresoras, filamentos, trabajos y planificaciones. |
| Backend | **Express.js** | Framework para construir la API REST que expone la gestión, los costos y el planificador. |
| Frontend | **Angular** | Framework para la interfaz web: ABM de entidades, visualización de costos y línea temporal de la planificación. |
| Runtime | **Node.js** | Entorno de ejecución del backend, donde también corre el algoritmo de optimización. |

## 4.1. Nivel de experiencia y uso de IA

De las tecnologías del stack, solo tengo experiencia previa con **MongoDB**. Express.js, Angular y Node.js son tecnologías nuevas para mí.

Por este motivo, y tal como se sugirió en el curso, voy a apoyarme fuertemente en herramientas de **inteligencia artificial** durante el desarrollo: para aprender las tecnologías, generar y revisar código, resolver errores y tomar decisiones de diseño. Parte del objetivo del proyecto es justamente evaluar cómo la IA acelera el trabajo sobre un stack desconocido.

---

# 5. Arquitectura conceptual

```text
┌──────────────────────────┐
│   Frontend (Angular)     │
│                          │
│  Proyectos               │
│  Piezas                  │
│  Costos                  │
│  Inventario              │
│  Cola de impresión       │
│  Planificación           │
└────────────┬─────────────┘
             │  API REST (HTTP/JSON)
             ▼
┌──────────────────────────┐
│ Backend (Node + Express) │
│                          │
│  Gestión de proyectos    │
│  Cálculo de costos       │
│  Planificador            │
│  Optimizador             │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Base de datos (MongoDB) │
│                          │
│  Proyectos               │
│  Piezas                  │
│  Impresoras              │
│  Filamentos              │
│  Trabajos                │
│  Planificaciones         │
└──────────────────────────┘
```

## 5.1. Módulos

| Módulo | Responsabilidades |
|---|---|
| **Gestión** | Proyectos, piezas, impresoras, filamentos, cantidades y estado de los trabajos. |
| **Costos** | Costos de filamento, de impresión y por proyecto; estimaciones. |
| **Planificación** | Cola de impresión, ventanas de disponibilidad, restricciones, optimización del orden y simulación temporal. |

El módulo de planificación es el de mayor complejidad algorítmica del sistema.

---

# 6. Alcance

## 6.1. MVP

El MVP se concentra en resolver correctamente tres problemas:

1. **¿Qué hay que imprimir?** — Gestión de proyectos, piezas y cantidades.
2. **¿Cuánto cuesta?** — Cálculo de costos individuales y totales.
3. **¿Cuándo y en qué orden conviene imprimirlo?** — Generación y optimización de la cola según disponibilidad y ventanas de tiempo.

La combinación de estos tres problemas le da al proyecto tanto una parte de **gestión de datos** como una de **lógica de negocio y optimización**, evitando que se reduzca a un CRUD.

## 6.2. Mejoras futuras (fuera del alcance inicial)

- Registrar impresiones realizadas o fallidas.
- Recalcular automáticamente la planificación ante un fallo.
- Comparar costos estimados contra costos reales.
- Consultar el historial de impresiones.
- Generar un resumen completo de cada proyecto.

Estas mejoras permitirían evolucionar el sistema desde una herramienta de planificación hacia un sistema completo de seguimiento de producción.
