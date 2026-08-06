import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  const prefix = config.get('apiPrefix', { infer: true });
  const port = config.get('port', { infer: true });
  const origins = config.get('webOrigin', { infer: true });
  const isProduction = config.get('isProduction', { infer: true });

  app.setGlobalPrefix(prefix);
  app.use(cookieParser());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // `credentials: true` is what lets the browser send the httpOnly auth cookies.
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Behind a proxy, req.ip must come from X-Forwarded-For for rate limiting to work.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SaaS CRM API')
        .setDescription('Multi-tenant CRM API with role-based access control')
        .setVersion('0.1.0')
        .addCookieAuth('crm_access_token')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  if (!isProduction) {
    logger.log(`Swagger UI at http://localhost:${port}/${prefix}/docs`);
  }
  logger.log(`CORS origins: ${origins.join(', ')}`);
}

void bootstrap();
