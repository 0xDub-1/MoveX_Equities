# MoveX Equities

**Mercados diarios de volatilidad sobre acciones. Operas cuánto se mueve una acción, no hacia dónde.**

> Estado: especificación para el hackathon Stocklana (Solana Foundation, deadline viernes 18 sept 2026, 16:00 ET).
> Este documento define el producto y el diseño on-chain. Versión en inglés: `PROJECT.en.md`.

---

## 1. Qué es esto

Cada día de mercado, para cada ticker listado, abrimos un mercado sobre una sola pregunta:

> **¿Cuánto se va a mover esta acción hoy?**

No si sube. No si baja. Cuánto. Depositas USDC en uno de los dos lados de un umbral, transcurre la sesión, y el lado que acertó se reparte el bote.

Eso es todo el producto. Sin escalera de strikes que aprender, sin griegas, sin margen, sin liquidaciones. Una pregunta por mercado, un número, una sesión.

---

## 2. El problema

La volatilidad es de las cosas más operadas en finanzas tradicionales. Comprar un straddle antes de un catalizador es una operación retail estándar. Millones de personas lo hacen.

On-chain, nadie puede hacerlo.

Las acciones tokenizadas están llegando rápido a Solana, y te permiten expresar exactamente una visión: sube o baja. Si tu visión es "NVDA se va a mover fuerte y no sé hacia dónde", no existe instrumento para ti. O eliges una dirección en la que no tienes convicción, o te quedas fuera.

Existen protocolos de opciones, pero le piden al retail entender strikes, vencimientos, griegas y superficies de volatilidad implícita. Ese es un muro que la mayoría nunca escala.

MoveX Equities colapsa la volatilidad en un solo número que cualquiera puede razonar: **la acción se movió 2.0% hoy, ¿eso fue más o menos que 1.55%?**

---

## 3. Cómo funciona un mercado

### 3.1 El ciclo diario

```
15:55 ET  (día D-2)   Se calcula el strike con las últimas 20 sesiones y se congela.
                      El mercado abre a depósitos.
                          |
                          |   ventana de depósito (~24 horas)
                          |   aquí también puedes retirar libremente
                          ↓
16:00 ET  (día D-1)   LOCK. Se cierran los depósitos.
                      Se lee de Pyth el precio de referencia (el cierre de ese día).
                          |
                          |   gap nocturno, y después la sesión completa
                          ↓
16:00 ET  (día D)     SETTLE. Se lee de Pyth el precio de liquidación (el cierre).
                      movimiento = |liquidación - referencia| / referencia
                      Se determina el lado ganador. El bote queda repartible.
                          |
                          ↓
                      CLAIM. Los ganadores retiran su parte cuando quieran.
```

Medimos **de cierre a cierre**, que es el número que cualquier persona ya entiende cuando dice "cuánto se movió hoy".

Es una decisión deliberada frente a lo intradía (de apertura a cierre), por una razón decisiva: **medir intradía vuelve invisibles los earnings.** Una empresa reporta después del cierre, la acción abre al día siguiente con un gap del 8%, y luego deriva plana durante toda la sesión. Un mercado intradía registraría un movimiento del 0.4% y pagaría BELOW en el día más volátil del trimestre. De cierre a cierre captura el gap, que es donde vive buena parte de la volatilidad de una acción individual.

Las dos lecturas del oráculo caen a las 16:00 ET, con el mercado vivo, así que el manejo de staleness se mantiene simple.

Una salvedad que no estamos tapando: si una lectura de Pyth a las 16:00:00 devuelve el print oficial de cierre o el precio del continuo justo antes de la subasta está sin verificar, y se va a medir antes de congelar la liquidación. Ver 11.

En todo momento hay dos mercados por peldaño en vuelo: uno bloqueado y midiendo, otro abierto a depósitos. Siempre hay algo que operar.

### 3.2 Dos botes, sin orderbook

No hay libro de órdenes, ni motor de matching, ni precio continuo. Hay dos botes y eliges uno:

```
Mercado: NVDA · sesión 2026-09-16 · strike 1.55%

     ┌──────────────────────┐   ┌──────────────────────┐
     │        ABOVE         │   │        BELOW         │
     │                      │   │                      │
     │  se mueve MÁS de     │   │  se mueve MENOS de   │
     │  1.55% (hacia donde  │   │  1.55%               │
     │  sea)                │   │                      │
     └──────────────────────┘   └──────────────────────┘
```

