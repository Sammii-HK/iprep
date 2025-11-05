# R2 Connection Fix - "Access Denied" Error

## Problem
The R2 connection is failing with "Access Denied". This means your R2 API token doesn't have the right permissions.

## Solution

### Step 1: Check R2 API Token Permissions

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Click **"Manage R2 API Tokens"**
3. Find your token (or create a new one)
4. **Critical**: Make sure it has:
   - **Permissions**: `Object Read & Write` (or `Admin`)
   - **Bucket**: Select your bucket `iprep-bucket` (or "All buckets")

### Step 2: Create New Token (If Needed)

If your current token doesn't have permissions:

1. Go to R2 → **Manage R2 API Tokens**
2. Click **"Create API Token"**
3. **Name**: `iprep-production`
4. **Permissions**: 
   - Select **"Object Read & Write"**
   - Or select **"Admin Read & Write"** for full access
5. **Bucket**: Select `iprep-bucket` (or leave as "All buckets" if you want)
6. Click **"Create API Token"**
7. **Copy the credentials immediately** (you won't see them again)

### Step 3: Update Vercel Environment Variables

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Update these values with your new token:
   - `R2_ACCESS_KEY_ID` = New Access Key ID
   - `R2_SECRET_ACCESS_KEY` = New Secret Access Key
3. **Redeploy** your app (Vercel will auto-redeploy or trigger manually)

### Step 4: Verify

After redeploy, visit:
```
https://your-app.vercel.app/api/env-check
```

The `r2_connection` should now show `"status": "ok"`.

## Common Issues

### Issue: "Access Denied"
**Fix**: API token needs "Object Read & Write" or "Admin" permissions

### Issue: "Bucket not found"
**Fix**: Check `R2_BUCKET_NAME` matches exactly (case-sensitive)

### Issue: "Invalid endpoint"
**Fix**: Verify `R2_ENDPOINT` format: `https://[ACCOUNT_ID].r2.cloudflarestorage.com`

## Quick Checklist

- [ ] R2 API token has "Object Read & Write" permissions
- [ ] Token is scoped to correct bucket (or all buckets)
- [ ] `R2_BUCKET_NAME` matches exactly: `iprep-bucket`
- [ ] `R2_ENDPOINT` format is correct: `https://[ACCOUNT_ID].r2.cloudflarestorage.com`
- [ ] Updated Vercel environment variables
- [ ] Redeployed after updating variables

## Test Locally

If you want to test locally first:
```bash
# Pull env vars from Vercel
vercel env pull .env.local

# The env-check endpoint will work locally too
npm run dev
# Visit: http://localhost:3000/api/env-check
```
