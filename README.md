# Espejo Detecno — Proxy SOAP para timbrado CFDI 4.0 desde SAP

Proxy SOAP **transparente** del PAC Detecno. Resuelve que SAP no pueda consumir
el servicio del PAC por incompatibilidad de TLS (el PAC negocia TLS 1.2 con suites
ECDHE modernas que un SAP antiguo no soporta).

```
   SAP  ──HTTP/TLS que SAP sí soporta──▶  ESPEJO (Node)  ──TLS 1.2 moderno──▶  PAC Detecno
        ◀───────────────────────────────              ◀───────────────────────
```

El espejo **no re-implementa** las operaciones del PAC: reenvía byte a byte el sobre
SOAP que manda SAP y devuelve tal cual la respuesta del PAC. Cubre automáticamente
las 18 operaciones (Generar, Buscar, Cancelar, PDF, Retenciones).

## Cómo funciona

1. **WSDL / XSD (GET `?wsdl`, `?xsd=...`, `?singleWsdl`)**: el espejo trae el documento
   del PAC y **reescribe la URL del endpoint** por la URL pública del espejo. Así, cuando
   SAP genera el proxy consumidor desde el WSDL, apunta al espejo y no al PAC inalcanzable.
2. **Operaciones (POST SOAP)**: el espejo reescribe en el cuerpo la URL del espejo de vuelta
   a la del PAC (cabecera `wsa:To` → evita el *AddressFilter mismatch* de WCF) y reenvía la
   petición preservando `Content-Type` y `SOAPAction`.

## Requisitos

- Node.js 18+ (probado en v24).

## Instalación y arranque

```bash
npm install
cp .env.example .env      # ajustar valores (ver abajo)
npm run build
npm run start:prod        # produccion
# npm run start:dev       # desarrollo con watch
```

## Configuración (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto único donde el espejo escucha (lo que SAP consume). |
| `QAS_ENABLED` / `PRD_ENABLED` | Enciende/apaga cada ambiente. PRD apagado por defecto. |
| `QAS_PAC_URL` / `PRD_PAC_URL` | URL real del PAC por ambiente (sin querystring). |
| `QAS_PUBLIC_URL` / `PRD_PUBLIC_URL` | URL pública del espejo **tal como SAP la alcanza** (host:puerto + `/qas/Detecno.svc`). Se inyecta en el WSDL y se usa para reescribir `wsa:To`. |
| `PAC_TLS_REJECT_UNAUTHORIZED` | `true` (recomendado) valida el cert del PAC. `false` solo para diagnóstico. |

> **Importante:** `*_PUBLIC_URL` debe ser la dirección con la que **SAP** ve al espejo
> (no `localhost` si SAP está en otra máquina). Ej.: `http://10.20.30.40:3000/qas/Detecno.svc`.

### Un solo proceso, dos ambientes

El mismo proceso atiende QAS y PRD bajo rutas distintas. Cada ambiente se enciende o
apaga por flag (PRD apagado por defecto, hay que encenderlo explícitamente):

| Ambiente | Ruta del espejo | PAC | Flag |
|---|---|---|---|
| QAS | `/qas/Detecno.svc` | `detecno-factura-electronica.com/...Demo/Detecno.svc` | `QAS_ENABLED=true` |
| PRD | `/prd/Detecno.svc` | `genera.emisiondetecno.mx/...Detecno.svc` | `PRD_ENABLED=true` |

Variables por ambiente: `*_PAC_URL`, `*_PUBLIC_URL`, `*_ENABLED` (ver `.env.example`).

### Liberación gradual de operaciones

Cada ambiente puede limitar **qué operaciones** se permiten ejecutar, para liberar de a poco:

```env
# Hoy solo se libera la operación pedida; agregar más separadas por coma.
QAS_ALLOWED_OPS=ComprobanteGenerarSAT40
# Mañana, por ejemplo:
# QAS_ALLOWED_OPS=ComprobanteGenerarSAT40,ComprobanteBuscar40,Comprobante_BuscarPdf40
```

- **Vacío o sin definir = todas las operaciones habilitadas.**
- Solo afecta a las peticiones SOAP (POST). El WSDL/XSD (GET) siempre se sirve completo,
  porque SAP necesita el contrato entero para generar su proxy.
- Una operación no habilitada recibe un **SOAP Fault 403** indicando cuáles están activas.
- La operación se identifica por el `action` del `Content-Type` (SOAP 1.2), el header
  `SOAPAction` (SOAP 1.1), el `wsa:Action` del sobre o el primer elemento de `soap:Body`.
- Para cambiar la lista: editar el `.env` y reiniciar el servicio.

## Lo que SAP debe consumir

- **WSDL QAS:** `http://<host-espejo>:<port>/qas/Detecno.svc?singleWsdl`
- **WSDL PRD:** `http://<host-espejo>:<port>/prd/Detecno.svc?singleWsdl`
- **Endpoint:** la misma ruta sin querystring.
- Binding: SOAP 1.2 + WS-Addressing (igual que el PAC; SAP lo genera del WSDL).
- Salud: `GET /health` lista los ambientes y si están encendidos.

## Prueba rápida (curl)

```bash
# Salud
curl http://localhost:3000/health

# WSDL reescrito (debe apuntar al espejo, no al PAC)
curl "http://localhost:3000/qas/Detecno.svc?wsdl" | grep location=

# Timbrado de ejemplo (ver docs/prueba-timbrado.md)
```

## Notas técnicas

- El PAC exige **SOAP 1.2** (`application/soap+xml`) + **WS-Addressing**: el sobre debe llevar
  `wsa:Action` y `wsa:To` en el `<soap:Header>`. SAP los genera al usar el binding del WSDL;
  un `request.xml` con `<soap:Header/>` vacío falla con `ActionMismatch`.
- Cuerpo crudo: el espejo desactiva el body-parser y maneja el SOAP como `Buffer` para no
  alterar el XML ni el base64 del CFDI.
- Límite de cuerpo: 50 MB (ajustable en `src/main.ts`).
