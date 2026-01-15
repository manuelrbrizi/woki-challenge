import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Validates if a requested time window is within the restaurant's service windows.
 *
 * @param windowStart - Requested window start time in HH:mm format
 * @param windowEnd - Requested window end time in HH:mm format
 * @param serviceWindows - Array of service windows with start/end in HH:mm format
 * @throws UnprocessableEntityException if window is outside service hours
 */
export function validateWindowWithinServiceHours(
  windowStart: string,
  windowEnd: string,
  serviceWindows: Array<{ start: string; end: string }>,
): void {
  // If no service windows, allow any window (24h open)
  if (!serviceWindows || serviceWindows.length === 0) {
    return;
  }

  // Parse the requested window times
  const [reqStartHour, reqStartMin] = windowStart.split(':').map(Number);
  const [reqEndHour, reqEndMin] = windowEnd.split(':').map(Number);
  const reqStartMinutes = reqStartHour * 60 + reqStartMin;
  const reqEndMinutes = reqEndHour * 60 + reqEndMin;

  // Check if the requested window overlaps with any service window
  // Overlap occurs when: reqStart < swEnd && reqEnd > swStart
  const overlapsAnyWindow = serviceWindows.some((sw) => {
    const [swStartHour, swStartMin] = sw.start.split(':').map(Number);
    const [swEndHour, swEndMin] = sw.end.split(':').map(Number);
    const swStartMinutes = swStartHour * 60 + swStartMin;
    const swEndMinutes = swEndHour * 60 + swEndMin;

    // Check if requested window overlaps with this service window
    // Overlap: reqStart < swEnd && reqEnd > swStart
    return (
      reqStartMinutes < swEndMinutes &&
      reqEndMinutes > swStartMinutes &&
      reqStartMinutes < reqEndMinutes
    );
  });

  if (!overlapsAnyWindow) {
    throw new UnprocessableEntityException({
      error: 'outside_service_window',
      detail: 'Window does not intersect service hours',
    });
  }
}
