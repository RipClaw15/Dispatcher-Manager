# Shipment Management Application — Approved Design

Consolidated on: 2026-10-29

Current phase: system design and review. This document records approved decisions and identifies pending questions. Application and database implementation remain a separate step.

## 1. Initial scope

- One dispatching company with multiple individual user accounts.
- Django, Django REST Framework, React with JavaScript, and PostgreSQL.
- Manual entry of orders, stops, cargo, clients, transport partners, vans, drivers, trip information and documents.
- Shared operational and financial visibility for dispatchers and managers.
- All initial financial amounts and kilometre rates are in EUR.
- Document extraction, custom-route quoting and payment follow-up are future features.
- PDF generation is outside the initial scope.

## 2. Users, permissions and responsibility

There are two business roles: Manager and Dispatcher.

| Action | Dispatcher | Manager |
| --- | --- | --- |
| View, create and edit company orders and trips | Yes | Yes |
| Create/edit clients, partners, vans, drivers and saved locations | Yes | Yes |
| Enter client prices, trip rates, kilometres and extras | Yes | Yes |
| View trip costs and margins | Yes | Yes |
| Upload and link documents | Yes | Yes |
| Mark a van out of service or usable again | Yes | Yes |
| Deactivate/archive or reactivate business profiles | No | Yes |
| Manage user accounts and roles | No | Yes |
| Approve requests requiring manager approval | No | Yes |

- Each order has one responsible dispatcher; each trip separately has one responsible dispatcher.
- Responsibility defaults to the creator and can be reassigned, with history retained.
- Orders belonging to different dispatchers can share a trip coordinated by another dispatcher.
- Responsibility supports coordination and filtering, including a My shipments view. It does not restrict shared access or editing.
- Account deactivation and profile archiving preserve historical records. Inactive business profiles are unavailable for normal selection for new work.

### Deleting entry mistakes

- Managers can permanently delete unused clients, transport partners, drivers, vans, saved locations and contacts. Referenced profiles remain available for archiving instead.
- Dispatchers and managers can delete manual draft orders that have no trip assignments, attempts, reviews or linked documents. The order's own unstarted stops and cargo are included in the deletion preview. Untouched quick-entry drafts can also remove their own automatically generated plan, subject to the protections below.
- Unstarted planned trips can be deleted with their unused planned visits, provided there are no assigned orders, attempts, linked documents, recorded costs or actual travel.
- Empty document entries can be deleted. Uploaded files, linked documents, accounts, reviews and operational history are retained.
- Show an explicit confirmation listing the entries to be removed. Recheck all references and reviewed record versions when confirming; changed records require another review.
- Preserve deletion snapshots and the actor/time in change history. Deletion removes the working record, not its audit trail.

### Approved approval and review rules

- Reopening a Delivered order requires advance manager approval.
- Emergency handovers can be recorded immediately and are flagged for manager review afterward.
- Cancellation while travelling to collection can be recorded immediately, with a reason, and is flagged for manager review afterward.
- Advance approval applies a pending proposed action after approval; review afterward concerns an action already recorded.
- Client-related cancellations after collection can be recorded directly by dispatchers without manager approval, with the client's reason and dispatcher action retained in history.

## 3. Core operational concepts

- An Order is one client's transport booking. It can contain multiple collection and delivery stops.
- The client is the business booking the transport; collection and delivery businesses do not automatically become clients.
- Cargo entries identify what travels from each collection stop to each delivery stop.
- A Trip is a planned van journey carrying work from one or more orders, potentially for different clients.
- A Transport leg is the portion of an order handled on one trip. A normal order uses one leg; a handover creates further legs.
- A trip can carry legs from several orders.
- An order can be entered before a trip, partner, van or driver is known.

### Order stops and trip visits

- An Order stop is a collection or delivery task belonging to one order.
- A Trip visit is a place in a van's route and can cover tasks from several orders.
- Dispatchers choose which tasks belong to the same visit.
- For example, one warehouse visit can collect goods for two different clients' orders.
- Each order retains its own cargo, references, documents and completion status.
- Customs checkpoints and handovers also appear in the trip route as visits with their relevant links.

