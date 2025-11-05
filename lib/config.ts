/**
 * Environment variable validation and configuration
 * Validates all required environment variables at runtime, not build time
 */

const optionalEnvVars = {
  ENABLE_LIVE_CAPTIONS: 'true',
  NODE_ENV: 'development',
  MAX_AUDIO_SIZE_MB: '50',
  RATE_LIMIT_REQUESTS: '10',
  RATE_LIMIT_WINDOW_MS: '60000',
} as const;

interface Config {
  database: {
    url: string;
  };
  r2: {
    accountId: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
  };
  openai: {
    apiKey: string;
  };
  features: {
    liveCaptions: boolean;
  };
  limits: {
    maxAudioSizeMB: number;
    rateLimitRequests: number;
    rateLimitWindowMs: number;
  };
  nodeEnv: string;
}

function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnvVar(name: keyof typeof optionalEnvVars): string {
  return process.env[name] || optionalEnvVars[name];
}

// Cache config (lazy initialization)
let config: Config | null = null;

export function getConfig(): Config {
  if (config) return config;
  
  // During build, return minimal config to avoid validation errors
  // NEXT_PHASE is set during Next.js build
  const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build' || 
                      process.env.NODE_ENV === 'production' && !process.env.VERCEL;
  
  if (isBuildTime || !process.env.DATABASE_URL) {
    config = {
      database: { url: process.env.DATABASE_URL || '' },
      r2: {
        accountId: process.env.R2_ACCOUNT_ID || '',
        bucketName: process.env.R2_BUCKET_NAME || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        endpoint: process.env.R2_ENDPOINT || '',
      },
      openai: { apiKey: process.env.OPENAI_API_KEY || '' },
      features: { liveCaptions: getOptionalEnvVar('ENABLE_LIVE_CAPTIONS') === 'true' },
      limits: {
        maxAudioSizeMB: parseInt(getOptionalEnvVar('MAX_AUDIO_SIZE_MB'), 10) || 50,
        rateLimitRequests: parseInt(getOptionalEnvVar('RATE_LIMIT_REQUESTS'), 10) || 10,
        rateLimitWindowMs: parseInt(getOptionalEnvVar('RATE_LIMIT_WINDOW_MS'), 10) || 60000,
      },
      nodeEnv: getOptionalEnvVar('NODE_ENV'),
    };
    return config;
  }
  
  try {
    config = {
      database: {
        url: validateEnvVar('DATABASE_URL'),
      },
      r2: {
        accountId: validateEnvVar('R2_ACCOUNT_ID'),
        bucketName: validateEnvVar('R2_BUCKET_NAME'),
        accessKeyId: validateEnvVar('R2_ACCESS_KEY_ID'),
        secretAccessKey: validateEnvVar('R2_SECRET_ACCESS_KEY'),
        endpoint: validateEnvVar('R2_ENDPOINT'),
      },
      openai: {
        apiKey: validateEnvVar('OPENAI_API_KEY'),
      },
      features: {
        liveCaptions: getOptionalEnvVar('ENABLE_LIVE_CAPTIONS') === 'true',
      },
      limits: {
        maxAudioSizeMB: parseInt(getOptionalEnvVar('MAX_AUDIO_SIZE_MB'), 10) || 50,
        rateLimitRequests: parseInt(getOptionalEnvVar('RATE_LIMIT_REQUESTS'), 10) || 10,
        rateLimitWindowMs: parseInt(getOptionalEnvVar('RATE_LIMIT_WINDOW_MS'), 10) || 60000,
      },
      nodeEnv: getOptionalEnvVar('NODE_ENV'),
    };
    return config;
  } catch (error) {
    // In development, log but don't crash
    if (process.env.NODE_ENV === 'development') {
      console.warn('Configuration validation failed:', error);
      console.warn('Some features may not work until environment variables are set');
      // Return a minimal config for development
      config = {
        database: { url: '' },
        r2: { accountId: '', bucketName: '', accessKeyId: '', secretAccessKey: '', endpoint: '' },
        openai: { apiKey: '' },
        features: { liveCaptions: false },
        limits: { maxAudioSizeMB: 50, rateLimitRequests: 10, rateLimitWindowMs: 60000 },
        nodeEnv: 'development',
      };
      return config;
    } else {
      throw error;
    }
  }
}