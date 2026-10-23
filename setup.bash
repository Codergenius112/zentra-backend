#!/bin/bash

# ============================================================================
# D'LIFESTYLE BACKEND - COMPLETE PROJECT SETUP SCRIPT
# This script generates all directories, files, and initial configurations
# Usage: bash setup.sh
# ============================================================================

set -e  # Exit on error

PROJECT_NAME="dlifestyle-backend"
ROOT_DIR="$PWD/$PROJECT_NAME"

echo "🚀 Starting D'Lifestyle Backend Project Setup..."
echo "📁 Creating project in: $ROOT_DIR"
echo ""

# ============================================================================
# 1. CREATE ROOT DIRECTORY
# ============================================================================
mkdir -p "$ROOT_DIR"
cd "$ROOT_DIR"
echo "✓ Created root directory"

# ============================================================================
# 2. CREATE DIRECTORY STRUCTURE
# ============================================================================
# Source directories
mkdir -p src/config
mkdir -p src/common/decorators
mkdir -p src/common/filters
mkdir -p src/common/guards
mkdir -p src/common/interceptors
mkdir -p src/common/pipes
mkdir -p src/common/utils

mkdir -p src/database/migrations
mkdir -p src/database/seeds

mkdir -p src/modules/auth
mkdir -p src/modules/bookings
mkdir -p src/modules/payments
mkdir -p src/modules/tickets
mkdir -p src/modules/tables
mkdir -p src/modules/apartments
mkdir -p src/modules/cars
mkdir -p src/modules/orders
mkdir -p src/modules/queues
mkdir -p src/modules/notifications
mkdir -p src/modules/analytics
mkdir -p src/modules/audit
mkdir -p src/modules/admin
mkdir -p src/modules/events

mkdir -p src/shared/entities
mkdir -p src/shared/enums
mkdir -p src/shared/interfaces
mkdir -p src/shared/services

# Database and deployment directories
mkdir -p database/migrations
mkdir -p database/seeds
mkdir -p docker
mkdir -p config/aws
mkdir -p config/nginx
mkdir -p scripts/deployment
mkdir -p docs

# Test directories
mkdir -p test/unit
mkdir -p test/e2e

echo "✓ Created directory structure"

# ============================================================================
# 3. CREATE CORE CONFIGURATION FILES
# ============================================================================

# .env.example
cat > .env.example << 'EOF'
# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=dlifestyle
DATABASE_PASSWORD=secure_password_change_me
DATABASE_NAME=dlifestyle_db
DATABASE_SSL=false

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production-immediately
JWT_EXPIRATION=3600
JWT_REFRESH_EXPIRATION=604800

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_S3_BUCKET=dlifestyle-uploads
AWS_S3_REGION=us-east-1

# Payment Gateway - Paystack
PAYSTACK_SECRET_KEY=your_paystack_secret_key_here
PAYSTACK_PUBLIC_KEY=your_paystack_public_key_here
PAYSTACK_WEBHOOK_SECRET=your_webhook_secret_here

# Email Configuration
EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key_here
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=${RESEND_API_KEY}
EMAIL_FROM=noreply@dlifestyle.com
EMAIL_FROM_NAME=D'Lifestyle

# Application Configuration
NODE_ENV=development
APP_PORT=3000
APP_NAME=D'Lifestyle
LOG_LEVEL=debug
CORS_ORIGIN=http://localhost:3000,http://localhost:8081
API_VERSION=v1

# Business Configuration
PLATFORM_COMMISSION_RATE=0.03
SERVICE_CHARGE=400
GROUP_BOOKING_COUNTDOWN_MINUTES=8
LATE_ARRIVAL_THRESHOLD_MINUTES=15

# Admin Configuration
SUPER_ADMIN_EMAIL=admin@dlifestyle.com
SUPER_ADMIN_PASSWORD=change_me_on_first_login

# Logging & Monitoring
LOG_FORMAT=json
LOG_RETENTION_DAYS=30
ENABLE_SWAGGER=true
SWAGGER_PATH=/api/docs

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF

echo "✓ Created .env.example"

