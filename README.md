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

