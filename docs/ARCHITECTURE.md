# OTONOM AI News Studio — SaaS Microservices Architecture (100% Free)

## Overview

**Goal:** Deploy OTONOM as a production-ready SaaS with microservices architecture, 100% free tier, GitHub Pages frontend + Cloudflare Workers backend.

**Architecture:** Monorepo with separated services communicating via HTTP/REST. Frontend on GitHub Pages (static). Backend on Cloudflare Workers (serverless, generous free tier). Storage on Cloudflare R2 (10GB free). All CI/CD via GitHub Actions.

**Tech Stack:**
- Frontend: React 18 + Vite + Tailwind CSS (static export)
- Backend: Cloudflare Workers (TypeScript) + Hono framework
- Storage: Cloudflare R2 (S3-compatible, 10GB free)
- Queue: Cloudflare Queues (free tier)
- Auth: Cloudflare Access / JWT (self-managed)
- CI/CD: GitHub Actions
- Domain: GitHub Pages (username.github.io/repo) + Workers (subdomain.workers.dev)

---

## Free Tier Limits (2024)

| Service | Free Limit | OTONOM Usage |
|---------|-----------|--------------|
| GitHub Pages | 1GB storage, 100GB bandwidth/mo | ~50MB build |
| Cloudflare Workers | 100k requests/day, 10ms CPU | ~1k req/day |
| Cloudflare R2 | 10GB storage, 1M Class A ops | ~1GB video/mo |
| Cloudflare Queues | 1M messages/mo | ~100 jobs/mo |
| GitHub Actions | 2000 min/mo (private), ∞ (public) | ~500 min/mo |

---

