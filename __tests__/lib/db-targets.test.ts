import { describe, expect, it } from 'vitest';
import {
  assertRuntimeDbAllowed,
  classifyDbTarget,
  currentEnvironment,
  describeDbUrl,
  parseDbUrl,
} from '@/lib/db-targets';

const PROD = 'postgresql://neondb_owner:secret@ep-dawn-sun-ahkhrdkl-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const PROD_DIRECT = 'postgresql://neondb_owner:secret@ep-dawn-sun-ahkhrdkl.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const PREVIEW = 'postgresql://preview_app:secret@ep-winter-water-ahz8kwcg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const LOCAL = 'postgresql://sammii@localhost:5432/iprep';

describe('db target classification', () => {
  it('recognises the production endpoint on both pooled and direct hosts', () => {
    expect(classifyDbTarget(PROD, {})).toBe('production');
    expect(classifyDbTarget(PROD_DIRECT, {})).toBe('production');
  });

  it('classifies preview and local databases', () => {
    expect(classifyDbTarget(PREVIEW, {})).toBe('other');
    expect(classifyDbTarget(LOCAL, {})).toBe('local');
    expect(classifyDbTarget('postgresql://x@127.0.0.1/db', {})).toBe('local');
  });

  it('treats unparseable or missing urls as other, never production', () => {
    expect(classifyDbTarget(undefined, {})).toBe('other');
    expect(classifyDbTarget('not a url', {})).toBe('other');
  });

  it('allows extra production endpoints through configuration (host moves)', () => {
    expect(classifyDbTarget(PREVIEW, { IPREP_PRODUCTION_DB_ENDPOINTS: 'ep-winter-water-ahz8kwcg' })).toBe('production');
  });

  it('never prints the password', () => {
    expect(describeDbUrl(PROD)).not.toContain('secret');
    expect(describeDbUrl(PROD)).toContain('neondb_owner@ep-dawn-sun-ahkhrdkl-pooler');
  });

  it('parses user, database and pooled flag', () => {
    expect(parseDbUrl(PROD)).toMatchObject({ user: 'neondb_owner', database: 'neondb', pooled: true, endpointId: 'ep-dawn-sun-ahkhrdkl' });
    expect(parseDbUrl(PROD_DIRECT)?.pooled).toBe(false);
  });
});

describe('runtime isolation: preview and development can never use the production database', () => {
  it('refuses a preview environment configured with the production database', () => {
    expect(() => assertRuntimeDbAllowed(PROD, { VERCEL_ENV: 'preview' })).toThrow(/production database/);
    expect(() => assertRuntimeDbAllowed(PROD_DIRECT, { VERCEL_ENV: 'preview' })).toThrow();
  });

  it('refuses a development environment configured with the production database', () => {
    expect(() => assertRuntimeDbAllowed(PROD, { VERCEL_ENV: 'development' })).toThrow();
    expect(() => assertRuntimeDbAllowed(PROD, { NODE_ENV: 'development' })).toThrow();
    expect(() => assertRuntimeDbAllowed(PROD, { IPREP_ENV: 'development' })).toThrow();
  });

  it('allows production to use the production database', () => {
    expect(() => assertRuntimeDbAllowed(PROD, { VERCEL_ENV: 'production' })).not.toThrow();
    expect(() => assertRuntimeDbAllowed(PROD, { NODE_ENV: 'production' })).not.toThrow();
  });

  it('allows preview and development their own databases', () => {
    expect(() => assertRuntimeDbAllowed(PREVIEW, { VERCEL_ENV: 'preview' })).not.toThrow();
    expect(() => assertRuntimeDbAllowed(LOCAL, { NODE_ENV: 'development' })).not.toThrow();
  });

  it('does nothing when no database is configured', () => {
    expect(() => assertRuntimeDbAllowed(undefined, { VERCEL_ENV: 'preview' })).not.toThrow();
  });

  it('derives the environment from Vercel, then IPREP_ENV, then NODE_ENV', () => {
    expect(currentEnvironment({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe('preview');
    expect(currentEnvironment({ IPREP_ENV: 'preview' })).toBe('preview');
    expect(currentEnvironment({ NODE_ENV: 'production' })).toBe('production');
    expect(currentEnvironment({})).toBe('development');
  });
});
