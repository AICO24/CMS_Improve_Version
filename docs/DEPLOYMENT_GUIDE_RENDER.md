# 🚀 Deployment Guide: Docker & Render.com (May Libreng TiDB MySQL Database)

Gabay para mai-deploy ang **Cemetery Management System (CMS)** sa **Render.com** gamit ang **Docker** at libreng cloud MySQL database (**TiDB Cloud Serverless**).

---

## 📌 Bakit Kailangan ng TiDB Cloud MySQL?
1. **Walang Libreng MySQL ang Render**: Ang libreng database sa Render ay PostgreSQL lamang.
2. **Naka-block ang InfinityFree Remote Access**: Hindi puwedeng kumonekta ang Render sa InfinityFree database (`sql210.infinityfree.com`) dahil naka-block ang remote port 3306 sa free tier nila.
3. **TiDB Cloud Serverless**: 
   - 100% Libre (Free 5GB storage, walang expiry).
   - Ganap na MySQL 8.0 compatible.
   - Puwedeng kumonekta ang Render mula sa kahit saang IP via secure TLS/SSL.
   - Walang kailangang credit card.

---

## 🛠️ Hakbang 1: Gumawa ng Libreng TiDB Cloud MySQL Database (2 minuto)

1. Pumunta sa [https://tidbcloud.com/](https://tidbcloud.com/) at mag-sign up / log in (puwedeng gamitin ang Google/GitHub account).
2. Piliin ang **Serverless** (Free Tier).
3. Piliin ang Region: **Singapore (AWS `ap-southeast-1`)** para mabilis at mababa ang latency mula sa Pilipinas.
4. I-click ang **Create Cluster**.
5. Pagkatapos mag-create, lalabas ang iyong Connection Details:
   - **Host**: (Halimbawa: `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`)
   - **Port**: `4000`
   - **User**: (Halimbawa: `3gxxxxxx.root`)
   - **Password**: (I-click ang *Generate Password* at kopyahin/i-save ito sa Notepad)
   - **Database Name**: `cemetery_db`

---

## 🗄️ Hakbang 2: I-import ang Database Schema sa TiDB Cloud

May dalawang madaling paraan para ma-import ang database:

### Paraan A: Gamit ang TiDB Cloud Web SQL Editor (Pinakamadali)
1. Sa TiDB Cloud Console, i-click ang tab na **SQL Editor** (o Chat2Query).
2. Patakbuhin muna ang command na ito para gawin ang database:
   ```sql
   CREATE DATABASE IF NOT EXISTS cemetery_db;
   USE cemetery_db;
   ```
3. Buksan ang file na [database_for_infinityfree.sql](file:///c:/laragon/www/CMS/database_for_infinityfree.sql) sa iyong editor, kopyahin ang nilalaman nito (o buksan sa text editor), at i-paste sa SQL Editor sa TiDB Cloud, pagkatapos ay i-click ang **Run**.

### Paraan B: Gamit ang HeidiSQL / Laragon / DBeaver
1. Buksan ang HeidiSQL / DBeaver sa iyong computer.
2. Gumawa ng bagong session:
   - **Network type**: MySQL (TCP/IP)
   - **Hostname**: (TiDB Host mula sa Hakbang 1)
   - **User**: (TiDB User mula sa Hakbang 1)
   - **Password**: (TiDB Password)
   - **Port**: `4000`
   - **SSL**: Check / Enable SSL
3. Mag-connect, gumawa ng database na `cemetery_db`, at i-run ang `database_for_infinityfree.sql`.

---

## 📤 Hakbang 3: I-commit at I-push ang Bagong Config sa GitHub

Ang mga sumusunod na files ay nai-update na para sa Render & Docker:
- `Dockerfile` (Dynamic `$PORT` binding, SSL certificates, storage folder permissions)
- `backend/config/Database.php` (May support para sa secure SSL connections)
- `backend/services/AIService.php` (Configurable `AI_SERVICE_URL`)
- `render.yaml` (Render service blueprint)
- `.dockerignore` (Excluded unnecessary files)

Patakbuhin sa iyong terminal:
```bash
git add Dockerfile .dockerignore render.yaml backend/config/Database.php backend/services/AIService.php docs/DEPLOYMENT_GUIDE_RENDER.md
git commit -m "Configure Docker, SSL database, and Render deployment"
git push origin main
```

---

## 🌐 Hakbang 4: I-deploy sa Render.com

1. Pumunta sa [https://render.com/](https://render.com/) at mag-sign in gamit ang iyong GitHub account.
2. Sa Dashboard, i-click ang **New +** button sa kanang itaas at piliin ang **Web Service**.
3. Piliin ang iyong GitHub repository: **`AICO24/CMS_Improve_Version`** (o `CMS`).
4. Ilagay ang mga detalye:
   - **Name**: `cemetery-management-system` (o anumang pangalan na nais mo)
   - **Region**: `Singapore (Southeast Asia)`
   - **Language / Runtime**: Piliin ang **Docker**
   - **Instance Type**: Piliin ang **Free**
5. Mag-scroll pababa sa **Environment Variables** section at i-click ang **Add Environment Variable** para sa bawat isa:

| Key | Value | Paliwanag |
|---|---|---|
| `APP_ENV` | `production` | Naka-production mode ang app |
| `DB_HOST` | *(TiDB Host)* | Host mula sa TiDB Cloud |
| `DB_PORT` | `4000` | Port ng TiDB Cloud (4000) |
| `DB_NAME` | `cemetery_db` | Pangalan ng database |
| `DB_USER` | *(TiDB User)* | User mula sa TiDB Cloud |
| `DB_PASS` | *(TiDB Password)* | Password mula sa TiDB Cloud |
| `DB_SSL` | `true` | Ino-on ang secure TLS connection |
| `JWT_SECRET` | `palitan_ito_ng_kahit_anong_mahaba_at_random_na_string_12345` | Security key para sa JWT |
| `JWT_EXPIRY` | `28800` | 8 hours session expiry |
| `JWT_REMEMBER_EXPIRY` | `2592000` | 30 days remember-me |
| `SEED_DEFAULT_USERS` | `false` | Hindi na kailangan dahil may seed data na sa SQL |
| `CORS_ALLOWED_ORIGINS` | `*` | Pinapayagan ang API requests |

*(Opsyonal: Kung gagamitin ang PayMongo, ilagay din ang `PAYMONGO_ENV=test`, `PAYMONGO_PUBLIC_KEY`, at `PAYMONGO_SECRET_KEY`)*.

6. I-click ang **Create Web Service** sa pinakailalim ng pahina!

---

## ⏳ Hakbang 5: Pag-monitor at Pag-verify

1. Sa Render Dashboard, makikita mo ang **Build Logs**:
   - I-da-download ng Render ang base image na `php:8.2-apache`.
   - I-i-install ang `ca-certificates` at `pdo_mysql`.
   - I-ko-kopya ang source code at i-se-set ang tamang permissions.
   - Pagsapit ng mensaheng `==> Your service is live 🎉`, ibibigay ng Render ang iyong libreng live URL (halimbawa: `https://cemetery-management-system.onrender.com`).
2. Buksan ang URL sa iyong browser:
   - Awtomatikong magre-redirect ang root papunta sa `frontend/index.html`.
   - Subukang mag-login gamit ang iyong mga credentials (Admin / Staff / Citizen).
   - I-test ang booking, reservations, at decedent search upang makitang kumokonekta nang maayos sa TiDB MySQL.

---

## 💡 Paalala sa Render Free Tier
- **Spin Down on Idle**: Sa Render Free tier, kapag walang bisita sa loob ng 15 minuto, magi-sleep pansamantala ang container. Kapag may nagbukas ulit ng website, aabutin ito ng humigit-kumulang 30-50 segundo bago mag-spin up muli. Normal na pag-uugali ito ng free tier ng Render.
