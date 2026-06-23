# Prueba de timbrado a través del espejo

Resultado verificado el 2026-06-23 contra el endpoint **QAS** del PAC.

## 1. Conectividad TLS al PAC (lo que SAP no puede)

El PAC negocia `TLSv1.2 / ECDHE-RSA-AES256-GCM-SHA384`. Node/curl lo alcanzan sin problema;
un SAP antiguo no negocia esa suite → de ahí el espejo.

## 2. Operación probada: `ComprobanteGenerarSAT40`

- **SOAPAction:** `http://tempuri.org/IDetecno/ComprobanteGenerarSAT40`
- **Content-Type:** `application/soap+xml; charset=utf-8; action="...ComprobanteGenerarSAT40"`
- El sobre lleva en `<soap:Header>` las cabeceras WS-Addressing `a:Action` y `a:To`.

### Directo al PAC (referencia)

```bash
curl -X POST "https://detecno-factura-electronica.com/Emision/cfdiWcfEmisionServicio40_Demo/Detecno.svc" \
  -H 'Content-Type: application/soap+xml; charset=utf-8; action="http://tempuri.org/IDetecno/ComprobanteGenerarSAT40"' \
  --data-binary @request-con-wsa.xml
```

### A través del espejo (To apunta al espejo)

```bash
curl -X POST "http://localhost:3000/Detecno.svc" \
  -H 'Content-Type: application/soap+xml; charset=utf-8; action="http://tempuri.org/IDetecno/ComprobanteGenerarSAT40"' \
  --data-binary @request-espejo.xml
```

Donde `request-espejo.xml` lleva `<a:To>http://localhost:3000/Detecno.svc</a:To>`
(el espejo lo reescribe internamente a la URL del PAC).

## 3. Respuesta esperada (éxito)

```xml
<ComprobanteGenerarSAT40Result ...>
  <b:CreditoActual>271876</b:CreditoActual>
  <b:FacturaId>631479</b:FacturaId>
  <b:Validate>true</b:Validate>
  ...
</ComprobanteGenerarSAT40Result>
```

`FacturaId` distinto de 0 y `Validate=true` ⇒ timbrado aceptado. Con `FacturaId` se consultan
el XML timbrado, UUID y PDF mediante `ComprobanteBuscar40` / `ComprobanteBuscarUUID40` /
`Comprobante_BuscarPdf40`.

## Sobre WS-Addressing

El `request.xml` original entregado trae `<soap:Header/>` vacío; así, llamado directo, el PAC
responde `ActionMismatch`. Funcionó en SoapUI porque SoapUI inyecta WS-Addressing al activar la
opción WS-A en la petición. SAP genera estas cabeceras automáticamente a partir del binding
`WSHttpBinding` del WSDL, por lo que no requiere armado manual.
