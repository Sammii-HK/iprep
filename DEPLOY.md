# Deployment Guide - iPrep

## Recommended Platform: Vercel

Vercel is the best choice for Next.js apps because:

- ✅ Zero-config deployment
- ✅ Automatic SSL/HTTPS
- ✅ Edge functions support
- ✅ Built-in CI/CD
- ✅ Free tier available
- ✅ PostgreSQL integration (Supabase)

## Quick Deploy to Vercel

### Step 1: Prepare Your Repository

```bash
# Make sure everything is committed
git add .
git commit -m "Ready for production"
git push origin main
```

### Step 2: Deploy to Vercel

**Option A: Via Vercel Dashboard (Recommended)**

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure project settings (see below)
5. Click "Deploy"

**Option B: Via CLI**

```bash
npm i -g vercel
vercel login
vercel
```

### Step 3: Configure Environment Variables

In Vercel dashboard → Your Project → Settings → Environment Variables, add:

#### Required Variables

```bash
# Database (Neon/Supabase/Postgres)
# Neon: Get from neon.tech dashboard
# Format: postgresql://[user]:[password]@[hostname]/[database]?sslmode=require
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Cloudflare R2 (or AWS S3)
R2_ACCOUNT_ID=your_account_id
R2_BUCKET_NAME=your-bucket-name
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com

# OpenAI
OPENAI_API_KEY=sk-your_openai_key
```

#### Optional Variables

```bash
ENABLE_LIVE_CAPTIONS=true
MAX_AUDIO_SIZE_MB=50
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
NODE_ENV=production
```

### Step 4: Run Database Migration

After deployment, run migrations:

**Option A: Via Vercel CLI**

```bash
vercel env pull .env.local
npm run db:generate
npx prisma migrate deploy
```

**Option B: Via Supabase Dashboard**

- Go to Supabase SQL Editor
- Run migrations manually (or use Prisma migrate)

## Getting Your Keys

### 1. Database Options

**Option A: Neon (Recommended - Free tier available)**

1. Go to [neon.tech](https://neon.tech) or use Vercel Marketplace
2. Create a new project
3. Copy the connection string from dashboard
4. Format: `postgresql://[user]:[password]@[hostname]/[database]?sslmode=require`
5. Neon provides free tier: 0.5GB storage, unlimited projects

**Option B: Supabase (Free tier: 500MB)**

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Settings → Database
4. Copy the connection string (under "Connection string" → "URI")
5. Format: `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

**Other Options:**

- **Vercel Postgres** (via Vercel dashboard - integrated)
- **Railway PostgreSQL** (free tier available)
- **Render PostgreSQL** (free tier available)

### 2. Cloudflare R2 (Object Storage)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Navigate to R2 → Create bucket
3. Go to "Manage R2 API Tokens"
4. Create API token with:
   - Permissions: Object Read & Write
   - Bucket: Your bucket name
5. Copy:
   - Account ID (from R2 dashboard)
   - Access Key ID
   - Secret Access Key
6. Endpoint: `https://[ACCOUNT_ID].r2.cloudflarestorage.com`

**Alternative: AWS S3**

- Use AWS S3 instead of R2
- Same endpoint format, different credentials

### 3. OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up/login
3. Go to API Keys
4. Create new secret key
5. Copy the key (starts with `sk-`)

## Alternative Platforms

### Railway

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Add PostgreSQL service
4. Add environment variables
5. Deploy

### Render

1. Go to [render.com](https://render.com)
2. New Web Service
3. Connect GitHub repo
4. Build command: `npm install && npm run build`
5. Start command: `npm start`
6. Add PostgreSQL database
7. Add environment variables

### Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly launch`
3. Configure PostgreSQL: `fly postgres create`
4. Add secrets: `fly secrets set KEY=value`
5. Deploy: `fly deploy`

## Post-Deployment Checklist

- [ ] Database migration completed
- [ ] Environment variables set
- [ ] Health check works: `https://your-domain.com/api/health`
- [ ] Test question bank import
- [ ] Test quiz creation
- [ ] Test voice recording (check browser permissions)
- [ ] Test written quiz submission
- [ ] Verify audio uploads to R2
- [ ] Check OpenAI API usage/limits

## Troubleshooting

### Database Connection Issues

- Verify `DATABASE_URL` includes `?sslmode=require`
- Check database firewall allows Vercel IPs
- Verify credentials are correct

### R2 Upload Fails

- Check bucket permissions
- Verify endpoint format
- Check CORS settings (if accessing from browser)

### OpenAI API Errors

- Check API key is valid
- Verify account has credits
- Check rate limits

### Build Fails

- Check Node.js version (should be 18+)
- Verify all dependencies install correctly
- Check for TypeScript errors: `npm run typecheck`

## Cost Estimates (Monthly)

**Free Tier:**

- Vercel: Free (Hobby plan)
- Neon: Free (0.5GB database, unlimited projects)
- Cloudflare R2: Free (10GB storage, 1M requests)
- OpenAI: Pay-as-you-go (~$0.002 per transcription)

**Production (estimated):**

- Vercel Pro: $20/month
- Supabase Pro: $25/month
- R2: ~$5-10/month (depends on storage)
- OpenAI: ~$10-50/month (depends on usage)

## Security Notes

- ✅ Never commit `.env` files
- ✅ Use Vercel's environment variables (encrypted)
- ✅ Enable R2 bucket private access
- ✅ Use Supabase RLS (Row Level Security) for v2
- ✅ Monitor API usage to prevent abuse
- ✅ Set up rate limiting (already configured)

## Need Help?

1. Check Vercel logs: Dashboard → Your Project → Functions
2. Check database: Supabase Dashboard → Logs
3. Test locally: `npm run dev` with same env vars
4. Health check: `/api/health` endpoint
