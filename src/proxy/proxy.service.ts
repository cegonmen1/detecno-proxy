import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';
import { EnvConfig } from './proxy.config';

export interface ProxyResult {
  status: number;
  contentType?: string;
  body: Buffer;
}

/**
 * Reenvio transparente al PAC Detecno (QAS o PRD segun el ambiente recibido).
 *
 * - GET (?wsdl / ?xsd / ?singleWsdl): trae el documento del PAC y reescribe la URL
 *   base del PAC por la URL publica del espejo, para que SAP genere el proxy
 *   apuntando al espejo y no al PAC inalcanzable.
 * - POST (operaciones SOAP): reescribe en el cuerpo la URL del espejo de vuelta a
 *   la del PAC (cabecera wsa:To -> AddressFilter de WCF) y reenvia byte a byte.
 */
@Injectable()
export class ProxyService {
  private readonly log = new Logger('Espejo');

  // keepAlive deshabilitado a proposito: reutilizar un socket que el PAC ya cerro por
  // inactividad provoca ECONNRESET intermitente (-> 502). El timbrado NO es idempotente,
  // asi que no se puede reintentar sin riesgo de CFDI duplicado; una conexion fresca por
  // peticion lo evita de raiz. Cuesta un handshake TLS extra por llamada (aceptable).
  private readonly agent = new https.Agent({
    keepAlive: false,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: process.env.PAC_TLS_REJECT_UNAUTHORIZED !== 'false',
  });

  /** Reemplaza todas las apariciones de `from` por `to` (sin regex, seguro con URLs). */
  private replaceAll(text: string, from: string, to: string): string {
    if (!from || !to) return text;
    return text.split(from).join(to);
  }

  /** Ultimo segmento de un URI de accion: .../IDetecno/ComprobanteGenerarSAT40 -> ComprobanteGenerarSAT40 */
  private lastSegment(uri: string): string {
    const u = uri.replace(/"/g, '').trim();
    const i = u.lastIndexOf('/');
    return i >= 0 ? u.substring(i + 1) : u;
  }

  /**
   * Identifica la operacion SOAP solicitada, en orden de confiabilidad:
   * 1) parametro action del Content-Type (SOAP 1.2), 2) cabecera SOAPAction (SOAP 1.1),
   * 3) wsa:Action del sobre, 4) primer elemento dentro de soap:Body.
   */
  extractOperation(contentType?: string, soapAction?: string, body?: Buffer): string | undefined {
    const ctAction = (contentType ?? '').match(/action\s*=\s*"?([^";]+)"?/i);
    if (ctAction) return this.lastSegment(ctAction[1]);

    if (soapAction && soapAction.trim()) return this.lastSegment(soapAction);

    if (body?.length) {
      const text = body.toString('utf8');
      const wsa = text.match(/<[^>]*\bAction\b[^>]*>([^<]+)<\/[^>]*Action>/i);
      if (wsa) return this.lastSegment(wsa[1].trim());
      const bodyEl = text.match(/<(?:[\w-]+:)?Body[^>]*>\s*<(?:[\w-]+:)?([A-Za-z]\w+)/i);
      if (bodyEl) return bodyEl[1];
    }
    return undefined;
  }

  async forwardGet(env: EnvConfig, query: string): Promise<ProxyResult> {
    const url = env.target + (query ? `?${query}` : '');
    this.log.log(`[${env.key}] GET  -> ${url}`);
    const resp = await axios.get<string>(url, {
      httpsAgent: this.agent,
      responseType: 'text',
      // Sin transformacion: conservamos el cuerpo tal cual lo manda el PAC.
      transformResponse: (data: unknown) => data,
      validateStatus: () => true,
    });
    // El WSDL/XSD apunta al PAC: reescribir a la URL publica del espejo de este ambiente.
    const rewritten = this.replaceAll(resp.data ?? '', env.target, env.publicUrl);
    return {
      status: resp.status,
      contentType: resp.headers['content-type'] as string | undefined,
      body: Buffer.from(rewritten, 'utf8'),
    };
  }

  /** Prefijo del namespace SOAP del sobre (soap, s, soapenv...). */
  private envelopePrefix(text: string): string {
    const m = text.match(/<([\w-]+):Envelope[\s>]/);
    return m ? m[1] : 'soap';
  }

