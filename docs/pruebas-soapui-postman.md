# Cómo validar el espejo desde otro equipo (SoapUI / Postman)

> La URL pública del túnel es **temporal** y cambia cada vez que se reinicia `cloudflared`.
> Pídela al responsable que tiene el servicio levantado. En esta guía se nota como
> `https://<TUNEL>` (ej. `https://algo.trycloudflare.com`).

El espejo expone hoy **solo** `ComprobanteGenerarSAT40` en QAS (`/qas/Detecno.svc`).
Cualquier otra operación responde un SOAP Fault 403 (liberación gradual).

## Datos clave

- **WSDL:** `https://<TUNEL>/qas/Detecno.svc?singleWsdl`
- **Endpoint:** `https://<TUNEL>/qas/Detecno.svc`
- **Binding:** SOAP 1.2 + **WS-Addressing** (obligatorio: sin `wsa:Action` y `wsa:To` el PAC responde `ActionMismatch`).
- **SOAPAction:** `http://tempuri.org/IDetecno/ComprobanteGenerarSAT40`
- **Salud:** `GET https://<TUNEL>/health`

---

## Opción A · SoapUI

1. **File → New SOAP Project.**
2. **Initial WSDL:** `https://<TUNEL>/qas/Detecno.svc?singleWsdl` → OK. Carga las 18 operaciones (binding SOAP 1.2).
3. Abre la request de **`ComprobanteGenerarSAT40`**.
4. **Activa WS-Addressing** (esto es lo que suele faltar): en las pestañas inferiores de la
   ventana de request, abre **"WS-A"** y marca:
   - `Enable WS-A addressing`
   - `Add default wsa:To`
   - `Add default wsa:Action`
   SoapUI generará las cabeceras `wsa:Action` y `wsa:To` automáticamente.
5. En el cuerpo, llena:
   - `<tem:licencia>` con la licencia de QAS.
   - `<tem:xml>` con el CFDI en Base64 (dejar `cerBytes/keyBytes/passBytes` vacíos para timbrado por licencia).
6. **Submit.** Respuesta esperada: `FacturaId` distinto de 0 y `Validate=true`.

> Si SoapUI no manda WS-A y ves `ActionMismatch`, revisa el paso 4. Alternativa: pega
> manualmente el `<soap:Header>` con `wsa:Action`/`wsa:To` (ver plantilla de Postman abajo).

---

## Opción B · Postman

Postman no agrega WS-Addressing solo: hay que incluir las cabeceras en el cuerpo.

- **Método:** `POST`
- **URL:** `https://<TUNEL>/qas/Detecno.svc`
- **Headers:**
  - `Content-Type`: `application/soap+xml; charset=utf-8; action="http://tempuri.org/IDetecno/ComprobanteGenerarSAT40"`
- **Body → raw → XML:**

```xml
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:tem="http://tempuri.org/"
               xmlns:a="http://www.w3.org/2005/08/addressing">
  <soap:Header>
    <a:Action soap:mustUnderstand="1">http://tempuri.org/IDetecno/ComprobanteGenerarSAT40</a:Action>
    <a:To soap:mustUnderstand="1">https://<TUNEL>/qas/Detecno.svc</a:To>
  </soap:Header>
  <soap:Body>
    <tem:ComprobanteGenerarSAT40>
      <tem:licencia>__COLOCAR_LICENCIA_QAS__</tem:licencia>
      <tem:cerBytes></tem:cerBytes>
      <tem:keyBytes></tem:keyBytes>
      <tem:passBytes></tem:passBytes>
      <tem:xml>__CFDI_EN_BASE64__</tem:xml>
    </tem:ComprobanteGenerarSAT40>
  </soap:Body>
</soap:Envelope>
```

Respuesta esperada (200): bloque `ComprobanteGenerarSAT40Result` con `FacturaId` y `Validate=true`.

---

## Opción C · curl (rápido)

```bash
curl -X POST "https://<TUNEL>/qas/Detecno.svc" \
  -H 'Content-Type: application/soap+xml; charset=utf-8; action="http://tempuri.org/IDetecno/ComprobanteGenerarSAT40"' \
  --data-binary @request.xml
```

(Con un `request.xml` que incluya el `<soap:Header>` con `wsa:Action` y `wsa:To` apuntando al `https://<TUNEL>/qas/Detecno.svc`.)

---

## Probar que la liberación gradual funciona

Llama cualquier otra operación (p. ej. `Prueba`): debe responder **HTTP 403** con
`"la operacion 'Prueba' aun no esta habilitada en qas"`. Eso confirma que solo
`ComprobanteGenerarSAT40` está liberada.
