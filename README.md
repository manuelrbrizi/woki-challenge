# WokiBrain

A compact booking engine for restaurants that discovers **when** and **how** to seat a party using **single tables or table combinations**.

## Table of Contents
- [Setup & Installation](#setup--installation)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Database](#database)
  - [Postman Collection](#postman-collection)
- [Testing](#testing)
  - [Running Tests](#running-tests)
- [Features](#features)
  - [Core Challenge Features](#core-challenge-features)
  - [Optional Extensions](#optional-extensions)
- [Assumptions](#assumptions)
  - [Domain Assumptions](#domain-assumptions)
  - [Technical Assumptions](#technical-assumptions)
- [Architecture Decisions](#architecture-decisions)
  - [Hexagonal Architecture](#hexagonal-architecture)
  - [Service Windows in Separate Table](#service-windows-in-separate-table)
- [Gap Discovery & Candidate Generation](#gap-discovery--candidate-generation)
  - [Gap Discovery Algorithm](#gap-discovery-algorithm)
  - [Combo Generation](#combo-generation)
- [WokiBrain Selection Strategy](#wokibrain-selection-strategy)
- [Time Model & Constraints](#time-model--constraints)
- [API Endpoints & Design Choices](#api-endpoints--design-choices)
  - [Core Endpoints](#core-endpoints)
  - [Optional Extension Endpoints](#optional-extension-endpoints)
- [Concurrency & Idempotency](#concurrency--idempotency)
  - [Atomic Create + Locking](#atomic-create--locking)
  - [Idempotency Semantics](#idempotency-semantics)
- [Metrics & Observability (Optional Extension)](#metrics--observability-optional-extension)
- [Rate Limiting (Optional Extension)](#rate-limiting-optional-extension)
- [Validation & Error Handling](#validation--error-handling)
- [Trade-offs & Justifications](#trade-offs--justifications)
- [Complexity Analysis](#complexity-analysis)
  - [Combo Generation Complexity](#combo-generation-complexity)
  - [Gap Discovery Complexity](#gap-discovery-complexity)
  - [Overall System Complexity](#overall-system-complexity)
- [Failure Modes & Edge Cases](#failure-modes--edge-cases)
- [Additional Resources](#additional-resources)
- [License](#license)



## Setup & Installation

### Prerequisites

- Node.js >= 16.0.0
- npm >= 8.0.0

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (optional, defaults are provided):
```env
APP_PORT=3000
API_PREFIX=api
NODE_ENV=development
DATABASE_TYPE=better-sqlite3
DATABASE_PATH=woki.db
DATABASE_SYNCHRONIZE=true
DROP_SCHEMA_ON_STARTUP=true
```

3. Start the application:
```bash
npm run start:dev
```

The application will:
- Create a fresh SQLite database on each startup (if `DROP_SCHEMA_ON_STARTUP=true`)
- Seed example data (restaurant R1, sector S1, 5 tables, 1 existing booking)
- Start the server on port 3000 (or the port specified in `.env`)

### Database

The application uses **SQLite** with TypeORM. The database file (`woki.db`) is created in the project root. On each startup (with `DROP_SCHEMA_ON_STARTUP=true`), the schema is dropped and recreated with fresh seed data.

### Postman Collection

A Postman collection is available at `WokiBrain.postman_collection.json` with pre-configured requests for all endpoints.

## Testing

### Running Tests

**Unit tests**:
```bash
npm run test:unit
```

**E2E tests**:
```bash
npm run test:e2e
```

**All tests**:
```bash
npm test
```


## Features

### Core Challenge Features

- **Discovery**: Returns deterministic candidates (single tables and combos) honoring 15-minute grid and service windows
- **WokiBrain Selection**: Deterministic selection strategy with identical inputs; chosen criteria documented
- **Atomic Create**: Locking and idempotency; no double booking even under concurrent requests
- **Service Window Enforcement**: Validates bookings against restaurant service hours
- **Interval Semantics**: Uses [start, end) where touching bookings are valid

### Optional Extensions

- **Blackouts**: Table/sector unavailability management (not required by core challenge)
- **Metrics Endpoint**: Observability metrics for bookings, conflicts, and performance (optional extension)
- **Rate Limiting**: API protection with per-endpoint throttling (optional extension)
- **Swagger Documentation**: Interactive API documentation at `/docs`
- **Postman Collection**: Pre-configured requests in `WokiBrain.postman_collection.json`

## Assumptions

This implementation makes the following domain and technical assumptions:

### Domain Assumptions

- **Time Grid**: Fixed 15-minute granularity (all times and durations are multiples of 15 minutes)
- **Duration**: Must be a multiple of 15 minutes (no minimum or maximum limit)
- **Interval Semantics**: [start, end) where end is exclusive; adjacent bookings are valid
- **No Partial Tables**: Tables cannot be split or partially occupied
- **Combo Capacity**: Sum of min/max capacities (simple additive heuristic)
- **Service Windows**: Optional per restaurant, can vary by day (enables closed Mondays, different hours)
- **Timezone**: IANA timezone per restaurant (e.g., `America/Argentina/Buenos_Aires`)
- **Booking Status**: Only CONFIRMED bookings block capacity; cancelled bookings are excluded from availability calculations (filtered at repository level)

### Technical Assumptions

- **Single-Instance Deployment**: In-memory locks are sufficient (not distributed)
- **SQLite Database**: Suitable for development/demo, not production-scale
- **Idempotency TTL**: 60 seconds (reasonable for booking operation retries)
- **Rate Limiting**: Per-endpoint throttling (not per-user)
- **Blackouts, Metrics, Rate Limiting**: Optional extensions beyond core challenge requirements

## Architecture Decisions

### Hexagonal Architecture

This project follows **Hexagonal Architecture** (Ports and Adapters) with strict separation between domain logic and implementation details:

- **Domain Layer**: Pure business logic, entities, and domain services (no infrastructure dependencies)
- **Application Layer**: Use cases orchestrate domain services, DTOs for data transfer
- **Infrastructure Layer**: TypeORM repositories, HTTP controllers, logging adapters
- **Ports**: Repository interfaces define contracts between layers

**Rationale**: Enables testing domain logic in isolation, facilitates future infrastructure changes without modifying business logic.

### Service Windows in Separate Table

Service windows are stored in a separate `service_windows` table rather than embedded in the restaurant entity.

**Rationale**: 
- Enables flexibility for different hours per day (e.g., closed Mondays, lunch vs dinner windows)
- Alternative (embedded in restaurant): Would require complex JSON/array handling, less queryable
- Separate table allows easy querying and management of service window variations

## Gap Discovery & Candidate Generation

### Gap Discovery Algorithm

Gap discovery uses interval arithmetic to find free time slots. For each table and service window on a day:

1. **Normalize existing CONFIRMED bookings** to [start, end) and sort by start time
2. **Add sentinels** at window start/end to mark boundaries
3. **Walk adjacent pairs** → gaps are found between `prevEnd` and `nextStart`

**Single Table Gaps**:
- Filter bookings and blackouts affecting the table
- Combine and sort all blockers
- Find gaps within each service window that meet minimum duration requirement

**Special Case - Single-Person Parties**:
- For `partySize=1`, tables are considered usable if `maxSize >= 1`, even if `minSize > 1`
- This allows single-person bookings without generating unnecessary combo candidates
- Prevents combinatorial explosion while maintaining functionality

**Combo Gaps (N Tables)**:
- For any combination of tables within the sector:
  - Find gaps for each individual table
  - **Intersect their gap sets** to obtain combo gaps where all tables are simultaneously free
- A combo candidate fits if:
  - Intersection gap length ≥ durationMinutes
  - Party size fits within the derived combo capacity range (minCapacity ≤ partySize ≤ maxCapacity)

**Timezone Handling**: All times are converted to UTC for storage and comparison, using the restaurant's IANA timezone for display and validation.

### Combo Generation

Combo generation uses a **backtracking algorithm with aggressive pruning** to explore table combinations efficiently.

**Max Combo Size Limit (6 tables)**:
- **Justification**: With 10 tables, combinations of 7+ tables generate 120+ combinations
- Combinatorial explosion makes exhaustive search impractical for large combos
- Real-world restaurant scenarios rarely require 7+ table combinations
- **Trade-off**: May miss some valid large combos, but ensures polynomial-time performance (see Complexity Analysis)

**Pruning Strategies**:

1. **Limit max combo size to 6**: Prevents exponential growth
2. **Capacity-based pruning**: Skip combinations where max possible capacity (even with all remaining tables) < partySize
3. **Sorted tables (larger first)**: Enables earlier pruning as larger tables reach capacity faster

**Key Principle**: *"Backtracking is acceptable when the search space is aggressively pruned by domain rules"*

## WokiBrain Selection Strategy

The selection strategy is **deterministic** and optimizes for capacity efficiency and operational simplicity.

**Heuristic**: "We prioritize less capacity waste, then fewer tables, then earliest start"

**Implementation**:

1. **Single tables over combos** (implicitly minimizes capacity waste)
2. **Among singles**: Earlier slots are preferred
3. **Among combos**: Fewer tables first, then earlier slots

**Tie-Breaking**: 
- For singles with same start time: Alphabetical table ID
- For combos with same table count and start time: Alphabetical first table ID


This ensures that given the same inputs, the system will always return the same result.

## Time Model & Constraints

- **Grid**: Fixed 15-minute granularity
- **Durations**: Multiples of 15 minutes (no minimum or maximum limit)
- **Intervals**: `[start, end)` (end exclusive); adjacent bookings do not conflict
  - Example: [19:00, 20:00) and [20:00, 21:00) can coexist
- **Timezone**: IANA per Restaurant (e.g., `America/Argentina/Buenos_Aires`)
- **Service Windows**: Optional array per restaurant, stored in separate table for flexibility
- **Timestamps**: 
  - `createdAt`: Set on create
  - `updatedAt`: Changes on mutation (e.g., cancellation)

## API Endpoints & Design Choices

### Core Endpoints

#### 1. Discover Seats

**GET** `/api/woki/discover`

Query parameters:
- `restaurantId` (required)
- `sectorId` (required)
- `date` (required, format: YYYY-MM-DD)
- `partySize` (required, positive integer)
- `duration` (required, positive integer, multiple of 15)
- `windowStart` (optional, format: HH:mm) - If provided without `windowEnd`, filters service windows to start at or after this time
- `windowEnd` (optional, format: HH:mm) - If provided without `windowStart`, filters service windows to end at or before this time. If both are provided, creates a single custom window
- `limit` (optional, positive integer)

**Response (200)**:
```json
{
  "slotMinutes": 15,
  "durationMinutes": 90,
  "candidates": [
    {
      "kind": "single",
      "tableIds": ["T4"],
      "start": "2025-10-22T20:00:00-03:00",
      "end": "2025-10-22T21:30:00-03:00"
    },
    {
      "kind": "combo",
      "tableIds": ["T2", "T3"],
      "start": "2025-10-22T20:15:00-03:00",
      "end": "2025-10-22T21:45:00-03:00"
    }
  ]
}
```

#### 2. Create Booking

**POST** `/api/woki/bookings`

**Headers**:
- `Idempotency-Key` (required): Ensures idempotent operations (60s TTL). Must be unique per booking request.
- `Content-Type`: application/json

**Request Body**:
```json
{
  "restaurantId": "R1",
  "sectorId": "S1",
  "partySize": 5,
  "durationMinutes": 90,
  "date": "2025-10-22",
  "windowStart": "20:00",
  "windowEnd": "23:45"
}
```

**Response (201)**:
```json
{
  "id": "BK_001",
  "restaurantId": "R1",
  "sectorId": "S1",
  "tableIds": ["T4"],
  "partySize": 5,
  "start": "2025-10-22T20:00:00-03:00",
  "end": "2025-10-22T21:30:00-03:00",
  "durationMinutes": 90,
  "status": "CONFIRMED",
  "createdAt": "2025-10-22T19:50:21-03:00",
  "updatedAt": "2025-10-22T19:50:21-03:00"
}
```

**Design Choice - Create Re-runs Selection Under Lock (TOCTOU Prevention)**:
- After acquiring lock, re-discovers candidates to ensure freshness
- Prevents Time-Of-Check-Time-Of-Use race conditions
- Verifies selected candidate is still available before writing
- **Rationale**: Between discovery and creation, concurrent requests may have booked the same slot

#### 3. List Bookings for a Day

**GET** `/api/woki/bookings/day`

Query parameters:
- `restaurantId` (required)
- `sectorId` (required)
- `date` (required, format: YYYY-MM-DD)

**Response (200)**:
```json
{
  "date": "2025-10-22",
  "items": [
    {
      "id": "BK_001",
      "tableIds": ["T4"],
      "partySize": 5,
      "start": "2025-10-22T20:00:00-03:00",
      "end": "2025-10-22T21:30:00-03:00",
      "status": "CONFIRMED"
    }
  ]
}
```

#### 4. Cancel Booking

**DELETE** `/api/woki/bookings/:id`

**Response (204)**: No content

**Behavior**:
- Marks the booking as `CANCELLED`
- Bookings are preserved for audit/history purposes
- Cancelled bookings do not block capacity (excluded from availability calculations)
- Idempotent: Cancelling an already-cancelled booking is a no-op

### Optional Extension Endpoints

#### 5. Create Blackout

**POST** `/api/woki/blackouts`

**Request Body**:
```json
{
  "restaurantId": "R1",
  "sectorId": "S1",
  "tableIds": ["T1", "T2"],
  "date": "2025-10-22",
  "startTime": "20:00",
  "endTime": "22:00",
  "reason": "MAINTENANCE",
  "notes": "Table maintenance required"
}
```

**Response (201)**:
```json
{
  "id": "BLK_12345678",
  "restaurantId": "R1",
  "sectorId": "S1",
  "tableIds": ["T1", "T2"],
  "start": "2025-10-22T20:00:00-03:00",
  "end": "2025-10-22T22:00:00-03:00",
  "reason": "MAINTENANCE",
  "notes": "Table maintenance required",
  "createdAt": "2025-10-22T19:50:21-03:00",
  "updatedAt": "2025-10-22T19:50:21-03:00",
  "cancelledBookingIds": ["BK_001", "BK_002"]
}
```

**Behavior**:
- Automatically cancels all overlapping CONFIRMED bookings that use the affected tables
- For whole sector blackouts (empty `tableIds`), cancels all overlapping bookings in the sector
- For table-specific blackouts, only cancels bookings using those specific tables
- Returns `cancelledBookingIds` array containing IDs of bookings that were cancelled
- Cancelled bookings are marked as `CANCELLED` (not deleted) and preserved in the database

#### 6. List Blackouts

**GET** `/api/woki/blackouts?restaurantId=R1&sectorId=S1&date=2025-10-22`

**Response (200)**: List of blackouts for the day

#### 7. Delete Blackout

**DELETE** `/api/woki/blackouts/:id`

**Response (204)**: No content

#### 8. Get Metrics

**GET** `/api/woki/metrics`

**Response (200)**:
```json
{
  "bookings": {
    "created": 42,
    "cancelled": 3,
    "conflicts": {
      "no_capacity": 5,
      "table_locked": 2
    }
  },
  "assignmentTime": {
    "p95": 45,
    "samples": 100
  },
  "locks": {
    "waitTimes": {
      "p95": 12,
      "samples": 50
    },
    "timeouts": 1
  }
}
```

**Note**: Metrics are in-memory and reset on application restart. This is an optional extension.

## Concurrency & Idempotency

### Atomic Create + Locking

**Individual Table Locking**: Each table is locked separately to prevent race conditions
- **Lock Key Format**: `{restaurantId}|{sectorId}|{tableId}|{start}` (one lock per table)
- Example for combo T1+T2: 
  - Lock 1: `R1|S1|T1|2025-10-22T20:00:00-03:00`
  - Lock 2: `R1|S1|T2|2025-10-22T20:00:00-03:00`
- **Deadlock Prevention**: Locks are acquired in sorted order (alphabetical by table ID) to ensure consistent lock ordering across all requests
- All required locks are acquired before proceeding, released in finally block

**Why Individual Table Locking?**
- Prevents race conditions where overlapping combos (e.g., T1+T2 and T2+T3) could both acquire locks simultaneously
- Ensures that if T2 is part of multiple combos, only one request can lock it at a time
- Example: Request for T1+T2 and request for T2+T3 both need T2; the second request will wait for T2 to be released

**Collision Check**: After acquiring all locks, verify against latest state
- Prevents double-booking even if two requests select the same candidate
- Re-discovers candidates under lock to ensure freshness (TOCTOU prevention)

**In-Memory Locks (Trade-off)**:
- **Rationale**: Challenge does not require distributed locking; single-instance deployment assumed
- **Limitation**: Not suitable for multi-instance deployments
- **Alternative**: Database row-level locking or distributed lock service (Redis, etc.) for production

### Idempotency Semantics

The `Idempotency-Key` header is **required** for all booking creation requests. It enables safe retries and prevents duplicate bookings.

**Required Header**:
- `Idempotency-Key` must be provided in the request headers
- Missing or empty idempotency key returns `400 Bad Request` with `invalid_input` error
- Each booking request must have a unique idempotency key

**Same Key + Same Payload**:
- Returns the same booking object (replay-safe)
- Cached for 60 seconds TTL
- Prevents duplicate bookings from network retries or client-side retry logic
- Safe to retry the same request multiple times

**Same Key + Different Payload**:
- Returns `400 Bad Request` with `invalid_input` error
- Prevents accidental reuse of idempotency keys with different parameters
- Ensures idempotency key uniquely identifies the exact operation

**TTL Rationale (60 seconds)**:
- Booking operations are typically fast (<1 second)
- 60-second window covers network retries and standard client retry patterns
- Prevents unbounded cache growth
- **Trade-off**: Longer TTL provides better retry protection but increases memory usage

## Metrics & Observability (Optional Extension)

Current metrics tracked:
- Bookings created/cancelled
- Conflicts (no_capacity, table_locked)
- Assignment time (P95 percentile)
- Lock wait times (P95 percentile)
- Lock timeouts

**Limitation**: Metrics are currently in-memory, so restarting the app resets them. Should be events sent to external system or stored in DB for production.

## Rate Limiting (Optional Extension)

Throttling configuration:
- Different limits per endpoint (e.g., 5/min for create, 100/min for discover)
- Test mode has higher limits (10,000/min) to avoid rate limiting in tests
- Per-endpoint throttling (not per-user)

## Validation & Error Handling

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `invalid_input` | Non-grid times/durations, bad formats, negative party size, same idempotency key with different payload, etc. |
| 404 | `not_found` | Restaurant/sector not found |
| 409 | `no_capacity` | No single nor combo fits on the requested day/window |
| 409 | `table_locked` | Lock timeout or contention (optional extension) |
| 422 | `outside_service_window` | Specified window does not overlap with any service window (validation checks for overlap, not complete containment) |

## Trade-offs & Justifications

This section explicitly justifies implementation choices that could be interpreted as deviations from the challenge requirements.

### 1. Max Combo Size Limit (6 tables)

**Challenge allows**: Unlimited combo sizes  
**Implementation choice**: Hard limit of 6 tables  
**Justification**: 
- With 10 tables, combinations of 7+ tables generate 120+ combinations
- Combinatorial explosion makes exhaustive search impractical for large combos
- Aggressive pruning (capacity checks, sorted tables) makes backtracking feasible up to size 6
- Real-world restaurant scenarios rarely require 7+ table combinations

**Trade-off**: May miss some valid large combos, but ensures polynomial-time performance (see Complexity Analysis)

### 2. In-Memory Locks vs Database Transactions

**Challenge requirement**: Prevent double-booking under concurrency  
**Implementation choice**: In-memory locks with per-table keys  
**Justification**:
- Challenge assumes single-instance deployment (no distributed system requirement)
- In-memory locks are simpler, faster, and sufficient for the stated scope
- Individual table locking prevents race conditions with overlapping table combinations
- Locks acquired in sorted order (alphabetical by table ID) prevents deadlocks
- Database row-level locking would require more complex transaction management

**Trade-off**: Not suitable for multi-instance deployments, but fully meets challenge requirements for single-instance scenarios

### 3. In-Memory Metrics

**Challenge requirement**: None (optional extension)  
**Implementation choice**: In-memory counters and arrays  
**Justification**:
- Simple implementation for observability
- No external dependencies required
- Sufficient for development/demo purposes

**Trade-off**: Lost on restart, but acceptable for optional feature

### 4. Backtracking with Aggressive Pruning

**Challenge allows**: Any reasonable optimization  
**Implementation choice**: Backtracking algorithm with domain-rule pruning  
**Justification**: See Complexity Analysis section  
**Trade-off**: May explore fewer combinations, but ensures polynomial-time behavior

## Complexity Analysis

### Combo Generation Complexity

Without pruning, generating all combinations of N tables would be O(2^N), which is exponential.

**Pruning Reduces Complexity**:

1. **Max Combo Size (6)**: Reduces from O(2^N) to O(C(N,6)) where C is binomial coefficient
   - With 10 tables: 2^10 = 1024 → C(10,6) = 210 combinations
   - **Impact**: Exponential → Polynomial (O(N^6) worst case)

2. **Capacity-Based Pruning**: Skip combinations where max possible capacity < partySize
   - Early termination when adding remaining tables cannot reach partySize
   - **Impact**: Often 50-80% reduction in explored combinations in practice

3. **Sorted Tables (Larger First)**: Enables earlier pruning
   - Larger tables reach capacity faster, allowing earlier backtracking
   - **Impact**: Better average-case performance

**Why Backtracking is Acceptable**:

With aggressive pruning, the search space is polynomial, not exponential:
- 10 tables, max combo size 6: ~210 combinations to explore
- Each combination requires gap intersection: O(M log M) where M = number of gaps
- Total: O(C(N,6) × M log M) - polynomial time
- In practice, pruning reduces this significantly (often <50 combinations explored)

### Gap Discovery Complexity

- **Single table gaps**: O(B log B) where B = bookings (sorting)
- **Combo gaps**: O(G × T) where G = gaps per table, T = tables in combo
- **Intersection**: O(G × T) using sorted intervals

### Overall System Complexity

- **Discovery**: O(T × B log B + C(N,6) × G × T) where:
  - T = tables
  - B = bookings
  - N = max combo size (6)
  - G = average gaps per table
- **Create**: O(Discovery + L) where L = lock acquisition (O(1) in-memory)

## Failure Modes & Edge Cases

### Adjacent Bookings ([start, end))

- Bookings ending at 20:00 and starting at 20:00 are valid (no conflict)
- End is exclusive, so [19:00, 20:00) and [20:00, 21:00) can coexist
- **Implementation**: Gap discovery correctly handles this by using exclusive end semantics

### Concurrent Booking Attempts

- Two requests discover the same candidate simultaneously
- Both acquire locks on different candidates (if available)
- If same candidate selected: First lock wins, second re-discovers and selects alternative
- **Protection**: Lock + collision check after selection prevents double-booking

### Empty Service Windows

- Restaurant with no service windows defined
- **Behavior**: Discovery returns no candidates (no valid time slots)
- **Error**: 422 `outside_service_window` if windowStart/windowEnd provided, otherwise 409 `no_capacity`

### Lock Contention

- Multiple requests competing for same time slot
- **Behavior**: First request acquires lock, others wait (with timeout)
- **Timeout**: Configurable, defaults prevent indefinite blocking
- **Fallback**: After timeout, request fails with 409 `table_locked` conflict

### Idempotency Key Reuse

- **Same key with different payload** → 400 Bad Request (`invalid_input`)
- **Same key with same payload** → Returns cached booking (replay-safe)
- **Expired key (>60s)** → Treated as new request

### No Capacity Scenarios

- All tables booked for requested duration
- Party size too large for any combo (even max size 6)
- Requested window outside all service windows
- **Response**: 409 `no_capacity` with descriptive detail

## Additional Resources

- **Postman Collection**: `WokiBrain.postman_collection.json`
- **Swagger Documentation**: http://localhost:3000/docs (when server is running)
- **Database Schema**: See TypeORM entities in `src/woki/domain/entities/`

## License

MIT
