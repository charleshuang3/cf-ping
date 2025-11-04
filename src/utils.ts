/**
 * Formats a time difference in seconds to a detailed human-readable format.
 * Shows up to 2 units, e.g., "2 days 5 hours" or "5 hours 30 minutes" or "30 minutes 15 seconds"
 */
export function formatTimeDifference(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds % 60} second${seconds % 60 === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ${minutes % 60} minute${minutes % 60 === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ${hours % 24} hour${hours % 24 === 1 ? '' : 's'}`;
}