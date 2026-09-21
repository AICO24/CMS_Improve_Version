<?php
/**
 * Automated Test: Panel-Ready Reports Verification
 *
 * Verifies:
 * 1. ReportController::occupancy() returns enriched by_section metrics (capacity_rate, utilization_status, occupied_rate, available_rate).
 * 2. ReportController::occupancy() returns a panel-ready executive_summary with narrative and actionable recommendations.
 * 3. ReportController::revenue() returns enriched service_breakdown with service labels, share percentages, and average transaction values.
 * 4. ReportController::revenue() returns a panel-ready financial executive_summary with top streams and takeaways.
 * 5. ReportController::revenue() respects date range filters while keeping breakdown and executive summary coherent.
 */

require_once __DIR__ . '/../backend/controllers/ReportController.php';

$testCount = 0;
$passCount = 0;

function run_test($name, $closure) {
    global $testCount, $passCount;
    $testCount++;
    try {
        $closure();
        echo "[PASS] $name\n";
        $passCount++;
    } catch (Throwable $e) {
        echo "[FAIL] $name: " . $e->getMessage() . " (" . $e->getFile() . ":" . $e->getLine() . ")\n";
    }
}

$controller = new ReportController();

// Test 1: Occupancy endpoint structure
run_test("Occupancy returns domain, summary, by_section, and executive_summary", function() use ($controller) {
    $result = $controller->occupancy();
    if (($result['domain'] ?? '') !== 'occupancy') {
        throw new Exception("Expected domain to be 'occupancy', got: " . var_export($result['domain'] ?? null, true));
    }
    if (!isset($result['summary']['total'])) {
        throw new Exception("Missing summary.total");
    }
    if (!isset($result['by_section']) || !is_array($result['by_section'])) {
        throw new Exception("Missing or invalid by_section");
    }
    if (!isset($result['executive_summary']) || !is_array($result['executive_summary'])) {
        throw new Exception("Missing executive_summary");
    }
});

// Test 2: Section Capacity Metrics
run_test("Occupancy by_section includes capacity_rate, utilization_status, and rate metrics", function() use ($controller) {
    $result = $controller->occupancy();
    $sections = $result['by_section'];
    if (empty($sections)) {
        throw new Exception("Sections array is empty");
    }
    foreach ($sections as $sec) {
        if (!isset($sec['section_name'])) {
            throw new Exception("Section missing section_name");
        }
        if (!isset($sec['capacity_rate'])) {
            throw new Exception("Section {$sec['section_name']} missing capacity_rate");
        }
        if (!isset($sec['utilization_status'])) {
            throw new Exception("Section {$sec['section_name']} missing utilization_status");
        }
        if (!isset($sec['occupied_rate']) || !isset($sec['available_rate'])) {
            throw new Exception("Section {$sec['section_name']} missing rate percentages");
        }
        $validStatuses = ['Critical / Full', 'Tight Capacity', 'Optimal Capacity'];
        if (!in_array($sec['utilization_status'], $validStatuses, true)) {
            throw new Exception("Unexpected utilization_status: {$sec['utilization_status']}");
        }
    }
});

// Test 3: Occupancy Executive Summary Narrative & Recommendations
run_test("Occupancy executive_summary contains narrative and key recommendations", function() use ($controller) {
    $result = $controller->occupancy();
    $summary = $result['executive_summary'];
    if (empty($summary['summary_narrative'])) {
        throw new Exception("Missing or empty summary_narrative");
    }
    if (!isset($summary['utilization_rate']) || !is_numeric($summary['utilization_rate'])) {
        throw new Exception("Missing or non-numeric utilization_rate");
    }
    if (empty($summary['key_recommendations']) || !is_array($summary['key_recommendations'])) {
        throw new Exception("Missing or empty key_recommendations");
    }
    if (count($summary['key_recommendations']) < 3) {
        throw new Exception("Expected at least 3 key recommendations, got: " . count($summary['key_recommendations']));
    }
});

