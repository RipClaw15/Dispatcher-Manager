const f = (key, label, type = "text", extra = {}) => ({
  key,
  label,
  type,
  ...extra,
});
const rel = (key, label, resource, extra = {}) =>
  f(key, label, "relation", { resource, ...extra });
const opts = (key, label, options, extra = {}) =>
  f(key, label, "select", {
    options: options.map((value) =>
      typeof value === "string" ? [value, value.replaceAll("_", " ")] : value,
    ),
    ...extra,
  });
const note = f("notes", "Internal notes", "textarea");
const business = [
  f("name", "Display / company name", "text", { required: true }),
  f("country", "Business country", "country", { required: true }),
  f("legal_name", "Legal name, if different"),
  f("address", "Company address", "textarea"),
  f("tax_id", "VAT / tax identifier"),
  f("registration_number", "Registration number"),
  note,
  f("is_active", "Active profile", "checkbox", { default: true }),
];
const place = [
  f("short_code", "Short location code", "text", { placeholder: "e.g. FR93" }),
  f("location_name", "Site / location name"),
  f("address", "Street address", "textarea"),
  f("city", "Town / region"),
  f("postal_code", "Postal code"),
  f("country", "Country", "country"),
  f("timezone", "Location timezone", "text", {
    placeholder: "Europe/Berlin — leave blank if unknown",
  }),
];

export const formSections = {
  orders: { client: "Booking details", price: "Price & instructions" },
  vehicles: {
    partner: "Vehicle details",
    default_rate: "Rate & capacity",
    status: "Availability",
  },
  drivers: { full_name: "Driver details", usual_vehicle: "Vehicle assignment" },
  trips: {
    name: "Journey details",
    partner: "Resources",
    rate: "Rate & distance",
    planned_start: "Schedule",
  },
};

export function canDelete(resource, user) {
  return (
    ["orders", "trips", "documents"].includes(resource) ||
    (user.role === "manager" &&
      [
        "clients",
        "partners",
        "drivers",
        "vehicles",
        "locations",
        "contacts",
      ].includes(resource))
  );
}

