<?php
require_once __DIR__ . '/DecedentController.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/Lot.php';

// Decedent Records module audit, Batch J — bulk CSV import for digitizing
// paper/historical records. Deliberately two-step (preview, then confirm):
// preview() never writes anything, it only parses and annotates each row
// with the SAME validation this module already enforces one record at a
// time (required fields, dob/dod order, exact/near duplicate detection),
// so staff can review before anything touches decedent_records. confirmImport()
// then commits only the rows staff kept checked, each through
// DecedentController::store() itself — not a parallel bulk-insert code
// path — so every import gets the exact same guards, audit log entry, and
// duplicate handling as a record entered by hand.
class DecedentImportController {
    private $decedentModel;
    private $lotModel;
    private $decedentController;

    // Keeps a single preview/import request bounded and fast — a larger
    // historical dataset should be split into multiple files rather than
    // this becoming a general-purpose spreadsheet-processing endpoint.
    private const MAX_ROWS = 500;

    // Fields required for every decedent regardless of burial or cremation.
    private const BASE_REQUIRED_COLUMNS = ['first_name', 'last_name', 'dob', 'dod'];

    // Legacy default for files that do not declare cremation status.
    private const REQUIRED_COLUMNS = ['first_name', 'last_name', 'dob', 'dod', 'lot_number', 'section_name'];

    // Human-readable labels for every error/warning message this controller
    // builds — staff reviewing the import preview should never see a raw
    // snake_case column key like "first_name" in plain sentence text; the
    // CSV template itself is the only place those exact spellings matter.
    private const FIELD_LABELS = [
        'first_name' => 'First Name',
        'last_name' => 'Last Name',
        'middle_name' => 'Middle Name',
        'suffix' => 'Suffix',
        'dob' => 'Date of Birth',
        'dod' => 'Date of Death',
        'lot_number' => 'Lot Number',
        'section_name' => 'Section',
        'block_name' => 'Block',
        'cause_of_death' => 'Cause of Death',
        'contact_name' => 'Contact Name',
        'contact_number' => 'Contact Number',
        'is_cremated' => 'Is Cremated',
        'ash_storage' => 'Ash Storage',
    ];

    // Batch 1 & 2 (Smart Import Automation): comprehensive synonym dictionary
    // mapping real-world spreadsheet headers (spaces, capitalizations, common
    // aliases) to canonical internal field names without requiring staff to
    // manually reformat column titles in Excel.
    private const COLUMN_SYNONYMS = [
        'first_name' => ['first_name', 'first name', 'firstname', 'given_name', 'given name', 'fname', 'first'],
        'last_name' => ['last_name', 'last name', 'lastname', 'surname', 'family_name', 'family name', 'lname', 'last'],
        'middle_name' => ['middle_name', 'middle name', 'middlename', 'mname', 'middle', 'middle initial', 'mi'],
        'suffix' => ['suffix', 'generation', 'ext', 'extension'],
        'dob' => ['dob', 'date_of_birth', 'date of birth', 'birth_date', 'birth date', 'birthdate', 'born', 'bday', 'birth'],
        'dod' => ['dod', 'date_of_death', 'date of death', 'death_date', 'death date', 'deathdate', 'deceased_date', 'date deceased', 'died', 'death'],
        'lot_number' => ['lot_number', 'lot number', 'lot_no', 'lot no', 'lot #', 'lot_id_str', 'lot'],
        'section_name' => ['section_name', 'section name', 'section', 'sec', 'sec_name'],
        'block_name' => ['block_name', 'block name', 'block', 'blk', 'blk_name', 'block_no', 'block no'],
        'cause_of_death' => ['cause_of_death', 'cause of death', 'cause', 'death_cause', 'reason of death'],
        'contact_name' => ['contact_name', 'contact name', 'family_contact', 'family contact', 'informant', 'informant_name', 'informant name', 'contact_person', 'contact person'],
        'contact_number' => ['contact_number', 'contact number', 'contact_no', 'contact no', 'contact_phone', 'contact phone', 'phone', 'mobile', 'cellphone', 'tel', 'telephone', 'phone_number', 'phone number'],
        'is_cremated' => ['is_cremated', 'is cremated', 'cremated', 'cremation'],
        'ash_storage' => ['ash_storage', 'ash storage', 'niche', 'niche_number', 'niche number', 'columbarium', 'ash_location', 'ash location'],
    ];

