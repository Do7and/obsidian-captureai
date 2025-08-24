/**
 * Time utilities for handling dates and timestamps with proper timezone support
 */

/**
 * Get the system timezone using Intl API
 */
export function getSystemTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Format a Date object as local time string in ISO-like format
 * Returns format like: "2025-08-23T14:30:45.123+08:00" (with timezone offset)
 */
export function formatLocalDateTime(date: Date): string {
    // Get timezone offset in minutes and convert to hours
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    
    // Format offset as +HH:MM or -HH:MM
    const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`;
    
    // Get local time components
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetString}`;
}

/**
 * Parse a timestamp string (can be ISO format or local format) back to Date
 */
export function parseTimestamp(timestampStr: string): Date {
    // Try to parse as ISO string first
    const date = new Date(timestampStr);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid timestamp format: ${timestampStr}`);
    }
    return date;
}

/**
 * Format a date for display in the local timezone (used in chat UI)
 * Returns user-friendly format like "今天 14:30" or "2025/8/23 14:30"
 */
export function formatDisplayTime(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Check if the date is today
    if (date.toDateString() === today.toDateString()) {
        return '今天 ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // Check if the date is yesterday
    else if (date.toDateString() === yesterday.toDateString()) {
        return '昨天 ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // For other dates, show full date and time
    else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

/**
 * Get current time formatted for file names (safe for filesystem)
 * Returns format like: "2025-08-23_14-30-45"
 */
export function formatTimestampForFilename(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}