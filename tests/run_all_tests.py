from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent

TEST_SUITES = [
    {
        'name': 'Smoke Test (Syntax, Routes & Assets)',
        'script': 'tests/smoke_test.py',
        'critical': True,
    },
    {
        'name': 'AI Architecture Regression Test (AI-1 - AI-8 Contracts)',
        'script': 'tests/ai_architecture_regression_test.py',
        'critical': True,
    },
    {
        'name': 'Integration Test (v_available_lots Parity & Sweeps Runner)',
        'script': 'tests/integration_test.py',
        'critical': True,
    },
]


def run_test(suite):
    print(f"\n=======================================================")
    print(f"RUNNING: {suite['name']}")
    print(f"Script:  {suite['script']}")
    print(f"=======================================================")
    start_time = time.time()

    cmd = [sys.executable, str(ROOT / suite['script'])]
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    duration = time.time() - start_time

    print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)

    passed = proc.returncode == 0
    status_str = "PASSED" if passed else "FAILED"
    print(f"RESULT: {status_str} ({duration:.2f}s, exit code {proc.returncode})")
    return {
        'name': suite['name'],
        'passed': passed,
        'duration': duration,
        'returncode': proc.returncode,
    }


def main():
    print(f"Starting Cemetery Management System (CMS) Test Runner...")
    print(f"Root: {ROOT}\n")

    results = []
    overall_passed = True

    for suite in TEST_SUITES:
        res = run_test(suite)
        results.append(res)
        if not res['passed'] and suite['critical']:
            overall_passed = False

    print("\n" + "=" * 60)
    print("                    TEST SUITE SUMMARY")
    print("=" * 60)
    for res in results:
        status_box = "[PASS]" if res['passed'] else "[FAIL]"
        print(f"{status_box:7} {res['name']:<42} ({res['duration']:.2f}s)")
    print("=" * 60)

    if overall_passed:
        print("ALL TEST SUITES PASSED SUCCESSFULLY.")
        sys.exit(0)
    else:
        print("ONE OR MORE TEST SUITES FAILED.")
        sys.exit(1)


if __name__ == '__main__':
    main()

