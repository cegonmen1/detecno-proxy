import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { raw } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // bodyParser desactivado: necesitamos el cuerpo SOAP crudo (Buffer) para reenviarlo intacto.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(raw({ type: () => true, limit: '50mb' }));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');

  const log = new Logger('Espejo');
  log.log(`Espejo Detecno escuchando en http://0.0.0.0:${port}`);
  log.log(`Reenviando a PAC: ${process.env.PAC_BASE_URL}`);
  log.log(`URL publica (WSDL): ${process.env.MIRROR_PUBLIC_URL}`);
}

void bootstrap();
