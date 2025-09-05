# Knugget AI Backend

A production-ready backend API for Knugget AI - an AI-powered YouTube video summarization platform that serves both Chrome extension and web application clients.

## 🚀 Features

- **AI-Powered Summarization**: Generate intelligent summaries from YouTube transcripts using OpenAI GPT-4
- **Authentication & Authorization**: JWT-based auth with refresh tokens, Supabase integration
- **Credit System**: Flexible credit-based usage with plan management (Free/Premium)
- **Rate Limiting**: Intelligent rate limiting based on user plans
- **Database Management**: Prisma ORM with PostgreSQL, automated cleanup tasks
- **Security**: Comprehensive security middleware, input validation, error handling
- **Monitoring**: Structured logging, health checks, performance monitoring

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+, TypeScript
- **Framework**: Express.js
- **Database**: Supabase PostgreSQL with Prisma ORM
- **Authentication**: Supabase Auth + JWT
- **AI**: OpenAI GPT-4 Turbo
- **Validation**: Zod schemas
- **Security**: Helmet, CORS, bcrypt, rate limiting
- **Logging**: Winston
- **Testing**: Jest (ready for implementation)

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/          # Route handlers
│   │   ├── auth.ts          # Authentication endpoints
│   │   ├── summary.ts       # Summary generation & management
│   │   └── user.ts          # User profile & statistics
│   ├── services/            # Business logic
│   │   ├── auth.ts          # Authentication service
│   │   ├── openai.ts        # AI summary generation
│   │   ├── summary.ts       # Summary management
│   │   └── user.ts          # User management
│   ├── middleware/          # Express middleware
│   │   ├── auth.ts          # JWT validation & authorization
│   │   ├── errorHandler.ts  # Global error handling
│   │   ├── rateLimit.ts     # Rate limiting by user plan
│   │   └── validation.ts    # Zod schema validation
│   ├── routes/             # API route definitions
│   │   ├── auth.ts         # /api/auth routes
│   │   ├── summary.ts      # /api/summary routes
│   │   ├── user.ts         # /api/user routes
│   │   └── index.ts        # Route aggregation
│   ├── config/             # Configuration
│   │   ├── index.ts        # Environment configuration
│   │   ├── database.ts     # Prisma client setup
│   │   └── logger.ts       # Winston logger setup
│   ├── types/              # TypeScript definitions
│   │   └── index.ts        # API types & interfaces
│   └── app.ts              # Express app bootstrap
├── prisma/
│   └── schema.prisma       # Database schema
├── .env.example           # Environment template
├── package.json
└── tsconfig.json
```

## 🗄️ Database Schema

### Core Models
- **User**: Authentication, plan management, credits
- **Summary**: AI-generated summaries with metadata
- **RefreshToken**: Secure token management
- **VideoMetadata**: YouTube video information
- **ApiUsage**: Usage tracking and analytics

## 📡 API Endpoints

### Authentication (`/api/auth`)
```
POST   /register          # User registration
POST   /login             # User login
POST   /refresh           # Token refresh
POST   /logout            # User logout
GET    /me                # Current user info
POST   /forgot-password   # Password reset request
POST   /reset-password    # Password reset
POST   /verify-email      # Email verification
```

### Summaries (`/api/summary`)
```
POST   /generate          # Generate AI summary
POST   /save              # Save summary
GET    /                  # Get user summaries (paginated)
GET    /:id               # Get single summary
PUT    /:id               # Update summary
DELETE /:id               # Delete summary
GET    /video/:videoId    # Get summary by video ID
GET    /stats             # Summary statistics
```

### User Management (`/api/user`)
```
GET    /profile           # Get user profile
PUT    /profile           # Update profile
GET    /stats             # User statistics
POST   /credits/add       # Add credits
POST   /plan/upgrade      # Upgrade plan
POST   /verify-email      # Verify email
DELETE /account           # Delete account
```

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL (Supabase recommended)
- OpenAI API key

### Installation

1. **Clone and install dependencies**
```bash
git clone <repository>
cd knugget-backend
npm install
```

2. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Set up database**
```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Or run migrations in production
npm run db:migrate
```

4. **Start development server**
```bash
npm run dev
```

### Environment Configuration

Key environment variables (see `.env.example`):

```env
# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-key"

