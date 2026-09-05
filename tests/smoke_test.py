from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

errors = []

# Backend include path regression
seed_file = ROOT / 'backend' / 'seedData.php'
seed_text = seed_file.read_text(encoding='utf-8')
if "config/database.php" not in seed_text:
    errors.append('backend/seedData.php does not reference the correct database bootstrap path')

# AI controller regression
ai_controller = ROOT / 'backend' / 'controllers' / 'AiController.php'
ai_text = ai_controller.read_text(encoding='utf-8')
for method in ['public function recommend', 'public function forecast', 'public function getParameters', 'public function updateParameter']:
    if method not in ai_text:
        errors.append(f'backend/controllers/AiController.php is missing {method}')

# Frontend asset resolution regression
for html_file in sorted((ROOT / 'frontend' / 'pages').glob('*.html')):
    text = html_file.read_text(encoding='utf-8')
    for match in re.finditer(r'''(?:href|src)=["']([^"']+)["']''', text):
        ref = match.group(1)
        if not ref.startswith(('http://', 'https://', 'mailto:', 'tel:', 'javascript:')) and ('assets/' in ref or 'assets' in ref):
            clean_ref = ref.split('?')[0].split('#')[0]
            resolved = (html_file.parent / clean_ref).resolve()
            if not resolved.exists():
                errors.append(f'{html_file.relative_to(ROOT)} references missing asset: {ref}')

landing_page = ROOT / 'frontend' / 'index.html'
landing_text = landing_page.read_text(encoding='utf-8')
if 'href="../assets/css/landingpage.css"' not in landing_text and 'href="/CMS/assets/css/landingpage.css"' not in landing_text:
    errors.append('frontend/index.html still points at an incorrect landing page stylesheet path')

# Authentication redirect regression
auth_login_js = ROOT / 'assets' / 'js' / 'auth' / 'login.js'
auth_login_text = auth_login_js.read_text(encoding='utf-8')
shared_api_js = ROOT / 'assets' / 'js' / 'shared' / 'api.js'
shared_api_text = shared_api_js.read_text(encoding='utf-8')
if 'function getFrontendBasePath' in auth_login_text:
    errors.append('assets/js/auth/login.js redeclares getFrontendBasePath, which shadows and breaks the shared helper (infinite recursion)')
if 'function getRoleDashboardPath' not in shared_api_text:
    errors.append('assets/js/shared/api.js is missing the shared role-dashboard helper')
if 'pages/dashboard_admin.html' not in shared_api_text:
    errors.append('assets/js/shared/api.js does not redirect admins to the canonical admin dashboard path')
if 'getRoleDashboardPath' not in auth_login_text:
    errors.append('assets/js/auth/login.js is not using the shared role-dashboard helper')

for page_script, expected_fragments in [
    (ROOT / 'assets' / 'js' / 'auth' / 'login.js', ['getRoleDashboardPath']),
    (ROOT / 'assets' / 'js' / 'auth' / 'register.js', ['getFrontendBasePath']),
    (ROOT / 'assets' / 'js' / 'pages' / 'dashboard_admin.js', ['requireRole', 'auth/login.html']),
    (ROOT / 'assets' / 'js' / 'pages' / 'dashboard_staff.js', ['requireRole', 'auth/login.html']),
    (ROOT / 'assets' / 'js' / 'pages' / 'dashboard_user.js', ['requireRole', 'dashboard_admin.html']),
]:
    script_text = page_script.read_text(encoding='utf-8')
    if not any(frag in script_text for frag in expected_fragments):
        errors.append(f'{page_script.relative_to(ROOT)} is not using the shared auth/role protection logic')

for page_html in sorted((ROOT / 'frontend' / 'pages').glob('*.html')):
    html_text = page_html.read_text(encoding='utf-8')
    if re.search(r'href="\.\./(admin|staff|user)/', html_text):
        errors.append(f'{page_html.relative_to(ROOT)} still links into the legacy admin/staff/user page tree')

for lot_script in [
    ROOT / 'assets' / 'js' / 'pages' / 'lot-management.js',
    ROOT / 'assets' / 'js' / 'pages' / 'burial-scheduling.js',
    ROOT / 'assets' / 'js' / 'pages' / 'reserve-burial-slot.js',
    ROOT / 'assets' / 'js' / 'pages' / 'reports.js',
    ROOT / 'assets' / 'js' / 'pages' / 'payments.js',
    ROOT / 'assets' / 'js' / 'pages' / 'forecast.js',
    ROOT / 'assets' / 'js' / 'pages' / 'expiration-monitoring.js',
    ROOT / 'assets' / 'js' / 'pages' / 'relocation-management.js',
]:
    lot_text = lot_script.read_text(encoding='utf-8')
    if 'requireRole' not in lot_text and 'createBookingWizard' not in lot_text and 'auth/login.html' not in lot_text:
        errors.append(f'{lot_script.relative_to(ROOT)} does not enforce route authentication')

# Shared v_available_lots view contract regression
lot_model = ROOT / 'backend' / 'models' / 'Lot.php'
lot_model_text = lot_model.read_text(encoding='utf-8')
if 'function findAvailableLots' not in lot_model_text or 'v_available_lots' not in lot_model_text:
    errors.append('backend/models/Lot.php is missing findAvailableLots() or does not query v_available_lots')

python_ai_app = ROOT / 'python-ai' / 'app.py'
python_ai_text = python_ai_app.read_text(encoding='utf-8')
if 'v_available_lots' not in python_ai_text:
    errors.append('python-ai/app.py does not reference the shared v_available_lots view')

# Automation sweeps CLI script regression
sweep_script = ROOT / 'backend' / 'scripts' / 'run-automation-sweeps.php'
if not sweep_script.exists():
    errors.append('backend/scripts/run-automation-sweeps.php does not exist')
else:
    sweep_text = sweep_script.read_text(encoding='utf-8')
    if "PHP_SAPI !== 'cli'" not in sweep_text:
        errors.append('backend/scripts/run-automation-sweeps.php is missing CLI SAPI enforcement')

if errors:
    print('SMOKE TEST FAILED')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('SMOKE TEST PASSED')