### Visit progress and task outcomes

- Marking a visit En route updates its included planned tasks to En route.
- Marking a visit Arrived records the shared arrival and updates the relevant tasks.
- Each collection or delivery has its own completion outcome.
- Physical departure is recorded once for the visit.
- Unsuccessful tasks can be rescheduled while preserving the earlier attempt.
- For example, one warehouse visit can complete Order A's collection while recording Order B's collection as Unsuccessful because its goods are unavailable.

### Stop attempts and retries

- One order stop can have multiple separate attempt records.
- Each attempt retains its trip-visit link, outcome and reason. Arrival and departure information comes from the associated visit.
- Rescheduling creates another attempt and preserves the earlier attempt.
- The order stop retains its identity, cargo links and documents; its instructions can still be updated.
- For example, the same collection stop can have an Unsuccessful Monday attempt and a Completed Tuesday attempt.

### Current stop progress from attempts

- A failed attempt leaves the order stop Unsuccessful.
- Scheduling a retry sets the stop to Planned while retaining the previous failure in history.
- Travel and arrival for the current retry update the stop to En route and Arrived respectively.
- A successful attempt sets the stop to Completed.
- Each stop has at most one current planned or ongoing attempt; earlier attempts remain historical.
- Removing a planned attempt leaves the underlying stop outstanding. Cancelling the required stop is a separate action with a reason.
- Once an order has started, scheduling a retry keeps the order In progress rather than returning it to Confirmed.

### Handovers

- Handovers support both planned transfers and breakdowns during an active journey.
- The order, completed stops and original transport history remain together.
- Record the actual transfer location and time, end the outgoing leg at the handover, and create a receiving leg for remaining transport.
- The receiving leg can use an existing or newly created trip.
- When a van carries several affected orders, each retains its own leg and handover history.
- A handover is not a customer delivery.
- Split loads across multiple vans were discussed as a possibility but have not been approved as an initial requirement.

## 4. Orders and customer stops

### Identifiers and references

- Internal order and trip numbers are generated automatically and remain fixed, for example ORD-000123 and TRP-000045.
- Internal numbers remain unchanged through address corrections, reassignment, retries and handovers.
- A client's order reference is optional and editable when supplied.
- Collection, delivery and customs stops can have their own optional references and instructions.
- Warn about a possible duplicate when the same client reference already exists for that client. The dispatcher can proceed when reuse is intentional.
- Different clients can use the same external reference.
- Missing external references do not prevent order creation or saving.

### Quick dispatch entry and lookup

- Create orders using van registration, separate short route-code fields, ordering client, order price and whole-trip payable kilometres. Show estimated profit calculated from the trip rate and costs.
- The starting position is the van's origin before collection, not a loading stop. Example: HD-86-GMC, FR95 (start), FR93 (collection), SL42 (delivery), Lukstransa, EUR 650, 1,280 km. At EUR 0.40/km, calculated estimated profit is EUR 138.
- Support adding, removing and reordering collection, customs and delivery points. Keep each short code separate from the full postal code/address. Country selection and recognised directory prefixes supply flag information without rewriting the dispatcher's shorthand.
- Quick summaries collapse consecutive repetitions of the same short code and country, including multiple collections in IT16. Preserve every stop and task in shipment details, and keep a return such as IT16 → AT10 → IT16 visible.
- A shared database of European and nearby countries/territories (including Morocco) supplies searchable country pickers. England, Scotland, Wales and Northern Ireland are also selectable, with their own flag assets and GB-ENG/GB-SCT/GB-WLS/GB-NIR codes. Dispatchers can add custom countries, optionally with a country or region code. Existing free-text countries remain readable.
- Display small locally served SVG country flags beside route codes. Explicitly selected countries take priority; known directory prefixes may suggest a country during quick entry. Unrecognised shorthand is not guessed. Custom entries without a matching flag use a globe.
- Saving quick entry atomically creates a draft order and, when planning information is present, its planned trip, leg, visits and stop attempts. Do not invent cargo details.
- Allow selecting an existing open trip for additional client orders. Keep its origin and agreed rate; distance entry represents the revised whole-trip total. Display shared trip profit explicitly, without allocating or charging van costs a second time.
- Present van and short route on the first line, client/price/distance/profit on the second. Keep status and the permanent order reference available. Search by van, route code, client or reference.
- Existing orders offer Edit van / driver / start with current values prefilled. Edit the selected linked trip, with an explicit shared-trip notice; orders with several trips let the dispatcher choose the assignment to correct. Preserve the agreed rate, actual kilometres and operational statuses. Use handovers for physical goods transfers rather than correcting the recorded assignment.
- Cargo, full locations, appointments and documents remain available in expandable shipment details. Enrich existing points rather than creating duplicate stops. Draft creation remains possible before any client, van or route is known.
- An untouched quick-entry draft can be deleted with its own unused planning rows. Preserve other orders on shared trips, referenced documents, travelled work and the audit trail.