Nunca te emparejan con una contraparte concreta. El bote contrario **es** tu contraparte, colectivamente.

### 3.3 Las cuotas salen del ratio de los botes

Nadie fija cuotas. Salen solas de dónde está el dinero.

```
Bote ABOVE   $70,000
Bote BELOW   $30,000
             ────────
BOTE TOTAL   $100,000
```

El mercado está diciendo colectivamente "hay como un 70% de probabilidad de que sea un día grande".

| Si gana este lado | Multiplicador |
|---|---|
| ABOVE | 100k / 70k = **1.43x** |
| BELOW | 100k / 30k = **3.33x** |

Apostar al lado impopular paga más. Mecánica parimutuel estándar, la misma de las carreras de caballos o de los pools tipo Polymarket.

### 3.4 Ejemplo trabajado

Alice deposita **$1,000 en BELOW** en el mercado de NVDA de arriba.

El cierre de referencia fue 218.29. La sesión siguiente cierra en 213.90.

```
movimiento = |213.90 - 218.29| / 218.29 = 2.01%
2.01% > 1.55%  →  gana ABOVE
```

Alice pierde sus $1,000.

Ahora al revés. NVDA cierra en 220.15:

```
movimiento = |220.15 - 218.29| / 218.29 = 0.85%
0.85% < 1.55%  →  gana BELOW

Participación de Alice en el bote BELOW:  1,000 / 30,000 = 3.33%
Bote tras el 1% de fee del protocolo:      $99,000
Alice recibe:                              3.33% × 99,000 = $3,300
Ganancia:                                  +$2,300   (ROI +230%)
```

---

## 4. El strike: se calcula, no se inventa

Esta es la parte que define la credibilidad del producto. Si un humano elige el umbral, todo esto es arbitrario y es un casino con pasos de más.

Así que ningún humano lo elige.

### 4.1 La fórmula

```
1. Tomas las últimas 20 sesiones completas del ticker.
2. Para cada una, el movimiento absoluto de cierre a cierre:
      |cierre - cierre_previo| / cierre_previo
3. Ordenas los 20 valores.
4. Lees los percentiles. Cada uno se convierte en un strike.
```

El paso 2 mide exactamente lo mismo con lo que liquida el mercado (3.1). Calibrar con una definición y liquidar con otra valoraría mal todos los peldaños, en silencio.

Usamos **percentiles empíricos**, no un modelo de volatilidad. La propiedad que importa: cada strike lleva su tasa histórica **incorporada por construcción**.

| Percentil | Sesiones que lo superaron |
|---|---|
| P25 | 75% (15 de 20) |
| P50 | 50% (10 de 20) |
| P75 | 25% (5 de 20) |

Esto es aritmética sobre la serie, no una estimación. Un usuario lo puede verificar contando.

**Por qué percentiles y no desviaciones estándar.** El enfoque convencional fija los strikes como múltiplos de sigma. Eso asume que los retornos siguen una distribución normal, y los retornos de acciones no la siguen: tienen colas gordas, así que una escalera basada en sigma subestima precisamente los días violentos que más le importan a un producto de volatilidad. Leer cuantiles empíricos no asume ninguna distribución.

Para orientarse: bajo normalidad la mediana del movimiento absoluto equivale a aproximadamente 0.67 sigma, y la banda P25 a P75 cubre de unos 0.32 a 1.15 sigma. El mismo territorio que una escalera de sigma, pero sin asumir la distribución.

### 4.2 Ejemplo trabajado

Las últimas 20 sesiones de NVDA, movimiento absoluto de cierre a cierre, ordenadas. Datos reales, ventana que termina el 2026-09-11:

```
0.03  0.06  0.07  0.33  0.84 │ 0.91  0.98  0.99  1.48  1.51 │ 1.59  1.80  2.01  2.19  2.34 │ 2.37  2.91  3.21  4.57  8.74
                             ↑                              ↑                              ↑
                        P25 = 0.89%                   P50 = 1.55%                    P75 = 2.35%
```