    public function __construct() {
        $this->decedentModel = new Decedent();
        $this->lotModel = new Lot();
        $this->decedentController = new DecedentController();
    }

    // Maps an incoming raw header column to a canonical field key using
    // exact match or the synonym dictionary. Strips UTF-8 BOM and periods.
    public static function matchHeaderToCanonical($rawHeader) {
        $clean = preg_replace('/^\xEF\xBB\xBF/', '', (string) $rawHeader);
        $clean = strtolower(trim($clean));
        $noPunct = trim(str_replace(['.', ',', ':', ';'], '', $clean));
        $normalized = trim(preg_replace('/[\s_\-\.]+/', ' ', $clean));

        foreach (self::COLUMN_SYNONYMS as $canonical => $synonyms) {
            if ($clean === $canonical || $noPunct === $canonical) {
                return $canonical;
            }
            foreach ($synonyms as $synonym) {
                $synClean = strtolower($synonym);
                $synNoPunct = trim(str_replace(['.', ',', ':', ';'], '', $synClean));
                $synNormalized = trim(preg_replace('/[\s_\-\.]+/', ' ', $synClean));
                if ($clean === $synClean || $noPunct === $synNoPunct || $normalized === $synNormalized) {
                    return $canonical;
                }
            }
        }
        return null;
    }

