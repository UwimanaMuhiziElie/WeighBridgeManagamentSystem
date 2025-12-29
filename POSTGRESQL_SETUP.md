# PostgreSQL Setup Guide

This guide will help you set up PostgreSQL and run the Weighbridge Management System.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL 14+ installed

## Step 1: Install PostgreSQL

### Windows
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. Run the installer and follow the setup wizard
3. Remember the password you set for the `postgres` user
4. Default port is 5432

### macOS
```bash
brew install postgresql@14
brew services start postgresql@14
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## Step 2: Create Database

1. Open terminal/command prompt
2. Connect to PostgreSQL:

**Windows:**
```bash
psql -U postgres
```

**macOS/Linux:**
```bash
sudo -u postgres psql
```

3. Create the database:
```sql
CREATE DATABASE weighbridge;
```

4. Create a user (optional, or use postgres user):
```sql
CREATE USER weighbridge_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE weighbridge TO weighbridge_user;
```

5. Exit psql:
```sql
\q
```

## Step 3: Run Database Migrations

1. Navigate to the project root directory
2. Connect to your database and run the migration file:

```bash
psql -U postgres -d weighbridge -f migrations/001_initial_schema.sql
```

If you created a custom user:
```bash
psql -U weighbridge_user -d weighbridge -f migrations/001_initial_schema.sql
```

## Step 4: Configure Environment Variables

1. Update `apps/backend/.env` with your database credentials:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/weighbridge
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NODE_ENV=development
```

Replace:
- `postgres` with your PostgreSQL username
- `your_password` with your PostgreSQL password
- `weighbridge` with your database name (if different)

2. The frontend apps are already configured in their `.env` files:

```env
VITE_API_URL=http://localhost:3001
```

## Step 5: Install Dependencies

In the project root directory:

```bash
npm install
```

## Step 6: Create an Admin User

Connect to your database:
```bash
psql -U postgres -d weighbridge
```

Create an admin user (replace with your details):
```sql
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES (
  'admin@example.com',
  '$2b$10$YourHashedPasswordHere',
  'Admin User',
  'admin',
  true
);
```

**Note:** You'll need to generate a bcrypt hash for your password. You can use an online bcrypt generator or run this Node.js command:

```bash
node -e "console.log(require('bcrypt').hashSync('your_password', 10))"
```

Then copy the hash and use it in the SQL INSERT statement above.

## Step 7: Run the Application

### Start the Backend Server

In the project root:
```bash
npm run dev:backend
```

The backend will start on http://localhost:3001

### Start the Web App

In a new terminal:
```bash
npm run dev:web
```

The web app will start on http://localhost:5173

### Start the Desktop App

In a new terminal:
```bash
npm run dev:desktop
```

## Step 8: Login

Use the admin credentials you created in Step 6 to log in.

## Troubleshooting

### Cannot connect to PostgreSQL

1. Check if PostgreSQL is running:
   ```bash
   # Windows (in Services)
   services.msc

   # macOS
   brew services list

   # Linux
   sudo systemctl status postgresql
   ```

2. Verify your connection string in `apps/backend/.env`
3. Check PostgreSQL logs for errors

### Database connection refused

- Make sure PostgreSQL is running on port 5432
- Check your firewall settings
- Verify the DATABASE_URL in your .env file

### Migration errors

- Make sure you're connected to the correct database
- Check that the uuid-ossp extension is installed:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  ```

### Backend won't start

- Make sure all dependencies are installed: `npm install`
- Check that port 3001 is not already in use
- Verify your DATABASE_URL is correct

### Frontend can't connect to backend

- Make sure the backend is running on port 3001
- Check VITE_API_URL in your .env files
- Check browser console for CORS errors

## Production Deployment

For production:

1. Use a secure JWT_SECRET (long random string)
2. Set NODE_ENV=production
3. Use SSL for PostgreSQL connections
4. Use environment-specific database credentials
5. Enable PostgreSQL backups
6. Set up proper access controls

## Database Backup

To backup your database:
```bash
pg_dump -U postgres weighbridge > backup.sql
```

To restore:
```bash
psql -U postgres weighbridge < backup.sql
```