Esos tres números son los tres strikes de la sesión. Cuando un usuario pregunte "¿por qué 1.55%?", la respuesta es "porque 10 de las últimas 20 sesiones de NVDA se movieron más que eso y 10 se movieron menos. Aquí están los 20 números." La interfaz muestra la serie completa.

Fíjate en el 8.74% del borde derecho, casi seguro un día de earnings o un titular grande. La mediana ni se inmuta. Una media o una desviación estándar habrían sido arrastradas hacia arriba por esa única sesión, que es justamente por lo que la escalera se construye sobre cuantiles.

### 4.3 Calibración ilustrativa

Cada ticker se autocalibra. Sin configuración, sin ajuste manual. Valores reales, de cierre a cierre, ventana de 20 sesiones terminando el 2026-09-11:

| Ticker | TIGHT (P25) | FAIR (P50) | WIDE (P75) |
|---|---|---|---|
| SPY | 0.30% | 0.45% | 0.67% |
| NVDA | 0.89% | 1.55% | 2.35% |
| TSLA | 0.71% | 1.71% | 4.04% |

Estos valores se desplazan cada día conforme la ventana avanza. La ventana de arriba es un tramo relativamente tranquilo para NVDA; en un mes volátil el mismo cálculo produce strikes bastante más anchos sin que nadie toque una configuración.

### 4.4 Transparencia honesta sobre la confianza

El strike se calcula **fuera de la cadena** por un keeper y se pasa a `init_market`. Guardar 20 días de histórico de precios on-chain para calcularlo dentro del programa sería prohibitivamente caro para una v1.

Lo que hace esto aceptable:

- La fórmula es pública y determinista. Cualquiera con datos de mercado gratuitos puede reproducirla.
- Los 20 valores de entrada se publican en la interfaz junto al mercado.
- El strike queda **congelado al crear el mercado** y no se puede mutar una vez abiertos los depósitos. El programa no tiene ninguna instrucción para cambiarlo.

El cálculo del strike on-chain (o un esquema de hash comprometido) es un punto del roadmap, no una promesa de la v1. Lo decimos claramente en vez de fingir lo contrario.

### 4.5 Los earnings no son un producto aparte

Bajo este modelo, un día de earnings es simplemente una sesión donde los percentiles recientes resultan ser más anchos. Los strikes se ensanchan solos, el volumen se dispara solo, y nosotros no construimos nada adicional.

Esa es la ventaja de ir a diario en vez de por eventos: **252 mercados por ticker al año en lugar de 4.**

---

## 5. La escalera de strikes

### 5.1 Dos lados, varios strikes

Son dos cosas distintas y la diferencia importa:

```
Un MERCADO tiene 2 lados:     ABOVE / BELOW          siempre exactamente dos
Un TICKER tiene N mercados:   TIGHT / FAIR / WIDE    esto es la escalera
```

Cada peldaño de la escalera es su propio mercado binario independiente, con sus dos botes y su propio vault. No comparten liquidez y liquidan por separado.

### 5.2 Los peldaños son percentiles

Cada peldaño es un percentil empírico de las últimas 20 sesiones (ver 4.1). Sin multiplicadores, sin números elegidos a mano.

| Nivel | Percentil | Tasa histórica de ABOVE | La pregunta que hace |
|---|---|---|---|
| **TIGHT** | P25 | 75% | ¿Se mueve algo hoy? |
| **FAIR** | P50 | 50% | La moneda al aire. |
| **WIDE** | P75 | 25% | ¿Es un día grande? |

```
NVDA · sesión 2026-09-16

┌─────────┬───────────┬────────┬───────┬────────┬─────────────────┐
│ Nivel   │ Percentil │ Strike │ ABOVE │ BELOW  │ Prob. implícita │
├─────────┼───────────┼────────┼───────┼────────┼─────────────────┤
│ TIGHT   │    P25    │  0.89% │  $80k │  $20k  │  80% above      │
│ FAIR    │    P50    │  1.55% │  $70k │  $30k  │  70% above      │
│ WIDE    │    P75    │  2.35% │  $25k │  $75k  │  25% above      │
└─────────┴───────────┴────────┴───────┴────────┴─────────────────┘
```

Compara la columna de probabilidad implícita contra la tasa histórica y tienes una señal operable: aquí el mercado está valorando todos los peldaños por encima de su frecuencia histórica, o sea una multitud inclinada hacia largo de volatilidad.

