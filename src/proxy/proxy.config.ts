/**
 * Configuracion de ambientes del espejo. Un solo proceso atiende QAS y PRD,
 * cada uno bajo su propia ruta (/qas/Detecno.svc, /prd/Detecno.svc).
 */
export interface EnvConfig {
  key: string;
  target: string; // URL real del PAC (sin querystring)
  publicUrl: string; // URL publica del espejo para este ambiente
  enabled: boolean;
  allowedOps: string[]; // operaciones habilitadas; lista vacia = todas
  wsaAutoInject: boolean; // inyecta WS-Addressing si SAP no lo manda
  wsdlStripPolicy: boolean; // quita la WS-SecurityPolicy HTTPS del WSDL servido a SAP
}

/** Convierte "Op1, Op2 ,Op3" en ['Op1','Op2','Op3']. Vacio o sin valor = []. */
function parseOps(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadEnvironments(): Record<string, EnvConfig> {
  return {
    qas: {
      key: 'qas',
      target: process.env.QAS_PAC_URL ?? '',
      publicUrl: process.env.QAS_PUBLIC_URL ?? '',
      // QAS encendido por defecto.
      enabled: (process.env.QAS_ENABLED ?? 'true') !== 'false',
      allowedOps: parseOps(process.env.QAS_ALLOWED_OPS),
      wsaAutoInject: (process.env.QAS_WSA_AUTOINJECT ?? 'true') !== 'false',
      wsdlStripPolicy: (process.env.QAS_WSDL_STRIP_POLICY ?? 'true') !== 'false',
    },
    prd: {
      key: 'prd',
      target: process.env.PRD_PAC_URL ?? '',
      publicUrl: process.env.PRD_PUBLIC_URL ?? '',
      // PRD apagado por defecto: hay que encenderlo explicitamente con PRD_ENABLED=true.
      enabled: (process.env.PRD_ENABLED ?? 'false') === 'true',
      allowedOps: parseOps(process.env.PRD_ALLOWED_OPS),
      wsaAutoInject: (process.env.PRD_WSA_AUTOINJECT ?? 'true') !== 'false',
      wsdlStripPolicy: (process.env.PRD_WSDL_STRIP_POLICY ?? 'true') !== 'false',
    },
  };
}
