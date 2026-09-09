<?php
/**
 * BookingDateResolver
 * 
 * Authoritative deterministic date & time extraction and normalization service
 * for the AI Booking Assistant (Unified Burial & Cremation V2).
 * 
 * Capabilities:
 * - Natural weekdays ("Sunday", "this Sunday", "next Sunday", "Friday", "this Friday", "next Friday")
 * - Relative intervals ("tomorrow", "in 1 week", "in 2 weeks", "in 1 month", "next week")
 * - Month + Day formats ("September 20", "Sept 20, 2026", "20th of September")
 * - ISO formats ("2026-09-20", "2026/09/20")
 * - Time expressions ("at 2 PM", "2:30 PM", "14:00", "9 AM") normalized to HH:MM:SS
 * - Cemetery business rules validation (Past dates, Monday burial rule)
 */

class BookingDateResolver {
    public const WEEKDAYS = [
        'sunday'    => 0,
        'monday'    => 1,
        'tuesday'   => 2,
        'wednesday' => 3,
        'thursday'  => 4,
        'friday'    => 5,
        'saturday'  => 6,
    ];

    public const MONTHS = [
        'january'   => 1, 'jan' => 1,
        'february'  => 2, 'feb' => 2,
        'march'     => 3, 'mar' => 3,
        'april'     => 4, 'apr' => 4,
        'may'       => 5,
        'june'      => 6, 'jun' => 6,
        'july'      => 7, 'jul' => 7,
        'august'    => 8, 'aug' => 8,
        'september' => 9, 'sept' => 9, 'sep' => 9,
        'october'   => 10, 'oct' => 10,
        'november'  => 11, 'nov' => 11,
        'december'  => 12, 'dec' => 12,
    ];

    /**
     * Extract and normalize date & time from conversational message.
     * 
     * @param string   $message
     * @param int|null $referenceTime Unix timestamp for reference (defaults to now)
     * @return array ['date' => string|null, 'time' => string|null, 'raw_matched' => string|null]
     */
    public static function extract(string $message, ?int $referenceTime = null): array {
        $ref = $referenceTime ?? time();
        $date = self::extractDate($message, $ref);
        $time = self::extractTime($message);

        return [
            'date' => $date,
            'time' => $time,
        ];
    }

