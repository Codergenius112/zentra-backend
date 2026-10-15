import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Railway (and most PaaS platforms) terminate TLS at a proxy in front of
  // this app, so req.protocol would otherwise always report 'http'. This
  // makes Express trust the X-Forwarded-Proto header so generated URLs
  // (e.g. uploaded file URLs) come back as https.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Raw body for Paystack webhook signature verification comes from
  // req.rawBody — populated automatically by Nest because rawBody:true was
  // passed to NestFactory.create above. There used to ALSO be a manual
  // app.use('/payments/webhook', express.raw(...)) here; that consumed the
  // request stream, then Nest's own built-in JSON body parser ran on the
  // same route and tried to re-read an already-drained stream, throwing
  // "stream is not readable" — every single webhook call 500'd before
  // PaystackWebhookController ever ran. See that controller for the
  // corresponding req.rawBody fix.

app.enableCors();

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // add this too
}));

  // ── Serve uploaded files statically ─────────────────────────────────────
  app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

  // ── Global validation pipe ─────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
    }),
  );

  // ── Swagger documentation ──────────────────────────────────────────────────
  if (process.env.ENABLE_SWAGGER !== 'false') {
    const config = new DocumentBuilder()
      .setTitle("D'Lifestyle API")
      .setDescription("Production-ready API for D'Lifestyle platform")
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Auth')
      .addTag('Bookings')
      .addTag('Payments')
      .addTag('Orders')
      .addTag('Notifications')
      .addTag('Admin')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  console.log(` D'Lifestyle Backend running on -- http://localhost:${port}`);
  console.log(` API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);
  process.exit(1);
});