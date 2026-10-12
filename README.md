# Comic Vault — Backend (`comicvault-backend`)

Backend del proyecto **Comic Vault**: lector/catálogo personal de cómics auto-hospedado.

Expone una API REST (prefijo global `/api`) para:

- Autenticación con **Google OAuth 2.0 + JWT** (`/api/auth/*`).
- Sincronización del catálogo desde **Google Drive** (`/api/sync/drive`).
- Catálogo, streaming de páginas, portadas y manifiestos de cómics (`/api/comics/*`).
- Progreso de lectura / favoritos / historial (`/api/comics/:id/*`, `/api/reading-history`).
- Healthcheck para Docker/K8s (`/api/health`).

> Prefijo global: todo cuelga de `/api` (ver `src/main.ts`). Ej.: `GET /api/health`.

---

## 1. Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime / Lenguaje | Node.js 22 + TypeScript 5 |
| Framework | NestJS 11 (`@nestjs/*`, `platform-express`) |
| Persistencia | MongoDB 7 + Mongoose 8 (`@nestjs/mongoose`) |
| Auth | `passport` + `passport-google-oauth20`, `@nestjs/jwt`, `@nestjs/passport` |
| Validación / Config | `class-validator` + `class-transformer`, `@nestjs/config` + `joi` (fail-fast) |
| Drive | `googleapis` (OAuth con tokens cifrados del usuario) |
| Archivos CBR/CBZ | `yauzl` (ZIP/CBZ), `node-unrar-js` (RAR/CBR), `sharp` (portadas/thumbnails), `fast-xml-parser` (`ComicInfo.xml`) |
| Errores | Filtro global RFC 7807 (`src/core/interceptors/rfc7807.filter.ts`) |
| Calidad | ESLint 9 + Prettier 3, Jest 29 + Supertest (unit + e2e) |
| Empaquetado | Docker multi-stage (`node:22-alpine`), `docker-compose.yml` (backend + Mongo) |
| Package manager | **pnpm 10.32.1** (`packageManager: pnpm@10.32.1`, `pnpm-lock.yaml`) |

Estructura:

```
src/
├── main.ts                  # bootstrap: prefijo /api, ValidationPipe global, filtro RFC7807
├── app.module.ts            # ConfigModule (Joi) + Mongoose + módulos de dominio
├── core/
│   ├── encryption/          # EncryptionModule (AES-256, tokens OAuth en reposo)
│   ├── interceptors/        # Rfc7807ExceptionFilter
│   ├── interfaces/ utils/
├── database/                # esquemas / conexión (Mongoose)
├── modules/
│   ├── auth/                # Google OAuth + JWT + /api/auth/*
│   ├── drive-sync/          # Sync Drive -> catálogo (POST /api/sync/drive)
│   ├── comics/              # catálogo + streaming (catalog.service, reader-stream.service)
│   ├── archive-extractor/   # extracción CBZ/CBR + ComicInfo.xml
│   ├── reading-state/       # historial de lectura (GET /api/reading-history)
│   ├── temp-cache/          # caché local LRU de archivos/portadas
│   └── health/              # GET /api/health
└── types/
```

## 2. API — referencia rápida

Base URL local: `http://localhost:3000/api`

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/health` | Healthcheck (usado por Docker `healthcheck`) |
| `GET` | `/api/auth/google` | Inicia flujo Google OAuth 2.0 |
| `GET` | `/api/auth/google/callback` | Callback OAuth (redirige a `FRONTEND_URL`; `?format=json` para clientes no-web) |
| `POST` | `/api/auth/logout` | Cierra sesión |
| `GET` | `/api/auth/me` | Perfil del usuario autenticado (JWT) |
| `POST` | `/api/sync/drive` | Sincroniza catálogo desde Google Drive del usuario |
| `GET` | `/api/comics` | Lista el catálogo |
| `PATCH` | `/api/comics/:id/progress` | Actualiza progreso de lectura |
| `PATCH` | `/api/comics/:id/favorite` | Marca/desmarca favorito |
| `GET` | `/api/comics/:id/manifest` | Manifiesto del cómic (páginas, metadatos `ComicInfo.xml`) |
| `GET` | `/api/comics/:id/pages/:pageIndex` | Stream de una página (imagen) |
| `GET` | `/api/comics/:id/cover` | Portada / thumbnail (`sharp`) |
| `GET` | `/api/reading-history` | Historial de lectura del usuario |

Notas:

- Validación global: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — los DTOs con propiedades extra son rechazados con `400`.
- Errores con formato **RFC 7807** (`application/problem+json`) vía `Rfc7807ExceptionFilter`.

## 3. Requisitos

- Node.js **22** + `corepack` (para pnpm) — o pnpm 10 instalado.
- MongoDB **7** (local o el servicio `mongo` del compose).
- Credenciales Google OAuth 2.0 (Client ID + Client Secret) con redirect URI registrada.
- Puertos libres: `3000` (API), `27017` (Mongo, solo compose local).

## 4. Variables de entorno

Copia `.env.example` a `.env` y completa los secretos. **Nunca** commitees `.env` (está en `.gitignore`).

```bash
cp .env.example .env
```

| Variable | Requerida | Defecto | Descripción |
|---|---|---|---|
| `PORT` | No | `3000` | Puerto HTTP de NestJS |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `DATABASE_URL` | **Sí** | — | URI Mongo (ej. `mongodb://vault_admin:secure_vault_pass@localhost:27017/comicvault?authSource=admin`) |
| `JWT_SECRET` | **Sí** (mín. 32 chars) | — | Firma de JWT. Fail-fast en boot si falta |
| `ENCRYPTION_KEY_AES256` | **Sí** (mín. 32 chars) | — | Cifrado AES-256 de tokens OAuth en reposo. Fail-fast si falta |
| `GOOGLE_CLIENT_ID` | **Sí** | — | OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | **Sí** | — | OAuth Client Secret |
| `GOOGLE_CALLBACK_URL` | **Sí** (URI) | — | Ej. `http://localhost:3000/api/auth/google/callback`. Debe coincidir con la consola de Google |
| `TEMP_DIR` | No | `/temp/comics` | Caché local de archivos descargados |
| `TEMP_COVER_DIR` | No | `/temp/covers` | Caché local de portadas |
| `MAX_CACHE_FILES` | No | `15` | Límite de ficheros en caché |
| `MAX_CACHE_SIZE_BYTES` | No | `157286400` (~150 MB) | Límite de tamaño de caché |
| `FRONTEND_URL` | No | `http://localhost:5173` | Redirect post-login OAuth |

