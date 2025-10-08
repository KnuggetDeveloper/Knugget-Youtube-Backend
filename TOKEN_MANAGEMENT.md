# Premium Token Management System

This document describes the implementation of the premium token management system for Knugget AI.

## Overview

When users upgrade to premium, they receive:

- **9,000,000 input tokens** per billing cycle
- **600,000 output tokens** per billing cycle
- Tokens reset automatically at the end of each billing cycle
- Token consumption is tracked per video processing

## Key Features

### 1. Token Allocation

- Premium users get 9M input tokens and 600K output tokens
- Tokens are initialized when user upgrades to premium
- Free users continue to use the credit system

### 2. Billing Cycle Management

- Tokens reset at the end of each billing cycle (based on `nextBillingDate`)
- Automatic reset when billing date passes
- Manual reset capability for admin operations

### 3. Per-Video Token Consumption

- Tokens are consumed based on actual OpenAI API usage
- Real-time tracking of input and output token consumption
- Estimation system for pre-flight checks

### 4. Token Exhaustion Handling

- Users receive clear error messages when tokens are exhausted
- System prevents API calls when insufficient tokens
- Graceful degradation with informative error messages

## Database Schema Changes

New fields added to the `User` model:

```prisma
model User {
  // ... existing fields ...

  // Token management for premium users
  inputTokensRemaining  Int      @default(0) // Remaining input tokens for current billing cycle
  outputTokensRemaining Int      @default(0) // Remaining output tokens for current billing cycle
  tokenResetDate        DateTime? // Date when tokens will be reset (billing cycle end)

  // ... rest of fields ...
}
```

## API Endpoints

### User Endpoints

- `GET /api/token/status` - Get current token status
- `POST /api/token/check-availability` - Check if enough tokens for operation

### Admin Endpoints

- `POST /api/token/initialize/:userId` - Initialize premium tokens for user
- `POST /api/token/reset/:userId` - Reset tokens for specific user
- `POST /api/token/reset-all` - Reset all premium users' tokens (cron job)

## Configuration

New environment variables:

```env
# Premium Token Limits
PREMIUM_INPUT_TOKENS=9000000   # 9M input tokens
PREMIUM_OUTPUT_TOKENS=600000   # 600K output tokens
```

## Services

### TokenService

Main service handling token operations:

- `initializePremiumTokens()` - Set up tokens for new premium users
- `checkTokenAvailability()` - Verify sufficient tokens before operations
- `consumeTokens()` - Deduct tokens after successful API calls
- `resetTokens()` - Reset tokens for billing cycle
- `getTokenStatus()` - Get current token status
- `estimateTokenUsage()` - Estimate tokens needed for transcript

### Integration Points

#### PaymentService

- Automatically initializes tokens when user upgrades to premium
- Sets token reset date based on billing cycle

#### OpenAIService

- Checks token availability before API calls
- Consumes tokens after successful operations
- Handles token exhaustion errors

#### SummaryService

- Pre-flight token checks for premium users
- Falls back to credit system for free users

#### UserService

- Includes token information in user profiles and stats
- Handles token reset in monthly maintenance

## Error Handling

### Token Exhaustion (402 Insufficient Tokens)

```json
{
  "success": false,
  "error": "Token limit exceeded. Your tokens will reset on your next billing date."
}
```

### Insufficient Tokens (402)

```json
{
  "success": false,
  "error": "Insufficient tokens. Required: 1500 input, 200 output. Available: 100 input, 50 output."
}
```

## Usage Flow

### For Premium Users:

1. User upgrades to premium → Tokens initialized
2. User requests video summary → Token availability checked
3. If sufficient tokens → Process summary and consume tokens
4. If insufficient tokens → Return error with details
5. At billing cycle end → Tokens reset automatically

### For Free Users:

- Continue using existing credit system
- No token checks or consumption

## Monitoring and Logging

All token operations are logged with:

- User ID
- Token amounts (input/output)
- Operation type
- Timestamps
- Success/failure status

## Migration

Run the migration script to add new database fields:

```sql
-- See backend/src/scripts/migrate-token-fields.sql
```

Or use Prisma:

```bash
npx prisma migrate dev --name add_token_management
```

## Testing

### Test Token Status

```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:8000/api/token/status
```

### Test Token Availability

```bash
curl -X POST \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"inputTokens": 1000, "outputTokens": 150}' \
     http://localhost:8000/api/token/check-availability
```

## Cron Jobs

Set up a cron job to reset tokens monthly:

```bash
# Reset tokens at the start of each month
0 0 1 * * curl -X POST http://localhost:8000/api/token/reset-all
```

## Future Enhancements

1. **Token Usage Analytics** - Detailed usage reports for users
2. **Token Alerts** - Notify users when tokens are running low
3. **Token Packages** - Allow users to purchase additional tokens
4. **Usage Optimization** - Better token estimation algorithms
5. **Token Rollover** - Allow unused tokens to carry over (limited amount)

## Security Considerations

- Token operations require authentication
- Admin endpoints should have additional authorization
- Token consumption is tracked to prevent abuse
- Rate limiting on token-related endpoints

## Performance Considerations

- Token checks are lightweight database operations
- Token consumption is async and non-blocking
- Bulk token reset operations are optimized
- Caching of token status for frequently accessed users
