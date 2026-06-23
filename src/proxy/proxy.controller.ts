import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { loadEnvironments } from './proxy.config';

@Controller()
export class ProxyController {
  private readonly log = new Logger('Espejo');
  private readonly envs = loadEnvironments();

  constructor(private readonly proxy: ProxyService) {}

  private soapFault(res: Response, status: number, reason: string): void {
    res
      .status(status)
      .setHeader('Content-Type', 'application/soap+xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="utf-8"?>` +
          `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault>` +
          `<s:Code><s:Value>s:Receiver</s:Value></s:Code>` +
          `<s:Reason><s:Text xml:lang="es">${reason}</s:Text></s:Reason>` +
          `</s:Fault></s:Body></s:Envelope>`,
      );
  }

  @All('*')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const segments = req.path.split('/').filter(Boolean); // ej. ['qas','Detecno.svc']
    const envKey = segments[0]?.toLowerCase();

    // Sonda de salud: lista los ambientes encendidos.
    if (req.method === 'GET' && req.path === '/health') {
      res.json({
        status: 'ok',
        environments: Object.values(this.envs).map((e) => ({
          key: e.key,
          enabled: e.enabled,
          target: e.target,
          publicUrl: e.publicUrl,
          allowedOps: e.allowedOps.length ? e.allowedOps : 'todas',
        })),
      });
      return;
    }

    const env = envKey ? this.envs[envKey] : undefined;
    if (!env) {
      this.soapFault(res, 404, `Espejo: ambiente desconocido. Use /qas/Detecno.svc o /prd/Detecno.svc`);
      return;
    }
    if (!env.enabled) {
      this.soapFault(res, 503, `Espejo: el ambiente '${env.key}' esta apagado.`);
      return;
    }

    // Liberacion gradual: si el ambiente define allowedOps, solo se permiten esas operaciones.
    if (req.method !== 'GET' && env.allowedOps.length > 0) {
      const op = this.proxy.extractOperation(
        req.headers['content-type'],
        req.headers['soapaction'] as string,
        req.body as Buffer,
      );
      if (!op || !env.allowedOps.includes(op)) {
        this.log.warn(`[${env.key}] operacion bloqueada (no habilitada): ${op ?? 'desconocida'}`);
        this.soapFault(
          res,
          403,
          `Espejo: la operacion '${op ?? 'desconocida'}' aun no esta habilitada en ${env.key}. ` +
            `Habilitadas: ${env.allowedOps.join(', ')}.`,
        );
        return;
      }
    }

    try {
      const result =
        req.method === 'GET'
          ? await this.proxy.forwardGet(env, req.url.includes('?') ? req.url.split('?')[1] : '')
          : await this.proxy.forwardPost(
              env,
              req.body as Buffer,
              req.headers['content-type'],
              (req.headers['soapaction'] as string) ?? undefined,
            );

      res.status(result.status);
      if (result.contentType) res.setHeader('Content-Type', result.contentType);
      res.send(result.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`[${env.key}] Fallo al reenviar al PAC: ${message}`);
      this.soapFault(res, 502, `Espejo: error al contactar el PAC (${env.key}): ${message}`);
    }
  }
}
