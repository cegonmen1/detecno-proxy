import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyController } from './proxy/proxy.controller';
import { ProxyService } from './proxy/proxy.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // ENV_FILE permite levantar una instancia por entorno: ENV_FILE=.env.prd npm run start:prod
      envFilePath: process.env.ENV_FILE || '.env',
    }),
  ],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class AppModule {}