### 5.3 La escalera genera las ventanas gratis

Tres strikes parten el espacio de resultados en cuatro ventanas, y como los strikes son cuartiles, cada ventana lleva exactamente 25% de probabilidad histórica. Esto es lo que muestra la interfaz:

```
NVDA · hoy

 ┌───────────┬───────────────┬───────────────┬───────────┐
 │  < 0.89%  │ 0.89 - 1.55%  │ 1.55 - 2.35%  │  > 2.35%  │
 │           │               │               │           │
 │    25%    │      25%      │      25%      │    25%    │
 └───────────┴───────────────┴───────────────┴───────────┘
     plano       tranquilo        movido       día loco
```

La diferencia crítica respecto a buckets realmente excluyentes: **lo que se muestra son ventanas, lo que se opera son los tres mercados binarios.**

Para tomar la ventana de "1.55 a 2.35%", un trader compra ABOVE en FAIR y BELOW en WIDE. Si la sesión termina en 2.4%, gana una pata y pierde la otra en vez de irse a cero por cinco centésimas de punto. Los mercados de opciones reales funcionan exactamente así: ves una escalera de strikes, y los spreads y mariposas se construyen combinando peldaños.

### 5.4 Cuántos peldaños: la regla de escalado

El número de peldaños es una decisión de liquidez, no de gusto. Cada peldaño parte el capital, y un bote con unos cientos de dólares dentro produce multiplicadores absurdos y una interfaz que parece rota.

| Peldaños | Percentiles | Ventanas | Cuándo |
|---|---|---|---|
| 1 | P50 | 2 | Ticker nuevo o poco líquido |
| **3** | **P25 / P50 / P75** | **4** | **Por defecto** |
| 5 | P10 / P25 / P50 / P75 / P90 | 6 | Solo cuando todos los botes existentes están gordos |

Los peldaños se añaden cuando los botes existentes superan un umbral de tamaño, nunca por capricho. Los percentiles siempre son simétricos alrededor de P50, así que la escalera nunca queda sesgada hacia un lado.

**Coste de implementación de la escalera: cero líneas extra.** El programa ya soporta N mercados. Cada peldaño es otra llamada a `init_market` con un strike distinto.

Cada ticker listado corre la escalera completa de tres peldaños. La liquidez en todos los peldaños la siembran cuentas que opera el proyecto, así que ningún bote queda vacío.

---

## 6. Arquitectura

Todo on-chain. Sin sequencer, sin matching fuera de cadena, sin custodia.

### 6.1 Cuentas

```
Market  (PDA: ["market", ticker, session_date, tier])
├── underlying          símbolo del ticker
├── pyth_feed           cuenta de precio de Pyth para esta acción
├── session_date        el día de mercado que se está midiendo
├── tier                Tight | Fair | Wide
├── strike_bps          ej. 155 = 1.55%
├── state               Open | Locked | Settled | Voided
├── reference_price     se escribe en el lock
├── settlement_price    se escribe en el settle
├── above_pool          total de USDC depositado en above
├── below_pool          total de USDC depositado en below
├── winning_side        se escribe en el settle
├── fee_bps             fee del protocolo
├── lock_ts / settle_ts timestamps unix
└── bump

Position  (PDA: ["position", market, user])
├── user
├── market
├── side                Above | Below
├── amount              USDC depositado
├── claimed             bool
└── bump

Vault  (cuenta de token PDA propiedad del mercado)
└── custodia todo el USDC de este mercado
```

### 6.2 Instrucciones

| Instrucción | Quién | Qué hace |
|---|---|---|
| `init_market` | admin | Crea un mercado con su strike congelado y sus timestamps |
| `deposit` | usuario | Deposita USDC en ABOVE o BELOW. Solo en estado `Open` y antes de `lock_ts` |
| `withdraw` | usuario | Recupera el depósito. Solo antes del lock. La vía de escape |
| `lock` | cualquiera | Crank sin permisos. Lee Pyth, guarda `reference_price`, estado → `Locked` |
| `settle` | cualquiera | Crank sin permisos. Lee Pyth, calcula el movimiento, fija ganador, estado → `Settled` |
| `claim` | usuario | El ganador retira su parte proporcional |

`lock` y `settle` son sin permisos a propósito. Nosotros corremos un keeper, pero si se muere, cualquiera puede empujar el mercado hacia adelante. El protocolo nunca se queda atascado esperándonos.

