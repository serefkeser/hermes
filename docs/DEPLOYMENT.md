# OTONOM Deployment Guide

Step-by-step deployment instructions for the OTONOM AI News Studio SaaS.

## Prerequisites

- **Cloudflare Account** (free): https://dash.cloudflare.com/sign-up
- **GitHub Account** (free): https://github.com/signup
- **Google AI Studio API Key** (free): https://aistudio.google.com/app/apikey
- **Buffer API Key** (optional, for social sharing): https://buffer.com/app/account/api
- **Node.js 20+** installed locally
- **Git** installed locally

---

## Phase 1: Cloudflare Infrastructure Setup

### 1.1 Create R2 Bucket

1. Go to Cloudflare Dashboard → R2 Object Storage
2. Click "Create bucket"
3. Name: `otonom-media`
4. Location: Automatic (or choose closest to your users)
5. Click "Create bucket"

### 1.2 Create Queue

1. Go to Cloudflare Dashboard → Queues
2. Click "Create queue"
3. Name: `otonom-job-queue`
4. Settings:
   - Max retries: 3
   - Retry delay: 60 seconds
   - Dead letter queue: (leave empty for now)
5. Click "Create queue"

### 1.3 Create KV Namespaces

Create two KV namespaces:

**RATE_LIMIT_KV** (for API Gateway rate limiting):
1. Go to Workers & Pages → KV
2. Click "Create namespace"
3. Name: `RATE_LIMIT_KV`
4. Click "Add"

**RENDER_KV** (for Video Renderer job state):
1. Click "Create namespace"
2. Name: `RENDER_KV`
3. Click "Add"