### Additional order header details

- Optional booking contact from the client's profile.
- Editable date the order was received, defaulting to today.
- Agreed client price in EUR.
- Optional internal operational notes visible to the team.
- A separately recorded automatic creation timestamp, distinct from the editable received date.
- Client, responsible dispatcher and references follow their approved rules.

### Order lifecycle

| Status | Meaning |
| --- | --- |
| Draft | Entry is incomplete. |
| Confirmed | The booking is accepted and ready for planning/execution. |
| In progress | Travel toward the first collection has begun. |
| Delivered | All required customer collections and deliveries are completed. |
| Cancelled | The booking has been explicitly cancelled; history remains. |

- Draft to Confirmed is a manual action.
- The first collection marked En route starts that order's In progress status.
- Partial completion or an unsuccessful stop leaves the order In progress with outstanding work visible.
- Completion of all required customer collections and deliveries marks the order Delivered, except for client-related cancellation returns, which close as Cancelled after return completion.
- Breakdowns and handovers leave the order In progress.
- Starting a trip does not start every order on that trip.
- Trip assignment is separate from the order lifecycle.
- Physical delivery progress is separate from document completeness.

### Client-related cancellation after collection

- Dispatchers record these cancellations directly without manager approval, for example when the client reports missing/incorrect goods paperwork or cancellation elsewhere in their own order chain.
- Record the client's cancellation reason and the dispatcher's action in history.
- Keep the order In progress with a Return pending indicator while the goods still need to be returned.
- Preserve completed work, cancel outstanding deliveries with a reason, and add return stops for the goods' original collection locations.
- Once the return is completed, close the order as Cancelled with the resolution Returned to loading point. A completed return stop does not mark the order Delivered.
- Retain all travelled kilometres and transport costs, including the return journey.
- Any revised client price follows the approved price-change rules.

### Minimum information

- Draft orders can be saved with incomplete information.
- Creating a draft order does not require an ordering-client profile. A blank responsible dispatcher defaults to the signed-in account. The client can be linked later.
- Confirmed orders require a client, responsible dispatcher, agreed client price in EUR, at least one collection stop, at least one delivery stop and a cargo entry describing the goods.
- Collection and delivery stops can use identifiable provisional locations rather than complete street addresses.
- Missing or unconfirmed cargo quantities, weights and dimensions remain visible.
- Documents are optional for both creation/saving and confirmation.

### Collection/delivery stop lifecycle

| Status | Meaning |
| --- | --- |
| Planned | Scheduled, but travel to this stop has not begun. |
| En route | The van is travelling toward the stop. |
| Arrived | The van is onsite, waiting or loading/unloading. |
| Completed | Physical collection or delivery has finished. |
| Unsuccessful | An attempt failed; record a reason. |
| Cancelled | The stop is no longer required; record a reason. |

