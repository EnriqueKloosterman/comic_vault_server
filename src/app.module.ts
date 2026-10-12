import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as Joi from 'joi';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { DriveSyncModule } from './modules/drive-sync/drive-sync.module';
import { ComicsModule } from './modules/comics/comics.module';
import { EncryptionModule } from './core/encryption/encryption.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        ENCRYPTION_KEY_AES256: Joi.string().min(32).required(),
        GOOGLE_CLIENT_ID: Joi.string().required(),
        GOOGLE_CLIENT_SECRET: Joi.string().required(),
        GOOGLE_CALLBACK_URL: Joi.string().uri().required(),
        TEMP_DIR: Joi.string().default('/temp/comics'),
        TEMP_COVER_DIR: Joi.string().default('/temp/covers'),
        FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),
        MAX_CACHE_FILES: Joi.number().default(15),
        MAX_CACHE_SIZE_BYTES: Joi.number().default(157286400),
      }),
    }),
    HealthModule,
    EncryptionModule,
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('DATABASE_URL') }),
    }),
    AuthModule,
    DriveSyncModule,
    ComicsModule,
  ],
})
export class AppModule {}
