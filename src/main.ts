import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { raw } from 'express';
import { AppModule } from './app.module';
import { loadEnvironments } from './proxy/proxy.config';

async function bootstrap(): Promise<void> {
  // bodyParser desactivado: necesitamos el cuerpo SOAP crudo (Buffer) para reenviarlo intacto.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // CORS permisivo: clientes server-side (SAP, SoapUI, Postman) no lo necesitan,
  // pero lo habilitamos para que ningun cliente de navegador quede bloqueado en pruebas.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: '*',
    exposedHeaders: '*',
  });

  app.use(raw({ type: () => true, limit: '50mb' }));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');

  const log = new Logger('Espejo');
  log.log(`Espejo Detecno escuchando en http://0.0.0.0:${port}`);
  for (const env of Object.values(loadEnvironments())) {
    const estado = env.enabled ? 'ON ' : 'OFF';
    log.log(
      `  [${env.key}] ${estado} -> PAC ${env.target || '(sin target)'} | publico ${env.publicUrl || '(sin publicUrl)'}`,
    );
  }
}

void bootstrap();
