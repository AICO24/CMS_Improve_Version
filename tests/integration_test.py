import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

errors = []


def find_php_binary():
    # 1. System PATH
    system_php = shutil.which('php')
    if system_php:
        return system_php

    # 2. Laragon PHP installations
    laragon_bin = Path(r'C:\laragon\bin\php')
    if laragon_bin.exists():
        candidates = list(laragon_bin.glob('**/php.exe'))
        if candidates:
            # Sort descending to pick the newest PHP version
            candidates.sort(reverse=True)
            return str(candidates[0])

    return None


php_bin = find_php_binary()
print(f'Using PHP binary: {php_bin or "NOT FOUND"}')

# ---------------------------------------------------------
# Test 1: Parity between Python and PHP for v_available_lots
# ---------------------------------------------------------
print('Test 1: Testing v_available_lots parity across Python & PHP...')
sys.path.insert(0, str(ROOT / 'python-ai'))

python_lots = []
try:
    import app
    python_lots = app._fetch_available_lots()
    print(f'  Python _fetch_available_lots() fetched {len(python_lots)} lots.')
except Exception as e:
    errors.append(f'Python _fetch_available_lots() failed: {e}')

php_lots = []
if php_bin:
    php_code = (
        "require_once 'backend/bootstrap.php';"
        "require_once 'backend/models/Lot.php';"
        "$lot = new Lot();"
        "echo json_encode($lot->findAvailableLots());"
    )
    result = subprocess.run(
        [php_bin, '-r', php_code],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        errors.append(f'PHP Lot::findAvailableLots() CLI exited with code {result.returncode}: {result.stderr.strip()}')
    else:
        try:
            php_lots = json.loads(result.stdout)
            print(f'  PHP Lot::findAvailableLots() fetched {len(php_lots)} lots.')
        except json.JSONDecodeError as e:
            errors.append(f'Failed to parse JSON output from PHP: {e}\nRaw output: {result.stdout[:200]}')
else:
    errors.append('PHP binary not found; unable to run PHP Lot::findAvailableLots() parity check')

if python_lots and php_lots:
    py_ids = sorted([int(lot['lot_id']) for lot in python_lots if 'lot_id' in lot])
    php_ids = sorted([int(lot['lot_id']) for lot in php_lots if 'lot_id' in lot])
    if py_ids != php_ids:
        errors.append(f'Parity mismatch: Python lot_ids ({len(py_ids)}) != PHP lot_ids ({len(php_ids)})')
    else:
        print(f'  [PASS] 100% parity verified ({len(py_ids)} available lots).')

# ---------------------------------------------------------
# Test 2: Automation Sweeps CLI Execution
# ---------------------------------------------------------
print('Test 2: Testing backend/scripts/run-automation-sweeps.php execution...')
if php_bin:
    sweep_script = ROOT / 'backend' / 'scripts' / 'run-automation-sweeps.php'
    result = subprocess.run(
        [php_bin, str(sweep_script)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        errors.append(f'run-automation-sweeps.php exited with code {result.returncode}: {result.stderr.strip()}')
    else:
        output = result.stdout
        if '=== automation sweep run started ===' not in output:
            errors.append('run-automation-sweeps.php missing start banner in stdout')
        if '=== automation sweep run finished ===' not in output:
            errors.append('run-automation-sweeps.php missing finished banner in stdout')
        if 'lots.expired-sync: lot expiration sync triggered' not in output:
            errors.append('run-automation-sweeps.php did not trigger lots.expired-sync stage')
        print('  [PASS] run-automation-sweeps.php executed cleanly with all stages.')
else:
    errors.append('PHP binary not found; skipping run-automation-sweeps.php execution')

# ---------------------------------------------------------
# Test Results
# ---------------------------------------------------------
if errors:
    print('\nINTEGRATION TESTS FAILED:')
    for err in errors:
        print(f'  - {err}')
    sys.exit(1)

print('\nALL INTEGRATION TESTS PASSED!')
sys.exit(0)