## Service Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Pages (Static)                  │
│  https://serefkeser.github.io/hermes/                       │
│  └── React SPA (App, Auth UI, Dashboard, Video Player)     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / REST
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers (API Gateway)          │
│  https://api.otonom.workers.dev                             │
│  ├── /auth/*        → Auth Service (JWT, refresh)          │
│  ├── /jobs/*        → Job Queue Service                    │
│  ├── /media/*       → Media Storage Service (R2 proxy)     │
│  ├── /render/*      → Video Generation Worker (async)      │
│  └── /webhooks/*    → Social Media Callbacks               │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Cloudflare R2 │ │ Cloudflare    │ │ External APIs │
│ (Media Bucket)│ │ Queues (Jobs) │ │ (Gemini, etc) │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## Monorepo Structure

```
/c/Users/skese/hermes/
├── apps/
│   ├── web/                    # Frontend (GitHub Pages)
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── .github/workflows/deploy-pages.yml
│   └── admin/                  # Admin dashboard (optional, same deploy)
│
├── services/
│   ├── api-gateway/            # Cloudflare Workers entry point
│   │   ├── src/
│   │   │   ├── index.ts        # Hono router
│   │   │   ├── routes/
│   │   │   ├── middleware/
│   │   │   └── bindings.d.ts
│   │   ├── wrangler.toml
│   │   ├── package.json
│   │   └── .github/workflows/deploy-worker.yml
│   │
│   ├── auth-service/           # Auth Worker (separate for scaling)
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── job-queue/              # Job orchestration Worker
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── media-storage/          # R2 proxy Worker
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── video-renderer/         # Video generation Worker (heavy)
│       ├── src/
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── shared-types/           # TypeScript types shared across services
│   │   ├── src/
│   │   │   ├── api.ts
│   │   │   ├── job.ts
│   │   │   ├── user.ts
│   │   │   └── media.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── shared-config/          # Environment config, constants
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared-utils/           # Common utilities (crypto, validation, etc)
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── cloudflare/
│   │   ├── r2-buckets.md       # Bucket configs
│   │   ├── queues.md           # Queue configs
│   │   └── d1-schema.sql       # If using D1 (free SQLite)
│   └── github/
│       ├── environments.md     # GitHub Environments config
│       └── secrets.md          # Required secrets list
│
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   ├── API.md                  # API contracts
│   ├── DEPLOYMENT.md           # Step-by-step deploy guide
│   └── LOCAL_DEV.md            # Local development setup
│
├── .github/
│   └── workflows/
│       ├── ci.yml              # Shared CI (lint, test, typecheck)
│       └── release.yml         # Version bump + changelog
│
├── package.json                # Root workspace config (npm workspaces)
├── turbo.json                  # Turborepo config (optional)
├── tsconfig.base.json
└── README.md
```

---

## Service Contracts (API)

### Auth Service (`/auth/*`)
```
POST   /auth/register       → { user, accessToken, refreshToken }
POST   /auth/login          → { user, accessToken, refreshToken }
POST   /auth/refresh        → { accessToken, refreshToken }
POST   /auth/logout         → { success: true }
GET    /auth/me             → { user } (requires Bearer token)
```

### Job Queue Service (`/jobs/*`)
```
POST   /jobs                → { jobId, status: 'queued' }
GET    /jobs/:id            → { jobId, status, progress, result?, error? }
GET    /jobs                → { jobs[] } (paginated, filtered)
DELETE /jobs/:id            → { success: true }
WS     /jobs/:id/stream     → Real-time progress updates
```

### Media Storage Service (`/media/*`)
```
POST   /media/upload        → { uploadUrl, mediaId } (presigned PUT)
GET    /media/:id           → Redirect to R2 public URL (or signed GET)
DELETE /media/:id           → { success: true }
POST   /media/multipart     → { uploadId, parts[] } (for large video)
PUT    /media/multipart/:uploadId/:partNumber → Direct R2 upload
POST   /media/complete      → { mediaId } (complete multipart)
```

### Video Renderer Service (`/render/*`)
```
POST   /render              → { jobId } (async, returns immediately)
GET    /render/:jobId       → { status, videoUrl?, thumbnailUrl?, error? }
POST   /render/:jobId/cancel → { success: true }
```

### Webhooks (`/webhooks/*`)
```
POST   /webhooks/buffer     → Buffer.com callback
POST   /webhooks/linkedin   → LinkedIn callback
POST   /webhooks/github     → GitHub Actions callback (for CI status)
```

---

## Data Models

### User
```typescript
interface User {
  id: string;                 // UUID
  email: string;
  name: string;
  avatarUrl?: string;
  plan: 'free' | 'pro';       // Future: tier limits
  createdAt: number;
  updatedAt: number;
}
```

### Job
```typescript
interface Job {
  id: string;                 // UUID
  userId: string;
  type: 'video' | 'image' | 'analysis';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  input: JobInput;
  config: RenderConfig;
  progress: number;           // 0-100
  result?: JobResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface JobInput {
  type: 'text' | 'url' | 'media' | 'prompt';
  data: string | MediaFile[];
}

interface JobResult {
  videoUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  script?: VideoScript;
  logs: LogEntry[];
}
```

### MediaFile
```typescript
interface MediaFile {
  id: string;
  userId: string;
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  size: number;
  r2Key: string;              // Path in R2 bucket
  publicUrl?: string;         // If public
  createdAt: number;
}
```

---

## Environment Variables (Per Service)

### API Gateway (`.dev.vars` / Cloudflare Dashboard)
```
JWT_SECRET=                    # 32+ char random string
JWT_EXPIRY=15m
REFRESH_EXPIRY=7d
R2_BUCKET_NAME=otonom-media
R2_PUBLIC_URL=https://pub-xxx.r2.dev
QUEUE_NAME=job-queue
RATE_LIMIT=100/min
CORS_ORIGIN=https://serefkeser.github.io
```

### Auth Service
```
JWT_SECRET=                    # Same as gateway
DATABASE_URL=                  # D1 or KV namespace binding
BCRYPT_ROUNDS=12
```

### Job Queue
```
QUEUE_BINDING=job-queue
R2_BUCKET_BINDING=media-bucket
MAX_JOB_DURATION=600          # seconds
```

### Media Storage
```
R2_BUCKET_BINDING=media-bucket
MAX_UPLOAD_SIZE=100MB
PRESIGNED_URL_EXPIRY=3600     # seconds
```

### Video Renderer
```
GEMINI_API_KEY=               # User-provided or shared
FFMPEG_CORE_PATH=https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js
MAX_RENDER_TIME=300           # seconds
R2_BUCKET_BINDING=media-bucket
```

---

## CI/CD Pipeline

### GitHub Actions Workflows

1. **`ci.yml`** (runs on every PR/push)
   - Typecheck all packages (`tsc --noEmit`)
   - Lint (`eslint . --ext .ts,.tsx`)
   - Unit tests (`vitest run`)
   - Build verification (all services compile)

2. **`deploy-pages.yml`** (on push to main, `apps/web/`)
   - Build Vite app (`npm run build`)
   - Upload `dist/` to GitHub Pages
   - Deploy to `https://serefkeser.github.io/hermes/`

3. **`deploy-worker.yml`** (on push to main, `services/*/`)
   - Install deps
   - `wrangler deploy --env production`
   - Runs per-service (matrix strategy)

4. **`release.yml`** (manual dispatch)
   - Bump version in root `package.json`
   - Generate changelog
   - Create git tag
   - Trigger all deploy workflows

---

## Local Development

```bash
# Install all deps (npm workspaces)
npm install

