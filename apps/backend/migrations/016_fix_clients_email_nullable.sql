-- 016_clients_email_nullable.sql
CREATE EXTENSION IF NOT EXISTS citext;

-- Make clients.email case-insensitive (optional but recommended)
ALTER TABLE clients
  ALTER COLUMN email TYPE citext;

-- Allow NULL email (your API uses NULLIF(email,''))
ALTER TABLE clients
  ALTER COLUMN email DROP NOT NULL;

-- Normalize empty email to NULL
UPDATE clients
SET email = NULL
WHERE email IS NOT NULL AND trim(email::text) = '';