  /**
   * Inyecta wsa:Action y wsa:To en el header SOAP si el mensaje no los trae.
   * Hace el espejo transparente para un SAP que no genera WS-Addressing: solo
   * manda el cuerpo de negocio y el espejo completa lo que el PAC (WCF) exige.
   */
  private injectWsAddressing(
    text: string,
    target: string,
    op: string,
  ): { xml: string; actionUri: string; injected: boolean } {
    const actionUri = `http://tempuri.org/IDetecno/${op}`;
    const p = this.envelopePrefix(text);

    const headerWith = new RegExp(`<${p}:Header\\b[^>]*>([\\s\\S]*?)</${p}:Header>`);
    const headerSelf = new RegExp(`<${p}:Header\\b[^>]*/>`);
    const hm = text.match(headerWith);

    // Si ya hay un elemento Action de WS-Addressing, no tocar nada.
    if (hm && /<[\w-]+:Action[\s>]/.test(hm[1])) {
      return { xml: text, actionUri, injected: false };
    }

    const block =
      `<wsa:Action xmlns:wsa="http://www.w3.org/2005/08/addressing" ${p}:mustUnderstand="1">${actionUri}</wsa:Action>` +
      `<wsa:To xmlns:wsa="http://www.w3.org/2005/08/addressing" ${p}:mustUnderstand="1">${target}</wsa:To>`;

    let xml: string;
    if (hm) {
      xml = text.replace(new RegExp(`</${p}:Header>`), `${block}</${p}:Header>`);
    } else if (headerSelf.test(text)) {
      xml = text.replace(headerSelf, `<${p}:Header>${block}</${p}:Header>`);
    } else {
      xml = text.replace(
        new RegExp(`(<${p}:Envelope\\b[^>]*>)`),
        `$1<${p}:Header>${block}</${p}:Header>`,
      );
    }
    return { xml, actionUri, injected: true };
  }

  /** Construye el Content-Type que el PAC espera, fijando el parametro action. */
  private buildContentType(text: string, actionUri: string, original?: string): string {
    const isSoap12 = text.includes('http://www.w3.org/2003/05/soap-envelope');
    if (isSoap12) return `application/soap+xml; charset=utf-8; action="${actionUri}"`;
    // SOAP 1.1: la accion viaja en la cabecera SOAPAction (se fija aparte).
    return original && original.trim() ? original : 'text/xml; charset=utf-8';
  }

  async forwardPost(
    env: EnvConfig,
    rawBody: Buffer,
    contentType?: string,
    soapAction?: string,
  ): Promise<ProxyResult> {
    let text = rawBody?.length ? rawBody.toString('utf8') : '';
    let outContentType = contentType;
    let outSoapAction = soapAction;

    // Auto-inyeccion de WS-Addressing para clientes que no la generan (transparencia para SAP).
    if (env.wsaAutoInject && text) {
      const op = this.extractOperation(contentType, soapAction, rawBody);
      if (op) {
        const r = this.injectWsAddressing(text, env.target, op);
        if (r.injected) {
          text = r.xml;
          outContentType = this.buildContentType(text, r.actionUri, contentType);
          outSoapAction = soapAction ?? r.actionUri;
          this.log.log(`[${env.key}] WS-Addressing inyectado automaticamente para ${op}`);
        }
      }
    }

    // Reescribir la URL del espejo de vuelta a la del PAC (wsa:To, anyURI internos).
    if (env.publicUrl && text.includes(env.publicUrl)) {
      text = this.replaceAll(text, env.publicUrl, env.target);
    }

    const payload = text ? Buffer.from(text, 'utf8') : rawBody;

    this.log.log(
      `[${env.key}] POST -> ${env.target}  (SOAPAction=${outSoapAction ?? 'n/a'}, ${payload.length} bytes)`,
    );

    const resp = await axios.post(env.target, payload, {
      httpsAgent: this.agent,
      headers: {
        'Content-Type': outContentType ?? 'application/soap+xml; charset=utf-8',
        ...(outSoapAction ? { SOAPAction: outSoapAction } : {}),
      },
      responseType: 'arraybuffer',
      // Sin transformacion: el cuerpo del PAC se reenvia byte a byte.
      transformResponse: (data: unknown) => data,
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return {
      status: resp.status,
      contentType: resp.headers['content-type'] as string | undefined,
      body: Buffer.from(resp.data as ArrayBuffer),
    };
  }
}
