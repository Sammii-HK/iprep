# Quick Deployment Checklist

## Step 1: Push to GitHub
```bash
git push origin main
```

## Step 2: Deploy to Vercel

**If you haven't connected Vercel yet:**
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repo
4. Vercel will auto-detect Next.js settings

**If already connected:**
- Vercel will auto-deploy on push
- Or manually trigger: Vercel Dashboard → Deployments → Redeploy

## Step 3: Verify Environment Variables

After deployment, visit:
```
https://your-app.vercel.app/api/env-check
```

This will show you:
- ✅ Which environment variables are set
- ✅ If database connection works
- ✅ If R2 connection works
- ✅ If OpenAI is configured

## Step 4: Run Database Migration

After confirming env vars work:

```bash
# Option 1: Via Vercel CLI
vercel env pull .env.local
npx prisma migrate deploy

# Option 2: Via Neon Dashboard
# Go to Neon SQL Editor and run:
# CREATE TABLE IF NOT EXISTS ...
# (Or use Prisma Studio to generate SQL)
```

## Step 5: Test the App

1. Visit: `https://your-app.vercel.app`
2. Try importing a question bank
3. Create a quiz
4. Test voice recording

## Troubleshooting

If `/api/env-check` shows missing variables:
1. Go to Vercel → Settings → Environment Variables
2. Make sure all are set for **Production** environment
3. Redeploy after adding variables

If database migration fails:
- Check DATABASE_URL is correct
- Make sure Neon database is active
- Verify connection string includes `?sslmode=require`
