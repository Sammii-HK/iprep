#!/usr/bin/env node

/**
 * Migration script to add frequentlyForgottenPoints column to LearningSummary table
 * Usage: node scripts/migrate-frequentlyforgottenpoints.js
 * 
 * Make sure DATABASE_URL is set in your environment or .env.local file
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🔄 Starting migration: Add frequentlyForgottenPoints column...');
    
    // Read the migration SQL file
    const migrationPath = join(__dirname, '../prisma/migrate-add-frequentlyforgottenpoints.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Split by semicolons and filter out empty statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`📝 Executing: ${statement.substring(0, 60)}...`);
        await prisma.$executeRawUnsafe(statement);
      }
    }
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the column exists (optional - may fail if database connection is not available)
    try {
      const result = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'LearningSummary' 
        AND column_name = 'frequentlyForgottenPoints'
      `);
      
      if (Array.isArray(result) && result.length > 0) {
        console.log('✅ Verified: frequentlyForgottenPoints column exists');
        console.log(`   Column type: ${result[0].data_type}`);
      } else {
        console.warn('⚠️  Warning: Could not verify column creation');
      }
    } catch (verifyError) {
      console.log('ℹ️  Note: Could not verify column (this is okay if migration succeeded)');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();

