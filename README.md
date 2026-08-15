# OTONOM AI News Studio — SaaS Microservices Architecture

A production-ready, 100% free-tier SaaS for generating AI-powered news videos, beautiful quotes, and fact-check analyses.

> **Güncel hedef mimari:** Üretim tarayıcıda yapılır ve medya saklanmaz. R2/Queue zorunlu değildir. AI analizi Groq, OpenCode Zen, OpenRouter Free, NVIDIA ve Gemini arasında fallback kullanır; Türkçe TTS Gemini Aoede ile çalışır. ZenMux adaptörü maliyet oluşmaması için varsayılan kapalıdır. Kurulum: [Ücretsiz AI sağlayıcıları](docs/FREE_AI_PROVIDERS.md).

## Architecture Overview

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
│  https://api.seref-keser.workers.dev                        │
│  ├── /api/auth/*     → Auth Service (JWT, refresh)         │
│  ├── /api/jobs/*     → Job Queue Service                   │
│  ├── /api/media/*    → Media Storage Service (R2 proxy)    │
│  ├── /api/render/*   → Video Generation Worker (async)     │
│  └── /api/webhooks/* → Social Media Callbacks              │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Cloudflare R2 │ │ Cloudflare    │ │ External APIs │
│ (Media Bucket)│ │ Queues (Jobs) │ │ (Gemini, etc) │
└───────────────┘ └───────────────┘ └───────────────┘
```

## Free Tier Limits (2024)

| Service | Free Limit | OTONOM Usage |
|---------|-----------|--------------|
| GitHub Pages | 1GB storage, 100GB bandwidth/mo | ~50MB build |
| Cloudflare Workers | 100k requests/day, 10ms CPU | ~1k req/day |
| Cloudflare R2 | 10GB storage, 1M Class A ops | ~1GB video/mo |
| Cloudflare Queues | 1M messages/mo | ~100 jobs/mo |
| GitHub Actions | ∞ (public repo) | ~500 min/mo |

## Monorepo Structure

```
/c/Users/skese/hermes/
├── apps/
│   └── web/                    # Frontend (GitHub Pages)
├── services/
│   ├── api-gateway/            # Cloudflare Workers entry point
│   ├── auth-service/           # Auth Worker (JWT)
│   ├── job-queue/              # Job orchestration Worker
│   ├── media-storage/          # R2 proxy Worker
│   └── video-renderer/         # Video generation Worker
├── packages/
│   ├── shared-types/           # TypeScript types
│   ├── shared-config/          # Config constants
│   └── shared-utils/           # Common utilities
├── infra/
│   └── cloudflare/             # R2, Queues, D1 configs
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   ├── DEPLOYMENT.md           # Deployment guide
│   └── API.md                  # API contracts
└── .github/workflows/          # CI/CD pipelines
```

## Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- Cloudflare account (free)
- GitHub account (free)

### Local Development

```bash
# Clone and install
git clone https://github.com/serefkeser/hermes.git
cd hermes
npm install

# Start all services (in separate terminals)
# Terminal 1: Frontend
npm run dev:web

# Terminal 2: API Gateway
npm run dev:gateway

# Terminal 3: Auth Service
npm run dev:auth

# Terminal 4: Job Queue
npm run dev:queue

# Terminal 5: Media Storage
npm run dev:media

# Terminal 6: Video Renderer (optional, heavy)
npm run dev:renderer
```

### Cloudflare Setup (One-time)

1. **Create R2 Bucket**: `otonom-media`
2. **Create Queue**: `otonom-job-queue`
3. **Create KV Namespaces**: `RATE_LIMIT_KV`, `RENDER_KV`
4. **Add Worker Secrets** (via `wrangler secret put`):
   - `JWT_SECRET` (32+ char random string)
   - `GEMINI_API_KEY` (from Google AI Studio)
   - `BUFFER_API_KEY` (from Buffer.com)

### GitHub Setup (One-time)

1. **Enable GitHub Pages**: Source = GitHub Actions
2. **Add Repository Secrets**:
   - `CLOUDFLARE_API_TOKEN` (Cloudflare API token with Workers + R2 + KV permissions)
   - `CLOUDFLARE_ACCOUNT_ID` (from Cloudflare dashboard)
   - `JWT_SECRET` (same as Worker secret)
   - `GEMINI_API_KEY` (same as Worker secret)

### Deploy

```bash
# Push to main triggers all deployments
git push origin main
```

## Services

### API Gateway (`services/api-gateway`)
- **Routes**: `/api/auth/*`, `/api/jobs/*`, `/api/media/*`, `/api/render/*`, `/api/webhooks/*`
- **Middleware**: Rate limiting (KV), Auth (JWT), CORS, Request ID, Error handling
- **Deploy**: `wrangler deploy` from `services/api-gateway/`

### Auth Service (`services/auth-service`)
- **Endpoints**: `POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`
- **Storage**: KV for users and refresh tokens
- **Security**: PBKDF2 password hashing, JWT tokens (15min access, 7d refresh)

### Job Queue (`services/job-queue`)
- **Queue Consumer**: Processes jobs from Cloudflare Queues
- **Job Types**: video, image, analysis, guzel-soz, iddia-analizi
- **Status**: queued → processing → completed/failed/cancelled
- **Real-time**: SSE streaming for progress updates

### Media Storage (`services/media-storage`)
- **R2 Proxy**: Presigned PUT/GET URLs for direct browser uploads
- **Multipart**: Support for large files (>5MB)
- **Features**: Upload, download, delete, list with pagination

### Video Renderer (`services/video-renderer`)
- **Queue Consumer**: Processes render jobs asynchronously
- **Rendering**: OffscreenCanvas + ffmpeg.wasm (WebM/MP4)
- **Output**: Video + thumbnail uploaded to R2
- **Limits**: 1 concurrent job (free tier), 5 min max duration

### Web App (`apps/web`)
- **Framework**: React 18 + Vite + TypeScript
- **Deploy**: GitHub Pages via GitHub Actions
- **Features**: 
  - 5 input modes (Text, URL, Media, Prompt, Gazete)
  - 3 content types (Haber, Güzel Söz, İddia Analizi)
  - 30 newspaper tracking with crop/add
  - Music library with 10s preview
  - Social sharing (Buffer, LinkedIn)
  - Real-time processing logs

## API Contracts

### Authentication
```
POST /api/auth/register    → { user, accessToken, refreshToken }
POST /api/auth/login       → { user, accessToken, refreshToken }
POST /api/auth/refresh     → { accessToken, refreshToken }
POST /api/auth/logout      → { success: true }
GET  /api/auth/me          → { user }
```

### Jobs
```
POST /api/jobs             → { jobId, status: 'queued' }
GET  /api/jobs/:id         → { job }
GET  /api/jobs             → { items[], total, page, hasMore }
DELETE /api/jobs/:id       → { success: true }
GET  /api/jobs/:id/stream  → SSE real-time updates
```

### Media
```
POST /api/media/upload     → { uploadUrl, mediaId } (presigned PUT)
POST /api/media/upload/multipart → { uploadId, partUrls[] }
POST /api/media/upload/complete  → { mediaId, publicUrl }
GET  /api/media/:id        → Redirect to R2 URL
DELETE /api/media          → { deleted, failed }
GET  /api/media            → { items[], total, page }
```

### Render
```
POST /api/render           → { jobId } (async)
GET  /api/render/:jobId    → { job }
POST /api/render/:jobId/cancel → { success: true }
GET  /api/render/:jobId/result → { videoUrl, thumbnailUrl, script }
GET  /api/render/:jobId/download → 302 to video
```

### Webhooks
```
POST /api/webhooks/buffer     → Buffer.com callback
POST /api/webhooks/linkedin   → LinkedIn callback
POST /api/webhooks/github     → GitHub Actions callback
POST /api/webhooks/retry/:jobId → Manual retry
```

## Configuration

### Environment Variables (Per Service)

**API Gateway** (`.dev.vars` / Cloudflare Dashboard):
```bash
JWT_SECRET=                    # 32+ char random
JWT_EXPIRY=15m
REFRESH_EXPIRY=7d
R2_BUCKET_NAME=otonom-media
R2_PUBLIC_URL=https://pub-xxx.r2.dev
QUEUE_NAME=otonom-job-queue
RATE_LIMIT=100/min
CORS_ORIGIN=https://serefkeser.github.io
```

**Video Renderer**:
```bash
GEMINI_API_KEY=               # Google AI Studio key
FFMPEG_CORE_PATH=https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js
MAX_RENDER_TIME=300
```

### Plan Limits

```typescript
free: {
  jobsPerDay: 10,
  concurrentJobs: 1,
  maxVideoDuration: 120,     // 2 minutes
  maxUploadSizeMB: 50,
  customImages: 2,
}
pro: {
  jobsPerDay: 100,
  concurrentJobs: 3,
  maxVideoDuration: 600,     // 10 minutes
  maxUploadSizeMB: 200,
  customImages: 10,
}
```

## Development Guidelines

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Functional components with hooks
- Zod for validation

### Adding a New Service
1. Create `services/new-service/` with `package.json`, `wrangler.toml`, `tsconfig.json`
2. Add to npm workspaces in root `package.json`
3. Add route to API Gateway
4. Create GitHub Actions workflow
5. Update documentation

### Testing
```bash
# Run all tests
npm run test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Deployment Checklist

### One-time (Cloudflare)
- [ ] Create R2 bucket: `otonom-media`
- [ ] Create Queue: `otonom-job-queue`
- [ ] Create KV namespaces: `RATE_LIMIT_KV`, `RENDER_KV`
- [ ] Add Worker secrets: `JWT_SECRET`, `GEMINI_API_KEY`, `BUFFER_API_KEY`

### One-time (GitHub)
- [ ] Enable GitHub Pages (GitHub Actions source)
- [ ] Add Repository Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JWT_SECRET`, `GEMINI_API_KEY`

### Per Deploy
- [ ] Push to `main` branch
- [ ] Verify CI passes
- [ ] Check GitHub Pages deployment
- [ ] Verify Workers deployed (check Cloudflare dashboard)

## Cost Control (Staying Free)

1. **Request Batching**: Frontend batches UI calls
2. **Caching**: Cloudflare Cache API for static assets
3. **R2 Lifecycle Rules**: Auto-delete temp uploads after 24h
4. **Queue Consumer**: Scale to 0 when idle (Workers default)
5. **Video Render**: Limit concurrent jobs (1 free, 3 pro)
6. **Monitoring**: Cloudflare Analytics (free) + GitHub Actions logs

## License

MIT License - see LICENSE file for details.

## Links

- **Live Demo**: https://serefkeser.github.io/hermes/
- **API**: https://api.seref-keser.workers.dev/health
- **Architecture**: docs/ARCHITECTURE.md
- **API Reference**: docs/API.md
- **Deployment Guide**: docs/DEPLOYMENT.md