### 6.3 Matemática de liquidación

```
movimiento_bps = |precio_liquidación - precio_referencia| × 10_000 / precio_referencia

gana_above = movimiento_bps > strike_bps    // empate exacto va a BELOW, declarado explícitamente

bote        = bote_above + bote_below
fee         = bote × fee_bps / 10_000
repartible  = bote - fee

pago(usuario) = usuario.amount × repartible / bote_ganador
```

### 6.4 Casos límite

| Situación | Comportamiento |
|---|---|
| Un bote está vacío al hacer lock | El mercado se **anula**. Todos recuperan su depósito íntegro. Un bote sin contraparte no es un mercado |
| Precio de Pyth no disponible o demasiado viejo en lock o settle | El mercado se **anula**. Todos recuperan |
| `movimiento_bps` exactamente igual a `strike_bps` | Gana BELOW. Documentado en la interfaz, sin ambigüedad |
| Nadie reclama | Los fondos siguen reclamables indefinidamente. Sin caducidad ni barrido en la v1 |
| Halt de cotización a media sesión | Pyth deja de actualizar, salta el check de staleness en el settle, el mercado se anula y devuelve |

Fíjate en lo que es estructuralmente imposible aquí: no puedes perder más de lo que depositaste, no hay margen, no hay liquidación, no hay deuda mala, y por lo tanto no hace falta fondo de seguro. El peor resultado posible para un usuario es perder lo que puso.

---

## 7. Por qué Solana

Este es un criterio de evaluación del hackathon, así que conviene responderlo bien en vez de salir por la tangente.

**Pyth es nativo aquí.** Pyth nació en Solana. Publica feeds de precios de acciones de primera mano, actualizados cada 400ms, gratis de consumir, provenientes de las firmas que realmente hacen esos mercados. Esto no es un bridge retransmitiendo números desde otro sitio. Para un producto cuyo payoff entero **es** la lectura del oráculo, eso pesa más que cualquier otra cosa del stack.

**Las acciones tokenizadas viven aquí.** El ecosistema que se está formando alrededor de las acciones on-chain en Solana es exactamente la base de usuarios que necesita un instrumento de volatilidad. Nos sentamos al lado, no lejos.

**Todo cabe on-chain.** El cómputo y las fees son suficientemente baratos como para que el mercado, los vaults, la liquidación y los pagos vivan en un solo programa. Sin motor de matching fuera de cadena, sin sequencer en quien confiar, sin custodia. Eso no es cierto en la mayoría de cadenas, y es una historia de confianza notablemente más fuerte que la de nuestro propio producto en EVM.

---

## 8. Testing fuera de horario de mercado

Los feeds de acciones de Pyth solo se actualizan en horario regular de mercado estadounidense (09:30 a 16:00 ET, entre semana). Fuera de esa ventana el feed devuelve el último cierre con un `publish_time` viejo, y cualquier check de staleness razonable lo rechaza.

Es una restricción real de desarrollo. Tres mitigaciones, todas dentro del alcance:

**Modo mock oracle.** El programa acepta una cuenta `MockPrice` en lugar de una cuenta de Pyth cuando se compila con la feature `dev-oracle`. Un admin puede fijar precios arbitrarios para llevar un mercado por su ciclo de vida completo en segundos. Se compila fuera del build de mainnet por completo, así que no puede activarse en producción.

**Mercados cripto para devnet siempre activo.** Los feeds de BTC y SOL de Pyth funcionan 24/7. Mantenemos un set paralelo de mercados cripto en devnet para que siempre haya un mercado vivo con oráculo real que tocar un domingo. La lógica de liquidación es idéntica, solo cambian el feed y la ventana de sesión.

**Grabar la demo en horario de mercado.** El deadline de entrega es el viernes a las 16:00 ET, que cae dentro de la sesión. Grabamos el video con feeds de acciones reales el jueves o el viernes por la mañana, no la noche anterior.

---

## 9. Alcance

### Dentro del alcance del hackathon

