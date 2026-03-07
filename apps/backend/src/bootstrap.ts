// apps/backend/src/bootstrap.ts
import dotenv from 'dotenv';
dotenv.config();

// Import the real server AFTER env is loaded
await import('./server.js');
