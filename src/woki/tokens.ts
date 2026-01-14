// Injection tokens for repository interfaces
// Using Symbols to avoid conflicts and ensure type safety
export const RESTAURANT_REPOSITORY = Symbol('RestaurantRepository');
export const SECTOR_REPOSITORY = Symbol('SectorRepository');
export const TABLE_REPOSITORY = Symbol('TableRepository');
export const BOOKING_REPOSITORY = Symbol('BookingRepository');
export const SERVICE_WINDOW_REPOSITORY = Symbol('ServiceWindowRepository');
export const BLACKOUT_REPOSITORY = Symbol('BlackoutRepository');