- Programa Anchor: las seis instrucciones de arriba, todo on-chain
- Integración con Pyth con checks de staleness e intervalo de confianza
- Mock oracle detrás de un feature flag de desarrollo
- Despliegue en devnet con mercados sembrados
- Script keeper: calcula el strike de las últimas 20 sesiones, llama a `init_market`, y empuja `lock` y `settle`
- Frontend reutilizando el design system existente de MoveX: lista de mercados, depósito, vista de posición, claim
- Tarjeta de PnL compartible (portada desde la implementación existente de MoveX)
- Tres tickers, NVDA, TSLA y SPY, cada uno con la escalera completa

### Explícitamente fuera del alcance de la v1

- Libro de órdenes y precio continuo
- Mercado secundario / salida anticipada después del lock
- Leverage y margen
- Cálculo del strike on-chain
- Mercados intradía (apertura a cierre) como segunda línea de producto
- Despliegue en mainnet

### Roadmap posterior al hackathon

1. **Posiciones transferibles.** Convertir `Position` en un token para poder venderla antes de la liquidación. Es el camino más barato hacia una salida sin construir un libro de órdenes.
2. **Strike on-chain o comprometido.** Publicar un hash de la serie de entrada al crear el mercado, para que el strike pase de reproducible a verificable.
3. **Mercados intradía junto a los diarios.** De cierre a cierre es el default correcto porque captura el gap, pero un mercado de solo sesión es un instrumento genuinamente distinto: aísla el rango intradía del riesgo nocturno. Vale la pena ofrecerlo cuando los mercados diarios tengan liquidez.
4. **Mercados continuos.** Un libro de órdenes real con precio de volatilidad en vivo. Eso es MoveX propiamente dicho, y ya existe en HyperEVM.

---

## 10. Relación con MoveX

MoveX Equities no es un port de MoveX ni una versión inferior. Es la misma primitiva expresada para otro usuario y otra estructura de mercado.

| | MoveX Equities (Solana) | MoveX (HyperEVM) |
|---|---|---|
| Estructura de mercado | Botes parimutuel | Libro de órdenes, precio continuo |
| Usuario | Retail, toma una postura y espera | Trader activo, gestiona posición |
| Horizonte | Una sesión | Continuo, entra y sale cuando quiere |
| Riesgo | Limitado al depósito | Margen, leverage, liquidación |
| Subyacente | Acciones estadounidenses | Cripto |
| Superficie de confianza | Todo on-chain | Matching fuera de cadena, liquidación on-chain |

Ambos responden la misma pregunta, que es la tesis de la compañía entera: **opera la magnitud, no la dirección.**

---

## 11. Preguntas abiertas

- **¿Una lectura de Pyth a las 16:00 equivale al cierre oficial?** Sin verificar, y es lo más importante de esta lista. El cierre oficial sale de la subasta de cierre de las 16:00:00, que imprime segundos o minutos después, así que una lectura a las 16:00:00 exactas captura el mercado continuo justo antes. Como los strikes se calibran sobre cierres oficiales, liquidar sobre otra cosa significa calibrar con una definición y liquidar con otra, que es justo lo que advierte 4.1. Se está midiendo contra el feed vivo antes de congelar la lógica de liquidación. Ver `ROADMAP.md`, Phase 3.
- **Nivel de fee.** El 1% del bote es un valor provisional. Necesita decisión antes de mainnet, no antes del hackathon.
- **Umbral para añadir peldaños.** La regla de escalado de 5.4 dice que los peldaños se añaden cuando los botes son suficientemente profundos, pero el umbral concreto en dólares está sin fijar. Necesita datos de uso real.
- **Bote mínimo viable.** Por debajo de cierto tamaño de bote los ratios se vuelven ridículos. Considerar un mínimo por debajo del cual el mercado se anula en el lock.
- **Ventana de lookback.** 20 sesiones es la elección estándar, pero ventanas más cortas reaccionan más rápido a cambios de régimen. EWMA (RiskMetrics, lambda 0.94) es la mejora natural, a costa de perder la verificabilidad de "cuenta tú mismo los números" que hace tan fácil defender los percentiles.
- ~~**Interpolación de percentiles.**~~ Resuelto. Con 20 muestras P25 y P75 caen entre observaciones, así que el keeper interpola linealmente entre los dos vecinos. Escoger la observación más cercana sesgaría P50 hacia un lado de la distribución, y ese es justo el peldaño que tiene que ser una moneda al aire de verdad. La convención queda fijada por tests contra la serie publicada de NVDA.
