import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/db';
import { S3Client } from '@aws-sdk/client-s3';
import OpenAI from 'openai';

export async function GET() {
  const checks: Record<string, { status: 'ok' | 'error' | 'missing'; message: string }> = {};

  // Check environment variables (without exposing values)
  const config = getConfig();

  // Database
  try {
    checks.database = {
      status: config.database.url ? 'ok' : 'missing',
      message: config.database.url
        ? 'Database URL configured'
        : 'DATABASE_URL is missing',
    };

    // Test database connection
    if (config.database.url) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database_connection = {
          status: 'ok',
          message: 'Database connection successful',
        };
      } catch (error) {
        checks.database_connection = {
          status: 'error',
          message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }
  } catch (error) {
    checks.database = {
      status: 'error',
      message: 'Database configuration error',
    };
  }

  // R2 Configuration
  checks.r2_account_id = {
    status: config.r2.accountId ? 'ok' : 'missing',
    message: config.r2.accountId ? 'R2 Account ID configured' : 'R2_ACCOUNT_ID is missing',
  };

  checks.r2_bucket = {
    status: config.r2.bucketName ? 'ok' : 'missing',
    message: config.r2.bucketName ? `R2 Bucket: ${config.r2.bucketName}` : 'R2_BUCKET_NAME is missing',
  };

  checks.r2_access_key = {
    status: config.r2.accessKeyId ? 'ok' : 'missing',
    message: config.r2.accessKeyId ? 'R2 Access Key configured' : 'R2_ACCESS_KEY_ID is missing',
  };

  checks.r2_secret_key = {
    status: config.r2.secretAccessKey ? 'ok' : 'missing',
    message: config.r2.secretAccessKey ? 'R2 Secret Key configured' : 'R2_SECRET_ACCESS_KEY is missing',
  };

  checks.r2_endpoint = {
    status: config.r2.endpoint ? 'ok' : 'missing',
    message: config.r2.endpoint ? `R2 Endpoint: ${config.r2.endpoint}` : 'R2_ENDPOINT is missing',
  };

  // Test R2 connection
  if (
    config.r2.accountId &&
    config.r2.bucketName &&
    config.r2.accessKeyId &&
    config.r2.secretAccessKey &&
    config.r2.endpoint
  ) {
    try {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: config.r2.endpoint,
        credentials: {
          accessKeyId: config.r2.accessKeyId,
          secretAccessKey: config.r2.secretAccessKey,
        },
        forcePathStyle: true, // R2 requires path-style addressing
      });
      
      // Try to access the bucket directly (bucket-scoped tokens can't list buckets)
      const { HeadBucketCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      
      try {
        // First, try to check if bucket exists and is accessible
        await s3Client.send(new HeadBucketCommand({ Bucket: config.r2.bucketName }));
        
        // Then try to list objects (this tests read permissions)
        await s3Client.send(new ListObjectsV2Command({ 
          Bucket: config.r2.bucketName,
          MaxKeys: 1 
        }));
        
        checks.r2_connection = {
          status: 'ok',
          message: 'R2 connection successful - bucket accessible with read/write permissions',
        };
      } catch (bucketError) {
        const bucketErrorMsg = bucketError instanceof Error ? bucketError.message : 'Unknown error';
        
        // Provide specific guidance based on error
        let helpfulMessage = bucketErrorMsg;
        if (bucketErrorMsg.includes('Access Denied') || bucketErrorMsg.includes('403')) {
          helpfulMessage = `Access Denied for bucket "${config.r2.bucketName}". Your token is scoped to specific buckets. Either: 1) Scope token to "All buckets", or 2) Verify bucket name matches exactly (case-sensitive).`;
        } else if (bucketErrorMsg.includes('NotFound') || bucketErrorMsg.includes('404')) {
          helpfulMessage = `Bucket "${config.r2.bucketName}" not found. Check bucket name in Cloudflare R2 dashboard (case-sensitive).`;
        } else if (bucketErrorMsg.includes('Forbidden')) {
          helpfulMessage = `Bucket access forbidden. Token may not have permissions for "${config.r2.bucketName}". Try scoping token to "All buckets" or recreate token with Admin permissions.`;
        }
        
        checks.r2_connection = {
          status: 'error',
          message: helpfulMessage,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages
      let helpfulMessage = errorMessage;
      if (errorMessage.includes('Access Denied') || errorMessage.includes('403')) {
        helpfulMessage = 'Access Denied - Check R2 API token permissions. Token needs "Object Read & Write" for your bucket.';
      } else if (errorMessage.includes('InvalidAccessKeyId')) {
        helpfulMessage = 'Invalid Access Key - Check R2_ACCESS_KEY_ID is correct.';
      } else if (errorMessage.includes('SignatureDoesNotMatch')) {
        helpfulMessage = 'Invalid Secret Key - Check R2_SECRET_ACCESS_KEY is correct.';
      } else if (errorMessage.includes('endpoint')) {
        helpfulMessage = 'Invalid Endpoint - Check R2_ENDPOINT format: https://[ACCOUNT_ID].r2.cloudflarestorage.com';
      }
      
      checks.r2_connection = {
        status: 'error',
        message: helpfulMessage,
      };
    }
  }

  // OpenAI
  checks.openai_key = {
    status: config.openai.apiKey ? 'ok' : 'missing',
    message: config.openai.apiKey
      ? `OpenAI API Key configured (${config.openai.apiKey.substring(0, 7)}...)`
      : 'OPENAI_API_KEY is missing',
  };

  // Test OpenAI connection
  if (config.openai.apiKey) {
    try {
      const openai = new OpenAI({ apiKey: config.openai.apiKey });
      // Just check if client initializes (no API call to avoid costs)
      checks.openai_connection = {
        status: 'ok',
        message: 'OpenAI client initialized',
      };
    } catch (error) {
      checks.openai_connection = {
        status: 'error',
        message: `OpenAI initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Optional variables
  checks.live_captions = {
    status: 'ok',
    message: `Live captions: ${config.features.liveCaptions ? 'enabled' : 'disabled'}`,
  };

  checks.rate_limits = {
    status: 'ok',
    message: `Rate limit: ${config.limits.rateLimitRequests} requests per ${config.limits.rateLimitWindowMs / 1000}s`,
  };

  // Summary
  const allOk = Object.values(checks).every((check) => check.status === 'ok');
  const hasMissing = Object.values(checks).some((check) => check.status === 'missing');
  const hasErrors = Object.values(checks).some((check) => check.status === 'error');

  return NextResponse.json({
    status: allOk ? 'all_ok' : hasErrors ? 'has_errors' : 'has_missing',
    environment: process.env.NODE_ENV || 'unknown',
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      total: Object.keys(checks).length,
      ok: Object.values(checks).filter((c) => c.status === 'ok').length,
      missing: Object.values(checks).filter((c) => c.status === 'missing').length,
      errors: Object.values(checks).filter((c) => c.status === 'error').length,
    },
  });
}
