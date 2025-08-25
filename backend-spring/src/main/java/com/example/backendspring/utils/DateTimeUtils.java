package com.example.backendspring.utils;

import java.time.*;
import java.time.format.DateTimeParseException;

/**
 * Utilities for parsing frontend-provided date/time strings in a consistent way
 * treating timezone-less values as America/Sao_Paulo local times.
 */
public final class DateTimeUtils {

    private static final ZoneId DEFAULT_ZONE = ZoneId.of("America/Sao_Paulo");

    private DateTimeUtils() {
    }

    /**
     * Parse a string into an OffsetDateTime. If the string carries an explicit
     * offset or 'Z', it is parsed as-is. If it is a local datetime (contains 'T'
     * but no offset), it's interpreted in America/Sao_Paulo. If it's a date-only
     * string (YYYY-MM-DD) it's interpreted as start of day in America/Sao_Paulo.
     * Returns null on parse failure.
     */
    public static OffsetDateTime parseToOffsetDateTimeOrNull(String s) {
        if (s == null || s.isBlank())
            return null;
        try {
            // Try parsing as OffsetDateTime (works when string has offset or Z)
            return OffsetDateTime.parse(s);
        } catch (DateTimeParseException ignored) {
        }

        try {
            // If contains 'T' but no offset, treat as local datetime in Sao_Paulo
            if (s.contains("T")) {
                LocalDateTime ldt = LocalDateTime.parse(s);
                return ldt.atZone(DEFAULT_ZONE).toOffsetDateTime();
            }
        } catch (DateTimeParseException ignored) {
        }

        try {
            // Try parsing as date-only
            LocalDate ld = LocalDate.parse(s);
            return ld.atStartOfDay(DEFAULT_ZONE).toOffsetDateTime();
        } catch (DateTimeParseException ignored) {
        }

        return null;
    }

}
