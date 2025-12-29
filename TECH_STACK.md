# Weighbridge Management System - Tech Stack

## Complete Technology Stack

### **Backend (Node.js Server)**

1. **Runtime & Framework**
   - **Node.js** (v18+) - JavaScript runtime environment
   - **Express.js** (v4.18.2) - Web application framework
   - **TypeScript** (v5.5.3) - Type-safe JavaScript

2. **Database**
   - **PostgreSQL** (v14+) - Primary relational database
   - **pg** (v8.11.3) - PostgreSQL client for Node.js

3. **Authentication & Security**
   - **JSON Web Tokens (JWT)** via `jsonwebtoken` (v9.0.2) - Token-based authentication
   - **bcrypt** (v5.1.1) - Password hashing
   - **CORS** (v2.8.5) - Cross-Origin Resource Sharing middleware

4. **Build Tools**
   - **tsx** (v4.7.0) - TypeScript executor for development
   - **tsc** (TypeScript Compiler) - Production build

### **Frontend - Web Admin App**

1. **Core Framework**
   - **React** (v18.3.1) - UI library
   - **React DOM** (v18.3.1) - React renderer for web

2. **Build Tools**
   - **Vite** (v5.4.2) - Fast build tool and dev server
   - **@vitejs/plugin-react** (v4.3.1) - React plugin for Vite

3. **Styling**
   - **Tailwind CSS** (v3.4.1) - Utility-first CSS framework
   - **PostCSS** (v8.4.35) - CSS processor
   - **Autoprefixer** (v10.4.18) - CSS vendor prefixing

4. **Icons & UI**
   - **Lucide React** (v0.344.0) - Icon library

5. **Development**
   - **TypeScript** (v5.5.3) - Static typing
   - **ESLint** (v9.9.1) - Code linting
   - **eslint-plugin-react-hooks** - React Hooks linting
   - **eslint-plugin-react-refresh** - React Fast Refresh linting

### **Frontend - Desktop Operator App**

1. **Desktop Framework**
   - **Electron** (v28.1.0) - Cross-platform desktop application framework
   - **electron-builder** (v24.9.1) - Application packaging and distribution

2. **React Stack** (Same as Web App)
   - React v18.3.1
   - Vite v5.4.2
   - Tailwind CSS v3.4.1
   - TypeScript v5.5.3

3. **Hardware Integration**
   - **SerialPort** (v12.0.0) - Serial port communication for weighing scale
   - **@serialport/parser-readline** (v13.0.0) - Parse serial port data

4. **Electron Vite Plugins**
   - **vite-plugin-electron** (v0.28.1) - Electron integration
   - **vite-plugin-electron-renderer** (v0.14.5) - Renderer process support

### **Shared Package**

1. **Purpose**: Shared types, utilities, and components between web and desktop apps

2. **Contents**:
   - **TypeScript types** - Shared interfaces and types
   - **Utility functions** - Common business logic
   - **API client** - HTTP client for backend communication
   - **React hooks** - Shared custom hooks

### **Development Tools**

1. **Version Control**
   - **Git** - Source control

2. **Package Management**
   - **npm** (workspaces) - Monorepo management

3. **Code Quality**
   - **TypeScript** - Type checking
   - **ESLint** - Code linting
   - **typescript-eslint** (v8.3.0) - TypeScript ESLint integration

### **Environment Configuration**

1. **Environment Variables**
   - **dotenv** (v16.3.1) - Environment variable management

2. **Configuration Files**:
   - `.env` - Environment variables
   - `tsconfig.json` - TypeScript configuration
   - `tailwind.config.js` - Tailwind CSS configuration
   - `vite.config.ts` - Vite build configuration
   - `electron-builder.json` - Electron packaging configuration

## Architecture Overview

### **Monorepo Structure**

```
weighbridge-monorepo/
├── apps/
│   ├── backend/          # Express + PostgreSQL API server
│   ├── web/              # React web admin application
│   └── desktop/          # Electron desktop operator application
├── packages/
│   └── shared/           # Shared types, utilities, and components
└── migrations/           # PostgreSQL database migrations
```

