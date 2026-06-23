# Despliegue en servidor Windows (HTTP plano para SAP)

Objetivo: que **SAP consuma el espejo por HTTP plano** dentro de la red del cliente, sin TLS.
Ese es el tramo que resuelve el problema —SAP no negocia el TLS moderno del PAC; el espejo sí—.

```
   SAP  ──HTTP plano (sin TLS/cert/SNI)──▶  ESPEJO (Windows, Node)  ──HTTPS TLS 1.2──▶  PAC Detecno
```

> **No** expongas el espejo a SAP por `https://` (ni túnel Cloudflare ni IIS con TLS): reintroduce
> la misma capa TLS que SAP no puede y la prueba fallaría por la razón equivocada.

---

## 1. Requisitos en el servidor

- **Node.js LTS** (https://nodejs.org) — verifica con `node -v`.
- **NSSM** (https://nssm.cc) para correr Node como servicio de Windows. Deja `nssm.exe` en el PATH.
- Acceso de red **SAP → servidor** en el puerto elegido (ej. `8000`).
- Salida **servidor → PAC** por HTTPS 443 (el espejo necesita alcanzar a Detecno).

## 2. Copiar y compilar el proyecto

Copia el repo a, p. ej., `C:\espejo-detecno` (sin `node_modules`). Luego, en esa carpeta:

```powershell
npm ci
npm run build
```

Esto genera `dist\main.js`.

## 3. Crear el `.env`

Crea `C:\espejo-detecno\.env`. La clave es **`QAS_PUBLIC_URL` = la URL con la que SAP ve al espejo**
(host real del servidor + puerto + `/qas/Detecno.svc`), en `http://`:

```env
PORT=8000
PAC_TLS_REJECT_UNAUTHORIZED=true

# QAS
QAS_ENABLED=true
QAS_PAC_URL=https://detecno-factura-electronica.com/Emision/cfdiWcfEmisionServicio40_Demo/Detecno.svc
QAS_PUBLIC_URL=http://NOMBRE-O-IP-DEL-SERVIDOR:8000/qas/Detecno.svc
QAS_ALLOWED_OPS=ComprobanteGenerarSAT40
QAS_WSA_AUTOINJECT=true

# PRD (apagado hasta tener licencia productiva)
PRD_ENABLED=false
PRD_PAC_URL=https://genera.emisiondetecno.mx/Detecno/WebService_EmisionServicio40/Detecno.svc
PRD_PUBLIC_URL=http://NOMBRE-O-IP-DEL-SERVIDOR:8000/prd/Detecno.svc
PRD_ALLOWED_OPS=ComprobanteGenerarSAT40
PRD_WSA_AUTOINJECT=true
```

- Usa el **hostname o IP que SAP resuelve** (no `localhost`).
- `PORT` debe coincidir con el `-Port` del script de instalación.

## 4. Instalar el servicio (NSSM)

En PowerShell **como Administrador**, dentro de `scripts\windows`:

```powershell
.\install-service.ps1 -ProjectDir "C:\espejo-detecno" -Port 8000
```

El script: registra el servicio `EspejoDetecno` (arranque automático), configura logs con rotación
en `C:\espejo-detecno\logs`, abre el puerto en el firewall y arranca el servicio.

> Si `node.exe` no está en la ruta por defecto, pasa `-NodeExe "D:\nodejs\node.exe"`.

## 5. Validar

En el **servidor**:

```powershell
curl http://localhost:8000/health
```

Desde **otro equipo de la red** (simula a SAP):

```
http://NOMBRE-O-IP-DEL-SERVIDOR:8000/qas/Detecno.svc?singleWsdl
```

Debe descargar el WSDL con el endpoint reescrito a esa misma URL `http://...:8000/qas/...`.

## 6. Lo que se entrega a SAP

- **WSDL:** `http://NOMBRE-O-IP-DEL-SERVIDOR:8000/qas/Detecno.svc?singleWsdl`
- **Endpoint:** `http://NOMBRE-O-IP-DEL-SERVIDOR:8000/qas/Detecno.svc`

SAP consume ese WSDL (SM59/SOAMANAGER + proxy consumidor). Por ser `http://`, no entra TLS,
ni certificado en STRUST, ni SNI. Con `QAS_WSA_AUTOINJECT=true`, aunque SAP no genere WS-Addressing,
el espejo lo completa.

---

## Operación

| Acción | Comando |
|---|---|
| Estado | `nssm status EspejoDetecno` |
| Reiniciar (tras cambiar `.env`) | `nssm restart EspejoDetecno` |
| Detener | `nssm stop EspejoDetecno` |
| Logs | `C:\espejo-detecno\logs\out.log` y `err.log` |
| Desinstalar | `.\uninstall-service.ps1 -Port 8000` |

## Actualizar a una nueva versión

```powershell
nssm stop EspejoDetecno
# reemplazar fuentes, luego:
npm ci
npm run build
nssm start EspejoDetecno
```

## Notas

- **Liberar más operaciones:** edita `QAS_ALLOWED_OPS` (coma) y `nssm restart`. Vacío = todas.
- **Encender PRD:** `PRD_ENABLED=true` + licencia productiva válida. Genera CFDI reales.
- **¿IIS?** No es necesario para HTTP plano. Solo si más adelante quieres un reverse proxy en :80/:443
  hacia el Node; para la prueba con SAP por HTTP, el servicio NSSM directo basta.