# JWT
JWT_SECRET="your-jwt-secret-min-32-chars"
REFRESH_TOKEN_SECRET="your-refresh-secret"

# OpenAI
OPENAI_API_KEY="sk-your-openai-key"
OPENAI_MODEL="gpt-4-turbo-preview"

# CORS
ALLOWED_ORIGINS="http://localhost:3000,https://knugget.com,chrome-extension://"
```

## 🤖 AI Summary Generation

The OpenAI service handles intelligent transcript processing:

- **Chunking**: Large transcripts are intelligently chunked for processing
- **Prompt Engineering**: Optimized prompts for extracting key insights
- **Structured Output**: Returns JSON with key points, full summary, and tags
- **Error Handling**: Robust error handling with credit refunds on failures

### Example AI Response Format
```json
{
  "keyPoints": [
    "First key insight from the video",
    "Second important takeaway",
    "Third actionable point"
  ],
  "fullSummary": "Comprehensive 2-3 paragraph summary...",
  "tags": ["topic1", "topic2", "topic3"]
}
```

## 🔐 Authentication Flow

1. **Registration/Login**: User credentials → JWT + Refresh token
2. **API Requests**: Bearer token in Authorization header
3. **Token Refresh**: Automatic refresh using refresh token
4. **Supabase Integration**: Fallback to Supabase auth tokens

## ⚡ Rate Limiting

Intelligent rate limiting based on user plans:

- **Free Users**: 10 requests/15min, 3 summaries/minute
- **Premium Users**: 100 requests/15min, higher limits
- **Special Endpoints**: Custom limits for auth, password reset

## 📊 Credit System

- **Free Plan**: 10 credits/month
- **Premium Plan**: 1000 credits/month
- **Per Summary**: 1 credit
- **Auto Refund**: Credits refunded on AI generation failures

## 🛡️ Security Features

- **Input Validation**: Zod schemas for all endpoints
- **Rate Limiting**: Plan-based limiting with IP fallback
- **CORS**: Configurable origins including chrome-extension://
- **Helmet**: Security headers
- **Error Handling**: Secure error responses
- **JWT**: Secure token management with refresh rotation

## 📈 Production Deployment

### Build and Start
```bash
npm run build
npm start
```

### Environment Considerations
- Set `NODE_ENV=production`
- Configure proper database URLs
- Set up monitoring and logging
- Configure CORS for production domains
- Set up automated backups

### Health Checks
```bash
GET /api/health
# Returns service status and connectivity
```

## 🧪 Testing (Setup Ready)

```bash
npm test
npm run test:watch
```

## 📝 Scripts

```bash
npm run dev          # Development server with watch
npm run build        # TypeScript compilation
npm run start        # Production server
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run database migrations
npm run db:studio    # Open Prisma Studio
npm run lint         # ESLint
npm run test         # Jest tests
```

## 🔧 Configuration

The API supports extensive configuration through environment variables:

- **Server**: Port, base URL, environment
- **Database**: Connection strings, pooling
- **Authentication**: JWT secrets, expiration times
- **OpenAI**: API key, model selection, token limits
- **Rate Limiting**: Window sizes, request limits per plan
- **CORS**: Allowed origins, credentials
- **Logging**: Log levels, file outputs

## 🚀 Chrome Extension Integration

The API is specifically designed to work with the Knugget Chrome extension:

- **CORS**: Supports `chrome-extension://` origins
- **Authentication**: Compatible with extension auth flows
- **Rate Limiting**: Recognizes extension requests
- **Error Handling**: Extension-friendly error responses

## 📚 API Documentation

For detailed API documentation, visit: `GET /api/` for endpoint overview

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

---

Built with ❤️ for the Knugget AI ecosystem