**Note**: Copy the namespace IDs (you'll need them for wrangler.toml files)

### 1.4 Generate Secrets

Generate a strong JWT secret (run locally):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this - you'll need it for:
- `JWT_SECRET` (Worker secret)
- GitHub Repository secret

### 1.5 Get API Keys

**Gemini API Key**:
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API key"
3. Copy the key (starts with `AIzaSy...`)

**Buffer API Key** (optional):
1. Go to https://buffer.com/app/account/api
2. Generate token
3. Copy the token

---

## Phase 2: Configure Worker Secrets

### 2.1 Login to Wrangler

```bash
npx wrangler login
```

### 2.2 Set Secrets for Each Worker

```bash
# API Gateway
cd services/api-gateway
npx wrangler secret put JWT_SECRET
# Enter the JWT secret from step 1.4

npx wrangler secret put GEMINI_API_KEY
# Enter your Gemini API key

npx wrangler secret put BUFFER_API_KEY
# Enter your Buffer API key (or dummy if not using)

# Auth Service
cd ../auth-service
npx wrangler secret put JWT_SECRET
# Same JWT secret

# Job Queue
cd ../job-queue
npx wrangler secret put JWT_SECRET
# Same JWT secret

# Video Renderer
cd ../video-renderer
npx wrangler secret put JWT_SECRET
# Same JWT secret

npx wrangler secret put GEMINI_API_KEY
# Same Gemini API key
```

### 2.3 Update wrangler.toml with KV/Queue/R2 Bindings

Update each service's `wrangler.toml` with the actual IDs from Phase 1.3:

```toml
# Example for api-gateway/wrangler.toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_ACTUAL_KV_ID_HERE"
preview_id = "YOUR_PREVIEW_KV_ID_HERE"

[[queues]]
binding = "JOB_QUEUE"
queue_name = "otonom-job-queue"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "otonom-media"
preview_bucket_name = "otonom-media-preview"
```

Do this for all services that use these bindings.

---

## Phase 3: GitHub Repository Setup

### 3.1 Create Repository

1. Go to https://github.com/new
2. Repository name: `hermes`
3. Public (required for free GitHub Actions)
4. Don't initialize with README (we have one)
5. Click "Create repository"

### 3.2 Push Code

```bash
cd /c/Users/skese/hermes
git init
git add .
git commit -m "Initial commit: OTONOM SaaS microservices"
git branch -M main
git remote add origin https://github.com/serefkeser/hermes.git
git push -u origin main
```

### 3.3 Enable GitHub Pages

1. Go to Repository Settings → Pages
2. Source: "GitHub Actions"
3. Save

### 3.4 Add Repository Secrets

Go to Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Value |
|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (create at https://dash.cloudflare.com/profile/api-tokens with Workers + R2 + KV + Queues permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID (from dashboard URL) |
| `JWT_SECRET` | The JWT secret from Phase 1.4 |
| `GEMINI_API_KEY` | Your Gemini API key from Phase 1.5 |

### 3.5 Create Environments

1. Go to Settings → Environments
2. Click "New environment"
3. Name: `github-pages`
4. Protection rules: None (or add if needed)
5. Save

---

## Phase 4: Local Development & Testing

### 4.1 Install Dependencies

```bash
cd /c/Users/skese/hermes
npm install
```

### 4.2 Start Development Servers

Open 6 terminal windows/tabs:

```bash
# Terminal 1: Frontend (Vite)
npm run dev:web
# Runs on http://localhost:3000

# Terminal 2: API Gateway
npm run dev:gateway
# Runs on http://localhost:8787

# Terminal 3: Auth Service
npm run dev:auth
# Runs on http://localhost:8788

# Terminal 4: Job Queue
npm run dev:queue
# Runs on http://localhost:8789

# Terminal 5: Media Storage
npm run dev:media
# Runs on http://localhost:8790

# Terminal 6: Video Renderer (optional)
npm run dev:renderer
# Runs on http://localhost:8791
```

### 4.3 Test Frontend

1. Open http://localhost:3000
2. Try creating a video:
   - Select "Medya Analizi" tab
   - Upload an image/video
   - Click "Video oluştur"
3. Check browser console for API calls to localhost:8787

### 4.4 Run Type Checks

```bash
npm run typecheck
npm run lint
npm run test
```

---

## Phase 5: Deploy to Production

### 5.1 Deploy Workers

```bash
# Deploy all workers
cd services/api-gateway && npx wrangler deploy --env production
cd ../auth-service && npx wrangler deploy --env production
cd ../job-queue && npx wrangler deploy --env production
cd ../media-storage && npx wrangler deploy --env production
cd ../video-renderer && npx wrangler deploy --env production
```

Or use GitHub Actions (push to main):

```bash
git push origin main
```

### 5.2 Verify Deployments

Check each Worker URL:

- API Gateway: `https://otonom-api-gateway.YOUR_SUBDOMAIN.workers.dev/health`
- Auth Service: `https://otonom-auth-service.YOUR_SUBDOMAIN.workers.dev/health`
- Job Queue: `https://otonom-job-queue.YOUR_SUBDOMAIN.workers.dev/health`
- Media Storage: `https://otonom-media-storage.YOUR_SUBDOMAIN.workers.dev/health`
- Video Renderer: `https://otonom-video-renderer.YOUR_SUBDOMAIN.workers.dev/health`

All should return `{ "success": true, "data": { "status": "healthy", ... } }`

### 5.3 Verify GitHub Pages

1. Go to https://github.com/serefkeser/hermes/actions
2. Wait for "Deploy Web App" workflow to complete
3. Visit: https://serefkeser.github.io/hermes/
4. Test the live site

---

## Phase 6: Post-Deploy Configuration

### 6.1 Update CORS Origins

If your GitHub Pages URL is different, update:
- `CORS_ORIGIN` in API Gateway wrangler.toml
- Redeploy API Gateway

### 6.2 Test Full Flow

1. Go to https://serefkeser.github.io/hermes/
2. Register/Login
3. Create a video:
   - Text input: "Test haber içeriği"
   - Click "Video oluştur"
4. Wait for processing (check logs)
5. Download video
6. Test social sharing (Buffer/LinkedIn)

### 6.3 Configure R2 Lifecycle Rules (Cost Control)

1. Go to Cloudflare Dashboard → R2 → otonom-media
2. Settings → Lifecycle rules
3. Add rule:
   - Prefix: `uploads/`
   - Expire after: 1 day
4. Add rule:
   - Prefix: `renders/`
   - Expire after: 30 days (or keep forever for user videos)

---

## Troubleshooting

### Worker Deployment Fails

**Error**: "KV namespace not found"
- Fix: Update wrangler.toml with correct KV namespace IDs

**Error**: "Queue not found"
- Fix: Ensure queue name matches exactly in wrangler.toml

**Error**: "R2 bucket not found"
- Fix: Check bucket name spelling in wrangler.toml

### Frontend Can't Connect to API

**Error**: CORS errors
- Fix: Check `CORS_ORIGIN` in API Gateway includes your GitHub Pages URL

**Error**: 401 Unauthorized
- Fix: Verify JWT_SECRET matches across all services

### Video Renderer Times Out

**Error**: Job stays in "processing"
- Check Video Renderer logs in Cloudflare Dashboard
- Free tier: 10ms CPU limit per request
- Consider: Offload heavy rendering to external service

### GitHub Pages 404

**Error**: Site not loading
- Check "Deploy Web App" workflow completed
- Verify `base: '/hermes/'` in vite.config.ts matches repo name
- Check `dist/` folder was uploaded as artifact

---

## Monitoring & Maintenance

### Free Tier Monitoring

| Resource | Limit | Alert At |
|----------|-------|----------|
| Workers Requests | 100k/day | 80k/day |
| Workers CPU | 10ms/request | 8ms avg |
| R2 Storage | 10GB | 8GB |
| R2 Class A Ops | 1M/month | 800k |
| Queue Messages | 1M/month | 800k |

### Useful Dashboards

- Cloudflare Workers: Analytics → Workers
- Cloudflare R2: Analytics → R2
- Cloudflare Queues: Analytics → Queues
- GitHub Actions: Repository → Actions

### Regular Maintenance

- **Weekly**: Check Cloudflare Analytics for usage trends
- **Monthly**: Rotate JWT_SECRET (update in all services + GitHub secrets)
- **Quarterly**: Review and update dependencies (`npm audit`, `npm update`)

---

## Scaling Beyond Free Tier

When you hit limits:

1. **Workers**: Cloudflare Workers Paid ($5/mo for 10M requests)
2. **R2**: Pay $0.015/GB/month over 10GB
3. **Queues**: $0.40/million messages over 1M
4. **GitHub Pages**: Always free for public repos
5. **GitHub Actions**: Always free for public repos

## Support

- **Issues**: https://github.com/serefkeser/hermes/issues
- **Discussions**: https://github.com/serefkeser/hermes/discussions
- **Cloudflare Docs**: https://developers.cloudflare.com/
- **GitHub Pages Docs**: https://docs.github.com/en/pages

---

*Last updated: 2024*
*Version: 3.14.0*