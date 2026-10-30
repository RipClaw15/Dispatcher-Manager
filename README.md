# Dispatch — shipment management

Django / Django REST Framework, React with JavaScript, and PostgreSQL. The approved business design is in [docs/approved-design.md](docs/approved-design.md).

## Local development (Windows)

The development database runs inside this project on **127.0.0.1:55432**. It does not install a Windows service. Runtime files, secrets, uploads and dependency caches are git-ignored.

This workspace has been set up with a virtual environment, dependencies and local PostgreSQL. To start it again:

```powershell
.\.venv\Scripts\python.exe tools/dev.py start
```

Open **http://127.0.0.1:5173**. Development account credentials are in **.local/demo-credentials.json**. Manager and dispatcher accounts are separate. Sample business records are explicitly labelled as demo data.

Server logs: **.local/backend.log** and **.local/frontend.log**.

Use **tools/dev.py restart** after backend changes, **tools/dev.py status** to check the servers, and **tools/dev.py stop** to stop them. The helper verifies each recorded process still belongs to this project before stopping it.

### Fresh setup

1. Install Python 3.14 and Node.js 24 (or compatible supported versions).
2. Create the environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm.cmd --prefix frontend ci
```

3. Either configure your PostgreSQL connection in **backend/.env** using **.env.example**, or download the official [EDB PostgreSQL Windows binary archive](https://www.enterprisedb.com/download-postgresql-binaries) into **.cache/postgresql-windows.zip**, then run:

```powershell
.\.venv\Scripts\python.exe tools/local_db.py setup
```

4. Apply migrations and optionally add development-only demo data:

```powershell
.\.venv\Scripts\python.exe backend/manage.py migrate
.\.venv\Scripts\python.exe backend/manage.py seed_demo
```

For a clean workspace without sample bookings, create the first manager using:

```powershell
.\.venv\Scripts\python.exe backend/manage.py createsuperuser
```

The business Manager role is separate from Django's technical administration flags. Accounts created in the app receive business roles without superuser permissions.

### Running servers in terminals

```powershell
.\.venv\Scripts\python.exe backend/manage.py runserver 127.0.0.1:8000
```

In another terminal:

```powershell
npm.cmd --prefix frontend run dev
```

Vite proxies **/api/** to Django, keeping login cookies and CSRF protection on the same browser origin. Use Ctrl+C to stop terminal servers. The project-local database can be stopped with **tools/local_db.py stop**.

## Checks

```powershell
.\.venv\Scripts\python.exe backend/manage.py test core --noinput
.\.venv\Scripts\python.exe backend/manage.py check
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run test:e2e
```

Browser tests use installed Microsoft Edge in headless mode. The dispatch workflow tests create explicitly named test records against the local development app. After clearing the demo orders and vans, **.local/real-data-mode** disables those tests to protect real records. Use a separate disposable database for fixture-writing tests. The interface checks in **frontend/tests/interface.spec.js** only read business data and open forms, so they can run against the working app.

## Town and postcode lookup

Quick order route points and detailed stop, visit and saved-location forms offer an optional **Find town or postcode** search after choosing a country. Selecting a suggestion fills the postcode and available locality name; short route codes and street addresses stay unchanged. All values remain editable and manual entry works without a match.

The local reference database contains 822,339 records from Eurostat GISCO's 2025 postal dataset across all 30 EEA countries. The downloaded release has no UK records, so England, Scotland, Wales and Northern Ireland use a separate GeoNames lookup (27,450 records). These are reference suggestions, not address validation. Eurostat names identify administrative areas and can differ from the delivery town. Ireland and Malta contain prefixes in this release; the UK GeoNames data also supplies prefixes. Complete these manually when the full postcode is known.

The raw Eurostat file, attribution and import report are under **.local/gisco/**; UK source files are under **.local/geonames/**. Downloads are excluded from source control. Restore or refresh the reference data with:

```powershell
.\.venv\Scripts\python.exe backend/manage.py import_eurostat_postcodes
.\.venv\Scripts\python.exe backend/manage.py import_postcodes --country GB
```

The Eurostat command reuses the cached CSV; use **--file PATH** to import another downloaded release. Imports validate input before replacing each country's reference rows and never rewrite saved shipment locations. **GET /api/postcodes/?country=HU&q=Budapest** requires authentication and returns up to 20 suggestions with provider, licence and coverage information. Runtime searches use PostgreSQL and need no external geocoding account.

Sources: [Eurostat GISCO postal codes](https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units/postal-codes), CC BY-SA 4.0; [GeoNames postal data](https://download.geonames.org/export/zip/readme.txt), CC BY 4.0. Preserve the displayed attribution when reusing these reference datasets.

## API conventions

Country reference data is seeded by migrations: 70 European and nearby countries/territories, including Morocco, plus England, Scotland, Wales and Northern Ireland. The UK entries have individual flags and GB-ENG/GB-SCT/GB-WLS/GB-NIR codes. **GET/POST /api/countries/** supports lookup and adding custom countries, including country/region codes. Existing country text remains supported; new pickers store the saved code or custom name. Route summaries compact only adjacent equal code/country pairs and keep their underlying stops unchanged. The UK seed is kept separate so fresh installations can run the original two-letter-country migration before the code-length extension.

The opt-in quick-entry browser flow uses Django's disposable test database. With Vite running, set **RUN_QUICK_BROWSER=1** and run **backend/manage.py test core.test_quick_entry_browser --noinput** through the project Python environment. Every browser API request is forwarded to the test server; it never creates bookings in the working database.

- All operational endpoints require a logged-in session. Obtain a CSRF token at **GET /api/auth/csrf/** and include it on login and changes.
- Lists are paginated and support **q** search and relevant parent filters such as **order**, **trip**, **client**, and **partner**.
- **Orders** is a monthly notebook grouped by first loading date. It opens on the month of the latest dated shipment; **Today** jumps to the current month, with today first and earlier shipment days below. Use previous/next month or the month picker for other months. Later bookings in the current month are under **Upcoming later this month**; **No loading date** keeps undated orders accessible. Van, client, loading/delivery country, status and search filters combine. Existing bookings are not assigned guessed loading dates.
- **GET /api/orders/notebook/** defaults to the latest recorded loading-date month (company-local current month if none exist) and accepts **month=YYYY-MM**, **scope=month|undated**, **vehicle** (ID or **unassigned**), **client**, **loading_country**, **delivery_country**, **status**, **q** and **page**. The frontend resolves the default month once and keeps it while filtering, and reads every page before grouping the selected month. Responses include **loading_date** on orders and notebook counts/today metadata. Other order list endpoints keep their existing date-received filters.
- Set **First loading date** during quick entry, or use the calendar action in the notebook/order page. **GET/POST /api/orders/{id}/loading-date/** reviews/changes the first collection date; POST includes the order **version**, **stop**, **stop_version** and nullable **planned_date**. It is audited and rejects stale or changed first stops. Quick-entry route points also accept optional **planned_date**.
- Existing-record changes require the **version** that was opened. Stale changes return **409**, leaving saved data intact.
- Deletion requires reviewing **GET /api/{resource}/{id}/delete-preview/**, then sending its **version** and **confirmation_token** with **DELETE /api/{resource}/{id}/**. Only unused profiles (manager), unassigned draft orders, unused planned trips and empty document entries are eligible. Related history and uploaded documents block deletion; deletion snapshots remain in change history.
- Workflow changes use **POST /api/{resource}/{id}/command/** with **action** and **version**, rather than editing statuses directly.
- Open a confirmed or in-progress order and choose **Mark completed** to confirm collection and delivery together. The status becomes **Delivered**. This records who confirmed completion without inventing historic stop times or changing other shipments or trip costs. The API requires a fresh **GET /api/orders/{id}/completion-preview/** followed by the **complete** command with its **confirmation_token** and **confirm_delivery: true**; a completion note is optional.
- **POST /api/orders/quick-entry/** saves the notebook-style order and its route plan atomically. Short codes are separate from full addresses. An optional **trip** and **trip_version** add the booking to an existing journey; **estimated_km** is the whole-trip total. Order responses include **dispatch_summary** for van, route, client, price, distance and estimated/shared trip profit.
- **GET/POST /api/orders/{id}/dispatch-details/** loads or corrects an existing booking's van, driver and starting position. Saving requires the order **version** and selected **trip_version**, updates the existing shared trip, and retains its agreed rate and operational history. An unassigned open booking can receive a new planned trip atomically.
- Original uploaded files are private and downloaded through authenticated document endpoints.
- Driver profiles have optional **Citizenship**, selected using the country picker. It is shown in the drivers list, driver assignment menus and trip/order details. Existing drivers remain unspecified until edited. Citizenship changes are versioned and audited; this field records the supplied citizenship and does not automatically determine NATO shipment eligibility.
- Every route visit has **Add document** for optional CMR, goods, customs or other paperwork; this remains available after departure. The trip's **All trip documents** section gathers visit files together with directly linked trip, assignment, handover, order and stop documents, without duplicating files. **GET /api/documents/?trip={id}** supplies this combined list; exact **linked_resource/linked_id** filters remain available. Operational actions never require paperwork.
- Saved workflow changes update the visible status from the API response and revalidate related records in place. The route stays visible while it updates; no browser reload is needed. Trip detail reads all pages of its related collections.
- Shared trip costs use total payable kilometres once. Final margin uses actual distance, agreed rate, extras and balanced revenue allocations.

## Implementation defaults to review

- EUR money totals use two decimal places; kilometre rates use four; distances use two. Mileage cost rounds to cents using decimal half-up rounding.
- The company timezone defaults to Europe/Bucharest; individual stop appointments retain their own explicit timezone. An unknown stop timezone stays unknown.
- Development uploads are limited to 30 MB per file. Expiry indicators use a 30-day window.
- Prices represent entered transport figures; VAT calculation, invoicing and payment tracking are outside this build.
- Planning overlaps are warnings. Cargo discrepancies are editable operational data with history, not manager approval requests.
- Quick order entry saves a draft without mandatory cargo or full addresses. Use Shipment details to enrich the booking and Trip plan & rate to change the journey. Untouched quick drafts can be deleted with their own automatic plan; shared trip records and other bookings are retained.
- Initial driver assignment is one driver per trip; simultaneous crews and split loads are not implemented.

This is a local development build. Hosting, production cookie/domain settings, account recovery, backups and deployment are separate setup work.

Country data and locally bundled SVG flags are derived from [flag-icons](https://github.com/lipis/flag-icons), used under its MIT licence. Licence copies are included in **backend/directory/data/flag-icons-LICENSE.txt** and **frontend/public/licenses/flag-icons.txt**. No external flag service is needed at runtime. **tools/build_country_seed.py** deliberately regenerates the checked-in reference dataset from the installed package when updating it.

