# Weighbridge Management System

A comprehensive weighbridge management solution with web and desktop applications for tracking transactions, managing clients, generating reports, and monitoring operations.

## Architecture

This is a monorepo containing:
- **Web App**: Admin dashboard for management and analytics
- **Desktop App**: Electron-based application for weighbridge operations
- **Shared Package**: Common utilities, types, and hooks
- **Supabase Backend**: Database, authentication, and Edge Functions

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Desktop**: Electron
- **Backend**: PostgreSQL + express
- **Hardware Integration**: Serial port communication for weighbridge scales

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose (for self-hosted Supabase)
- Git

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd weighbridge-monorepo
npm install
```

### 2. Set Up Supabase (Self-Hosted)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed Supabase setup instructions.

Quick setup:
```bash
# Start Supabase locally
npx supabase init
npx supabase start

# Apply migrations
npx supabase db reset
```

### 3. Configure Environment

Create `.env` file:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Run Development

```bash
# Web app
npm run dev:web

# Desktop app
npm run dev:desktop
```

## Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete self-hosting instructions including:
- Self-hosted Supabase setup with Docker
- Web app deployment options
- Desktop app distribution
- Edge Functions deployment
- Security considerations

## Project Structure

```
weighbridge-monorepo/
├── apps/
│   ├── web/          # Admin web dashboard
│   └── desktop/      # Weighbridge desktop app
├── packages/
│   └── shared/       # Shared code and utilities
├── supabase/
│   ├── functions/    # Edge Functions (API endpoints)
│   └── migrations/   # Database schema migrations
└── docs/             # Additional documentation
```

## Features

### Web Dashboard
- Real-time analytics and reporting
- Client and branch management
- User administration
- Pricing configuration
- API key management

### Desktop Application
- Weighbridge scale integration
- Transaction recording
- Invoice generation
- Offline capability
- Receipt printing

## Hardware Integration

The desktop app supports serial port communication with weighbridge scales. Supported protocols:
- Standard ASCII weight output
- Configurable baud rates
- Auto-detection of connected scales

## Security

- Row Level Security (RLS) enforced on all tables
- JWT-based authentication
- API key authentication for external integrations
- Audit logging for sensitive operations

## Development

```bash
# Run type checking
npm run typecheck

# Run linting
npm run lint

# Build all apps
npm run build
```

## Support

For issues and questions, refer to the documentation or contact the development team.

## License

Proprietary - All rights reserved
