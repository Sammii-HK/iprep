# R2 Bucket-Scoped Token Fix

## The Issue

Your token is scoped to `iprep-bucket` which is correct. The error occurs because:
- Bucket-scoped tokens can't list all buckets (they only have access to their specific bucket)
- The test now directly accesses `iprep-bucket` instead of trying to list buckets

## Verify Bucket Name

**Important**: Bucket names are case-sensitive!

1. Go to Cloudflare Dashboard → R2
2. Check the exact bucket name (should be `iprep-bucket`)
3. In Vercel, verify `R2_BUCKET_NAME` matches exactly:
   - Should be: `iprep-bucket` (lowercase)
   - Not: `iprep-Bucket` or `Iprep-Bucket` or `IPREP-BUCKET`

## Token Configuration

Your token should be:
- **Permissions**: "Object Read & Write" ✅
- **Bucket**: `iprep-bucket` (or "All buckets" if you prefer)
- **Access**: Read, write, and list objects in `iprep-bucket`

## After Redeploy

The new test will:
1. Try to access `iprep-bucket` directly
2. Test if it can read/write to the bucket
3. Give you specific error messages if it fails

Check `/api/env-check` after Vercel redeploys - it should now work!
