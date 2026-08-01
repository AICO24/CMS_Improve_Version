# Project Architecture

## Overview
This project is structured as a lightweight full-stack PHP application with a static frontend shell and a PHP API backend.

## Top-Level Structure
- frontend/: user-facing pages, layouts, and assets
- backend/: API entry points, controllers, models, middleware, and routes
- shared/: shared utilities, constants, or common helpers that may be reused across layers
- database/: SQL schema and seed data
- docs/: architecture and deployment notes
- scripts/: maintenance and setup scripts
- tests/: automated tests and fixtures

## Runtime Notes
- Frontend pages are served from the browser and call the backend API endpoints.
- Backend routes are bootstrapped through backend/index.php.
- Database setup scripts live under database/ and backend/database/.