- Retain unsuccessful attempt history if a stop is rescheduled.
- Record actual arrival and departure times separately from planned timing.

### Locations, customs and appointments

- Collection, delivery and customs locations are editable as correct instructions arrive.
- Initially record whatever is known: site name, town, postal code and country.
- Location details can be Provisional or Confirmed; log who changes them and when.
- Editing one order's stop preserves other orders and the saved address-book entry. Updating the address book is a separate action.
- Customs handling is optional per order and is explicitly recorded by the dispatcher.
- Optional customs checkpoints can appear in the trip route, link to relevant orders, and hold documents, appointments and instructions.
- Appointment options are Not yet known, Date only, Time window, or Fixed appointment.
- Timing can remain provisional and be updated later.
- Show stop times in that location's local timezone, with the timezone visible.

## 5. Cargo information

Each cargo entry links one collection stop to one delivery stop and supports:

- Description.
- Quantity and package type.
- Total gross weight for the entry.
- Dimensions per unit; different-sized units can be entered separately.
- Stackable: Yes, No or Unknown.
- Handling instructions.

Keep client-reported and actual-at-collection information distinguishable. Preserve reported values, highlight discrepancies, and use corrected information to describe the transported load. Missing, estimated or unconfirmed details stay visibly uncertain; unknown values are not zero.

Booking confirmation and cargo-detail confirmation are separate.

- Dispatchers can freely edit cargo information as details change, including quantities, weights and dimensions. More or less cargo than initially discussed is a routine operational change.
- Cargo edits require neither manager approval nor mandatory manager review and are not restricted by cargo-discrepancy thresholds.
- Preserve the reported/actual distinction and change history showing previous and updated information, who changed it and when.
- Ordinary cargo-information corrections do not reopen the order's physical delivery status.

## 6. Trip planning and execution

### Planning sequence

1. Group orders or legs into a Planned trip around dates and regions.
2. Arrange the route, planned times and estimated payable kilometres.
3. Assign the partner, van and driver when known, and confirm the agreed kilometre rate.
4. Execute the trip, recording progress, changes and final payable kilometres.

- Planned trips can be saved with some or all resource assignments unknown.
- Orders can remain outside any trip until grouping is decided.
- Partner, van, driver and agreed rate are required before a trip becomes In progress.
- The route can interleave collections and deliveries from different orders and include customs checkpoints and handovers.
- Check that the relevant goods are collected before delivery and that a receiving van receives a handover before delivering those goods.

### Trip lifecycle

| Status | Meaning |
| --- | --- |
| Planned | The journey is being arranged. |
| In progress | Payable travel has begun. |
| Interrupted | An issue has stopped the journey and needs resolution. |
| Finished | The journey has ended; remaining work is completed, transferred or cancelled. |
| Cancelled | The trip was cancelled before travel began. |

- A dispatcher finishes the trip manually after payable travel ends, including any empty travel after the last delivery.
- Travel already performed retains its kilometres and costs even if every order is cancelled. Such a trip can finish with an ended-early reason.
- An interrupted trip can resume with the same van after repair or finish after its work is transferred.

### Availability

- Show current/upcoming van trips, expected availability date/time and expected town/region/country.
- Mark estimated availability information and allow dispatchers to update it manually.
- Show driver bookings as well as vehicle bookings.
- Warn about overlapping van or driver assignments when time windows are known.
- Provisional plans can still be saved while assignment conflicts are resolved.

## 7. Prices, costs and margins

- Each order records its agreed client price in EUR.
- Draft orders can have no price; an agreed client price is required before confirmation.
- Dispatchers or managers can revise the client price afterward, recording the previous amount, new amount, reason, person and time.
- Revenue and trip margin reflect the revised price. Partner costs follow their separately agreed rates, and physical collection/delivery statuses remain as recorded.
- For orders involving handovers, price changes require review of manual revenue allocations so their total matches the revised price; affected margins remain provisional meanwhile.
- Each van has its own editable default EUR/km rate.
- New trips start with the van's default; the actual agreed trip rate can be changed for that journey.
- A new ongoing agreement can update the van's default for future trips.
- Existing trips retain their recorded agreed rates.
- An agreed rate applies to the whole trip, including loaded and empty payable kilometres.
- Total payable journey distance is counted once, regardless of the number of orders carried.
- Dispatchers initially enter estimated and final payable kilometres manually.