export const schemas = {
  countries: {
    title: "Countries",
    singular: "country",
    description:
      "Saved countries for routes and business profiles. Add a custom entry when needed.",
    fields: [
      f("name", "Country name", "text", { required: true }),
      f("code", "Country code (optional)"),
    ],
    columns: ["country_flag", "code", "country_source"],
  },
  orders: {
    title: "Orders",
    singular: "order",
    description:
      "Every client booking, from first instruction to final delivery.",
    fields: [
      rel("client", "Ordering client (optional for draft)", "clients"),
      rel("dispatcher", "Responsible dispatcher", "users"),
      rel("booking_contact", "Booking contact", "contacts", {
        filter: (item, values) => item.client === Number(values.client),
      }),
      f("client_reference", "Client order reference"),
      f("date_received", "Date received", "date", {
        default: () => new Date().toLocaleDateString("en-CA"),
      }),
      f("price", "Agreed client price · EUR", "number", { step: "0.01" }),
      f("customs_required", "Customs handling needed", "checkbox"),
      note,
    ],
    columns: ["dispatch_summary", "status", "reference"],
  },
  clients: {
    title: "Clients",
    singular: "client",
    description: "The businesses that book transport with you.",
    fields: business,
    columns: ["name", "country", "order_count", "agreed_revenue", "is_active"],
  },
  partners: {
    title: "Transport partners",
    singular: "partner",
    description: "Owner-drivers and small fleets supplying your transport.",
    fields: business,
    columns: ["name", "country", "vehicle_count", "driver_count", "is_active"],
  },
  contacts: {
    title: "Contacts",
    singular: "contact",
    fields: [
      rel("client", "Client", "clients"),
      rel("partner", "Transport partner", "partners"),
      f("name", "Full name", "text", { required: true }),
      f("role", "Contact role"),
      f("phone", "Phone"),
      f("email", "Email", "email"),
    ],
    columns: ["name", "role", "phone", "email"],
  },
  locations: {
    title: "Saved locations",
    singular: "location",
    description:
      "A shared address book. One-off stops can still be entered directly.",
    fields: [
      f("name", "Site name", "text", { required: true }),
      f("address", "Address", "textarea"),
      f("city", "Town / region"),
      f("postal_code", "Postal code"),
      f("country", "Country", "country"),
      f("timezone", "Location timezone", "text", {
        placeholder: "Europe/Berlin",
      }),
      f("contact_name", "Onsite contact"),
      f("phone", "Phone"),
      f("opening_hours", "Usual opening hours"),
      f("instructions", "Access and loading instructions", "textarea"),
      f("is_active", "Active location", "checkbox", { default: true }),
    ],
    columns: ["name", "city", "country", "opening_hours", "is_active"],
  },
  vehicles: {
    title: "Vans & availability",
    singular: "van",
    description:
      "Your vans, their rates and the places they’ll be available next.",
    fields: [
      rel("partner", "Transport partner (optional)", "partners"),
      f("registration", "Registration number", "text", { required: true }),
      f("registration_country", "Registration country", "country", {
        required: true,
      }),
      opts("vehicle_type", "Van type", ["Box van", "Curtain van", "Other"], {
        default: "Box van",
      }),
      f("default_rate", "Default rate · EUR/km", "number", {
        required: true,
        step: "0.0001",
      }),
      f("make_model", "Make / model"),
      f("payload_kg", "Maximum payload · kg", "number"),
      f("length_cm", "Internal length · cm", "number"),
      f("width_cm", "Internal width · cm", "number"),
      f("height_cm", "Internal height · cm", "number"),
      f("pallet_capacity", "Pallet capacity", "number"),
      opts(
        "status",
        "Operational condition",
        ["active", "out_of_service", "inactive"],
        { default: "active" },
      ),
      f("available_at", "Expected available from · your local time", "instant"),
      f("available_region", "Expected town / region"),
      f("available_country", "Expected country", "country"),
      f("availability_estimated", "Availability is estimated", "checkbox", {
        default: true,
      }),
      note,
    ],
    columns: [
      "registration",
      "partner_label",
      "vehicle_type",
      "default_rate",
      "status",
      "available_region",
      "available_at",
    ],
  },
  drivers: {
    title: "Drivers",
    singular: "driver",
    description:
      "People behind the wheel, including fleet owners who also drive.",
    fields: [
      f("full_name", "Full name", "text", { required: true }),
      f("phone", "Phone number", "tel", { required: true }),
      f("citizenship", "Citizenship", "country"),
      rel("partner", "Transport partner (optional)", "partners"),
      f("email", "Email", "email"),
      rel("usual_vehicle", "Usual van", "vehicles", {
        filter: (item, values) =>
          !values.partner ||
          !item.partner ||
          item.partner === Number(values.partner),
      }),
      note,
      f("is_active", "Active driver", "checkbox", { default: true }),
    ],
    columns: [
      "full_name",
      "citizenship",
      "phone",
      "partner_label",
      "usual_vehicle_label",
      "is_active",
    ],
  },
  trips: {
    title: "Trip planning",
    singular: "trip",
    description:
      "Group the work first. Assign the van and driver when they’re known.",
    fields: [
      f("name", "Trip name / region"),
      f("starting_code", "Starting position code", "text", {
        placeholder: "e.g. FR95",
      }),
      f("starting_country", "Starting country", "country"),
      rel("dispatcher", "Responsible dispatcher", "users"),
      rel("partner", "Transport partner", "partners"),
      rel("vehicle", "Van", "vehicles", {
        filter: (item, values) =>
          !values.partner ||
          !item.partner ||
          item.partner === Number(values.partner),
      }),
      rel("driver", "Driver", "drivers", {
        filter: (item, values) =>
          !values.partner ||
          !item.partner ||
          item.partner === Number(values.partner),
      }),
      f("rate", "Agreed whole-trip rate · EUR/km", "number", {
        step: "0.0001",
      }),
      f("rate_reason", "Reason for a special agreed rate"),
      f(
        "estimated_km",
        "Estimated payable km · includes empty travel",
        "number",
        { step: "0.01" },
      ),
      f("actual_km", "Final payable km · includes empty travel", "number", {
        step: "0.01",
      }),
      f("planned_start", "Planned start · your local time", "instant"),
      f("planned_end", "Planned finish · your local time", "instant"),
      note,
    ],
    columns: [
      "reference",
      "name",
      "status",
      "vehicle_label",
      "driver_label",
      "dispatcher_label",
      "financials",
    ],
  },
  stops: {
    title: "Stops",
    singular: "stop",
    fields: [
      rel("order", "Order", "orders", { required: true }),
      opts("kind", "Task", ["collection", "delivery", "return"], {
        default: "collection",
      }),
      f("position", "Order sequence", "number", { default: 1 }),
      ...place,
      f("location_confirmed", "Location details confirmed", "checkbox"),
      f("contact_name", "Onsite contact"),
      f("phone", "Onsite phone"),
      f("external_reference", "Stop reference"),
      opts(
        "timing",
        "Appointment information",
        ["unknown", "date", "window", "appointment"],
        { default: "unknown" },
      ),
      f("planned_date", "Planned date", "date"),
      f("time_from", "From / appointment · location local time", "time"),
      f("time_to", "Until · location local time", "time"),
      f("instructions", "Stop instructions", "textarea"),
    ],
    columns: ["kind", "location_name", "city", "country", "status"],
  },
  cargo: {
    title: "Cargo",
    singular: "cargo entry",
    fields: [
      rel("order", "Order", "orders", { required: true }),
      rel("collection", "Collection stop", "stops", {
        required: true,
        filter: (item, values) =>
          item.order === Number(values.order) && item.kind === "collection",
      }),
      rel("delivery", "Delivery stop", "stops", {
        required: true,
        filter: (item, values) =>
          item.order === Number(values.order) && item.kind === "delivery",
      }),
      f("description", "Goods description", "text", { required: true }),
      f("reported", "Client-reported details", "cargo"),
      f("actual", "Actual details at collection", "cargo"),
      f("details_confirmed", "Cargo details confirmed", "checkbox"),
      f("instructions", "Handling instructions", "textarea"),
    ],
    columns: [
      "description",
      "collection_label",
      "delivery_label",
      "details_confirmed",
    ],
  },
  legs: {
    title: "Assigned orders",
    singular: "order assignment",
    fields: [
      rel("order", "Order", "orders", { required: true }),
      rel("trip", "Trip", "trips", { required: true }),
      f(
        "allocated_revenue",
        "Allocated revenue · EUR (multi-trip orders)",
        "number",
        { step: "0.01" },
      ),
    ],
    columns: ["order_label", "trip_label", "allocated_revenue"],
  },
  visits: {
    title: "Route visits",
    singular: "visit",
    fields: [
      rel("trip", "Trip", "trips", { required: true }),
      f("position", "Route position", "number", { default: 1 }),
      opts(
        "kind",
        "Visit type",
        [
          ["work", "Collection / delivery"],
          ["customs", "Customs checkpoint"],
        ],
        { default: "work" },
      ),
      ...place,
      f("planned_at", "Planned visit · your local time", "instant"),
      f("instructions", "Visit instructions", "textarea"),
    ],
    columns: ["position", "location_name", "kind", "status"],
  },
  attempts: {
    title: "Task attempts",
    singular: "task",
    fields: [
      rel("stop", "Order stop", "stops", { required: true }),
      rel("visit", "Trip visit", "visits", { required: true }),
    ],
    columns: ["stop_label", "status", "reason"],
  },
  extras: {
    title: "Extra costs",
    singular: "extra cost",
    fields: [
      rel("trip", "Trip", "trips", { required: true }),
      f("description", "Agreed extra cost", "text", { required: true }),
      f("amount", "Amount · EUR", "number", { required: true, step: "0.01" }),
    ],
    columns: ["description", "amount"],
  },
  documents: {
    title: "Documents",
    singular: "document",
    description:
      "Transport paperwork and fleet documents, with original files preserved.",
    fields: [
      f("title", "Document title", "text", { required: true }),
      opts(
        "kind",
        "Document category",
        [
          "transport_order",
          "loading_cmr",
          "unloading_cmr",
          ["goods", "Goods documents"],
          "customs",
          "imi",
          "insurance",
          "vehicle",
          "company",
          "other",
        ],
        { default: "transport_order" },
      ),
      f("valid_from", "Valid from", "date"),
      f("expires_on", "Expiry date", "date"),
      note,
    ],
    columns: ["title", "kind", "validity", "expires_on", "files"],
  },
  reviews: {
    title: "Manager reviews",
    singular: "review",
    description:
      "Advance reopening requests and reviews of recorded operational actions.",
    fields: [],
    readonly: true,
    columns: ["kind", "order_label", "requested_by_label", "reason", "status"],
  },
  users: {
    title: "Team accounts",
    singular: "account",
    description: "Individual accounts, shared work and clear responsibility.",
    fields: [
      f("full_name", "Full name", "text", { required: true }),
      f("email", "Login email", "email", { required: true }),
      opts("role", "Business role", ["dispatcher", "manager"], {
        default: "dispatcher",
      }),
      f("password", "Initial / replacement password", "password"),
      f("is_active", "Account active", "checkbox", { default: true }),
    ],
    columns: ["full_name", "email", "role", "is_active"],
  },
  history: {
    title: "Change history",
    description: "Who changed what and when, including manager actions.",
    readonly: true,
    fields: [],
    columns: [
      "created_at",
      "actor_name",
      "resource",
      "object_id",
      "action",
      "changes",
    ],
  },
};

export const columnNames = {
  country_flag: "Country",
  code: "Code",
  country_source: "Source",
  dispatch_summary: "Van · route · booking",
  client_label: "Client",
  partner_label: "Partner",
  dispatcher_label: "Dispatcher",
  price: "Agreed price",
  date_received: "Received",
  order_count: "Orders",
  agreed_revenue: "Agreed revenue",
  is_active: "Status",
  vehicle_count: "Vans",
  driver_count: "Drivers",
  default_rate: "EUR / km",
  vehicle_type: "Van type",
  available_region: "Expected region",
  available_at: "Available from",
  full_name: "Name",
  usual_vehicle_label: "Usual van",
  financials: "Transport margin",
  vehicle_label: "Van",
  driver_label: "Driver",
  files: "Files",
  requested_by_label: "Requested by",
  order_label: "Order",
  created_at: "When",
  actor_name: "Changed by",
  object_id: "Record",
  collection_label: "Collection",
  delivery_label: "Delivery",
  details_confirmed: "Confirmed",
};