    /**
     * Extract date and format as YYYY-MM-DD.
     */
    public static function extractDate(string $message, ?int $referenceTime = null): ?string {
        $ref = $referenceTime ?? time();
        $msg = trim($message);
        $msgLower = strtolower($msg);

        // 1. Explicit ISO Date (YYYY-MM-DD or YYYY/MM/DD)
        if (preg_match('/\b(20\d{2})[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/', $msg, $m)) {
            $candidate = sprintf('%04d-%02d-%02d', (int) $m[1], (int) $m[2], (int) $m[3]);
            if (checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
                return $candidate;
            }
        }

        // 2. Relative Days: "today", "tomorrow", "day after tomorrow", "bukas", "samakalawa"
        if (preg_match('/\bday after tomorrow\b|\bsamakalawa\b|\bsa makalawa\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+2 days', $ref));
        }
        if (preg_match('/\btomorrow\b|\bbukas\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+1 day', $ref));
        }

        // 3. Relative Intervals: "in X weeks", "in X months", "in X days"
        if (preg_match('/\b(?:in\s+)?1\s*week\b/i', $msgLower) || preg_match('/\bnext\s+week\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+7 days', $ref));
        }
        if (preg_match('/\b(?:in\s+)?2\s*weeks\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+14 days', $ref));
        }
        if (preg_match('/\b(?:in\s+)?3\s*weeks\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+21 days', $ref));
        }
        if (preg_match('/\b(?:in\s+)?4\s*weeks\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+28 days', $ref));
        }
        if (preg_match('/\b(?:in\s+)?1\s*month\b/i', $msgLower) || preg_match('/\bnext\s+month\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+1 month', $ref));
        }
        if (preg_match('/\b(?:in\s+)?2\s*months\b/i', $msgLower)) {
            return date('Y-m-d', strtotime('+2 months', $ref));
        }
        if (preg_match('/\bin\s+(\d+)\s*days\b/i', $msgLower, $dm)) {
            $days = (int) $dm[1];
            if ($days > 0 && $days <= 365) {
                return date('Y-m-d', strtotime("+{$days} days", $ref));
            }
        }

        // 4. Weekday with optional qualifier: "this Sunday", "next Sunday", "Sunday", "coming Friday", "Friday", "darating na Biyernes"
        $weekdayPattern = '\b(?:(this|next|coming|darating\s+na|susunod\s+na|ngayong)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|linggo|lunes|martes|miyerkoles|miyerkules|huwebes|hwebes|biyernes|sabado)\b';
        if (preg_match('/' . $weekdayPattern . '/i', $msgLower, $wm)) {
            $rawMod = !empty($wm[1]) ? strtolower(trim($wm[1])) : null;
            $modifier = match ($rawMod) {
                'darating na', 'coming' => 'coming',
                'susunod na', 'next'     => 'next',
                'ngayong', 'this'        => 'this',
                default                  => $rawMod
            };
            $rawDay = strtolower(trim($wm[2]));
            $tagalogMap = [
                'linggo'      => 'sunday',
                'lunes'       => 'monday',
                'martes'      => 'tuesday',
                'miyerkoles'  => 'wednesday',
                'miyerkules'  => 'wednesday',
                'huwebes'     => 'thursday',
                'hwebes'      => 'thursday',
                'biyernes'    => 'friday',
                'sabado'      => 'saturday',
            ];
            $dayName = $tagalogMap[$rawDay] ?? $rawDay;
            return self::resolveWeekday($dayName, $modifier, $ref);
        }

        // 5. Month Name + Day: e.g. "September 20", "Sept 20th", "Sept 25, 2026", "20 September"
        $monthPattern = '(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
        // Format A: "September 20th, 2026" or "Sept 20"
        if (preg_match('/\b' . $monthPattern . '\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i', $msgLower, $mm)) {
            $monthNum = self::MONTHS[strtolower($mm[1])] ?? 1;
            $dayNum = (int) $mm[2];
            $yearNum = !empty($mm[3]) ? (int) $mm[3] : (int) date('Y', $ref);

            if (checkdate($monthNum, $dayNum, $yearNum)) {
                $resolved = sprintf('%04d-%02d-%02d', $yearNum, $monthNum, $dayNum);
                // If year was omitted and date has already passed this year, roll over to next year
                if (empty($mm[3]) && $resolved < date('Y-m-d', $ref)) {
                    $resolved = sprintf('%04d-%02d-%02d', $yearNum + 1, $monthNum, $dayNum);
                }
                return $resolved;
            }
        }

        // Format B: "20th of September, 2026" or "20 September"
        if (preg_match('/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?' . $monthPattern . '\.?(?:\s*,?\s*(20\d{2}))?\b/i', $msgLower, $mm)) {
            $dayNum = (int) $mm[1];
            $monthNum = self::MONTHS[strtolower($mm[2])] ?? 1;
            $yearNum = !empty($mm[3]) ? (int) $mm[3] : (int) date('Y', $ref);

            if (checkdate($monthNum, $dayNum, $yearNum)) {
                $resolved = sprintf('%04d-%02d-%02d', $yearNum, $monthNum, $dayNum);
                if (empty($mm[3]) && $resolved < date('Y-m-d', $ref)) {
                    $resolved = sprintf('%04d-%02d-%02d', $yearNum + 1, $monthNum, $dayNum);
                }
                return $resolved;
            }
        }

        return null;
    }

    /**
     * Resolve a weekday name and optional modifier (this/next/coming) relative to reference time.
     * 
     * Rules:
     * - "this [day]" / "[day]": The next upcoming occurrence of that day. If today is that day,
     *   for forward-looking cemetery bookings we take the occurrence next week (+7 days).
     * - "next [day]": The day in the following week (e.g. if today is Wed and user says "next Friday",
     *   it resolves to Friday of next week, +9 days, not the Friday in 2 days).
     */
    public static function resolveWeekday(string $dayName, ?string $modifier = null, int $ref = 0): string {
        $ref = $ref ?: time();
        $targetDayIndex = self::WEEKDAYS[strtolower($dayName)] ?? 0;
        $currentDayIndex = (int) date('w', $ref); // 0=Sunday ... 6=Saturday

        $daysUntil = ($targetDayIndex - $currentDayIndex + 7) % 7;
        if ($daysUntil === 0) {
            // Same day of week: since booking must be future, advance by 7 days
            $daysUntil = 7;
        }

        if ($modifier === 'next') {
            // If modifier is "next", advance to the occurrence in the following week
            if ($daysUntil < 7) {
                $daysUntil += 7;
            }
        }

        return date('Y-m-d', strtotime("+{$daysUntil} days", $ref));
    }

    /**
     * Extract time and format as HH:MM:SS (24-hour format).
     */
    public static function extractTime(string $message): ?string {
        $msg = trim($message);

        // 1. "at 2 PM", "at 2:30 pm", "2:00 PM", "9:30 AM", "11am"
        if (preg_match('/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i', $msg, $tm)) {
            $hours = (int) $tm[1];
            $minutes = !empty($tm[2]) ? (int) $tm[2] : 0;
            $meridiem = strtolower($tm[3]);

            if ($hours >= 1 && $hours <= 12 && $minutes >= 0 && $minutes <= 59) {
                if ($meridiem === 'pm' && $hours < 12) {
                    $hours += 12;
                } elseif ($meridiem === 'am' && $hours === 12) {
                    $hours = 0;
                }
                return sprintf('%02d:%02d:00', $hours, $minutes);
            }
        }

        // 2. 24-hour format: "14:00", "09:30"
        if (preg_match('/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/', $msg, $tm)) {
            $hours = (int) $tm[1];
            $minutes = (int) $tm[2];
            $seconds = !empty($tm[3]) ? (int) $tm[3] : 0;
            return sprintf('%02d:%02d:%02d', $hours, $minutes, $seconds);
        }

        return null;
    }

    /**
     * Validate Date Constraints against Cemetery Business Rules.
     * 
     * @param string $dateStr Format YYYY-MM-DD
     * @param bool   $isBurial
     * @return array ['valid' => bool, 'error' => string|null]
     */
    public static function validate(string $dateStr, bool $isBurial = true, ?int $ref = null): array {
        $ref = $ref ?? time();
        $timestamp = strtotime($dateStr);
        if ($timestamp === false) {
            return ['valid' => false, 'error' => 'Invalid date format'];
        }

        $formatted = date('Y-m-d', $timestamp);
        $today = date('Y-m-d', $ref);

        if ($formatted < $today) {
            return ['valid' => false, 'error' => 'Booking date cannot be in the past'];
        }

        if ($isBurial && (int) date('N', $timestamp) === 1) {
            return ['valid' => false, 'error' => 'Monday booking is not allowed; cemetery maintenance occurs on Mondays. Please select Tuesday through Sunday.'];
        }

        return ['valid' => true, 'error' => null];
    }

    public static function validateBookingDate(string $dateStr, bool $isBurial = true, ?int $ref = null): array {
        return self::validate($dateStr, $isBurial, $ref);
    }
}