# .env.production
cat > .env.production << 'EOF'
NODE_ENV=production
DATABASE_HOST=${DB_HOST}
DATABASE_PORT=${DB_PORT}
DATABASE_USER=${DB_USER}
DATABASE_PASSWORD=${DB_PASSWORD}
DATABASE_NAME=${DB_NAME}
DATABASE_SSL=true
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_S3_BUCKET=${AWS_S3_BUCKET}
PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}
SENDGRID_API_KEY=${SENDGRID_API_KEY}
APP_PORT=3000
LOG_LEVEL=error
CORS_ORIGIN=https://app.dlifestyle.com
EOF

echo "✓ Created .env.production"

# .gitignore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Environment
.env
.env.local
.env.*.local

# Build
dist/
build/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# Testing
coverage/
.nyc_output/

# Docker
.dockerignore

# OS
.DS_Store
Thumbs.db
EOF

echo "✓ Created .gitignore"

# ============================================================================
# 4. CREATE TYPESCRIPT CONFIGURATION
# ============================================================================

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "baseUrl": "./src",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "allowSyntheticDefaultImports": true,
    "moduleResolution": "node",
    "allowJs": true,
    "noImplicitAny": false,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./*"],
      "@config/*": ["./config/*"],
      "@common/*": ["./common/*"],
      "@modules/*": ["./modules/*"],
      "@shared/*": ["./shared/*"],
      "@database/*": ["./database/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
EOF

echo "✓ Created tsconfig.json"

# ============================================================================
# 5. CREATE PACKAGE.JSON
# ============================================================================

cat > package.json << 'EOF'
{
  "name": "dlifestyle-backend",
  "version": "1.0.0",
  "description": "Production-ready backend for D'Lifestyle platform",
  "author": "D'Lifestyle Team",
  "license": "MIT",
  "main": "dist/main.js",
  "scripts": {
    "start": "node dist/main",
    "dev": "nest start --watch",
    "build": "nest build",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config ./test/e2e/jest-e2e.json",
    "db:migrate": "typeorm migration:run -d dist/database/data-source.js",
    "db:migration:create": "typeorm migration:create",
    "db:seed": "node dist/database/seeds/index.js",
    "db:drop": "typeorm schema:drop -d dist/database/data-source.js",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts",
    "docker:build": "docker build -f docker/Dockerfile -t dlifestyle-backend:latest .",
    "docker:dev": "docker-compose -f docker/docker-compose.yml up",
    "docker:prod": "docker-compose -f docker/docker-compose.prod.yml up -d"
  },
  "dependencies": {
    "@nestjs/bull": "^10.0.0",
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/websockets": "^10.0.0",
    "axios": "^1.6.0",
    "bcryptjs": "^2.4.3",
    "bull": "^4.11.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "helmet": "^7.1.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.11.0",
    "redis": "^4.6.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0",
    "socket.io": "^4.7.0",
    "swagger-ui-express": "^5.0.0",
    "typeorm": "^0.3.16",
    "uuid": "^9.0.0",
    "winston": "^3.11.0",
    "aws-sdk": "^2.1500.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/express": "^4.17.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "jest": "^29.0.0",
    "prettier": "^3.0.0",
    "supertest": "^6.3.0",
    "ts-jest": "^29.0.0",
    "ts-loader": "^9.0.0",
    "ts-node": "^10.0.0",
    "typescript": "^5.0.0"
  }
}
EOF

echo "✓ Created package.json"

# ============================================================================
# 6. CREATE DOCKER CONFIGURATION
# ============================================================================

cat > docker/Dockerfile << 'EOF'
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main"]
EOF

echo "✓ Created docker/Dockerfile"

cat > docker/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: dlifestyle_postgres
    environment:
      POSTGRES_USER: dlifestyle
      POSTGRES_PASSWORD: dlifestyle_dev
      POSTGRES_DB: dlifestyle_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dlifestyle"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: dlifestyle_redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # NestJS Application
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: dlifestyle_app
    environment:
      NODE_ENV: development
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_USER: dlifestyle
      DATABASE_PASSWORD: dlifestyle_dev
      DATABASE_NAME: dlifestyle_db
      REDIS_HOST: redis
      REDIS_PORT: 6379
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ../src:/app/src
    command: npm run dev

volumes:
  postgres_data:
  redis_data:
EOF

echo "✓ Created docker/docker-compose.yml"

cat > docker/docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${DATABASE_USER}
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
      POSTGRES_DB: ${DATABASE_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: always

  app:
    image: dlifestyle-backend:latest
    environment:
      NODE_ENV: production
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_USER: ${DATABASE_USER}
      DATABASE_PASSWORD: ${DATABASE_PASSWORD}
      DATABASE_NAME: ${DATABASE_NAME}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    restart: always

volumes:
  postgres_data:
  redis_data:
EOF

echo "✓ Created docker/docker-compose.prod.yml"

# ============================================================================
# 7. CREATE MAIN APPLICATION FILES
# ============================================================================

cat > src/main.ts << 'EOF'
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security middleware
  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger documentation
  if (process.env.ENABLE_SWAGGER !== 'false') {
    const config = new DocumentBuilder()
      .setTitle("D'Lifestyle API")
      .setDescription('Production-ready API for D\'Lifestyle platform')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Auth')
      .addTag('Bookings')
      .addTag('Payments')
      .addTag('Orders')
      .addTag('Admin')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 D'Lifestyle Backend running on http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);
  process.exit(1);
});
EOF

echo "✓ Created src/main.ts"

cat > src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // TypeORM Configuration (add later)
    // BullModule.forRoot (add later)
    // Auth Module
    // Booking Modules
    // Other modules...
  ],
  providers: [],
})
export class AppModule {}
EOF

echo "✓ Created src/app.module.ts"

# ============================================================================
# 8. CREATE PLACEHOLDER MODULE FILES
# ============================================================================

# Auth Module
cat > src/modules/auth/auth.module.ts << 'EOF'
import { Module } from '@nestjs/common';

@Module({})
export class AuthModule {}
EOF

cat > src/modules/auth/auth.service.ts << 'EOF'
import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {}
EOF

cat > src/modules/auth/auth.controller.ts << 'EOF'
import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}
}
EOF

echo "✓ Created auth module placeholders"

# Bookings Module
for module in bookings payments tickets tables apartments cars orders queues notifications analytics audit admin events; do
  mkdir -p "src/modules/$module"
  
  cat > "src/modules/$module/${module}.module.ts" << EOFMOD
import { Module } from '@nestjs/common';

@Module({})
export class ${module^}Module {}
EOFMOD

  cat > "src/modules/$module/${module}.service.ts" << EOFSVC
import { Injectable } from '@nestjs/common';

@Injectable()
export class ${module^}Service {}
EOFSVC

  cat > "src/modules/$module/${module}.controller.ts" << EOFCTRL
import { Controller } from '@nestjs/common';
import { ${module^}Service } from './${module}.service';

@Controller('${module}')
export class ${module^}Controller {
  constructor(private ${module}Service: ${module^}Service) {}
}
EOFCTRL
done

echo "✓ Created all module placeholders"

# ============================================================================
# 9. CREATE SHARED ENUMS FILE
# ============================================================================

cat > src/shared/enums/index.ts << 'EOF'
export enum BookingStatus {
  INITIATED = 'INITIATED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PENDING_GROUP_PAYMENT = 'PENDING_GROUP_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BookingType {
  TICKET = 'ticket',
  TABLE = 'table',
  APARTMENT = 'apartment',
  CAR = 'car',
}

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  FULLY_PAID = 'FULLY_PAID',
  REFUNDED = 'REFUNDED',
}

export enum OrderStatus {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  ROUTED = 'ROUTED',
  IN_PREPARATION = 'IN_PREPARATION',
  READY = 'READY',
  SERVED = 'SERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum UserRole {
  CUSTOMER = 'customer',
  WAITER = 'waiter',
  KITCHEN_STAFF = 'kitchen_staff',
  BAR_STAFF = 'bar_staff',
  DOOR_STAFF = 'door_staff',
  MANAGER = 'manager',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

export enum AuditActionType {
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_UPDATED = 'BOOKING_UPDATED',
  PAYMENT_PROCESSED = 'PAYMENT_PROCESSED',
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_ASSIGNED = 'ORDER_ASSIGNED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ADMIN_OVERRIDE = 'ADMIN_OVERRIDE',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
}
EOF

echo "✓ Created shared enums"

# ============================================================================
# 10. CREATE DOCUMENTATION FILES
# ============================================================================

cat > README.md << 'EOF'
# D'Lifestyle Backend

Production-ready NestJS backend for the D'Lifestyle platform - a unified lifestyle, nightlife, and venue-operations platform.

## Features

- 🎫 Ticket booking & event management
- 🪑 Table reservations with group bookings
- 🏠 Apartment booking system
- 🚗 Car rental management
- 🍔 In-venue digital ordering
- 📊 Real-time queue management
- 💳 Payment processing & wallet system
- 📝 Immutable audit logging
- 🔐 Role-based access control
- 📊 Analytics & reporting

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: NestJS 10
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **API**: REST with Swagger docs
- **Payment**: Paystack integration
- **Deployment**: Docker + AWS ECS

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7

### Local Development

1. Clone the repository
```bash
git clone <repo-url>
cd dlifestyle-backend
```

2. Install dependencies
```bash
npm install
```

3. Setup environment
```bash
cp .env.example .env
```

4. Start with Docker Compose
```bash
npm run docker:dev
```

5. Run migrations
```bash
npm run db:migrate
```

6. Access API
- API: http://localhost:3000
- Swagger Docs: http://localhost:3000/api/docs

### Available Scripts

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm run start            # Start production server
npm run test             # Run unit tests
npm run test:e2e         # Run e2e tests
npm run lint             # Run ESLint
npm run format           # Format code with Prettier
npm run db:migrate       # Run database migrations
npm run db:seed          # Seed initial data
npm run docker:dev       # Start with Docker Compose
npm run docker:prod      # Start production containers
```

## Project Structure

```
src/
├── config/              # Configuration files
├── common/              # Shared utilities, guards, pipes
├── database/            # TypeORM migrations & seeds
├── modules/             # Feature modules
│   ├── auth/            # Authentication
│   ├── bookings/        # Core booking engine
│   ├── payments/        # Payment & wallet
│   ├── tickets/         # Ticketing
│   ├── tables/          # Table bookings
│   ├── apartments/      # Apartment bookings
│   ├── cars/            # Car rentals
│   ├── orders/          # In-venue orders
│   ├── queues/          # Queue management
│   ├── notifications/   # Notifications
│   ├── analytics/       # Analytics & reporting
│   ├── audit/           # Audit logging
│   ├── admin/           # Admin operations
│   └── events/          # Event management
└── shared/              # Shared entities, DTOs, interfaces
```

## API Documentation

Full API documentation available at `/api/docs` (Swagger UI)

### Core Endpoints

- `POST /auth/login` - User login
- `POST /bookings` - Create booking
- `GET /bookings/:id` - Get booking details
- `POST /payments` - Process payment
- `GET /orders` - List orders
- `POST /orders` - Create order
- `GET /admin/analytics` - Analytics dashboard

## Database Schema

See `database/migrations/` for all table definitions.

### Key Tables
- `users` - User accounts
- `bookings` - All booking records
- `payment_transactions` - Payment history
- `orders` - In-venue orders
- `audit_logs` - Immutable activity logs
- `financial_ledger` - Double-entry accounting

## Deployment

### AWS ECS Deployment

```bash
# Build Docker image
npm run docker:build

# Push to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <your-ecr-url>

docker tag dlifestyle-backend:latest <your-ecr-url>/dlifestyle-backend:latest
docker push <your-ecr-url>/dlifestyle-backend:latest

# Deploy with ECS Fargate
# See scripts/deployment/ for deployment scripts
```

## Environment Variables

See `.env.example` for all required environment variables.

### Critical Variables
- `DATABASE_*` - PostgreSQL connection
- `REDIS_*` - Redis connection
- `JWT_SECRET` - JWT signing key
- `PAYSTACK_SECRET_KEY` - Paystack API key
- `AWS_*` - AWS credentials for S3

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# E2E tests
npm run test:e2e

# Coverage
npm run test -- --coverage
```

## Contributing

1. Create feature branch: `git checkout -b feature/xyz`
2. Commit changes: `git commit -m "feat: xyz"`
3. Push branch: `git push origin feature/xyz`
4. Open Pull Request

## Support

For issues and questions, contact: support@dlifestyle.com

## License

MIT License - See LICENSE file for details
EOF

echo "✓ Created README.md"

# ============================================================================
# 11. CREATE JEST CONFIGURATION
# ============================================================================

cat > jest.config.js << 'EOF'
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
  },
};
EOF

echo "✓ Created jest.config.js"

# ============================================================================
# 12. CREATE .ESLINTRC AND PRETTIER CONFIG
# ============================================================================

cat > .eslintrc.js << 'EOF'
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
EOF

cat > .prettierrc << 'EOF'
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
EOF

echo "✓ Created .eslintrc.js and .prettierrc"

# ============================================================================
# 13. CREATE MAKEFILE FOR COMMON COMMANDS
# ============================================================================

cat > Makefile << 'EOF'
.PHONY: help install dev build test docker-dev docker-prod migrate seed

help:
	@echo "D'Lifestyle Backend - Available Commands"
	@echo "========================================"
	@echo "install       - Install dependencies"
	@echo "dev           - Start development server"
	@echo "build         - Build for production"
	@echo "test          - Run unit tests"
	@echo "test-e2e      - Run e2e tests"
	@echo "lint          - Run ESLint"
	@echo "format        - Format code with Prettier"
	@echo "docker-dev    - Start with Docker Compose (dev)"
	@echo "docker-prod   - Start with Docker Compose (prod)"
	@echo "migrate       - Run database migrations"
	@echo "seed          - Seed initial data"
	@echo ""

install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

test-e2e:
	npm run test:e2e

lint:
	npm run lint

format:
	npm run format

docker-dev:
	npm run docker:dev

docker-prod:
	npm run docker:prod

migrate:
	npm run db:migrate

seed:
	npm run db:seed

clean:
	rm -rf dist node_modules coverage

clone-env:
	cp .env.example .env
EOF

echo "✓ Created Makefile"

# ============================================================================
# 14. CREATE GITHUB WORKFLOWS FOR CI/CD
# ============================================================================

mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'EOF'
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm run test
      
      - name: Build
        run: npm run build

  docker-build:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v3
      - uses: docker/setup-buildx-action@v2
      
      - name: Build Docker image
        uses: docker/build-push-action@v4
        with:
          context: .
          file: ./docker/Dockerfile
          push: false
          tags: dlifestyle-backend:latest
EOF

echo "✓ Created GitHub Actions workflow"

# ============================================================================
# 15. CREATE INITIAL MIGRATION TEMPLATE
# ============================================================================

cat > database/migrations/001_initial_schema.sql << 'EOF'
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'customer',
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bookings table (polymorphic)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type VARCHAR(50) NOT NULL, -- 'ticket', 'table', 'apartment', 'car'
  user_id UUID NOT NULL REFERENCES users(id),
  group_id UUID,
  resource_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
  guest_count INTEGER,
  base_price DECIMAL(12, 2),
  platform_commission DECIMAL(12, 2),
  service_charge DECIMAL(12, 2),
  total_amount DECIMAL(12, 2),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
  payment_method VARCHAR(50),
  check_in_time TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  expires_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment transactions
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(12, 2) NOT NULL,
  status VARCHAR(50) NOT NULL,
  payment_method VARCHAR(50),
  external_ref_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- User wallets
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id),
  balance DECIMAL(12, 2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'NGN',
  last_transaction_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs (append-only)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role VARCHAR(50),
  resource_type VARCHAR(100),
  resource_id UUID,
  changes JSONB,
  ip_address VARCHAR(50),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Financial ledger (immutable)
CREATE TABLE financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  transaction_type VARCHAR(20) NOT NULL, -- 'DEBIT', 'CREDIT'
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  description TEXT,
  related_user_id UUID REFERENCES users(id),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_booking_type ON bookings(booking_type);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_payment_transactions_booking_id ON payment_transactions(booking_id);
CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_financial_ledger_booking_id ON financial_ledger(booking_id);
CREATE INDEX idx_financial_ledger_timestamp ON financial_ledger(timestamp);

-- Create audit log insert function (PostgreSQL trigger)
CREATE OR REPLACE FUNCTION prevent_audit_deletion()
RETURNS TRIGGER AS $
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be deleted';
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_audit_log_deletion
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_deletion();

CREATE TRIGGER prevent_ledger_deletion
BEFORE DELETE ON financial_ledger
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_deletion();
EOF

echo "✓ Created initial migration SQL"

# ============================================================================
# 16. CREATE .DOCKERIGNORE
# ============================================================================

cat > .dockerignore << 'EOF'
node_modules
npm-debug.log
.git
.gitignore
.DS_Store
.env
.env.local
dist
coverage
test
docs
scripts
EOF

echo "✓ Created .dockerignore"

# ============================================================================
# 17. CREATE DEPLOYMENT SCRIPTS
# ============================================================================

cat > scripts/deployment/aws-ecs-deploy.sh << 'EOF'
#!/bin/bash
# Deploy to AWS ECS Fargate

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="dlifestyle-backend"
ECS_CLUSTER="dlifestyle-cluster"
ECS_SERVICE="dlifestyle-service"
TASK_FAMILY="dlifestyle-task"

echo "🚀 Starting AWS ECS Deployment..."

# Build Docker image
echo "📦 Building Docker image..."
docker build -f docker/Dockerfile -t $ECR_REPOSITORY:latest .

# Get ECR login token
echo "🔐 Authenticating with ECR..."
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com

# Tag and push to ECR
ECR_URI=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY
docker tag $ECR_REPOSITORY:latest $ECR_URI:latest
docker push $ECR_URI:latest

echo "✅ Docker image pushed to ECR"
echo "📝 Next steps:"
echo "1. Update ECS task definition with new image URI: $ECR_URI:latest"
echo "2. Update ECS service: aws ecs update-service --cluster $ECS_CLUSTER --service $ECS_SERVICE --force-new-deployment --region $AWS_REGION"
EOF

chmod +x scripts/deployment/aws-ecs-deploy.sh

echo "✓ Created deployment scripts"

# ============================================================================
# 18. CREATE SUMMARY FILE
# ============================================================================

cat > PROJECT_SETUP_SUMMARY.md << 'EOF'
# D'Lifestyle Backend - Project Setup Summary

## ✅ Generated Files & Directories

### Core Application Files
- `src/main.ts` - Application entry point
- `src/app.module.ts` - Root NestJS module
- `package.json` - Dependencies & scripts
- `tsconfig.json` - TypeScript configuration
- `.env.example` - Environment variables template
- `.env.production` - Production environment config

### Configuration Files
- `.eslintrc.js` - ESLint configuration
- `.prettierrc` - Code formatting rules
- `.gitignore` - Git ignore patterns
- `.dockerignore` - Docker ignore patterns
- `jest.config.js` - Testing configuration

### Source Code Structure
```
src/
├── config/
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── pipes/
│   └── utils/
├── database/
│   ├── migrations/
│   └── seeds/
├── modules/
│   ├── auth/
│   ├── bookings/
│   ├── payments/
│   ├── tickets/
│   ├── tables/
│   ├── apartments/
│   ├── cars/
│   ├── orders/
│   ├── queues/
│   ├── notifications/
│   ├── analytics/
│   ├── audit/
│   ├── admin/
│   └── events/
└── shared/
    ├── entities/
    ├── enums/
    ├── interfaces/
    └── services/
```

### Docker & Deployment
- `docker/Dockerfile` - Production container image
- `docker/docker-compose.yml` - Local development stack
- `docker/docker-compose.prod.yml` - Production stack
- `scripts/deployment/aws-ecs-deploy.sh` - AWS deployment script
- `.github/workflows/ci.yml` - GitHub Actions CI/CD pipeline

### Documentation
- `README.md` - Complete project documentation
- `Makefile` - Common command shortcuts
- `PROJECT_SETUP_SUMMARY.md` - This file

### Database
- `database/migrations/001_initial_schema.sql` - Initial database schema

## 📋 Next Steps

1. **Install Dependencies**
   ```bash
   cd dlifestyle-backend
   npm install
   ```

2. **Setup Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start Local Development**
   ```bash
   npm run docker:dev
   # OR
   make docker-dev
   ```

4. **Access Services**
   - API: http://localhost:3000
   - Swagger Docs: http://localhost:3000/api/docs
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

5. **Run Migrations**
   ```bash
   npm run db:migrate
   ```

6. **Seed Initial Data** (to be created)
   ```bash
   npm run db:seed
   ```

## 🔧 Available Commands

```bash
make help              # Show all available commands
make install           # Install dependencies
make dev              # Start dev server
make build            # Build for production
make test             # Run tests
make docker-dev       # Start with Docker
npm run lint          # Run ESLint
npm run format        # Format code
```

## 📦 Technology Stack

- **Runtime**: Node.js 20+
- **Framework**: NestJS 10
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Testing**: Jest
- **API Docs**: Swagger/OpenAPI
- **Containerization**: Docker
- **Deployment**: AWS ECS Fargate

## 🔐 Security Features

- Helmet.js for HTTP headers
- JWT authentication
- Role-Based Access Control (RBAC)
- Immutable audit logging
- Double-entry financial ledger
- Input validation & sanitization

## 📝 Important Notes

1. **Change JWT Secret** in `.env` before production
2. **Configure Database** credentials in `.env`
3. **Add Paystack Keys** for payment processing
4. **Setup AWS Credentials** for S3 & ECS deployment
5. **Review Security Checklist** before going live

## 🚀 Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations tested
- [ ] All tests passing
- [ ] Security headers enabled
- [ ] API documentation updated
- [ ] Logging configured
- [ ] Monitoring setup
- [ ] Backup strategy defined
- [ ] Disaster recovery plan documented

## 📞 Support

For setup issues or questions:
1. Check README.md for detailed instructions
2. Review .env.example for all required variables
3. Check Docker logs: `docker-compose logs app`
4. Review application logs in `logs/` directory

---

**Setup Date**: $(date)
**NestJS Version**: 10
**Node Version**: 20+
**Status**: Ready for Development ✅
EOF

cat > PROJECT_SETUP_SUMMARY.md

echo "✓ Created PROJECT_SETUP_SUMMARY.md"

# ============================================================================
# 19. FINAL SUMMARY
# ============================================================================

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ D'LIFESTYLE BACKEND PROJECT SETUP COMPLETE!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📁 Project Location: $ROOT_DIR"
echo ""
echo "📋 Generated:"
echo "  ✓ 13 module directories with placeholder files"
echo "  ✓ Complete configuration files"
echo "  ✓ Docker setup (dev + prod)"
echo "  ✓ TypeScript configuration"
echo "  ✓ Testing setup (Jest)"
echo "  ✓ CI/CD pipeline (GitHub Actions)"
echo "  ✓ Database migration template"
echo "  ✓ Deployment scripts (AWS ECS)"
echo "  ✓ Documentation & README"
echo ""
echo "🚀 QUICK START:"
echo ""
echo "  1. cd $ROOT_DIR"
echo "  2. npm install"
echo "  3. cp .env.example .env"
echo "  4. npm run docker:dev"
echo ""
echo "📚 Documentation:"
echo "  - README.md - Full project documentation"
echo "  - PROJECT_SETUP_SUMMARY.md - Setup details"
echo "  - .env.example - Required environment variables"
echo ""
echo "💡 Tips:"
echo "  - Use 'make help' to see all available commands"
echo "  - Use 'make docker-dev' to start with Docker"
echo "  - API will be available at http://localhost:3000"
echo "  - Swagger docs at http://localhost:3000/api/docs"
echo ""
