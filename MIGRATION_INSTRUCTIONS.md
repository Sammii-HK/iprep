# Migration Instructions for Vercel Deployment

## Add `dontForget` column to SessionItem table

Since you're using Vercel, you need to run the migration locally against your production database.

### Step 1: Get your production DATABASE_URL

1. Go to your Vercel dashboard
2. Navigate to your project → Settings → Environment Variables
3. Copy your `DATABASE_URL` value

**OR** if you're using Neon/Supabase:
- Get the connection string from your database provider's dashboard

### Step 2: Run the migration locally

**Option A: Using Prisma db push (easiest)**

```bash
# Set your production DATABASE_URL temporarily
export DATABASE_URL="your-production-database-url-here"

# Push the schema changes (this will add the column)
npx prisma db push

# Regenerate Prisma client
npx prisma generate
```

**Option B: Run SQL directly**

If you have direct database access (Neon dashboard, Supabase SQL editor, etc.):

```sql
ALTER TABLE "SessionItem" 
ADD COLUMN IF NOT EXISTS "dontForget" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "SessionItem" 
SET "dontForget" = ARRAY[]::TEXT[] 
WHERE "dontForget" IS NULL;
```

**Option C: Using Neon CLI (if using Neon)**

```bash
# Install Neon CLI if you haven't
npm install -g neonctl

# Login
neonctl auth

# Get connection string
neonctl connection-string --project-id YOUR_PROJECT_ID

# Run the migration SQL
psql "YOUR_CONNECTION_STRING" -f prisma/migrate-add-dontforget.sql
```

### Step 3: Verify

After running the migration, your Vercel deployment should work. The Prisma client will be regenerated during the build process.

### Important Notes

- **Backup first**: Always backup your database before running migrations in production
- **Test locally**: Test the migration on a local copy of your database if possible
- **No downtime**: This migration is safe and won't cause downtime (adding a column with a default value)

