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

  private readonly agent = new https.Agent({
    keepAlive: true,
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
      transformResponse: (r) => r,
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

  async forwardPost(
    env: EnvConfig,
    rawBody: Buffer,
    contentType?: string,
    soapAction?: string,
  ): Promise<ProxyResult> {
    // Reescribir la URL del espejo de vuelta a la del PAC (wsa:To, anyURI internos).
    let payload = rawBody;
    if (env.publicUrl && rawBody?.length) {
      const asText = rawBody.toString('utf8');
      if (asText.includes(env.publicUrl)) {
        payload = Buffer.from(this.replaceAll(asText, env.publicUrl, env.target), 'utf8');
      }
    }

    this.log.log(
      `[${env.key}] POST -> ${env.target}  (SOAPAction=${soapAction ?? 'n/a'}, ${payload.length} bytes)`,
    );

    const resp = await axios.post(env.target, payload, {
      httpsAgent: this.agent,
      headers: {
        'Content-Type': contentType ?? 'application/soap+xml; charset=utf-8',
        ...(soapAction ? { SOAPAction: soapAction } : {}),
      },
      responseType: 'arraybuffer',
      transformResponse: (r) => r,
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
