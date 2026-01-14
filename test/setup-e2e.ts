// Setup environment variables for e2e tests if .env is not present
// This allows tests to run without requiring a .env file
process.env.APP_PORT = process.env.APP_PORT || '3000';
process.env.API_PREFIX = process.env.API_PREFIX || 'api';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_TYPE = process.env.DATABASE_TYPE || 'better-sqlite3';
process.env.DATABASE_SYNCHRONIZE = process.env.DATABASE_SYNCHRONIZE || 'true';
process.env.DATABASE_PATH = process.env.DATABASE_PATH || 'woki-test.db';
process.env.DROP_SCHEMA_ON_STARTUP =
  process.env.DROP_SCHEMA_ON_STARTUP || 'true';
