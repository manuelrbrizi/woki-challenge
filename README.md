# WokiBrain

A compact booking engine for restaurants that discovers **when** and **how** to seat a party using **single tables or table combinations**.

## Features

- Manages **Sectors** containing **Tables** with capacity ranges
- Accepts **variable durations** (multiples of 15 minutes, 30-180 minutes)
- Selects slots and seating configurations (single table **or** combos of any size) using a deterministic selection strategy
- Enforces basic **concurrency** (no double booking) and **idempotency** for create operations
- Exposes a **minimal API** (3 endpoints) to discover candidates, create a booking, and list the day's bookings

## Architecture

This project follows **Hexagonal Architecture** (Ports and Adapters) with clear separation of concerns:

- **Domain Layer**: Core business logic, entities, and domain services
- **Application Layer**: Use cases and DTOs
- **Infrastructure Layer**: TypeORM repositories, HTTP controllers, logging
- **Ports**: Repository interfaces

## Time Model

- **Grid**: Fixed 15-minute granularity
- **Durations**: Multiples of 15 minutes (minimum 30, maximum 180 minutes)
- **Intervals**: `[start, end)` (end exclusive); adjacent bookings do not conflict
- **Timezone**: IANA per Restaurant (e.g., `America/Argentina/Buenos_Aires`)
- **Service windows**: Optional array per restaurant/sector: `{ start: "HH:mm", end: "HH:mm" }`

## Combo Capacity Heuristic

For table combinations, the capacity is calculated as:
- **Min capacity**: Sum of all table `minSize` values
- **Max capacity**: Sum of all table `maxSize` values

**Rationale**: This approach is simple, predictable, and allows flexible seating. It assumes tables can be combined without significant space penalties.

## WokiBrain Selection Strategy

The selection strategy is deterministic and prioritizes:

1. **Single tables** over combos
2. Among singles: **earlier slots** are preferred
3. Among combos: **fewer tables** first, then **earlier slots**

This ensures that given the same inputs, the system will always return the same result.

## API Endpoints

### 1. Discover Seats

**GET** `/woki/discover`

Query parameters:
- `restaurantId` (required)
- `sectorId` (required)
- `date` (required, format: YYYY-MM-DD)
- `partySize` (required, positive integer)
- `duration` (required, positive integer, multiple of 15)
- `windowStart` (optional, format: HH:mm)
- `windowEnd` (optional, format: HH:mm)
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

**Error Responses**:
- `400`: Invalid input
- `404`: Restaurant or sector not found
- `409`: No capacity available
- `422`: Outside service window

### 2. Create Booking

**POST** `/woki/bookings`

**Headers**:
- `Idempotency-Key` (optional): Ensures idempotent operations (60s TTL)

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

**Error Responses**:
- `400`: Invalid input
- `404`: Restaurant or sector not found
- `409`: No capacity available

### 3. List Bookings for a Day

**GET** `/woki/bookings/day`

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

### 4. Cancel Booking (Optional)

**DELETE** `/woki/bookings/:id`

**Response (204)**: No content

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (see `.env.example`)

3. Start the application:
```bash
npm run start:dev
```

The application will:
- Create a fresh SQLite database on each startup
- Seed example data (restaurant R1, sector S1, 5 tables, 1 existing booking)
- Start the server on port 3000 (or the port specified in `.env`)

## Database

The application uses **SQLite** with TypeORM. The database file (`woki.db`) is created in the project root. On each startup, the schema is dropped and recreated with fresh seed data.

## Testing

Run tests:
```bash
npm test
```

Run E2E tests:
```bash
npm run test:e2e
```

## Swagger Documentation

Once the application is running, visit:
- http://localhost:3000/docs

## Concurrency & Idempotency

- **Locking**: Uses in-memory locks with composite keys (`restaurantId|sectorId|tableIds|start`)
- **Idempotency**: In-memory cache with 60-second TTL, keyed by `Idempotency-Key` header
- **Atomic Operations**: Bookings are created within transactions to ensure consistency

## Error Handling

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `invalid_input` | Non-grid times/durations, bad formats, negative party size |
| 404 | `not_found` | Restaurant/sector not found |
| 409 | `no_capacity` | No single nor combo fits on the requested day/window |
| 422 | `outside_service_window` | Specified window lies outside service hours |

## License

MIT