Trip transport cost = total payable kilometres × agreed trip rate + agreed extras.

Trip transport margin = allocated client revenue − trip transport cost.

Example: client prices EUR 550 + EUR 250, distance 1,300 km, and rate EUR 0.40/km give revenue EUR 800, mileage cost EUR 520, and transport margin EUR 280 before extras and other business expenses.

- Whole-trip margin is the primary profitability measure.
- Orders handled entirely on one trip contribute their full price to that trip's revenue.
- For handovers, dispatchers manually allocate the order price across participating trips. Allocations must total the order price.
- Each participating trip retains its own costs. The company counts the order revenue once.
- Affected trip margins remain provisional until revenue allocation is complete.
- Costs remain provisional while distance or rate information is uncertain.
- Client reporting includes order counts and agreed revenue; no per-order cost-allocation method has been approved.
- Payment follow-up is a future feature. Tax basis and detailed precision/rounding conventions remain pending.

## 8. Business profiles

### Clients

- Clients are businesses and have separate profiles from transport partners; dual-role companies are not part of the initial design.
- Required on initial creation: company name and country.
- Optional initially: company address, VAT/tax identifier, registration number and internal notes.
- Support multiple contacts, each with name, purpose/role, email and phone.
- Active/inactive status; inactive clients retain history and are unavailable for new bookings.
- Preserve client/contact information recorded on earlier orders when the profile changes.
- Show linked order history, total order count and breakdown by order status, most recent order date, and agreed revenue.
- Filter history by date, status and responsible dispatcher.
- Count each client order once regardless of its trips, legs or handovers.

### Transport partners

- A partner identifies who arranges/supplies the transport and receives the transport payment.
- One partner can supply one or many vans and drivers.
- The fleet owner can also have a driver profile and drive a van.
- Partner, driver and vehicle are separate records; each trip identifies the actual participants.
- Profiles include company details and contacts, linked drivers/vans, trip history and transport-cost totals.
- Required on initial creation: display name (the recognisable company or fleet name) and business country.
- Optional initially: legal company name if different, company address, VAT/tax identifier and company registration number.
- Support multiple contacts with name, role, phone and email, plus optional internal notes.
- Status is Active or Inactive; archiving/reactivation follows the approved manager permissions.
- Company details and documents can be completed after the profile is created.
- Default kilometre rates remain on individual vans.

### Vehicles

- Required: registration number, registration country, vehicle type and editable default EUR/km rate.
- Supplying partner is optional when creating or editing a van and can be linked later.
- Optional initially: make/model, maximum payload in kg, internal loading dimensions, pallet capacity and loading/access notes.
- Operational status: Active, Out of service or Inactive.
- Missing capacity information remains visibly unknown.
- Show trip history, payable kilometres and transport-cost totals.
- Operational condition and scheduling availability are separate.

### Drivers

- Required: full name and phone number.
- Optional: current transport partner, email, usual van and operational notes. Drivers can be created before a partner profile exists and linked later.
- An unknown partner does not prevent choosing a usual van or planning a trip. When both profiles have known partners, conflicting partners are rejected.
- Active/inactive status, with trip and vehicle history preserved.
- The usual van is a default; trips record the actual van and driver.
- Changes to the current partner or usual van preserve previous trip records.
- Profiles are maintained manually by dispatchers.

### Saved locations

- Company-wide reusable collection/delivery address book, usable across different clients' orders.
- Site/business name, address/country, onsite contacts/phones, usual opening hours and access/loading instructions.
- A stop separately records its appointment, reference and specific instructions.
- One-off locations can be entered directly on stops without saving an address-book entry.
- Saved-profile edits preserve the location details already recorded on other bookings.

