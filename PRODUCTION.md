# Production Deployment Guide

## Prerequisites

- Node.js 18+ and npm/pnpm
- PostgreSQL database (Supabase recommended)
- Cloudflare R2 account (or AWS S3)
- OpenAI API key

## Environment Variables

Create a `.env.local` file (or set environment variables in your hosting platform):

```bash
# Database (Supabase/Postgres)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require

# Cloudflare R2 (S3-compatible)
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET_NAME=your-bucket-name
R2_ACCESS_KEY_ID=R2xxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Optional Configuration
ENABLE_LIVE_CAPTIONS=true
MAX_AUDIO_SIZE_MB=50
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
NODE_ENV=production
```

## Database Setup

1. **Run migrations:**
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

2. **Verify connection:**
   ```bash
   npm run db:studio  # Opens Prisma Studio to verify
   ```

## Build & Deploy

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Docker

```dockerfile
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
EXPOSE 3000
CMD ["npm", "start"]
```

### Manual Deployment

```bash
# Install dependencies
npm ci

# Generate Prisma client
npm run db:generate

# Build
npm run build

# Start production server
npm start
```

## Production Checklist

### Security
- [ ] All environment variables set
- [ ] Database connection string uses SSL
- [ ] R2 bucket has private ACL
- [ ] API keys are not exposed in client code
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] File size limits enforced

### Performance
- [ ] Database indexes created (if needed)
- [ ] Connection pooling configured
- [ ] CDN configured for static assets
- [ ] Image optimization enabled
- [ ] Compression enabled

### Monitoring
- [ ] Health check endpoint: `/api/health`
- [ ] Error logging configured
- [ ] Analytics tracking (optional)
- [ ] Uptime monitoring

### Testing
- [ ] Test audio upload and transcription
- [ ] Test CSV/JSON import
- [ ] Test practice flow end-to-end
- [ ] Test analytics dashboard
- [ ] Load testing (optional)

## Health Check

The app includes a health check endpoint at `/api/health` that returns:
- Database connection status
- Table availability
- Timestamp

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check SSL mode settings
- Verify database is accessible from hosting IP

### R2 Upload Issues
- Verify R2 credentials
- Check bucket permissions
- Verify endpoint URL format

### OpenAI API Issues
- Verify API key is valid
- Check rate limits
- Monitor API usage

### Audio Transcription Fails
- Check file size (max 50MB)
- Verify audio format (webm, mp4, wav)
- Check OpenAI API status

## Scaling Considerations

### For High Traffic:
1. **Database**: Use connection pooling (PgBouncer)
2. **Rate Limiting**: Upgrade to Redis-based rate limiting
3. **Caching**: Add Redis for session data
4. **CDN**: Use Cloudflare or similar for static assets
5. **Queue**: Add job queue for async processing (BullMQ)

### Cost Optimization:
1. **OpenAI**: Use GPT-4o-mini for cost efficiency
2. **R2**: Set lifecycle policies for old audio files
3. **Database**: Archive old session items periodically

## Support

For issues or questions:
1. Check logs: `npm run dev` for development errors
2. Check health endpoint: `/api/health`
3. Review error responses for error codes
4. Check database connection with Prisma Studio
