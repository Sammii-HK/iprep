# Environment Variables Quick Reference

Copy these into your deployment platform (Vercel, Railway, etc.):

## Required Variables

```bash
# Database - Get from Supabase
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres?sslmode=require

# Cloudflare R2 - Get from Cloudflare Dashboard → R2 → API Tokens
R2_ACCOUNT_ID=your_account_id_here
R2_BUCKET_NAME=interview-coach-audio
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_ENDPOINT=https://[ACCOUNT_ID].r2.cloudflarestorage.com

# OpenAI - Get from platform.openai.com/api-keys
OPENAI_API_KEY=sk-your_openai_api_key_here
```

## Optional Variables (Defaults shown)

```bash
ENABLE_LIVE_CAPTIONS=true
MAX_AUDIO_SIZE_MB=50
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
NODE_ENV=production
```

## Quick Setup Guide

### 1. Database (Neon Recommended)

**Option A: Neon (Free tier available)**
1. Go to https://neon.tech → Sign up/Login
2. Create new project
3. Copy connection string from dashboard
4. Format: `postgresql://[user]:[password]@[hostname]/[database]?sslmode=require`
5. Free tier: 0.5GB storage, unlimited projects

**Option B: Via Vercel Marketplace**
1. In Vercel dashboard → Your Project → Storage
2. Click "Create Database"
3. Select "Neon" from marketplace
4. Vercel will automatically set `DATABASE_URL` environment variable

**Option C: Supabase (Free tier: 500MB)**
1. Go to https://supabase.com → Create Project
2. Settings → Database → Copy connection string
3. Replace `[PASSWORD]` with your database password

### 2. Cloudflare R2 (File Storage)
1. Go to https://dash.cloudflare.com → R2
2. Create bucket: `interview-coach-audio`
3. Manage R2 API Tokens → Create Token
4. Copy Account ID, Access Key ID, Secret Access Key
5. Endpoint: `https://[ACCOUNT_ID].r2.cloudflarestorage.com`

### 3. OpenAI (AI Services)
1. Go to https://platform.openai.com → API Keys
2. Create new secret key
3. Copy key (starts with `sk-`)

## Vercel Deployment

1. Push code to GitHub
2. Go to vercel.com → New Project
3. Import GitHub repo
4. Add all environment variables above
5. Deploy!
6. Run migration: `npx prisma migrate deploy` (or use Supabase SQL editor)