## 9. Documents

- Manually upload and classify PDFs, images/photos and Word documents, preserving originals.
- Support links to multiple relevant records without duplicate uploads.
- Record document type, uploader, upload time and optional notes.
- Preserve earlier versions when revised, signed, renewed or replacement files are added.
- Optional manually entered valid-from/expiry dates support expiring-soon and expired indicators.

| Category | Relevant records |
| --- | --- |
| Loading CMR | Collection stop |
| Unloading CMR | Delivery stop |
| Customs paperwork for border clearance | Relevant orders and stops |
| Transport order | Order |
| Driver documents, including IMI paperwork | Driver and other relevant records |
| Insurance and vehicle documents | Vehicle and other relevant records |
| Partner-level insurance/company documents | Transport partner |

- Files can be added later; they are optional when creating, saving and confirming orders.
- Document completeness is separate from physical delivery completion.
- The proposed Expected → Received → Checked document-checklist workflow has not been approved.

## 10. Shared editing and history

- Meaningful changes record who changed what and when, including manager actions.
- When two users edit the same record, the first save succeeds.
- A later save detects whether the record has changed, preserves the user's unsaved changes, and shows the latest saved information for review.
- The user reviews/reapplies their intended changes before saving.
- This protection applies across shared records.

## 11. Technical architecture

- One Django/DRF backend organised into feature modules.
- React with JavaScript provides screens, forms, planning views and interactions.
- Django enforces permissions, workflows, calculations, approvals, history and conflicting-edit checks.
- React may preview results; the backend validates saved changes and calculates authoritative totals.
- PostgreSQL stores operational data, relationships and document metadata.
- Private file storage holds uploaded files behind permission-controlled access.
- Reporting reads the order/trip records and their agreed calculation rules.

| Module | Responsibility |
| --- | --- |
| Accounts | Users, roles and account management |
| Business directory | Clients, partners, contacts and saved locations |
| Fleet | Vans, drivers, default rates, operational status and expected availability |
| Orders | Bookings, cargo, customer stops, customs requirements and client prices |
| Trips | Planning, route sequence, legs, handovers, resources, kilometres, rates, extras, revenue allocation and margins |
| Documents | Files, links, versions and validity dates |
| Reviews | Advance approval requests and reviews of actions already recorded |

Change history and conflicting-edit protection apply across modules. All modules are part of the same backend and share PostgreSQL.

### Authentication

- Email/password login for Manager and Dispatcher accounts created by managers.
- Django-managed sessions using a secure, HTTP-only browser cookie.
- React and the API served under the same website.
- CSRF protection on login and requests that change data.
- Server-side role checks on requests.
- Deactivated accounts lose access while history remains.

### Shipment completion shortcut

- Confirmed and in-progress orders offer **Mark completed** on the order page. A dispatcher confirms that all goods have been collected and delivered; an optional note is saved in history. The order becomes Delivered, with its remaining collection/delivery tasks completed together.
- Existing recorded timings stay unchanged; unknown arrival, departure and task-completion times remain unknown. Other shipments, trip status, kilometres and costs are retained. Shared visits with outstanding work stay open.
- A changed order or stop requires reviewing the latest information again. Cancellation returns continue through their separate return workflow. Trips containing completed work cannot be cancelled as untravelled.

### Route documents and immediate status updates

- Every route visit offers optional document attachments, including CMRs, goods paperwork, customs and other categories. Files can be added before or after recording visit progress. No arrival, task completion, departure or trip action requires an upload.
- **All trip documents** combines files linked to the trip, its visits, assignments, handovers and assigned orders or their stops. Each document appears once, with its original links and file versions. Van/driver/company profile files remain in their profiles.
- After a successful action, React applies the server's saved status and reloads related data in place. Route cards remain mounted; their status, appearance, actual times and available next actions update without a browser refresh. Rejected actions retain the previous status and show the error.

### Driver citizenship