### **Database Architecture**

- **PostgreSQL** with 13 core tables:
  - users, user_profiles, branches
  - clients, vehicles, transactions
  - invoices, invoice_line_items, payments
  - pricing_rules, report_templates
  - api_keys, api_audit_logs

- **Features**:
  - UUID primary keys
  - Foreign key relationships
  - Indexes for performance
  - Timestamp tracking

### **API Architecture**

- **RESTful API** with Express.js
- **JWT Authentication** for users
- **API Key Authentication** for external systems
- **CORS enabled** for cross-origin requests

**Core Endpoints**:
- `/auth` - Authentication (login, signup, logout)
- `/api/transactions` - Transaction management
- `/api/clients` - Client management
- `/api/invoices` - Invoice management
- `/api/attendance` - Attendance tracking
- `/api/webhooks` - Webhook handling

### **Authentication Flow**

1. **User Login** → JWT token issued
2. **Token stored** in localStorage
3. **API requests** include JWT in Authorization header
4. **Backend validates** JWT and returns data

### **Desktop Hardware Integration**

- **Serial Port Communication** for weighing scales
- **Real-time weight reading** via SerialPort library
- **Electron IPC** for main/renderer process communication

## Key Features

1. **User Management** - Multi-role authentication (admin, manager, operator)
2. **Weighing Operations** - Real-time weight capture from hardware scales
3. **Client Management** - Customer database and profiles
4. **Vehicle Management** - Fleet tracking and tare weights
5. **Transaction Recording** - Inbound/outbound weighing transactions
6. **Invoicing** - Automated invoice generation and PDF export
7. **Pricing Rules** - Dynamic pricing based on weight, client, material
8. **Reports** - Analytics and reporting engine
9. **API Integration** - RESTful API for third-party systems
10. **Audit Logging** - Complete API audit trail

## Deployment

### **Backend**
- Deployable to any Node.js hosting (Heroku, AWS, DigitalOcean, etc.)
- Requires PostgreSQL database
- Environment variables for configuration

### **Web App**
- Static site deployment (Netlify, Vercel, AWS S3, etc.)
- Single-page application (SPA)
- Environment variables for API URL

### **Desktop App**
- Windows, macOS, and Linux support via Electron
- Installable application packages
- Auto-updater support via electron-builder

## Performance Optimizations

1. **Vite** - Fast development server and optimized production builds
2. **Database Indexes** - Optimized queries for large datasets
3. **JWT Tokens** - Stateless authentication (no session storage)
4. **Code Splitting** - Lazy loading for faster initial load
5. **Connection Pooling** - Efficient database connection management

## Security Features

1. **Password Hashing** - bcrypt with salt rounds
2. **JWT Tokens** - Secure authentication
3. **API Key Authentication** - For external integrations
4. **CORS** - Controlled cross-origin access
5. **Environment Variables** - Sensitive data protection
6. **SQL Parameterization** - SQL injection prevention

## Development Workflow

1. **Local Development**:
   ```bash
   npm install                # Install dependencies
   npm run dev:backend        # Start Express server
   npm run dev:web            # Start web app dev server
   npm run dev:desktop        # Start desktop app in dev mode
   ```

2. **Production Build**:
   ```bash
   npm run build              # Build all apps
   ```

3. **Database Setup**:
   ```bash
   createdb weighbridge       # Create PostgreSQL database
   psql -d weighbridge -f migrations/001_initial_schema.sql   # Run migrations
   ```

## Summary

This is a **full-stack, production-ready weighbridge management system** built with:
- **Modern JavaScript stack** (Node.js, React, TypeScript)
- **PostgreSQL database** for reliability and scalability
- **Electron desktop app** for hardware integration
- **REST API** for extensibility
- **Monorepo architecture** for code sharing and maintainability
- **Type-safe** development with TypeScript throughout
- **Fast builds** with Vite
- **Beautiful UI** with Tailwind CSS
- **Cross-platform** support (Web + Desktop for Windows/Mac/Linux)
