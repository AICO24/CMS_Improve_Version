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
            resolved = (html_file.parent / ref).resolve()
            if not resolved.exists():
                errors.append(f'{html_file.relative_to(ROOT)} references missing asset: {ref}')

landing_page = ROOT / 'frontend' / 'index.html'
landing_text = landing_page.read_text(encoding='utf-8')
if 'href="../assets/css/landingpage.css"' not in landing_text and 'href="/CMS/assets/css/landingpage.css"' not in landing_text:
    errors.append('frontend/index.html still points at an incorrect landing page stylesheet path')

if errors:
    print('SMOKE TEST FAILED')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('SMOKE TEST PASSED')
