import { Injectable } from '@nestjs/common';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../types/booking-status.enum';
import { TimeInterval } from '../types/time-interval.type';
import { Restaurant } from '../entities/restaurant.entity';
import { zonedTimeToUtc } from 'date-fns-tz';

@Injectable()
export class GapDiscoveryService {
  /**
   * Find gaps in booking schedule for a single table.
   * Returns intervals where the table is free for at least the specified duration.
   */
  findGapsForTable(
    bookings: Booking[],
    tableId: string,
    date: Date,
    durationMinutes: number,
    restaurant: Restaurant,
    serviceWindows: Array<{ start: string; end: string }>,
    windowStart?: string,
    windowEnd?: string,
  ): TimeInterval[] {
    // Filter confirmed bookings for this table
    // Note: bookings are already filtered by date in the restaurant's timezone
    // by the repository query, so we don't need to check isSameDay here
    const tableBookings = bookings
      .filter(
        (b) =>
          b.tableIds.includes(tableId) && b.status === BookingStatus.CONFIRMED,
      )
      .map((b) => ({
        start: b.start,
        end: b.end,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Get service windows for the day
    const windows = this.getServiceWindowsForDate(
      restaurant,
      date,
      serviceWindows,
      windowStart,
      windowEnd,
    );

    if (windows.length === 0) {
      return [];
    }

    const gaps: TimeInterval[] = [];

    // Find gaps within each service window
    for (const window of windows) {
      const windowGaps = this.findGapsInWindow(
        tableBookings,
        window,
        durationMinutes,
      );
      gaps.push(...windowGaps);
    }

    // Sort all gaps by start time to ensure deterministic order across service windows
    return gaps.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Find gaps where multiple tables are simultaneously free.
   * Returns intervals where all tables in the combination are free.
   */
  findComboGaps(
    bookings: Booking[],
    tableIds: string[],
    date: Date,
    durationMinutes: number,
    restaurant: Restaurant,
    serviceWindows: Array<{ start: string; end: string }>,
    windowStart?: string,
    windowEnd?: string,
  ): TimeInterval[] {
    if (tableIds.length === 0) {
      return [];
    }

    if (tableIds.length === 1) {
      return this.findGapsForTable(
        bookings,
        tableIds[0],
        date,
        durationMinutes,
        restaurant,
        serviceWindows,
        windowStart,
        windowEnd,
      );
    }

    // Get gaps for each table
    const gapsByTable = tableIds.map((tableId) =>
      this.findGapsForTable(
        bookings,
        tableId,
        date,
        durationMinutes,
        restaurant,
        serviceWindows,
        windowStart,
        windowEnd,
      ),
    );

    // Intersect gaps - find intervals where all tables are free
    // If any table has no gaps, the intersection will be empty
    if (gapsByTable.some((gaps) => gaps.length === 0)) {
      return [];
    }

    let intersection = gapsByTable[0];

    for (let i = 1; i < gapsByTable.length; i++) {
      intersection = this.intersectIntervals(intersection, gapsByTable[i]);
    }

    // Filter by duration
    return intersection.filter(
      (gap) => this.getDurationMinutes(gap) >= durationMinutes,
    );
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    // Use UTC methods to avoid timezone issues
    // All dates in the system are stored in UTC
    return (
      date1.getUTCFullYear() === date2.getUTCFullYear() &&
      date1.getUTCMonth() === date2.getUTCMonth() &&
      date1.getUTCDate() === date2.getUTCDate()
    );
  }

  private getServiceWindowsForDate(
    restaurant: Restaurant,
    date: Date,
    serviceWindows: Array<{ start: string; end: string }>,
    windowStart?: string,
    windowEnd?: string,
  ): TimeInterval[] {
    const timezone = restaurant.timezone;
    // Extract year, month, day from the date (using UTC to avoid timezone issues)
    // The date parameter comes from parseISO which creates a UTC date at midnight
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    // If specific window provided, use it
    if (windowStart && windowEnd) {
      const start = this.parseTimeInTimezone(
        year,
        month,
        day,
        windowStart,
        timezone,
      );
      const end = this.parseTimeInTimezone(
        year,
        month,
        day,
        windowEnd,
        timezone,
      );
      return [{ start, end }];
    }

    // Otherwise use restaurant service windows
    if (!serviceWindows || serviceWindows.length === 0) {
      // Full day if no windows specified
      // Create a full day window: 00:00 to 24:00 in restaurant's timezone
      const start = this.parseTimeInTimezone(
        year,
        month,
        day,
        '00:00',
        timezone,
      );
      const end = this.parseTimeInTimezone(year, month, day, '24:00', timezone);
      return [{ start, end }];
    }

    return serviceWindows.map((window) => ({
      start: this.parseTimeInTimezone(year, month, day, window.start, timezone),
      end: this.parseTimeInTimezone(year, month, day, window.end, timezone),
    }));
  }

  private parseTimeInTimezone(
    year: number,
    month: number,
    day: number,
    timeStr: string,
    timezone: string,
  ): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    // Create date string in the timezone
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    // Parse as if it's in the timezone, then convert to UTC
    return zonedTimeToUtc(new Date(dateStr), timezone);
  }

  private findGapsInWindow(
    bookings: Array<{ start: Date; end: Date }>,
    window: TimeInterval,
    durationMinutes: number,
  ): TimeInterval[] {
    // 1. Normalize existing CONFIRMED bookings to [start, end) and sort
    const normalizedBookings = bookings
      .filter((b) => b.start < window.end && b.end > window.start)
      .map((b) => ({
        start: b.start,
        end: b.end,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // 2. Add sentinels at window start/end
    const sentinels: TimeInterval[] = [
      { start: window.start, end: window.start }, // Sentinel at window start
      { start: window.end, end: window.end }, // Sentinel at window end
    ];

    // 3. Combine sentinels and bookings, then sort
    const allEvents = [...sentinels, ...normalizedBookings].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );

    // 4. Walk adjacent pairs → gaps (prevEnd, nextStart)
    const gaps: TimeInterval[] = [];
    for (let i = 0; i < allEvents.length - 1; i++) {
      const prevEnd = allEvents[i].end; // End of previous booking/sentinel
      const nextStart = allEvents[i + 1].start; // Start of next booking/sentinel

      // If there's a gap between prevEnd and nextStart
      if (prevEnd < nextStart) {
        const gap: TimeInterval = {
          start: prevEnd,
          end: nextStart,
        };

        // Only include gaps that meet the minimum duration requirement
        if (this.getDurationMinutes(gap) >= durationMinutes) {
          gaps.push(gap);
        }
      }
    }

    return gaps;
  }

  private intersectIntervals(
    intervals1: TimeInterval[],
    intervals2: TimeInterval[],
  ): TimeInterval[] {
    const intersection: TimeInterval[] = [];

    for (const i1 of intervals1) {
      for (const i2 of intervals2) {
        const overlap = this.getOverlap(i1, i2);
        if (overlap) {
          intersection.push(overlap);
        }
      }
    }

    return intersection;
  }

  private getOverlap(
    interval1: TimeInterval,
    interval2: TimeInterval,
  ): TimeInterval | null {
    // Find the overlap between two intervals
    // Start of overlap = max(interval1.start, interval2.start)
    // End of overlap = min(interval1.end, interval2.end)
    const start =
      interval1.start > interval2.start ? interval1.start : interval2.start;
    const end = interval1.end < interval2.end ? interval1.end : interval2.end;

    // If start < end, there's an overlap
    if (start < end) {
      return { start, end };
    }

    // No overlap
    return null;
  }

  private getDurationMinutes(interval: TimeInterval): number {
    return Math.floor(
      (interval.end.getTime() - interval.start.getTime()) / (1000 * 60),
    );
  }
}