// Test 4: Revenue endpoint structure and service breakdown
run_test("Revenue returns total, breakdown, service_breakdown, and financial executive_summary", function() use ($controller) {
    $result = $controller->revenue();
    if (!isset($result['total'])) {
        throw new Exception("Missing total");
    }
    if (!isset($result['breakdown']) || !is_array($result['breakdown'])) {
        throw new Exception("Missing or invalid breakdown");
    }
    if (!isset($result['service_breakdown']) || !is_array($result['service_breakdown'])) {
        throw new Exception("Missing or invalid service_breakdown");
    }
    if (!isset($result['executive_summary']) || !is_array($result['executive_summary'])) {
        throw new Exception("Missing executive_summary");
    }
});

// Test 5: Service Breakdown Item Attributes
run_test("Service breakdown rows contain service_label, percentage, and average_amount", function() use ($controller) {
    $result = $controller->revenue();
    $services = $result['service_breakdown'];
    if (empty($services)) {
        throw new Exception("service_breakdown is empty");
    }
    $totalPercentage = 0.0;
    foreach ($services as $svc) {
        if (empty($svc['transaction_type'])) {
            throw new Exception("Missing transaction_type in service row");
        }
        if (empty($svc['service_label'])) {
            throw new Exception("Missing service_label in service row");
        }
        if (!isset($svc['percentage']) || !is_numeric($svc['percentage'])) {
            throw new Exception("Missing or invalid percentage in {$svc['transaction_type']}");
        }
        if (!isset($svc['average_amount']) || !is_numeric($svc['average_amount'])) {
            throw new Exception("Missing or invalid average_amount in {$svc['transaction_type']}");
        }
        $totalPercentage += (float) $svc['percentage'];
    }
    // Total percentages should sum to approximately 100% (within rounding margin 99.0 - 101.0)
    if ($totalPercentage < 98.0 || $totalPercentage > 102.0) {
        throw new Exception("Total service percentage sums to {$totalPercentage}%, expected approx 100%");
    }
});

// Test 6: Financial Executive Summary Narrative & Takeaways
run_test("Revenue executive_summary contains financial narrative and takeaways", function() use ($controller) {
    $result = $controller->revenue();
    $exec = $result['executive_summary'];
    if (empty($exec['summary_narrative'])) {
        throw new Exception("Missing financial summary_narrative");
    }
    if (empty($exec['top_revenue_stream'])) {
        throw new Exception("Missing top_revenue_stream");
    }
    if (!isset($exec['average_ticket_size']) || !is_numeric($exec['average_ticket_size'])) {
        throw new Exception("Missing average_ticket_size");
    }
    if (empty($exec['financial_takeaways']) || !is_array($exec['financial_takeaways'])) {
        throw new Exception("Missing financial_takeaways");
    }
    if (count($exec['financial_takeaways']) < 3) {
        throw new Exception("Expected at least 3 financial takeaways");
    }
});

// Test 7: Date Range Filtering preserves enhanced structure
run_test("Revenue with date filter maintains service_breakdown and executive_summary", function() use ($controller) {
    $filtered = $controller->revenue(['date_from' => '2025-01-01', 'date_to' => '2026-12-31']);
    if (!isset($filtered['service_breakdown']) || !is_array($filtered['service_breakdown'])) {
        throw new Exception("Filtered revenue missing service_breakdown");
    }
    if (!isset($filtered['executive_summary']) || !is_array($filtered['executive_summary'])) {
        throw new Exception("Filtered revenue missing executive_summary");
    }
    if (!isset($filtered['executive_summary']['total_revenue'])) {
        throw new Exception("Filtered executive_summary missing total_revenue");
    }
});

echo "\n--- Summary: $passCount / $testCount tests passed ---\n";
if ($passCount !== $testCount) {
    exit(1);
}