# Start all services locally
# Terminal 1: Frontend
npm run dev --workspace=apps/web

# Terminal 2: API Gateway (wrangler dev)
npm run dev --workspace=services/api-gateway

# Terminal 3: Auth Service
npm run dev --workspace=services/auth-service

# Terminal 4: Job Queue
npm run dev --workspace=services/job-queue

# Terminal 5: Media Storage
npm run dev --workspace=services/media-storage

# Terminal 6: Video Renderer (optional, heavy)
npm run dev --workspace=services/video-renderer
```

---

## Deployment Checklist

### One-time Setup (Cloudflare Dashboard)
- [ ] Create R2 bucket: `otonom-media`
- [ ] Create Queue: `job-queue`
- [ ] (Optional) Create D1 database: `otonom-db`
- [ ] Create KV namespaces: `auth-sessions`, `rate-limits`
- [ ] Add Worker secrets: `JWT_SECRET`, `GEMINI_API_KEY`, etc.

### One-time Setup (GitHub)
- [ ] Enable GitHub Pages (source: GitHub Actions)
- [ ] Add Repository Secrets:
  - `CLOUDFLATE_API_TOKEN`
  - `CLOUDFLATE_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  - `JWT_SECRET`
  - `GEMINI_API_KEY`

### Per-Service Deploy
- [ ] `apps/web` → GitHub Pages
- [ ] `services/api-gateway` → Workers
- [ ] `services/auth-service` → Workers
- [ ] `services/job-queue` → Workers
- [ ] `services/media-storage` → Workers
- [ ] `services/video-renderer` → Workers

---

## Cost Control (Staying Free)

1. **Request Batching**: Frontend batches UI calls
2. **Caching**: Cloudflare Cache API for static assets
3. **R2 Lifecycle Rules**: Auto-delete temp uploads after 24h
4. **Queue Consumer**: Scale to 0 when idle (Workers default)
5. **Video Render**: Limit concurrent jobs (1 free, 3 pro)
6. **Monitoring**: Cloudflare Analytics (free) + GitHub Actions logs

---

## Migration from Current Monolith

| Current Module | Target Service | Effort |
|---------------|---------------|--------|
| M1-M3 (Config, Utils, Network) | `packages/shared-*` | Low |
| M4 (AssetManager) | `services/media-storage` + R2 | Medium |
| M5 (LogicEngine) | `services/video-renderer` (partial) | High |
| M6 (MediaSynthesis) | `services/video-renderer` | High |
| M7 (AmbientAudio) | `packages/shared-utils` | Low |
| M8 (RenderEngine) | `services/video-renderer` (core) | High |
| M9 (Workflow) | `services/job-queue` + API Gateway | Medium |
| M10 (React UI) | `apps/web` | Low (extract) |

---

## Next Steps (Priority Order)

1. **Setup monorepo** with npm workspaces + shared packages
2. **Extract frontend** to `apps/web` with Vite + GitHub Pages deploy
3. **Deploy API Gateway** skeleton on Workers with routing
4. **Implement Auth** (JWT + KV sessions)
5. **Media Storage** proxy to R2 with presigned URLs
6. **Job Queue** with Queue consumer
7. **Video Renderer** port from canvas-based to Worker-compatible (OffscreenCanvas + ffmpeg.wasm)
8. **Integration testing** end-to-end
9. **Documentation** + user onboarding flow