    // Batch 1 (Smart Import Normalization): robust deterministic date parser
    // converts YYYY-MM-DD, MM/DD/YYYY (Philippine standard), DD/MM/YYYY,
    // YYYY/MM/DD, and standard textual dates into strict ISO 'YYYY-MM-DD'.
    public static function normalizeDate($value) {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        // 1. Strict YYYY-MM-DD
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $raw, $m)) {
            return checkdate((int) $m[2], (int) $m[3], (int) $m[1])
                ? sprintf('%04d-%02d-%02d', (int) $m[1], (int) $m[2], (int) $m[3])
                : null;
        }

        // 2. YYYY/MM/DD or YYYY.MM.DD
        if (preg_match('/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/', $raw, $m)) {
            return checkdate((int) $m[2], (int) $m[3], (int) $m[1])
                ? sprintf('%04d-%02d-%02d', (int) $m[1], (int) $m[2], (int) $m[3])
                : null;
        }

        // 3. Separated by slash, hyphen, or dot with 4-digit year at the end: MM/DD/YYYY or DD/MM/YYYY
        if (preg_match('/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/', $raw, $m)) {
            $p1 = (int) $m[1];
            $p2 = (int) $m[2];
            $year = (int) $m[3];

            // If part1 > 12, it must be DD/MM/YYYY
            if ($p1 > 12 && $p2 <= 12 && checkdate($p2, $p1, $year)) {
                return sprintf('%04d-%02d-%02d', $year, $p2, $p1);
            }
            // Standard Philippine convention default: MM/DD/YYYY
            if ($p1 <= 12 && checkdate($p1, $p2, $year)) {
                return sprintf('%04d-%02d-%02d', $year, $p1, $p2);
            }
            // Fallback to DD/MM/YYYY
            if ($p2 <= 12 && checkdate($p2, $p1, $year)) {
                return sprintf('%04d-%02d-%02d', $year, $p2, $p1);
            }
            return null; // Both interpretations invalid (e.g. 00/00/0000 or 13/32/2020)
        }

        // 4. Textual dates (e.g. "January 15, 2020", "15 Jan 2020", "Jan 15 2020")
        $timestamp = strtotime($raw);
        if ($timestamp !== false) {
            $parsedYear = (int) date('Y', $timestamp);
            if ($parsedYear >= 1800 && $parsedYear <= 2100) {
                return date('Y-m-d', $timestamp);
            }
        }

        return null;
    }

    // Normalizes name casing and whitespace. Converts ALL CAPS names
    // (common in government/hospital exports) to Title Case.
    public static function normalizeName($value) {
        if ($value === null) {
            return null;
        }
        $val = trim(preg_replace('/\s+/', ' ', (string) $value));
        if ($val === '') {
            return '';
        }
        if (mb_strtoupper($val, 'UTF-8') === $val && mb_strlen($val, 'UTF-8') > 1) {
            return mb_convert_case(mb_strtolower($val, 'UTF-8'), MB_CASE_TITLE, 'UTF-8');
        }
        return $val;
    }

    // Cleans phone numbers of stray formatting artifacts while preserving digits.
    public static function normalizePhone($value) {
        if ($value === null) {
            return null;
        }
        $val = trim((string) $value);
        if ($val === '') {
            return null;
        }
        $clean = preg_replace('/[^\d\+\-\s\(\)]/', '', $val);
        $clean = trim(preg_replace('/\s+/', ' ', $clean));
        return $clean !== '' ? $clean : null;
    }

    // $file: one entry of $_FILES (readRequestBody()'s ['files'][...] shape —
    // see PaymentController::store()'s identical $data['files']['...'] convention).
    public function preview($file) {
        if (empty($file['tmp_name']) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return ['error' => 'No valid CSV file was uploaded', 'code' => 400];
        }

        // Detect the file's actual type from its bytes rather than trusting
        // the client-supplied Content-Type/extension — same discipline as
        // PaymentController::saveReceiptFile().
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detectedType = $finfo ? finfo_file($finfo, $file['tmp_name']) : false;
        if ($finfo) {
            finfo_close($finfo);
        }
        // A plain CSV saved from Excel/Sheets can legitimately report as any
        // of these depending on OS/exporter — all are effectively "text".
        $allowedTypes = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'];
        if (!in_array($detectedType, $allowedTypes, true)) {
            return ['error' => 'File does not appear to be a CSV file', 'code' => 400];
        }

        $handle = fopen($file['tmp_name'], 'r');
        if (!$handle) {
            return ['error' => 'Could not read the uploaded file', 'code' => 400];
        }

        $header = fgetcsv($handle);
        if (!$header) {
            fclose($handle);
            return ['error' => 'The CSV file appears to be empty', 'code' => 400];
        }

        // Batch 1: dynamic header mapping via synonym dictionary. Strips BOM,
        // maps aliases ("First Name", "Date of Birth") to canonical keys.
        $mappedHeaders = [];
        $foundCanonical = [];
        foreach ($header as $i => $col) {
            $canonical = self::matchHeaderToCanonical($col);
            $mappedHeaders[$i] = $canonical;
            if ($canonical !== null) {
                $foundCanonical[$canonical] = true;
            }
        }

        // Batch 2 (Cremation Alignment): first_name, last_name, dob, dod are
        // unconditionally required. lot_number and section_name are required
        // unless the file includes an 'is_cremated' column (where pure
        // cremation records legitimately have no burial lot).
        $missingColumns = [];
        foreach (self::BASE_REQUIRED_COLUMNS as $req) {
            if (empty($foundCanonical[$req])) {
                $missingColumns[] = self::FIELD_LABELS[$req] ?? $req;
            }
        }
        if (empty($foundCanonical['is_cremated'])) {
            if (empty($foundCanonical['lot_number'])) {
                $missingColumns[] = self::FIELD_LABELS['lot_number'];
            }
            if (empty($foundCanonical['section_name'])) {
                $missingColumns[] = self::FIELD_LABELS['section_name'];
            }
        }
        if (!empty($missingColumns)) {
            fclose($handle);
            return ['error' => 'Missing required column(s): ' . implode(', ', $missingColumns), 'code' => 400];
        }

        $rows = [];
        $rowNumber = 1; // the header itself is row 1, so the first data row is 2 — matches what staff sees if they open the file in a spreadsheet app.
        $seenFileRecords = []; // Batch 2: in-file duplicate detection map

        while (($line = fgetcsv($handle)) !== false) {
            $rowNumber++;

            // A trailing blank line is a common CSV-export artifact, not a
            // real row worth reporting as rejected.
            $hasContent = false;
            foreach ($line as $cell) {
                if (trim((string) $cell) !== '') {
                    $hasContent = true;
                    break;
                }
            }
            if (!$hasContent) {
                continue;
            }

            if (count($rows) >= self::MAX_ROWS) {
                fclose($handle);
                return ['error' => 'This file has more than ' . self::MAX_ROWS . ' data rows — please split it into smaller batches.', 'code' => 400];
            }

            $record = [];
            foreach ($mappedHeaders as $i => $col) {
                if ($col !== null && isset($line[$i])) {
                    $record[$col] = trim((string) $line[$i]);
                }
            }

            // Batch 2: track exact duplicates within the same uploaded file
            $fName = self::normalizeName($record['first_name'] ?? '');
            $lName = self::normalizeName($record['last_name'] ?? '');
            $dDob = self::normalizeDate($record['dob'] ?? '');
            $dDod = self::normalizeDate($record['dod'] ?? '');
            $fileDupKey = ($fName !== '' && $lName !== '' && $dDob !== null && $dDod !== null)
                ? strtolower($fName) . '|' . strtolower($lName) . '|' . $dDob . '|' . $dDod
                : null;

            $duplicateOfRow = ($fileDupKey !== null && isset($seenFileRecords[$fileDupKey]))
                ? $seenFileRecords[$fileDupKey]
                : null;

            if ($fileDupKey !== null && !isset($seenFileRecords[$fileDupKey])) {
                $seenFileRecords[$fileDupKey] = $rowNumber;
            }

            $rows[] = $this->evaluateRow($rowNumber, $record, $duplicateOfRow);
        }
        fclose($handle);

        $summary = ['total' => count($rows), 'ready' => 0, 'needs_review' => 0, 'rejected' => 0];
        foreach ($rows as $row) {
            $summary[$row['status']]++;
        }

        return ['rows' => $rows, 'summary' => $summary];
    }

    private function isValidDate($value) {
        $date = DateTime::createFromFormat('Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value;
    }

    // Mirrors DecedentController's own store()/checkForDuplicates() rules
    // exactly (required fields, dob<=dod, exact-duplicate block, near-
    // duplicate flag) plus resolving a human-readable lot_number, section_name,
    // and block_name to a real lot_id. Never writes anything — purely annotates
    // $record for the frontend's review table.
    private function evaluateRow($rowNumber, $record, $duplicateOfRow = null) {
        $errors = [];
        $warnings = [];

        $isCremated = (strtolower($record['is_cremated'] ?? '') === 'yes') ? 'yes' : 'no';

        // Check required fields for all records
        foreach (self::BASE_REQUIRED_COLUMNS as $field) {
            $val = trim((string) ($record[$field] ?? ''));
            if ($val === '') {
                $errors[] = "Missing " . (self::FIELD_LABELS[$field] ?? $field);
            }
        }

        // Batch 2 (Cremation Alignment): a burial record requires lot & section;
        // a cremation-only record legitimately has no burial lot.
        if ($isCremated !== 'yes') {
            if (empty($record['lot_number'])) {
                $errors[] = "Missing " . self::FIELD_LABELS['lot_number'];
            }
            if (empty($record['section_name'])) {
                $errors[] = "Missing " . self::FIELD_LABELS['section_name'];
            }
        }

        $rawDob = $record['dob'] ?? '';
        $rawDod = $record['dod'] ?? '';
        $dob = self::normalizeDate($rawDob);
        $dod = self::normalizeDate($rawDod);

        if ($rawDob !== '') {
            if ($dob === null) {
                $errors[] = "Date of Birth '{$rawDob}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY)";
            }
        }
        if ($rawDod !== '') {
            if ($dod === null) {
                $errors[] = "Date of Death '{$rawDod}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY)";
            }
        }
        if ($dob !== null && $dod !== null) {
            if (strtotime($dod) < strtotime($dob)) {
                $errors[] = 'Date of Death cannot be before Date of Birth';
            }
        }

        // Batch 2 (Lot Disambiguation): disambiguate lot using section + optional block_name
        $lotId = null;
        $lotNumber = $record['lot_number'] ?? '';
        $sectionName = $record['section_name'] ?? '';
        $blockName = !empty($record['block_name']) ? trim((string) $record['block_name']) : null;

        if (!empty($lotNumber) && !empty($sectionName)) {
            $matches = $this->lotModel->findByNumberAndSection($lotNumber, $sectionName, $blockName);
            if (count($matches) === 0) {
                $blkMsg = $blockName !== null ? " in block '{$blockName}'" : "";
                $errors[] = "No lot '{$lotNumber}' found in section '{$sectionName}'{$blkMsg}";
            } elseif (count($matches) > 1) {
                $matchedBlocks = array_unique(array_filter(array_column($matches, 'block_name')));
                $blkList = !empty($matchedBlocks) ? " (" . implode(', ', $matchedBlocks) . ")" : "";
                $errors[] = "Lot '{$lotNumber}' in section '{$sectionName}' matches more than one block{$blkList} — specify block";
            } else {
                $lotId = (int) $matches[0]['lot_id'];
            }
        }

        $firstName = self::normalizeName($record['first_name'] ?? '');
        $lastName = self::normalizeName($record['last_name'] ?? '');
        $middleName = self::normalizeName($record['middle_name'] ?? null);
        $suffix = trim((string) ($record['suffix'] ?? '')) ?: null;
        $contactName = self::normalizeName($record['contact_name'] ?? null);
        $contactNumber = self::normalizePhone($record['contact_number'] ?? null);
        $causeOfDeath = trim((string) ($record['cause_of_death'] ?? '')) ?: null;
        $ashStorage = trim((string) ($record['ash_storage'] ?? '')) ?: null;

        $data = [
            'lot_id' => $lotId,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'middle_name' => $middleName ?: null,
            'suffix' => $suffix,
            'dob' => $dob ?: $rawDob,
            'dod' => $dod ?: $rawDod,
            'cause_of_death' => $causeOfDeath,
            'contact_name' => $contactName ?: null,
            'contact_number' => $contactNumber,
            'is_cremated' => $isCremated,
            'ash_storage' => $ashStorage,
        ];

        $status = 'ready';

        // Batch 2: in-file duplicate check
        if ($duplicateOfRow !== null) {
            $errors[] = "Duplicate entry within this file (matches row {$duplicateOfRow})";
        }

        $canCheckDuplicates = ($isCremated === 'yes' || $lotId !== null) && $dob !== null && $dod !== null && $firstName !== '' && $lastName !== '';

        if (!empty($errors)) {
            $status = 'rejected';
        } elseif ($canCheckDuplicates) {
            // Only check database once the row is otherwise clean
            $exact = $this->decedentModel->findExactDuplicate($data);
            if ($exact) {
                $status = 'rejected';
                $errors[] = "Exact duplicate of existing record D-{$exact['decedent_id']}";
            } else {
                $near = $this->decedentModel->findNearDuplicates($data);
                if ($near) {
                    $status = 'needs_review';
                    foreach ($near as $candidate) {
                        $warnings[] = "Possible duplicate of D-{$candidate['decedent_id']}: {$candidate['first_name']} {$candidate['last_name']} ({$candidate['dob']} to {$candidate['dod']})";
                    }
                }
            }
        }

        return [
            'row_number' => $rowNumber,
            'data' => $data,
            'lot_number' => $lotNumber,
            'section_name' => $sectionName,
            'block_name' => $blockName ?: '',
            'status' => $status,
            'errors' => $errors,
            'warnings' => $warnings,
        ];
    }

    // Batch J: each row goes through DecedentController::store() itself —
    // not a parallel bulk-insert path — so an import gets the exact same
    // required-field check, dob/dod validation, duplicate guard, and audit
    // log entry as a record entered by hand. A row the frontend marks
    // confirm_duplicate (staff explicitly reviewed a near-duplicate warning
    // and chose to keep it anyway) is passed through as such; an exact
    // duplicate is still unconditionally blocked here exactly like
    // everywhere else in this module. Processes rows independently and
    // sequentially (not wrapped in one all-or-nothing transaction) — a
    // partial import with a clear per-row failure report is the correct
    // outcome for a real-world spreadsheet where most rows are clean and a
    // few aren't, not a reason to reject the whole batch.
    public function confirmImport($rows, $actor = null) {
        $rows = is_array($rows) ? $rows : [];
        if (empty($rows)) {
            return ['error' => 'No rows to import', 'code' => 400];
        }
        if (count($rows) > self::MAX_ROWS) {
            return ['error' => 'Too many rows in a single import', 'code' => 400];
        }

        $imported = 0;
        $failed = [];

        foreach ($rows as $index => $row) {
            $data = is_array($row['data'] ?? null) ? $row['data'] : [];
            if (!empty($row['confirm_duplicate'])) {
                $data['confirm_duplicate'] = true;
            }

            $result = $this->decedentController->store($data, $actor);
            if (!empty($result['success'])) {
                $imported++;
            } else {
                $failed[] = [
                    'row_number' => $row['row_number'] ?? ($index + 1),
                    'error' => $result['error'] ?? ($result['message'] ?? 'Unknown error'),
                ];
            }
        }

        return [
            'success' => true,
            'imported' => $imported,
            'failed' => $failed,
            'message' => "Imported {$imported} of " . count($rows) . ' record(s)',
        ];
    }
}
