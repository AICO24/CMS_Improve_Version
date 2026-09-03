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

    private const REQUIRED_COLUMNS = ['first_name', 'last_name', 'dob', 'dod', 'lot_number', 'section_name'];

    // Human-readable labels for every error/warning message this controller
    // builds — staff reviewing the import preview should never see a raw
    // snake_case column key like "first_name" in plain sentence text; the
    // CSV template itself is the only place those exact spellings matter.
    private const FIELD_LABELS = [
        'first_name' => 'First Name',
        'last_name' => 'Last Name',
        'dob' => 'Date of Birth',
        'dod' => 'Date of Death',
        'lot_number' => 'Lot Number',
        'section_name' => 'Section',
    ];

    public function __construct() {
        $this->decedentModel = new Decedent();
        $this->lotModel = new Lot();
        $this->decedentController = new DecedentController();
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
        $header = array_map(function ($col) {
            return strtolower(trim((string) $col));
        }, $header);

        $missingColumns = array_diff(self::REQUIRED_COLUMNS, $header);
        if (!empty($missingColumns)) {
            fclose($handle);
            return ['error' => 'Missing required column(s): ' . implode(', ', $missingColumns), 'code' => 400];
        }

        $rows = [];
        $rowNumber = 1; // the header itself is row 1, so the first data row is 2 — matches what staff sees if they open the file in a spreadsheet app.
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
            foreach ($header as $i => $col) {
                $record[$col] = isset($line[$i]) ? trim((string) $line[$i]) : '';
            }
            $rows[] = $this->evaluateRow($rowNumber, $record);
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
    // duplicate flag) plus the one thing unique to a spreadsheet import:
    // resolving a human-readable "lot_number in section_name" to a real
    // lot_id. Never writes anything — purely annotates $record for the
    // frontend's review table.
    private function evaluateRow($rowNumber, $record) {
        $errors = [];
        $warnings = [];

        foreach (self::REQUIRED_COLUMNS as $field) {
            if (empty($record[$field])) {
                $errors[] = "Missing " . self::FIELD_LABELS[$field];
            }
        }

        $dob = $record['dob'] ?? '';
        $dod = $record['dod'] ?? '';
        if ($dob !== '' && $dod !== '') {
            if (!$this->isValidDate($dob)) {
                $errors[] = "Date of Birth '{$dob}' is not a valid date (use YYYY-MM-DD)";
            }
            if (!$this->isValidDate($dod)) {
                $errors[] = "Date of Death '{$dod}' is not a valid date (use YYYY-MM-DD)";
            }
            if (empty($errors) && strtotime($dod) < strtotime($dob)) {
                $errors[] = 'Date of Death cannot be before Date of Birth';
            }
        }

        $lotId = null;
        if (!empty($record['lot_number']) && !empty($record['section_name'])) {
            $matches = $this->lotModel->findByNumberAndSection($record['lot_number'], $record['section_name']);
            if (count($matches) === 0) {
                $errors[] = "No lot '{$record['lot_number']}' found in section '{$record['section_name']}'";
            } elseif (count($matches) > 1) {
                $errors[] = "Lot '{$record['lot_number']}' in section '{$record['section_name']}' matches more than one block — ambiguous";
            } else {
                $lotId = (int) $matches[0]['lot_id'];
            }
        }

        $data = [
            'lot_id' => $lotId,
            'first_name' => $record['first_name'] ?? '',
            'last_name' => $record['last_name'] ?? '',
            'middle_name' => $record['middle_name'] ?? null,
            'suffix' => $record['suffix'] ?? null,
            'dob' => $dob,
            'dod' => $dod,
            'cause_of_death' => $record['cause_of_death'] ?? null,
            'contact_name' => $record['contact_name'] ?? null,
            'contact_number' => $record['contact_number'] ?? null,
            'is_cremated' => (strtolower($record['is_cremated'] ?? '') === 'yes') ? 'yes' : 'no',
            'ash_storage' => $record['ash_storage'] ?? null,
        ];

        $status = 'ready';
        if (!empty($errors)) {
            $status = 'rejected';
        } elseif ($lotId !== null) {
            // Only worth checking once the row is otherwise clean — an
            // unresolved lot or bad dates already blocks the row regardless
            // of whether it also happens to look like a duplicate.
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
            'lot_number' => $record['lot_number'] ?? '',
            'section_name' => $record['section_name'] ?? '',
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