Generar secretos:

```bash
node -e "const c=require('node:crypto'); console.log(c.randomBytes(32).toString('hex'))"
```

## 5. Desarrollo local (sin Docker)

```bash
pnpm install
cp .env.example .env   # y edítalo
pnpm run start:dev     # watch mode -> http://localhost:3000/api/health
```

Otros scripts (`package.json`):

| Script | Comando | Qué hace |
|---|---|---|
| `build` | `pnpm run build` | `nest build` -> `dist/` |
| `start` | `pnpm run start` | Arranque normal |
| `start:dev` | `pnpm run start:dev` | Watch mode |
| `start:prod` | `pnpm run start:prod` | `node dist/main.js` |
| `lint` | `pnpm run lint` | `node scripts/lint.js` |
| `format` / `format:check` | `pnpm run format` | Prettier `src/**/*.ts test/**/*.ts` |
| `test` / `test:cov` | `pnpm test` | Jest (+ cobertura) |
| `test:e2e` | `pnpm run test:e2e` | Jest con `test/jest-e2e.json` |

## 6. Producción con Docker Compose (recomendado)

Levanta **backend + MongoDB 7** con healthchecks, volúmenes (`mongo_data`, `temp_cache`) y red `comicvault_network`:

```bash
# 1. Secretos que el compose inyecta al contenedor (el resto va hardcodeado en docker-compose.yml)
JWT_SECRET=... \
ENCRYPTION_KEY_AES256=... \
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback \
docker compose up --build -d

docker compose ps
curl http://localhost:3000/api/health
docker compose logs -f backend
```

Notas:

- El `Dockerfile` es multi-stage: `builder` (install + `nest build` + `prune --prod`) y `runner` (`node:22-alpine`, usuario `node`, `dumb-init`, `EXPOSE 3000`, `CMD ["node", "dist/main.js"]`).
- El healthcheck del backend consulta `http://localhost:3000/api/health` con `wget`.
- `DATABASE_URL` dentro del compose apunta al host `mongo` (`mongodb://vault_admin:secure_vault_pass@mongo:27017/comicvault?authSource=admin`). Las credenciales de Mongo del compose son de **desarrollo** (`vault_admin` / `secure_vault_pass`): cámbialas antes de exponer el servicio.

## 7. Seguridad

- `ConfigModule` valida con **Joi** y falla en arranque si faltan `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY_AES256` o las credenciales de Google — no hay secretos hardcodeados.
- Tokens OAuth de Drive cifrados con **AES-256** (`ENCRYPTION_KEY_AES256`) vía `EncryptionModule`.
- Auth por **JWT** (`@nestjs/jwt`); callback OAuth redirige a `FRONTEND_URL` salvo `?format=json`.
- `ValidationPipe` estricto (`whitelist` + `forbidNonWhitelisted`) y errores normalizados **RFC 7807**.

## 8. Testing y calidad

```bash
pnpm test          # unitarios (Jest, --passWithNoTests)
pnpm run test:cov  # con cobertura -> coverage/
pnpm run test:e2e  # e2e (test/jest-e2e.json)
pnpm run lint         # scripts/lint.js
pnpm run format:check # prettier --check
```

## 9. Despliegue — notas

1. Fija `NODE_ENV=production` (el compose ya lo hace).
2. Usa secretos reales de 32+ bytes para `JWT_SECRET` y `ENCRYPTION_KEY_AES256`.
3. Registra `GOOGLE_CALLBACK_URL` exacta (`https://<tu-dominio>/api/auth/google/callback`) en Google Cloud Console.
4. Persiste `mongo_data`; dimensiona `MAX_CACHE_FILES` / `MAX_CACHE_SIZE_BYTES` según disco.
5. Expón solo el puerto 3000 (o un reverse proxy con TLS delante).

---

Repo remoto: `https://github.com/EnriqueKloosterman/comic_vault_server.git` · Rama: `main`.