- Drivers have an optional **Citizenship** country field, editable by dispatchers and managers using the saved-country picker (including custom countries). Existing drivers stay blank until citizenship is supplied; the company and van registration do not supply this value.
- Citizenship is visible on driver profiles and in the drivers list, trip/order assignment details, and driver selection menus. Unknown citizenship is identified when selecting a driver. Changes use the existing version checks and audit history.
- Citizenship is recorded information for checking shipment instructions; this change does not add automatic NATO membership, citizenship verification or shipment-eligibility decisions.

### Monthly orders notebook

- The Orders page groups shipments by their **first loading date**, not the date the booking was received. The first active collection in route order supplies its planned date; later collection dates do not substitute for an unknown first date. If all collections were cancelled, their original first collection date remains available for history.
- The default month is the month of the latest recorded first loading date, falling back to the current month when no loading dates exist. **Today** opens the company-local current month with today's group first, followed by earlier shipment days descending to the start of that month. Empty past days are omitted. Previous/next month controls and a month picker open other months, with no 100-order cut-off within a month.
- Future bookings later in the current month are in a separate expandable Upcoming section. Other selected months show all their shipment days. Orders lacking a loading date remain accessible across all months in **No loading date**, with a visible reminder in the monthly view; existing dates are not invented or copied from date received.
- Van, client, any loading country, any delivery country, status and text filters combine. Van filters include any retained assignment, including handover history; released assignments are ignored. Country filters support saved names/codes/custom countries, and recognised short-code prefixes only where no explicit country was entered.
- Quick entry offers an optional first loading date, initially today, stored on the first entered collection. Calendar controls in the notebook and the order page let dispatchers correct it with version checks and history. Existing planned time windows remain unless the date is explicitly cleared; actual operational times remain unchanged. No manager approval is needed.
- Month and filter selections remain while navigating between the notebook and orders in the same app session. Applying filters keeps the resolved month selected. Reloading the application starts with the latest recorded shipment month.
- The month controls stay visible. Notebook view, search, country, van/client and status controls sit in a **Filters** panel, collapsed by default. Closing it retains the selections, with an active-filter count on the toggle.
- **Latest shipments**, beside **Today**, returns to the most recent month with dated shipments matching the current filters.

### Optional town and postcode lookup

- Route points in quick entry and detailed stops, visits and saved locations support country-scoped town/postcode search. Selecting a suggestion copies the available locality and postcode; short route codes and street addresses stay unchanged. Search and selection are optional, with editable manual entry throughout.
- Eurostat GISCO's 2025 postal data supplies all 30 EEA countries. This release has no UK rows; GeoNames supplies the UK lookup, filtered for England, Scotland, Wales and Northern Ireland. Reference data is imported locally, separately from business locations, and refreshing it does not change saved shipments.
- Results show provider, licence and coverage notes. Administrative-area names may need correction to the actual delivery town. Ireland, Malta and the UK lookup contain postcode prefixes requiring manual completion. Suggestions do not validate street addresses or guarantee complete postal coverage.

## 12. Pending design work

These points are not approved implementation requirements:

- Remaining detailed conceptual relationships and database schema.
- Whether split-load execution, driver changes during a trip or multiple simultaneous drivers are needed initially.
- Tax basis of agreed prices/costs, numeric precision and rounding rules.
- Reporting date-filter semantics.
- Document deletion/archiving permissions, expiry-warning thresholds, upload limits and storage provider.
- Detailed API contracts, account recovery/session expiry settings, deployment and hosting.
- Future features remain separate: extraction, custom-route quoting and payment follow-up. PDF generation was declined for the initial version.

## Technical references consulted

- [Django projects and applications](https://docs.djangoproject.com/en/stable/ref/applications/)
- [DRF permissions](https://www.django-rest-framework.org/api-guide/permissions/)
- [Django authentication](https://docs.djangoproject.com/en/stable/topics/auth/default/)
- [DRF session authentication and CSRF](https://www.django-rest-framework.org/api-guide/authentication/#sessionauthentication)
