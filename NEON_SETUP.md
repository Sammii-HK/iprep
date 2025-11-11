# Using Neon Database with iPrep

## Why Neon?

- ✅ **Free tier**: 0.5GB storage, unlimited projects
- ✅ **Serverless Postgres**: Auto-scales, pay only for what you use
- ✅ **Easy integration**: Works seamlessly with Prisma
- ✅ **Vercel integration**: Can be added via Vercel Marketplace

## Setup Options

### Option 1: Via Vercel Marketplace (Easiest)

1. In Vercel dashboard → Your Project → **Storage**
2. Click **"Create Database"**
3. Select **"Neon"** from the marketplace
4. Vercel automatically:
   - Creates a Neon database
   - Sets `DATABASE_URL` environment variable
   - Configures connection pooling

**Done!** No manual setup needed.

### Option 2: Manual Neon Setup

1. Go to [neon.tech](https://neon.tech)
2. Sign up/login (free account)
3. Click **"Create Project"**
4. Choose:
   - Project name: `interview-coach` (or any name)
   - Region: Choose closest to you
   - Postgres version: 15 or 16 (recommended)
5. Click **"Create Project"**
6. Copy the connection string:

   - It will look like: `postgresql://[user]:[password]@[hostname]/[database]?sslmode=require`
   - Or click "Connection string" button for formatted version

7. **Add to Vercel:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add: `DATABASE_URL` = your Neon connection string
   - Make sure to include `?sslmode=require` at the end

## Run Migration

After setting DATABASE_URL in Vercel:

```bash
# Option 1: Via Vercel CLI (recommended)
vercel env pull .env.local
npx prisma migrate deploy

# Option 2: Via Neon SQL Editor
# Go to Neon dashboard → SQL Editor
# Copy and paste migration SQL from prisma/migrations
```

## Connection String Format

Neon connection string format:

```
postgresql://[user]:[password]@[hostname]/[database]?sslmode=require
```

Example:

```
postgresql://neondb_owner:password123@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

## Neon Free Tier Limits

- **Storage**: 0.5GB (plenty for this app)
- **Compute**: 0.5 vCPU
- **Projects**: Unlimited
- **Branches**: 1 branch per project (free tier)

## Tips

1. **Connection Pooling**: Neon handles this automatically
2. **Branches**: Create branches for testing (Pro feature)
3. **Monitoring**: Check Neon dashboard for usage
4. **Backups**: Automatic daily backups (free tier)

## Troubleshooting

### Connection Issues

- Make sure connection string includes `?sslmode=require`
- Check Neon dashboard for connection status
- Verify IP is not blocked (Neon allows all IPs by default)

### Migration Issues

- Use `npx prisma migrate deploy` (not `dev`)
- Make sure DATABASE_URL is set correctly
- Check Neon SQL Editor for errors

## Cost

- **Free tier**: Perfect for development and small projects
- **Pro tier**: $19/month if you need more storage/compute
- **Pay-as-you-go**: For occasional spikes

## Next Steps

1. ✅ Set up Neon database (via Vercel or manually)
2. ✅ Add `DATABASE_URL` to Vercel environment variables
3. ✅ Run migration: `npx prisma migrate deploy`
4. ✅ Test the app!
