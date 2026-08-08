# Cemetery Management System

A full-stack PHP web application for cemetery and lot management.

## Project Structure
- frontend/: presentation layer, with auth/ (login, register) and pages/ (all role-based dashboards and features)
- backend/: PHP API entry points, controllers, models, middleware, services, and database schema/migrations
- docs/: architecture and project documentation
- scripts/: setup and maintenance scripts
- tests/: automated tests and fixtures

## Run Locally
- Start Apache and MySQL in XAMPP.
- Set up the database — see "Database Setup" below.
- Open http://localhost/CMS/frontend/index.html or the login page directly.
- Run the setup helper from scripts/setup.bat if you need runtime folders created.

## Database Setup
1. Create a database (default name `cemetery_db`, configurable via `backend/.env` — see `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASS` in `backend/services/EnvironmentService.php`).
2. Import `backend/database/schema.sql` — this is the full structure baseline.
3. Apply every `backend/database/migration_*.sql` file, in filename (date) order. Each one is idempotent to run once and is tracked in the `schema_migrations` table it creates (see `migration_20260807_add_schema_migrations_tracking.sql`).
4. See `docs/database.md` for the live table list and the convention for adding new migrations.

## AI / Capacity Forecasting Service (python-ai)
The "Capacity Forecast" page (admin) and lot-recommendation feature depend on a separate Flask microservice — it is **not** started automatically by XAMPP/Apache.
1. `cd python-ai`
2. Run `run.bat` (Windows) or `run.sh` (macOS/Linux) — creates a venv, installs `requirements.txt`, and starts the service on `http://127.0.0.1:5000` (configurable via `python-ai/.env`).
3. Verify it's up: `GET http://127.0.0.1:5000/api/health`, or check the "AI Configuration" page in the admin dashboard, which shows live service status.
4. If this service is not running, `ai/forecast` and `ai/recommend` degrade gracefully (the PHP API and frontend both detect and report the outage instead of failing silently) — but no real forecast or recommendation data is available until it's started.

