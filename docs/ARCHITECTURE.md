# Project Architecture

## Overview
This project is structured as a lightweight full-stack PHP application with a static frontend shell and a PHP API backend.

## Top-Level Structure
- frontend/: user-facing pages, layouts, and assets
- backend/: API entry points, controllers, models, middleware, and routes
- docs/: architecture and deployment notes
- scripts/: maintenance and setup scripts
- tests/: automated tests and fixtures

## Runtime Notes
- Frontend pages are served from the browser and call the backend API endpoints.
- Backend routes are bootstrapped through backend/index.php.
- Database setup scripts (schema, migrations, seed data) live under backend/database/ and backend/seedData.php.
