# Cemetery Management System (CMS) — Smart Burial Scheduling & Operations

The **Cemetery Management System (CMS)** is a full-stack web application and AI-assisted operations platform designed for cemetery administrators, staff, and citizens (bereaved families and pre-need lot buyers). Its main objectives are to centralize spatial cemetery lot and columbarium niche mapping, streamline at-need burial/cremation scheduling and pre-need reservations, automate documentary and online payment verification (via PayMongo), and provide intelligent decision support through ARIMA capacity forecasting and AI-guided lot recommendations.

---

## Group Members & Roles (Team CodeRebels)
* **Mikaela Mayumi Salas** – Project Manager
* **Manolo Jr. A. Gochaico** – Lead Fullstack Developer / Main Programmer
* **John Eric Gabayan** – Fullstack Developer / Database Administrator
* **Trisha Ann Loraine G. Giray** – Frontend / UI-UX Designer
* **Celina H. Buenaventura** – Documentation Lead

---

## Tech Stack
* **Frontend:** HTML5, CSS3 (Custom Design Tokens & Responsive Dark/Light Theme), Vanilla JavaScript (ES6+ Modular Architecture), FontAwesome 6, SVG Interactive Cemetery Mapping
* **Backend:** Native PHP 8.x (Custom MVC/Service REST API Architecture, PDO Database Layer, Custom HS256 JWT Authentication with Stateful Session Versioning, PayMongo Payment Gateway API)
* **AI & Forecasting Microservice:** Python 3.10+, Flask, Scikit-Learn (Cosine Similarity Lot Recommendation), Statsmodels & Pandas/NumPy (ARIMA Burial Capacity Forecasting), Google Gemini API (`google-genai`) & Groq API Fallback (Conversational Booking Assistant & Document Vision OCR)
* **Database:** MySQL 8.0+ / MariaDB 10.4+ (`cemetery_db`)
* **Tools & Version Control:** Git, GitHub, VS Code, Laragon / XAMPP, Postman

---

## System Requirements & Prerequisites
Before you begin, ensure you have the following installed on your local machine:
* **XAMPP** or **Laragon** (with **Apache 2.4+** and **MySQL 8.0+ / MariaDB 10.4+**)
* **PHP (v8.1 or higher)** with `pdo_mysql`, `curl`, `mbstring`, `openssl`, and `gd`/`fileinfo` extensions enabled
* **Python (v3.10 or higher)** and `pip` (required for the AI Recommendation, Chatbot, and ARIMA Capacity Forecasting microservice)
* **Git** (for cloning the repository)

---

## Installation & Setup Instructions

Follow these step-by-step commands to set up the project locally:

### 1. Clone the Repository
Navigate to your local web server's document root (`C:\xampp\htdocs\` for XAMPP or `C:\laragon\www\` for Laragon) and clone the repository into a folder named `CMS`:

```bash
git clone https://github.com/AICO24/CMS_Improve_Version.git CMS
cd CMS
```

### 2. Initialize Runtime Directories & Environment Files
```bash
# Create required local upload and log directories (Windows):
scripts\setup.bat

# Copy the root environment configuration template:
cp .env.example .env

# Copy the Python AI microservice environment template:
cp python-ai/.env.example python-ai/.env
```

### 3. Install Python AI Microservice Dependencies
```bash
cd python-ai
python -m venv venv

# Activate the virtual environment (Windows):
venv\Scripts\activate

# Install required Python packages:
pip install -r requirements.txt
cd ..
```
*(Note: On Windows, running `python-ai\run.bat` will also automatically create the virtual environment and install `requirements.txt` for you.)*

---

## Database Setup & Configuration

Follow these steps to configure your local database:

1. **Start your local database server:**
   * Open **XAMPP** or **Laragon** and start both **Apache** and **MySQL / MariaDB**.
2. **Create a new database:**
   * Open **phpMyAdmin** (`http://localhost/phpmyadmin`) or your preferred SQL client (HeidiSQL / MySQL Workbench).
   * Create a new database named: `cemetery_db` (UTF-8 / `utf8mb4_general_ci`).
3. **Import the Database Schema:**
   * Locate the primary SQL schema inside the repository under `/backend/database/schema.sql`.
   * Import `backend/database/schema.sql` into your newly created `cemetery_db` database.
   * Apply any incremental migration scripts in `/backend/database/migration_*.sql` in chronological filename order (or import `/backend/database/reset_demo_data_20260826.sql` for baseline lot catalog fixtures).
4. **Configure Environment Variables:**
   * Open the `.env` file in the root directory (`CMS/.env`) and update your database connection and local seeding settings:
     ```env
     DB_HOST=127.0.0.1
     DB_PORT=3306
     DB_NAME=cemetery_db
     DB_USER=root
     DB_PASS=

     JWT_SECRET=cemetery-super-secret-key-change-this
     APP_ENV=local
     SEED_DEFAULT_USERS=true
     CORS_ALLOWED_ORIGINS=http://localhost

     # Optional: PayMongo Sandbox Keys (for online checkout testing)
     PAYMONGO_ENV=test
     PAYMONGO_PUBLIC_KEY=
     PAYMONGO_SECRET_KEY=
     PAYMONGO_WEBHOOK_SECRET=
     ```
   * Open `python-ai/.env` and ensure its database credentials match your root `.env`:
     ```env
     DB_HOST=127.0.0.1
     DB_PORT=3306
     DB_NAME=cemetery_db
     DB_USER=root
     DB_PASSWORD=
     PORT=5000

     # Optional: Google Gemini / Groq API keys for LLM Q&A and OCR features
     GEMINI_API_KEY=
     AI_PROVIDER=gemini
     GROQ_API_KEY=
     ```

---

## Running the Application

### 1. Start the Web & Database Server (PHP + MySQL)
Ensure **Apache** and **MySQL** are running in **XAMPP** or **Laragon**.

### 2. Start the Python AI & Forecasting Microservice (Optional but Recommended)
To enable the **ARIMA Capacity Forecast**, **Cosine Similarity Lot Recommendation**, and **AI Booking Assistant**, start the Flask service in a terminal:

```bash
# On Windows:
cd python-ai
run.bat

# On macOS / Linux:
cd python-ai
./run.sh
```
The AI microservice will run on `http://127.0.0.1:5000` (verify health at `http://127.0.0.1:5000/api/health`). If the Python service is not running, the main PHP application still runs normally and degrades AI features gracefully.

### 3. Open the Application in Your Browser
Navigate to:
* **Landing Page:** `http://localhost/CMS/` (or `http://localhost/CMS/frontend/index.html`)
* **Login Portal:** `http://localhost/CMS/frontend/auth/login.html`

---

## Default Login Credentials (If applicable)

When `APP_ENV=local` and `SEED_DEFAULT_USERS=true` are set in your `.env` file, the system automatically seeds and verifies the following default accounts upon your first login attempt:

* **Admin Account:**
  * **Username / Email:** `admin` or `admin@cemetery.com`
  * **Password:** `admin123`
  * **Role Selection:** Administrator
* **Staff Account:**
  * **Username / Email:** `staff` or `staff@cemetery.com`
  * **Password:** `staff123`
  * **Role Selection:** Staff
* **Citizen / Client Account:**
  * Citizens can self-register directly via the Registration page (`http://localhost/CMS/frontend/auth/register.html`) by selecting the **User / Citizen** role on login.
