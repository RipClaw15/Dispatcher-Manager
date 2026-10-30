import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Globe,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Truck,
  Trash2,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { all, api, command, human, label, list, money } from "./api";
import { canDelete, columnNames, schemas } from "./schema";
import { Dialog, Empty, ErrorBox, Loading, Pill, RecordForm } from "./ui";
import DeleteDialog from "./DeleteDialog";
import QuickOrderForm from "./QuickOrderForm";
import DispatchSummary from "./DispatchSummary";
import OrderDispatchForm from "./OrderDispatchForm";
import CountryDirectory from "./CountryDirectory";
import CountryValue from "./CountryValue";
import CountryFlag from "./CountryFlag";
import CompleteShipmentDialog from "./CompleteShipmentDialog";
import LoadingDateDialog from "./LoadingDateDialog";
import CountrySelect from "./CountrySelect";

const navigation = [
  ["dashboard", "Overview", LayoutDashboard],
  ["orders", "Orders", Package],
  ["trips", "Trip planning", Route],
  ["clients", "Clients", Building2],
  ["partners", "Transport partners", Warehouse],
  ["vehicles", "Vans & availability", Truck],
  ["drivers", "Drivers", Users],
  ["locations", "Saved locations", MapPin],
  ["countries", "Countries", Globe],
  ["documents", "Documents", FileText],
  ["reviews", "Manager reviews", ShieldCheck],
  ["history", "Change history", History],
  ["users", "Team accounts", Users],
];
const navigationGroups = [
  ["Operations", ["dashboard", "orders", "trips", "documents"]],
  [
    "Directory",
    ["clients", "partners", "vehicles", "drivers", "locations", "countries"],
  ],
  ["Management", ["reviews", "history", "users"]],
];
const numericColumns = new Set([
  "price",
  "default_rate",
  "agreed_revenue",
  "order_count",
  "vehicle_count",
  "driver_count",
  "allocated_revenue",
]);
const resourceIcons = {
  orders: Package,
  trips: Route,
  vehicles: Truck,
  drivers: Users,
  clients: Building2,
  partners: Warehouse,
  locations: MapPin,
  documents: FileText,
};
const basicCatalogs = [
  "clients",
  "partners",
  "contacts",
  "vehicles",
  "drivers",
  "locations",
  "users",
  "countries",
];
const dateTime = (value, zone) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        ...(zone ? { timeZone: zone } : {}),
      }).format(new Date(value))
    : "Not yet known";

function useBundle(paths, revision, allPages = false) {
  const key = JSON.stringify(paths);
  const [state, setState] = useState({
    key,
    data: null,
    loading: true,
    refreshing: false,
    error: null,
  });
  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await Promise.all(
          JSON.parse(key).map(async (path) => {
            const options = { signal: controller.signal };
            const first = await api(path, options);
            if (!allPages || !Array.isArray(first.results)) return first;
            const results = [...first.results];
            let next = first.next;
            while (next) {
              const url = new URL(next, location.origin);
              const page = await api(url.pathname + url.search, options);
              results.push(...page.results);
              next = page.next;
            }
            return { ...first, results, next: null, previous: null };
          }),
        );
        if (active)
          setState({
            key,
            data,
            loading: false,
            refreshing: false,
            error: null,
          });
      } catch (error) {
        if (active && error.name !== "AbortError")
          setState((previous) => ({
            ...previous,
            loading: false,
            refreshing: false,
            error,
          }));
      } finally {
        running = false;
      }
    };
    // Keep the current view mounted during revalidation. Apply the server's
    // saved record immediately, then reload related records together.
    setState((previous) => {
      if (previous.key !== key || !previous.data)
        return {
          key,
          data: null,
          loading: true,
          refreshing: true,
          error: null,
        };
      const saved = revision?.change;
      const data = !saved?.record
        ? previous.data
        : previous.data.map((value, index) => {
            const path = new URL(JSON.parse(key)[index], location.origin)
              .pathname;
            if (!path.startsWith(`/api/${saved.resource}/`)) return value;
            const replace = (record) =>
              record.id === saved.record.id &&
              record.version <= saved.record.version
                ? saved.record
                : record;
            return value.results
              ? { ...value, results: value.results.map(replace) }
              : replace(value);
          });
      return { key, data, loading: false, refreshing: true, error: null };
    });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [key, revision, allPages]);
  return state.key === key
    ? state
    : { data: null, loading: true, refreshing: true, error: null };
}

function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(2) || "dashboard");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(2) || "dashboard");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route.split("/");
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/login/", {
        method: "POST",
        body: { email, password },
      });
      onLogin(result.user);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Route size={25} />
          </span>{" "}
          Dispatch
        </div>
        <div>
          <span className="eyebrow">DISPATCH WORKSPACE</span>
          <h1>
            A little more clarity.
            <br />
            In every journey.
          </h1>
          <p>
            Orders, people and the road ahead.
            <br />
            One shared space for your dispatch team.
          </p>
          <div className="login-route">
            <span>
              <Warehouse /> Collection
            </span>
            <i />
            <span>
              <Truck /> On the road
            </span>
            <i />
            <span>
              <MapPin /> Delivery
            </span>
          </div>
        </div>
        <small>Shipment management · Internal operations</small>
      </div>
      <main className="login-main">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to Dispatch</h2>
          <p>Pick up where your team left off.</p>
          <ErrorBox error={error} />
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button primary login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight size={18} />
          </button>
          <p className="login-help">
            Accounts are managed by your company manager.
          </p>
        </form>
      </main>
    </div>
  );
}

function Cell({ field, value }) {
  if (field === "country_flag")
    return (
      <span className="country-value">
        <CountryFlag country={value} />
        {value.name}
      </span>
    );
  if (
    [
      "country",
      "registration_country",
      "available_country",
      "citizenship",
    ].includes(field)
  )
    return <CountryValue value={value} />;
  if (field === "dispatch_summary") return <DispatchSummary value={value} />;
  if (field === "changes") {
    const readable = (item) =>
      item === null || item === undefined
        ? "Blank"
        : typeof item === "object"
          ? Object.entries(item)
              .map(([key, val]) => `${human(key)}: ${readable(val)}`)
              .join("; ")
          : String(item);
    return (
      <details className="change-details">
        <summary>{value?.length || 0} field change(s)</summary>
        {value?.map((item) => (
          <p key={item.field}>
            <strong>{human(item.field)}</strong>
            <br />
            {readable(item.before)} → {readable(item.after)}
          </p>
        ))}
      </details>
    );
  }
  if (["status", "role", "validity"].includes(field))
    return <Pill value={value} />;
  if (field === "is_active")
    return <Pill value={value ? "active" : "inactive"} />;
  if (field === "details_confirmed")
    return (
      <Pill value={value ? "confirmed" : "planned"}>
        {value ? "Confirmed" : "Unconfirmed"}
      </Pill>
    );
  if (
    ["price", "agreed_revenue", "amount", "allocated_revenue"].includes(field)
  )
    return <span className="numeric">{money(value)}</span>;
  if (field === "default_rate")
    return <span className="numeric">€{Number(value).toFixed(4)}</span>;
  if (field === "financials")
    return (
      <div>
        <span
          className={`numeric ${Number(value?.margin) >= 0 ? "positive" : "negative"}`}
        >
          {money(value?.margin)}
        </span>
        {value?.provisional ? (
          <small className="subtext">Provisional</small>
        ) : (
          <small className="subtext">Final</small>
        )}
      </div>
    );
  if (field === "files")
    return (
      <span>
        {value?.length || 0} file{value?.length === 1 ? "" : "s"}
      </span>
    );
  if (["available_at", "created_at"].includes(field))
    return <span>{dateTime(value)}</span>;
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  return <span>{String(value)}</span>;
}

function Table({
  resource,
  rows,
  columns = schemas[resource]?.columns || [],
  edit,
  view = true,
  emptyTitle,
  emptyText,
  emptyAction,
  remove,
  rowActions,
}) {
  return (
    <>
      <div className="table-scroll">
        <table
          aria-label={schemas[resource]?.title || "Records"}
          className={resource === "orders" ? "orders-table" : undefined}
        >
          <thead>
            <tr>
              {columns.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className={
                    numericColumns.has(key) ? "numeric-cell" : undefined
                  }
                >
                  {columnNames[key] || human(key)}
                </th>
              ))}
              {view || edit || remove || rowActions ? (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-record-id={row.id}>
                {columns.map((key, index) => (
                  <td
                    key={key}
                    className={`${index === 0 ? "primary-cell" : ""} ${numericColumns.has(key) ? "numeric-cell" : ""}`}
                  >
                    {index === 0 && view ? (
                      <a
                        className="record-link"
                        href={`#/${resource}/${row.id}`}
                      >
                        <Cell field={key} value={row[key]} />
                      </a>
                    ) : (
                      <Cell field={key} value={row[key]} />
                    )}
                  </td>
                ))}
                {view || edit || remove || rowActions ? (
                  <td className="table-action">
                    <div className="table-row-actions">
                      {rowActions?.(row)}
                      {view ? (
                        <a
                          aria-label={`View ${label(row)}`}
                          className="icon-button"
                          href={`#/${resource}/${row.id}`}
                        >
                          <ArrowRight size={16} />
                        </a>
                      ) : edit ? (
                        <button
                          className="text-button"
                          onClick={() => edit(resource, row)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {remove ? (
                        <button
                          className="icon-button danger"
                          aria-label={`Delete ${label(row)}`}
                          title={`Delete ${label(row)}`}
                          onClick={() => remove(resource, row)}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? (
        <Empty
          icon={resourceIcons[resource]}
          title={
            emptyTitle ||
            `No ${schemas[resource]?.title.toLowerCase() || "records"} yet`
          }
          text={
            emptyText ||
            "Add your first record to start building your workspace."
          }
          action={emptyAction}
        />
      ) : null}
    </>
  );
}

function Section({ title, subtitle, action, children }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function Metric({ label: title, value, subtitle, icon: Icon, tone = "" }) {
  return (
    <article className={`metric ${tone}`}>
      <div className="metric-label">
        {title}
        <span className="metric-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{subtitle}</small>
    </article>
  );
}

function Dashboard({ revision, edit }) {
  const { data, loading, error } = useBundle(
    [
      "/api/dashboard/",
      "/api/orders/?status=draft,confirmed,in_progress",
      "/api/trips/?status=planned,in_progress,interrupted",
      "/api/vehicles/",
    ],
    revision,
  );
  if (loading) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const [stats, orders, trips, vehicles] = data;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DISPATCH DESK</span>
          <h1>Operations overview</h1>
          <p>The current picture. A clear place to plan what’s next.</p>
        </div>
        <div className="row-actions">
          <button className="button secondary" onClick={() => edit("trips")}>
            <Route size={17} /> Plan a trip
          </button>
          <button className="button primary" onClick={() => edit("orders")}>
            <Plus size={17} />
            New order
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="metrics">
        <Metric
          label="Open orders"
          value={stats.open_orders}
          subtitle="Confirmed & in progress"
          icon={Package}
        />
        <Metric
          label="Active trips"
          value={stats.active_trips}
          subtitle={`${stats.unassigned_trips} planned trips await a van`}
          icon={Route}
        />
        <Metric
          label="Usable vans"
          value={stats.usable_vans}
          subtitle="Check bookings before assigning"
          icon={Truck}
        />
        <Metric
          label="Final trip margin"
          value={money(stats.final_margin)}
          subtitle="Completed, fully allocated journeys"
          icon={ArrowUpRight}
        />
      </div>
      <div className="dashboard-grid">
        <Section
          title="Open orders"
          subtitle="Drafts, confirmed bookings and shipments in progress"
          action={
            <a className="text-button" href="#/orders">
              All orders <ChevronRight size={15} />
            </a>
          }
        >
          <Table
            resource="orders"
            rows={orders.results.slice(0, 6)}
            columns={["dispatch_summary", "status"]}
            emptyTitle="No open orders"
            emptyText="Create an order with the details you have. You can add the client, stops and cargo as they’re confirmed."
            emptyAction={
              <button className="text-button" onClick={() => edit("orders")}>
                <Plus size={16} /> Create an order
              </button>
            }
          />
        </Section>
        <Section
          title="Open trips"
          subtitle="Your next journeys and assignments"
          action={
            <a className="text-button" href="#/trips">
              Trip board <ChevronRight size={15} />
            </a>
          }
        >
          <div className="trip-preview-list">
            {trips.results.slice(0, 4).map((trip) => (
              <a
                className="trip-preview"
                href={`#/trips/${trip.id}`}
                key={trip.id}
              >
                <span className="route-symbol">
                  <Route size={18} />
                </span>
                <div>
                  <strong>{trip.name || trip.reference}</strong>
                  <small>
                    {trip.vehicle_label || "Van not assigned"} ·{" "}
                    {trip.driver_label || "Driver not assigned"}
                  </small>
                </div>
                <Pill value={trip.status} />
              </a>
            ))}
            {trips.results.length === 0 ? (
              <Empty
                icon={Route}
                title="No trips planned"
                text="Plan a journey, group its orders and assign a van when you’re ready."
                action={
                  <button
                    className="button secondary"
                    onClick={() => edit("trips")}
                  >
                    Plan a trip
                  </button>
                }
              />
            ) : null}
          </div>
        </Section>
      </div>
      <Section
        title="Fleet availability"
        subtitle="Expected locations and availability, maintained by your team"
        action={
          <a className="text-button" href="#/vehicles">
            View fleet <ChevronRight size={15} />
          </a>
        }
      >
        <Table
          resource="vehicles"
          rows={vehicles.results.slice(0, 5)}
          columns={[
            "registration",
            "vehicle_type",
            "available_region",
            "available_at",
            "status",
          ]}
          emptyTitle="No vans added yet"
          emptyText="Add a van to keep its rate, availability and documents in one place. A transport partner can be linked later."
          emptyAction={
            <button className="text-button" onClick={() => edit("vehicles")}>
              <Plus size={16} /> Add a van
            </button>
          }
        />
      </Section>
    </>
  );
}

const defaultNotebookFilters = () => ({
  month: "",
  scope: "month",
  search: "",
  status: "",
  vehicle: "",
  client: "",
  loading_country: "",
  delivery_country: "",
});
const calendarLabel = (value, options) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(
    new Date(`${value}T12:00:00Z`),
  );
const shipmentCount = (count) => `${count} shipment${count === 1 ? "" : "s"}`;
function shiftNotebookMonth(value, offset) {
  const [year, month] = value.split("-").map(Number);
  const total = year * 12 + month - 1 + offset;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function OrdersNotebook({
  revision,
  edit,
  catalog,
  remove,
  refresh,
  notify,
  filters,
  setFilters,
}) {
  const [query, setQuery] = useState(filters.search);
  const [dateOrder, setDateOrder] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filters.search), 250);
    return () => clearTimeout(timer);
  }, [filters.search]);
  const set = (key, value) =>
    setFilters((previous) => ({ ...previous, [key]: value }));
  const params = new URLSearchParams(
    Object.entries({ ...filters, search: "", q: query }).filter(
      ([, value]) => value !== "",
    ),
  );
  const { data, loading, refreshing, error } = useBundle(
    [`/api/orders/notebook/?${params}`],
    revision,
    true,
  );
  const result = data?.[0];
  const month = filters.month || result?.month || "";
  const today = result?.today;
  useEffect(() => {
    if (!result?.month || filters.month) return;
    // Resolve the initial latest month once, then keep it selected while
    // changing filters or navigating between the notebook and its orders.
    setFilters((previous) =>
      previous.month ? previous : { ...previous, month: result.month },
    );
  }, [result?.month, filters.month, setFilters]);
  const currentMonth = month === today?.slice(0, 7);
  const groups = new Map();
  for (const order of result?.results || []) {
    const date = order.loading_date || "undated";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(order);
  }
  const futureDates = [...groups.keys()]
    .filter((date) => currentMonth && date > today && date !== "undated")
    .sort()
    .reverse();
  let visibleDates = [...groups.keys()]
    .filter((date) => !futureDates.includes(date))
    .sort()
    .reverse();
  if (
    filters.scope === "month" &&
    currentMonth &&
    !visibleDates.includes(today)
  )
    visibleDates = [today, ...visibleDates];
  const filtered = Boolean(
    query ||
    filters.status ||
    filters.vehicle ||
    filters.client ||
    filters.loading_country ||
    filters.delivery_country,
  );
  const activeFilterCount = [
    filters.search,
    filters.status,
    filters.vehicle,
    filters.client,
    filters.loading_country,
    filters.delivery_country,
    filters.scope === "undated",
  ].filter(Boolean).length;
  const table = (rows) => (
    <Table
      resource="orders"
      rows={rows}
      remove={remove}
      emptyTitle={
        filters.scope === "undated"
          ? "No shipments without a loading date"
          : filtered
            ? "No matching shipments for this day"
            : "No shipments starting this day"
      }
      emptyText="Choose another day or month, adjust the filters, or add a new order."
      rowActions={(order) => (
        <button
          className={order.loading_date ? "icon-button" : "text-button"}
          aria-label={`${order.loading_date ? "Edit" : "Set"} loading date for ${order.reference}`}
          title="First loading date"
          onClick={() => setDateOrder(order)}
        >
          <CalendarDays size={16} />
          {!order.loading_date ? "Set date" : null}
        </button>
      )}
    />
  );
  const day = (date) => (
    <section
      className="panel notebook-day"
      key={date}
      aria-label={
        date === "undated"
          ? "Shipments without a loading date"
          : `Shipments loading ${date}`
      }
      data-loading-day={date}
    >
      <header className="notebook-day-heading">
        <div>
          <span className="eyebrow">
            {date === today
              ? "TODAY"
              : date === "undated"
                ? "NEEDS A DATE"
                : calendarLabel(date, { weekday: "long" })}
          </span>
          <h2>
            {date === "undated"
              ? "Loading date not set"
              : calendarLabel(date, { day: "numeric", month: "long" })}
          </h2>
        </div>
        <span>{shipmentCount(groups.get(date)?.length || 0)}</span>
      </header>
      {table(groups.get(date) || [])}
    </section>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERATIONS NOTEBOOK</span>
          <h1>Orders</h1>
          <p>Grouped by first loading date. Your daily view of the work.</p>
        </div>
        <button className="button primary" onClick={() => edit("orders")}>
          <Plus size={17} /> New order
        </button>
      </div>
      <section
        className={`panel notebook-controls${filtersOpen ? " filters-open" : ""}`}
        aria-label="Order notebook filters"
      >
        <div className="notebook-month-bar">
          <div className="notebook-month-controls">
            <button
              className="icon-button"
              aria-label="Previous month"
              disabled={
                !month || month === "0001-01" || filters.scope === "undated"
              }
              onClick={() => set("month", shiftNotebookMonth(month, -1))}
            >
              <ArrowLeft size={18} />
            </button>
            <label className="field">
              <span>Loading month</span>
              <input
                type="month"
                min="0001-01"
                max="9999-12"
                aria-label="Loading month"
                value={month}
                disabled={filters.scope === "undated"}
                onChange={(event) => set("month", event.target.value)}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Next month"
              disabled={
                !month || month === "9999-12" || filters.scope === "undated"
              }
              onClick={() => set("month", shiftNotebookMonth(month, 1))}
            >
              <ArrowRight size={18} />
            </button>
            <button
              className="text-button"
              disabled={!result}
              title="Show the latest month with shipments matching your filters"
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  month: "",
                  scope: "month",
                }))
              }
            >
              Latest shipments
            </button>
            <button
              className="text-button"
              disabled={!today}
              title="Show the current month, starting with today"
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  month: today.slice(0, 7),
                  scope: "month",
                }))
              }
            >
              Today
            </button>
          </div>
          <button
            type="button"
            className="button secondary notebook-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="order-notebook-filters"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={16} /> Filters
            {activeFilterCount ? ` (${activeFilterCount})` : ""}
            <ChevronDown size={16} className={filtersOpen ? "expanded" : ""} />
          </button>
        </div>
        <div id="order-notebook-filters" hidden={!filtersOpen}>
          <div
            className="notebook-view-tabs"
            role="group"
            aria-label="Notebook view"
          >
            <button
              className={`status-filter ${filters.scope === "month" ? "selected" : ""}`}
              aria-pressed={filters.scope === "month"}
              onClick={() => set("scope", "month")}
            >
              Daily notebook {result ? `(${result.month_count})` : ""}
            </button>
            <button
              className={`status-filter ${filters.scope === "undated" ? "selected" : ""}`}
              aria-pressed={filters.scope === "undated"}
              onClick={() => set("scope", "undated")}
            >
              No loading date {result ? `(${result.undated_count})` : ""}
            </button>
          </div>
          <div className="notebook-filter-grid">
            <label className="field notebook-search">
              <span>Search orders</span>
              <div className="search">
                <Search size={17} />
                <input
                  aria-label="Search Orders"
                  placeholder="Van, route, client or reference…"
                  value={filters.search}
                  onChange={(event) => set("search", event.target.value)}
                />
              </div>
            </label>
            <label className="field">
              <span>Van</span>
              <select
                aria-label="Filter by van"
                value={filters.vehicle}
                onChange={(event) => set("vehicle", event.target.value)}
              >
                <option value="">All vans</option>
                <option value="unassigned">Van not assigned</option>
                {catalog.vehicles?.map((van) => (
                  <option key={van.id} value={van.id}>
                    {van.registration}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Client</span>
              <select
                aria-label="Filter by client"
                value={filters.client}
                onChange={(event) => set("client", event.target.value)}
              >
                <option value="">All clients</option>
                {catalog.clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Loading country</span>
              <CountrySelect
                label="Filter by loading country"
                value={filters.loading_country}
                onChange={(value) => set("loading_country", value)}
                allowCreate={false}
                placeholder="All loading countries"
              />
            </label>
            <label className="field">
              <span>Delivery country</span>
              <CountrySelect
                label="Filter by delivery country"
                value={filters.delivery_country}
                onChange={(value) => set("delivery_country", value)}
                allowCreate={false}
                placeholder="All delivery countries"
              />
            </label>
            <div className="notebook-filter-note">
              <span>
                Country filters match any collection or delivery point.
              </span>
              <button
                className="text-button"
                disabled={!filtered}
                onClick={() =>
                  setFilters((previous) => ({
                    ...defaultNotebookFilters(),
                    month: previous.month,
                    scope: previous.scope,
                  }))
                }
              >
                Clear filters
              </button>
            </div>
          </div>
          <div
            className="status-filters"
            role="group"
            aria-label="Filter orders by status"
          >
            {[
              "",
              "draft",
              "confirmed",
              "in_progress",
              "delivered",
              "cancelled",
            ].map((status) => (
              <button
                className={`status-filter ${filters.status === status ? "selected" : ""}`}
                aria-pressed={filters.status === status}
                key={status}
                onClick={() => set("status", status)}
              >
                {status ? human(status) : "All orders"}
              </button>
            ))}
          </div>
        </div>
      </section>
      <ErrorBox error={error} />
      <div className="notebook-results" role="status">
        {loading
          ? "Loading shipments…"
          : `${result?.count || 0} matching shipment${result?.count === 1 ? "" : "s"}${filters.scope === "undated" ? " without a loading date, across all months" : ` · ${month ? calendarLabel(`${month}-01`, { month: "long", year: "numeric" }) : ""}`}${refreshing ? " · Updating…" : ""}`}
      </div>
      {filters.scope === "month" && result?.undated_count > 0 ? (
        <div className="notice notebook-undated-notice">
          <span>
            {shipmentCount(result.undated_count)}{" "}
            {result.undated_count === 1 ? "still needs" : "still need"} a first
            loading date.
          </span>
          <button
            className="text-button"
            onClick={() => set("scope", "undated")}
          >
            View undated shipments
          </button>
        </div>
      ) : null}
      {loading ? (
        <Loading />
      ) : result ? (
        <>
          {futureDates.length ? (
            <details className="panel notebook-upcoming">
              <summary>
                <CalendarDays size={17} /> Upcoming later this month{" "}
                <span>{shipmentCount(result.upcoming_count)}</span>
              </summary>
              <div>{futureDates.map(day)}</div>
            </details>
          ) : null}
          {visibleDates.length ? (
            visibleDates.map(day)
          ) : (
            <section className="panel">{table([])}</section>
          )}
        </>
      ) : null}
      {dateOrder ? (
        <LoadingDateDialog
          order={dateOrder}
          onClose={() => setDateOrder(null)}
          onSaved={() => {
            setDateOrder(null);
            refresh();
            notify("First loading date saved.");
          }}
        />
      ) : null}
    </>
  );
}

function ResourceList({
  resource,
  revision,
  edit,
  catalog,
  run,
  user,
  remove,
}) {
  const schema = schemas[resource];
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    q: query,
    page,
    ...(status ? { status } : {}),
  });
  const { data, loading, error } = useBundle(
    [`/api/${resource}/?${params}`],
    revision,
  );
  const result = data?.[0];
  const reviewEdit =
    resource === "reviews" && user.role === "manager"
      ? (res, row) =>
          run(res, row, row.kind === "reopen_order" ? "approve" : "review", [
            { key: "note", label: "Review note", type: "textarea" },
          ])
      : undefined;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {navigationGroups.find(([, keys]) => keys.includes(resource))?.[0]}
          </span>
          <h1>{schema.title}</h1>
          <p>{schema.description}</p>
        </div>
        {!schema.readonly ? (
          <button className="button primary" onClick={() => edit(resource)}>
            <Plus size={17} />
            New {schema.singular}
          </button>
        ) : null}
      </div>
      <section className="panel">
        {["orders", "trips"].includes(resource) ? (
          <div
            className="status-filters"
            role="group"
            aria-label={`Filter ${resource} by status`}
          >
            {[
              "",
              ...(resource === "orders"
                ? [
                    "draft",
                    "confirmed",
                    "in_progress",
                    "delivered",
                    "cancelled",
                  ]
                : [
                    "planned",
                    "in_progress",
                    "interrupted",
                    "finished",
                    "cancelled",
                  ]),
            ].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
                className={
                  status === value ? "status-filter selected" : "status-filter"
                }
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                {value ? human(value) : `All ${resource}`}
              </button>
            ))}
          </div>
        ) : null}
        <div className="list-toolbar">
          <label className="search">
            <Search size={17} />
            <input
              aria-label={`Search ${schema.title}`}
              placeholder={
                resource === "orders"
                  ? "Search van, route, client or reference…"
                  : `Search ${schema.title.toLowerCase()}…`
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {resource === "reviews" ? (
            <select
              aria-label="Filter status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {(resource === "orders"
                ? [
                    "draft",
                    "confirmed",
                    "in_progress",
                    "delivered",
                    "cancelled",
                  ]
                : resource === "trips"
                  ? [
                      "planned",
                      "in_progress",
                      "interrupted",
                      "finished",
                      "cancelled",
                    ]
                  : ["pending", "approved", "rejected", "reviewed"]
              ).map((value) => (
                <option value={value} key={value}>
                  {human(value)}
                </option>
              ))}
            </select>
          ) : null}
          <span className="result-count">
            {result?.count ?? "…"} {result?.count === 1 ? "record" : "records"}
          </span>
        </div>
        <ErrorBox error={error} />
        {loading ? (
          <Loading />
        ) : result ? (
          <Table
            resource={resource}
            rows={result.results}
            view={!["history", "reviews", "countries"].includes(resource)}
            edit={reviewEdit}
            remove={canDelete(resource, user) ? remove : undefined}
            emptyTitle={query || status ? "No matching records" : undefined}
            emptyText={
              query || status
                ? "Try a different search or status to find what you’re looking for."
                : undefined
            }
          />
        ) : null}
        <div className="pagination">
          <button
            className="button secondary"
            disabled={!result?.previous}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page}
            {result?.count
              ? ` of ${Math.max(1, Math.ceil(result.count / 100))}`
              : ""}
          </span>
          <button
            className="button secondary"
            disabled={!result?.next}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </section>
      {resource === "reviews" ? (
        <p className="page-note">
          Only managers can decide requests. Reopening requests require
          approval; handovers and en-route cancellations have already happened
          and need review afterward. To reject a reopening, use the order’s
          review panel.
        </p>
      ) : null}
    </>
  );
}

function DocumentCards({ rows, edit, add, upload }) {
  return rows.length ? (
    <div className="document-list">
      {rows.map((document) => (
        <article className="document-card" key={document.id}>
          <span className="document-icon">
            <FileText size={22} />
          </span>
          <div>
            <strong>{document.title}</strong>
            <p>
              {human(document.kind)} · <Pill value={document.validity} />
            </p>
            {document.files.map((file) => (
              <a key={file.id} href={file.url} className="file-link">
                {file.name}
                <small>{dateTime(file.uploaded_at)}</small>
              </a>
            ))}
            <div className="document-links">
              {document.links?.map((link) => (
                <a key={link.id} href={link.url}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <div className="row-actions">
            <button
              className="text-button"
              onClick={() => edit("documents", document)}
            >
              Edit
            </button>
            <button
              className="button secondary small"
              onClick={() => upload(document)}
            >
              Add file / version
            </button>
          </div>
        </article>
      ))}
    </div>
  ) : (
    <Empty
      title="No documents attached"
      text="Files are optional and can be added whenever they arrive."
      action={
        <button className="button secondary" onClick={add}>
          <Plus size={15} />
          Add document
        </button>
      }
    />
  );
}

function OrderDetail({
  id,
  revision,
  edit,
  run,
  catalog,
  user,
  upload,
  notify,
  remove,
  refresh,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [loadingDateOpen, setLoadingDateOpen] = useState(false);
  const paths = [
    `/api/orders/${id}/`,
    `/api/stops/?order=${id}`,
    `/api/cargo/?order=${id}`,
    `/api/legs/?order=${id}`,
    `/api/documents/?linked_resource=orders&linked_id=${id}`,
    `/api/reviews/?order=${id}`,
    `/api/attempts/?order=${id}`,
  ];
  const { data, loading, error } = useBundle(paths, revision);
  if (loading) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const [order, stops, cargo, legs, documents, reviews, attempts] = data;
  const choices = { ...catalog, stops: stops.results };
  const addDocument = () =>
    edit("documents", null, {
      documentLinks: [{ resource: "orders", object_id: order.id }],
    });
  const cancel = () =>
    run("orders", order, "cancel", [
      {
        key: "reason",
        label: "Client cancellation reason",
        type: "textarea",
        required: true,
      },
    ]);
  return (
    <>
      <a className="back-link" href="#/orders">
        <ArrowLeft size={15} />
        All orders
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLIENT BOOKING</span>
          <h1>
            {order.reference}
            <Pill value={order.status} />
          </h1>
          <p>
            {order.client_label || "Client not yet selected"}
            {order.client_reference
              ? ` · ${order.client_reference}`
              : ""} · {order.dispatcher_label}
          </p>
        </div>
        <div className="row-actions">
          {["confirmed", "in_progress"].includes(order.status) &&
          !order.return_pending ? (
            <button
              className="button primary"
              onClick={() => setCompletionOpen(true)}
            >
              <Check size={16} />
              Mark completed
            </button>
          ) : null}
          <button
            className="button secondary"
            onClick={() => setDispatchOpen(true)}
          >
            Edit van / driver / start
          </button>
          <button
            className="button secondary"
            onClick={() => edit("orders", order)}
          >
            Edit details
          </button>
          <button
            className="button danger-outline"
            onClick={() => remove("orders", order)}
          >
            <Trash2 size={16} /> Delete
          </button>
          {order.status === "draft" ? (
            <button
              className="button primary"
              onClick={() => run("orders", order, "confirm")}
            >
              <Check size={16} />
              Confirm booking
            </button>
          ) : null}
          {["draft", "confirmed", "in_progress"].includes(order.status) &&
          !order.return_pending ? (
            <button className="button secondary" onClick={cancel}>
              Cancel booking
            </button>
          ) : null}
          {order.status === "delivered" ? (
            <button
              className="button secondary"
              onClick={() =>
                run("orders", order, "request_reopen", [
                  {
                    key: "stop",
                    label: "Completed stop to correct",
                    type: "select",
                    options: stops.results
                      .filter((stop) => stop.status === "completed")
                      .map((stop) => [stop.id, label(stop)]),
                    required: true,
                  },
                  {
                    key: "reason",
                    label: "Reason for reopening",
                    type: "textarea",
                    required: true,
                  },
                ])
              }
            >
              Request reopening
            </button>
          ) : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {order.return_pending ? (
        <div className="notice">
          Return pending · The order stays in progress until goods are returned
          to the loading point. Plan its return stops on the assigned trip.
        </div>
      ) : null}
      {order.resolution ? (
        <div className="notice">
          {order.resolution} · {order.cancellation_reason}
        </div>
      ) : null}
      <section className="dispatch-sheet" aria-label="Dispatch summary">
        <DispatchSummary value={order.dispatch_summary} showDriver />
        <button
          className="text-button"
          onClick={() => setLoadingDateOpen(true)}
        >
          <CalendarDays size={15} /> First loading:{" "}
          {order.loading_date
            ? calendarLabel(order.loading_date, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "date not set"}
        </button>
        {order.dispatch_summary?.trip_id ? (
          <a
            className="text-button"
            href={`#/trips/${order.dispatch_summary.trip_id}`}
          >
            Trip plan & rate <ArrowRight size={15} />
          </a>
        ) : null}
      </section>
      {loadingDateOpen ? (
        <LoadingDateDialog
          order={order}
          onClose={() => setLoadingDateOpen(false)}
          onSaved={() => {
            setLoadingDateOpen(false);
            refresh();
            notify("First loading date saved.");
          }}
        />
      ) : null}
      {dispatchOpen ? (
        <OrderDispatchForm
          order={order}
          catalog={catalog}
          onClose={() => setDispatchOpen(false)}
          onSaved={() => {
            setDispatchOpen(false);
            refresh();
            notify("Dispatch details saved.");
          }}
        />
      ) : null}
      {completionOpen ? (
        <CompleteShipmentDialog
          order={order}
          onClose={() => setCompletionOpen(false)}
          onSaved={() => {
            setCompletionOpen(false);
            refresh();
            notify("Shipment completed — marked Delivered.");
          }}
        />
      ) : null}
      <details
        className="shipment-details"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary>
          <ChevronRight size={18} />
          <strong>Shipment details</strong>
          <span>Cargo, full addresses, appointments and documents</span>
        </summary>
        <div className="shipment-details-body">
          <div className="detail-facts">
            <div>
              <span>Agreed client price</span>
              <strong>{money(order.price)}</strong>
            </div>
            <div>
              <span>Received</span>
              <strong>{order.date_received}</strong>
            </div>
            <div>
              <span>Customs</span>
              <strong>
                {order.customs_required ? "Handling needed" : "Not required"}
              </strong>
            </div>
            <div>
              <span>Transport assignments</span>
              <strong>
                {legs.count} leg{legs.count === 1 ? "" : "s"}
              </strong>
            </div>
          </div>
          <Section
            title="Collection & delivery tasks"
            subtitle="Locations and appointment details can remain provisional."
            action={
              <button
                className="button secondary small"
                onClick={() =>
                  edit("stops", null, {
                    fixed: { order: order.id },
                    defaults: { position: stops.results.length + 1 },
                  })
                }
              >
                <Plus size={15} />
                Add stop
              </button>
            }
          >
            <div className="stop-list">
              {stops.results.map((stop) => (
                <article className="stop-card" key={stop.id}>
                  <span className={`stop-symbol ${stop.kind}`}>
                    <MapPin size={20} />
                  </span>
                  <div className="stop-main">
                    <div className="row-actions">
                      <strong>
                        {human(stop.kind)} ·{" "}
                        {stop.short_code ||
                          stop.location_name ||
                          stop.city ||
                          stop.postal_code ||
                          "Location pending"}
                      </strong>
                      <Pill value={stop.status} />
                      {!stop.location_confirmed ? (
                        <span className="minor-label">Provisional address</span>
                      ) : null}
                    </div>
                    <p>
                      {[stop.address, stop.city, stop.postal_code, stop.country]
                        .filter(Boolean)
                        .join(", ") || "Full address awaiting instructions"}
                    </p>
                    <small>
                      {stop.planned_date || "Date pending"}
                      {stop.time_from
                        ? ` · ${stop.time_from.slice(0, 5)}${stop.time_to ? `–${stop.time_to.slice(0, 5)}` : ""}`
                        : ""}{" "}
                      · {stop.timezone || "Timezone not yet confirmed"}
                    </small>
                    {stop.external_reference ? (
                      <small>Reference: {stop.external_reference}</small>
                    ) : null}
                    {stop.instructions ? <p>{stop.instructions}</p> : null}
                    <details>
                      <summary>
                        {
                          attempts.results.filter(
                            (attempt) => attempt.stop === stop.id,
                          ).length
                        }{" "}
                        attempt(s)
                      </summary>
                      {attempts.results
                        .filter((attempt) => attempt.stop === stop.id)
                        .map((attempt) => (
                          <p key={attempt.id}>
                            {attempt.visit_label} · {human(attempt.status)}{" "}
                            {attempt.reason ? `— ${attempt.reason}` : ""}
                          </p>
                        ))}
                    </details>
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() =>
                        edit("stops", stop, { fixed: { order: order.id } })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        edit("documents", null, {
                          defaults: {
                            kind:
                              stop.kind === "collection"
                                ? "loading_cmr"
                                : "unloading_cmr",
                          },
                          documentLinks: [
                            { resource: "orders", object_id: order.id },
                            { resource: "stops", object_id: stop.id },
                          ],
                        })
                      }
                    >
                      Add paperwork
                    </button>
                  </div>
                </article>
              ))}
              {!stops.count ? (
                <Empty
                  title="Add the collection and delivery"
                  text="A site name, town or postal code is enough to start."
                />
              ) : null}
            </div>
          </Section>
          <Section
            title="Cargo"
            subtitle="Edit reported and actual details directly; no manager approval is needed."
            action={
              <button
                className="button secondary small"
                onClick={() =>
                  edit("cargo", null, {
                    fixed: { order: order.id },
                    extraCatalog: choices,
                  })
                }
              >
                <Plus size={15} />
                Add cargo
              </button>
            }
          >
            <div className="cargo-cards">
              {cargo.results.map((item) => (
                <article className="cargo-card" key={item.id}>
                  <div className="row-actions">
                    <h3>{item.description}</h3>
                    {item.has_discrepancy ? (
                      <Pill value="unsuccessful">Details differ</Pill>
                    ) : null}
                    <button
                      className="text-button push-right"
                      onClick={() =>
                        edit("cargo", item, {
                          fixed: { order: order.id },
                          extraCatalog: choices,
                        })
                      }
                    >
                      Edit cargo
                    </button>
                  </div>
                  <p>
                    {item.collection_label} <ArrowRight size={14} />{" "}
                    {item.delivery_label}
                  </p>
                  <div className="cargo-comparison">
                    <div>
                      <span>Client reported</span>
                      <CargoSummary data={item.reported} />
                    </div>
                    <div>
                      <span>Actual at collection</span>
                      <CargoSummary data={item.actual} />
                    </div>
                  </div>
                </article>
              ))}
              {!cargo.count ? (
                <Empty
                  title="Describe the goods"
                  text="Link each cargo entry to its collection and delivery."
                />
              ) : null}
            </div>
          </Section>
          <Section
            title="Transport legs & allocated revenue"
            action={
              order.status === "in_progress" ? (
                <button
                  className="button secondary small"
                  onClick={() =>
                    run("orders", order, "handover", [
                      {
                        key: "from_leg",
                        label: "Source trip",
                        type: "select",
                        options: legs.results
                          .filter((leg) => !leg.is_cancelled && !leg.ended_at)
                          .map((leg) => [leg.id, leg.trip_label]),
                        required: true,
                      },
                      {
                        key: "to_trip",
                        label: "Receiving trip",
                        type: "select",
                        options: catalog.trips?.map((trip) => [
                          trip.id,
                          `${trip.reference} · ${trip.vehicle_label || "van pending"}`,
                        ]),
                        required: true,
                      },
                      {
                        key: "location",
                        label: "Actual handover location",
                        required: true,
                      },
                      {
                        key: "reason",
                        label: "Reason for handover",
                        type: "textarea",
                        required: true,
                      },
                      {
                        key: "is_emergency",
                        label: "Emergency handover — manager reviews afterward",
                        type: "checkbox",
                        default: true,
                      },
                    ])
                  }
                >
                  Record handover
                </button>
              ) : null
            }
          >
            <Table
              resource="legs"
              rows={legs.results}
              columns={["trip_label", "allocated_revenue", "ended_at"]}
              view={false}
              edit={(res, row) =>
                edit(res, row, { fixed: { order: row.order, trip: row.trip } })
              }
            />
            <p className="panel-note">
              A single-trip order contributes its full agreed price. For
              multi-trip orders, enter each leg’s revenue allocation so the
              total matches the order price.
            </p>
          </Section>
          <Section
            title="Documents"
            action={
              <button className="button secondary small" onClick={addDocument}>
                <Plus size={15} />
                Add document
              </button>
            }
          >
            <DocumentCards
              rows={documents.results}
              edit={edit}
              add={addDocument}
              upload={upload}
            />
          </Section>
          {reviews.count ? (
            <Section title="Approval & review history">
              <div className="review-list">
                {reviews.results.map((review) => (
                  <article key={review.id}>
                    <div>
                      <strong>{human(review.kind)}</strong>
                      <p>{review.reason}</p>
                      <Pill value={review.status} />
                    </div>
                    {user.role === "manager" && review.status === "pending" ? (
                      <div className="row-actions">
                        {review.kind === "reopen_order" ? (
                          <>
                            <button
                              className="button primary small"
                              onClick={() =>
                                run("reviews", review, "approve", [
                                  {
                                    key: "note",
                                    label: "Decision note",
                                    type: "textarea",
                                  },
                                ])
                              }
                            >
                              Approve
                            </button>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                run("reviews", review, "reject", [
                                  {
                                    key: "note",
                                    label: "Decision note",
                                    type: "textarea",
                                  },
                                ])
                              }
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <button
                            className="button secondary small"
                            onClick={() =>
                              run("reviews", review, "review", [
                                {
                                  key: "note",
                                  label: "Review note",
                                  type: "textarea",
                                },
                              ])
                            }
                          >
                            Mark reviewed
                          </button>
                        )}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </details>
    </>
  );
}

function CargoSummary({ data }) {
  return Object.keys(data || {}).length ? (
    <div>
      {Object.entries(data).map(([key, value]) => (
        <small key={key}>
          {human(key)}: <strong>{String(value)}</strong>
        </small>
      ))}
    </div>
  ) : (
    <p className="muted">Not yet supplied</p>
  );
}

function TripDetail({
  id,
  revision,
  edit,
  run,
  catalog,
  direct,
  remove,
  upload,
}) {
  const { data, loading, refreshing, error } = useBundle(
    [
      `/api/trips/${id}/`,
      `/api/legs/?trip=${id}`,
      `/api/visits/?trip=${id}`,
      `/api/attempts/?trip=${id}`,
      `/api/stops/?trip=${id}`,
      `/api/extras/?trip=${id}`,
      `/api/documents/?trip=${id}`,
    ],
    revision,
    true,
  );
  if (loading) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const [trip, legs, visits, attempts, stops, extras, documents] = data;
  const choices = { ...catalog, stops: stops.results, visits: visits.results };
  const addDocument = (visit = null) => {
    const kinds = attempts.results
      .filter((attempt) => attempt.visit === visit?.id)
      .map(
        (attempt) =>
          stops.results.find((stop) => stop.id === attempt.stop)?.kind,
      );
    const kind =
      visit?.kind === "customs"
        ? "customs"
        : kinds.length && kinds.every((value) => value === "collection")
          ? "loading_cmr"
          : kinds.length && kinds.every((value) => value === "delivery")
            ? "unloading_cmr"
            : "other";
    edit("documents", null, {
      documentLinks: [
        {
          resource: visit ? "visits" : "trips",
          object_id: visit?.id || trip.id,
        },
      ],
      defaults: {
        kind,
        title: visit
          ? `${human(kind)} · ${visit.short_code || visit.location_name || `Visit ${visit.position}`}`
          : "",
      },
    });
  };
  const move = (visit, direction) => {
    const ids = visits.results.map((item) => item.id);
    const index = ids.indexOf(visit.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    direct("trips", trip, "reorder", {
      visits: ids,
      versions: Object.fromEntries(
        visits.results.map((item) => [item.id, item.version]),
      ),
    });
  };
  return (
    <>
      <a className="back-link" href="#/trips">
        <ArrowLeft size={15} />
        All trips
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VAN JOURNEY</span>
          <h1>
            {trip.reference}
            <Pill value={trip.status} />
          </h1>
          <p>
            {trip.name || "Trip name not set"} · {trip.dispatcher_label}
          </p>
        </div>
        <div className="row-actions">
          <button
            className="button secondary"
            onClick={() => edit("trips", trip)}
          >
            Edit trip
          </button>
          <button
            className="button danger-outline"
            onClick={() => remove("trips", trip)}
          >
            <Trash2 size={16} /> Delete
          </button>
          {trip.status === "planned" ? (
            <>
              <button
                className="button primary"
                onClick={() => run("trips", trip, "start")}
              >
                Start trip
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  run("trips", trip, "cancel", [
                    {
                      key: "reason",
                      label: "Cancellation reason",
                      type: "textarea",
                      required: true,
                    },
                  ])
                }
              >
                Cancel trip
              </button>
            </>
          ) : null}
          {trip.status === "in_progress" ? (
            <button
              className="button secondary"
              onClick={() =>
                run("trips", trip, "interrupt", [
                  {
                    key: "reason",
                    label: "Interruption reason",
                    type: "textarea",
                    required: true,
                  },
                ])
              }
            >
              Record interruption
            </button>
          ) : null}
          {trip.status === "interrupted" ? (
            <button
              className="button secondary"
              onClick={() => run("trips", trip, "resume")}
            >
              Resume same van
            </button>
          ) : null}
          {["in_progress", "interrupted"].includes(trip.status) ? (
            <button
              className="button primary"
              onClick={() =>
                run("trips", trip, "finish", [
                  {
                    key: "reason",
                    label: "Finish / ended-early note",
                    type: "textarea",
                  },
                ])
              }
            >
              Finish journey
            </button>
          ) : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {trip.warnings?.map((warning) => (
        <div className="notice" key={warning}>
          {warning}
        </div>
      ))}
      <div className="detail-facts">
        <div>
          <span>Transport partner</span>
          <strong>{trip.partner_label || "Not yet assigned"}</strong>
        </div>
        <div>
          <span>Van</span>
          <strong>{trip.vehicle_label || "Not yet assigned"}</strong>
        </div>
        <div>
          <span>Driver</span>
          <strong>{trip.driver_label || "Not yet assigned"}</strong>
          {trip.driver ? (
            <small className="driver-citizenship">
              Citizenship:{" "}
              {trip.driver_citizenship ? (
                <CountryValue value={trip.driver_citizenship} />
              ) : (
                "Not recorded"
              )}
            </small>
          ) : null}
        </div>
        <div>
          <span>Whole-trip rate</span>
          <strong>
            {trip.rate === null
              ? "Not agreed yet"
              : `€${Number(trip.rate).toFixed(4)} / km`}
          </strong>
        </div>
      </div>
      <div className="metrics">
        <Metric
          label="Allocated revenue"
          value={money(trip.financials.revenue)}
          subtitle="Client prices counted once"
          icon={ClipboardList}
        />
        <Metric
          label="Payable distance"
          value={`${trip.actual_km ?? trip.estimated_km ?? "—"} km`}
          subtitle={
            trip.actual_km === null
              ? "Estimated · empty + loaded travel"
              : "Final · empty + loaded travel"
          }
          icon={Route}
        />
        <Metric
          label="Partner transport cost"
          value={money(trip.financials.cost)}
          subtitle={`${money(trip.financials.extras)} agreed extras included`}
          icon={Truck}
        />
        <Metric
          label="Transport margin"
          value={money(trip.financials.margin)}
          subtitle={
            trip.financials.provisional
              ? "Provisional — journey or allocation incomplete"
              : "Final operational margin"
          }
          icon={ArrowUpRight}
          tone="metric-highlight"
        />
      </div>
      <Section
        title="Orders on this trip"
        action={
          !["finished", "cancelled"].includes(trip.status) ? (
            <button
              className="button secondary small"
              onClick={() =>
                run("trips", trip, "assign_order", [
                  {
                    key: "order",
                    label: "Order to assign",
                    type: "select",
                    options: catalog.orders?.map((order) => [
                      order.id,
                      `${order.reference} · ${order.client_label || "client pending"}`,
                    ]),
                    required: true,
                  },
                ])
              }
            >
              <Plus size={15} />
              Assign order & plan stops
            </button>
          ) : null
        }
      >
        <div className="assignment-list">
          {legs.results.map((leg) => (
            <article key={leg.id}>
              <a href={`#/orders/${leg.order}`}>
                <strong>{leg.order_label}</strong>
                <small>
                  {leg.is_cancelled
                    ? "Released assignment"
                    : leg.ended_at
                      ? "Leg ended / handed over"
                      : "Active assignment"}
                </small>
              </a>
              <span>
                {leg.allocated_revenue === null
                  ? "Full price for single-trip orders"
                  : money(leg.allocated_revenue)}
              </span>
              <button
                className="text-button"
                onClick={() =>
                  edit("legs", leg, {
                    fixed: { order: leg.order, trip: trip.id },
                  })
                }
              >
                Edit allocation
              </button>
              {trip.status === "planned" && !leg.is_cancelled ? (
                <button
                  className="text-button"
                  onClick={() => run("legs", leg, "release")}
                >
                  Release
                </button>
              ) : null}
            </article>
          ))}
          {!legs.count ? (
            <Empty
              title="Group the work first"
              text="Assign orders now; partner, van and driver can be chosen later."
            />
          ) : null}
        </div>
      </Section>
      <Section
        title="Route visits"
        subtitle="One visit can cover several orders. Each task keeps its own outcome."
        action={
          !["finished", "cancelled"].includes(trip.status) ? (
            <div className="row-actions">
              <button
                className="text-button"
                onClick={() => run("trips", trip, "plan_outstanding")}
              >
                Plan outstanding stops
              </button>
              <button
                className="button secondary small"
                onClick={() =>
                  edit("visits", null, {
                    fixed: { trip: trip.id },
                    defaults: { position: visits.results.length + 1 },
                  })
                }
              >
                <Plus size={15} />
                Add visit
              </button>
            </div>
          ) : null
        }
      >
        <div className="route-update-status" role="status" aria-live="polite">
          {refreshing ? "Updating route…" : ""}
        </div>
        <div className="route-list" aria-busy={refreshing} inert={refreshing}>
          {visits.results.map((visit, index) => (
            <article
              className={`visit-card visit-${visit.status}`}
              key={visit.id}
              data-visit-id={visit.id}
            >
              <div className="visit-index">{index + 1}</div>
              <div className="visit-content">
                <div className="row-actions">
                  <h3>
                    {visit.short_code ||
                      visit.location_name ||
                      visit.city ||
                      visit.postal_code ||
                      human(visit.kind)}
                  </h3>
                  <Pill value={visit.status} />
                  <span className="minor-label">{human(visit.kind)}</span>
                  <div className="push-right row-actions">
                    <button
                      aria-label="Move visit up"
                      className="icon-button"
                      disabled={index === 0}
                      onClick={() => move(visit, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      aria-label="Move visit down"
                      className="icon-button"
                      disabled={index === visits.results.length - 1}
                      onClick={() => move(visit, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        edit("visits", visit, { fixed: { trip: trip.id } })
                      }
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <p>
                  {[visit.address, visit.city, visit.postal_code, visit.country]
                    .filter(Boolean)
                    .join(", ") || "Full address pending"}
                </p>
                <small>
                  {visit.timezone || "Timezone not confirmed"}
                  {visit.arrived_at
                    ? ` · Arrived ${dateTime(visit.arrived_at, visit.timezone)}`
                    : ""}
                  {visit.departed_at
                    ? ` · Departed ${dateTime(visit.departed_at, visit.timezone)}`
                    : ""}
                </small>
                <div className="visit-tasks">
                  {attempts.results
                    .filter((attempt) => attempt.visit === visit.id)
                    .map((attempt) => (
                      <div
                        className={`visit-task task-${attempt.status}`}
                        key={attempt.id}
                      >
                        <div>
                          <strong>{attempt.stop_label}</strong>
                          <small>
                            {attempt.stop_label &&
                              stops.results.find(
                                (stop) => stop.id === attempt.stop,
                              )?.order_label}
                          </small>
                          {attempt.reason ? (
                            <small>{attempt.reason}</small>
                          ) : null}
                        </div>
                        <Pill value={attempt.status} />
                        {attempt.is_current && visit.status === "arrived" ? (
                          <>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                run("attempts", attempt, "complete")
                              }
                            >
                              Complete task
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                run("attempts", attempt, "fail", [
                                  {
                                    key: "reason",
                                    label:
                                      "Why could this task not be completed?",
                                    type: "textarea",
                                    required: true,
                                  },
                                ])
                              }
                            >
                              Unsuccessful
                            </button>
                          </>
                        ) : null}
                        {attempt.is_current && attempt.status === "planned" ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              run("attempts", attempt, "remove", [
                                {
                                  key: "reason",
                                  label: "Reason for removing this attempt",
                                  required: true,
                                },
                              ])
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                </div>
                <div className="visit-actions">
                  {!["departed", "cancelled"].includes(visit.status) ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        edit("attempts", null, {
                          fixed: { visit: visit.id },
                          extraCatalog: choices,
                        })
                      }
                    >
                      <Plus size={14} />
                      Add order task
                    </button>
                  ) : null}
                  <span className="push-right" />
                  {visit.status === "planned" &&
                  trip.status === "in_progress" ? (
                    <button
                      className="button primary small"
                      onClick={() => run("visits", visit, "en_route")}
                    >
                      En route
                    </button>
                  ) : null}
                  {visit.status === "en_route" ? (
                    <button
                      className="button primary small"
                      onClick={() => run("visits", visit, "arrive")}
                    >
                      Arrived
                    </button>
                  ) : null}
                  {visit.status === "arrived" ? (
                    <button
                      className="button primary small"
                      onClick={() => run("visits", visit, "depart")}
                    >
                      Record departure
                    </button>
                  ) : null}
                  {["planned", "en_route"].includes(visit.status) ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        run("visits", visit, "cancel", [
                          {
                            key: "reason",
                            label: "Reason for cancelling this visit",
                            required: true,
                          },
                        ])
                      }
                    >
                      Cancel visit
                    </button>
                  ) : null}
                </div>
                <section
                  className="visit-documents"
                  aria-label={`Documents for visit ${index + 1}`}
                >
                  <header>
                    <strong>
                      <FileText size={15} /> Visit documents
                    </strong>
                    <button
                      className="button secondary small"
                      onClick={() => addDocument(visit)}
                    >
                      <Plus size={14} /> Add document
                    </button>
                  </header>
                  {documents.results.some((document) =>
                    document.links.some(
                      (link) =>
                        link.resource === "visits" &&
                        link.object_id === visit.id,
                    ),
                  ) ? (
                    <DocumentCards
                      rows={documents.results.filter((document) =>
                        document.links.some(
                          (link) =>
                            link.resource === "visits" &&
                            link.object_id === visit.id,
                        ),
                      )}
                      edit={edit}
                      upload={upload}
                    />
                  ) : (
                    <p className="muted">
                      No documents yet. Uploads are optional.
                    </p>
                  )}
                </section>
              </div>
            </article>
          ))}
          {!visits.count ? (
            <Empty
              title="Build the route"
              text="Assign an order to plan its stops, then adjust the sequence or group tasks into shared visits."
            />
          ) : null}
        </div>
      </Section>
      <Section
        title="All trip documents"
        subtitle="Trip, visit and shipment paperwork in one place. Files remain optional."
        action={
          <button
            className="button secondary small"
            onClick={() => addDocument()}
          >
            <Plus size={15} /> Add document
          </button>
        }
      >
        <DocumentCards
          rows={documents.results}
          edit={edit}
          upload={upload}
          add={() => addDocument()}
        />
      </Section>
      <Section
        title="Agreed extra costs"
        action={
          <button
            className="button secondary small"
            onClick={() => edit("extras", null, { fixed: { trip: trip.id } })}
          >
            <Plus size={15} />
            Add extra
          </button>
        }
      >
        <Table
          resource="extras"
          rows={extras.results}
          view={false}
          edit={(res, row) => edit(res, row, { fixed: { trip: trip.id } })}
        />
      </Section>
    </>
  );
}

function ProfileDetail({
  resource,
  id,
  revision,
  edit,
  upload,
  linkDocument,
  catalog,
  user,
  remove,
}) {
  const [historyFilters, setHistoryFilters] = useState({
    status: "",
    dispatcher: "",
    received_from: "",
    received_to: "",
    page: 1,
  });
  const historyQuery = new URLSearchParams(
    Object.entries(historyFilters).filter(([, value]) => value !== ""),
  );
  const filterHistory = (key, value) =>
    setHistoryFilters((previous) => ({ ...previous, [key]: value, page: 1 }));
  const hasDocs = [
    "clients",
    "partners",
    "vehicles",
    "drivers",
    "documents",
  ].includes(resource);
  const related =
    resource === "clients"
      ? [
          `/api/contacts/?client=${id}`,
          `/api/orders/?client=${id}&${historyQuery}`,
        ]
      : resource === "partners"
        ? [
            `/api/contacts/?partner=${id}`,
            `/api/vehicles/?partner=${id}`,
            `/api/drivers/?partner=${id}`,
            `/api/trips/?partner=${id}`,
          ]
        : ["vehicles", "drivers"].includes(resource)
          ? [
              `/api/trips/?${resource === "vehicles" ? "vehicle" : "driver"}=${id}`,
            ]
          : [];
  const { data, loading, error } = useBundle(
    [
      `/api/${resource}/${id}/`,
      ...(hasDocs && resource !== "documents"
        ? [`/api/documents/?linked_resource=${resource}&linked_id=${id}`]
        : []),
      ...related,
    ],
    revision,
  );
  if (loading) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const record = data[0];
  const docs =
    hasDocs && resource !== "documents" ? data[1]?.results || [] : [];
  const rest = data.slice(hasDocs && resource !== "documents" ? 2 : 1);
  const addDocument = () =>
    edit("documents", null, {
      documentLinks: [{ resource, object_id: record.id }],
    });
  return (
    <>
      <a className="back-link" href={`#/${resource}`}>
        <ArrowLeft size={15} />
        All {schemas[resource].title.toLowerCase()}
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {schemas[resource].singular.toUpperCase()} PROFILE
          </span>
          <h1>{label(record)}</h1>
          <p>
            {record.country ||
              record.partner_label ||
              record.email ||
              "Shared company record"}
          </p>
        </div>
        <div className="row-actions">
          {resource === "documents" ? (
            <button
              className="button secondary"
              onClick={() => linkDocument(record)}
            >
              Link record
            </button>
          ) : null}
          <button
            className="button secondary"
            onClick={() => edit(resource, record)}
          >
            Edit profile
          </button>
          {canDelete(resource, user) ? (
            <button
              className="button danger-outline"
              onClick={() => remove(resource, record)}
            >
              <Trash2 size={16} /> Delete
            </button>
          ) : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {["partners", "vehicles"].includes(resource) ? (
        <div className="metrics">
          <Metric
            label="Trip history"
            value={record.trip_count}
            subtitle="All recorded assignments"
            icon={Route}
          />
          <Metric
            label="Recorded payable distance"
            value={`${Number(record.payable_km_total).toLocaleString("en-GB")} km`}
            subtitle="Finished journeys with final figures"
            icon={Truck}
          />
          <Metric
            label="Recorded transport costs"
            value={money(record.transport_cost_total)}
            subtitle={`${record.finalized_trip_count} journeys with known final costs`}
            icon={ClipboardList}
          />
          <Metric
            label={
              resource === "partners"
                ? "Vans supplied"
                : "Default kilometre rate"
            }
            value={
              resource === "partners"
                ? record.vehicle_count
                : `€${Number(record.default_rate).toFixed(4)}`
            }
            subtitle={
              resource === "partners"
                ? `${record.driver_count} linked drivers`
                : "Actual agreed rate is retained per trip"
            }
            icon={resource === "partners" ? Users : Route}
          />
        </div>
      ) : null}
      {resource === "clients" ? (
        <div className="metrics">
          <Metric
            label="Total orders"
            value={record.order_count}
            subtitle="Each order counted once"
            icon={Package}
          />
          <Metric
            label="Agreed revenue"
            value={money(record.agreed_revenue)}
            subtitle="Across client bookings"
            icon={ClipboardList}
          />
          <Metric
            label="Delivered"
            value={record.status_counts.delivered}
            subtitle="Completed customer transport"
            icon={Check}
          />
          <Metric
            label="Most recent booking"
            value={record.most_recent_order || "—"}
            subtitle="Order received date"
            icon={History}
          />
        </div>
      ) : null}
      <Section title="Profile details">
        <dl className="profile-details">
          {schemas[resource].fields
            .filter((field) => !["password", "notes"].includes(field.key))
            .map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {field.type === "country" ? (
                    <CountryValue value={record[field.key]} />
                  ) : field.type === "relation" ? (
                    record[field.key + "_label"] || "Not assigned"
                  ) : typeof record[field.key] === "boolean" ? (
                    record[field.key] ? (
                      "Yes"
                    ) : (
                      "No"
                    )
                  ) : (
                    (record[field.key] ?? "Not yet supplied")
                  )}
                </dd>
              </div>
            ))}
        </dl>
        {record.notes ? <p className="panel-note">{record.notes}</p> : null}
      </Section>
      {["clients", "partners"].includes(resource) ? (
        <Section
          title="Contacts"
          action={
            <button
              className="button secondary small"
              onClick={() =>
                edit("contacts", null, {
                  fixed: {
                    [resource === "clients" ? "client" : "partner"]: record.id,
                  },
                })
              }
            >
              <Plus size={15} />
              Add contact
            </button>
          }
        >
          <Table
            resource="contacts"
            rows={rest[0]?.results || []}
            remove={user.role === "manager" ? remove : undefined}
            view={false}
            edit={(res, row) =>
              edit(res, row, {
                fixed: {
                  [resource === "clients" ? "client" : "partner"]: record.id,
                },
              })
            }
          />
        </Section>
      ) : null}
      {resource === "clients" ? (
        <Section title="Order history">
          <div className="history-filters">
            <label className="field">
              <span>Status</span>
              <select
                aria-label="Order history status"
                value={historyFilters.status}
                onChange={(event) =>
                  filterHistory("status", event.target.value)
                }
              >
                <option value="">All ({record.order_count})</option>
                {Object.entries(record.status_counts).map(([key, count]) => (
                  <option key={key} value={key}>
                    {human(key)} ({count})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Responsible dispatcher</span>
              <select
                aria-label="Order history dispatcher"
                value={historyFilters.dispatcher}
                onChange={(event) =>
                  filterHistory("dispatcher", event.target.value)
                }
              >
                <option value="">All dispatchers</option>
                {catalog.users?.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Received from</span>
              <input
                type="date"
                value={historyFilters.received_from}
                onChange={(event) =>
                  filterHistory("received_from", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Received until</span>
              <input
                type="date"
                value={historyFilters.received_to}
                onChange={(event) =>
                  filterHistory("received_to", event.target.value)
                }
              />
            </label>
          </div>
          <Table resource="orders" rows={rest[1]?.results || []} />
          <div className="pagination">
            <button
              className="button secondary"
              disabled={!rest[1]?.previous}
              onClick={() =>
                setHistoryFilters((previous) => ({
                  ...previous,
                  page: previous.page - 1,
                }))
              }
            >
              Previous
            </button>
            <span>
              {rest[1]?.count || 0} matching orders · Page {historyFilters.page}
            </span>
            <button
              className="button secondary"
              disabled={!rest[1]?.next}
              onClick={() =>
                setHistoryFilters((previous) => ({
                  ...previous,
                  page: previous.page + 1,
                }))
              }
            >
              Next
            </button>
          </div>
        </Section>
      ) : null}
      {resource === "partners" ? (
        <>
          <Section title="Vans supplied">
            <Table resource="vehicles" rows={rest[1]?.results || []} />
          </Section>
          <Section title="Drivers">
            <Table resource="drivers" rows={rest[2]?.results || []} />
          </Section>
          <Section title="Trip history">
            <Table resource="trips" rows={rest[3]?.results || []} />
          </Section>
        </>
      ) : null}
      {["vehicles", "drivers"].includes(resource) ? (
        <Section title="Trip history">
          <Table resource="trips" rows={rest[0]?.results || []} />
        </Section>
      ) : null}
      {hasDocs ? (
        <Section
          title="Documents"
          action={
            resource !== "documents" ? (
              <button className="button secondary small" onClick={addDocument}>
                <Plus size={15} />
                Add document
              </button>
            ) : (
              <button
                className="button secondary small"
                onClick={() => upload(record)}
              >
                Add file / version
              </button>
            )
          }
        >
          <DocumentCards
            rows={resource === "documents" ? [record] : docs}
            edit={edit}
            add={addDocument}
            upload={upload}
          />
        </Section>
      ) : null}
    </>
  );
}

function DocumentLinkDialog({ document, onClose, onSaved }) {
  const [resource, setResource] = useState("orders");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const {
    data,
    loading,
    error: loadError,
  } = useBundle([`/api/${resource}/?q=${encodeURIComponent(search)}`], 0);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/documents/${document.id}/link/`, {
        method: "POST",
        body: { resource, object_id: Number(selected) },
      });
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Link this document"
      subtitle={document.title}
      onClose={onClose}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error || loadError} />
        <div className="form-grid">
          <label className="field">
            <span>Record type</span>
            <select
              value={resource}
              onChange={(event) => {
                setResource(event.target.value);
                setSelected("");
                setSearch("");
              }}
            >
              {[
                "orders",
                "stops",
                "trips",
                "visits",
                "handovers",
                "drivers",
                "vehicles",
                "partners",
                "clients",
              ].map((key) => (
                <option value={key} key={key}>
                  {schemas[key]?.title || human(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Search records</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, reference or location"
            />
          </label>
          <label className="field field-wide">
            <span>Linked record</span>
            <select
              required
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">
                {loading ? "Loading…" : "Choose a record"}
              </option>
              {data?.[0].results.map((record) => (
                <option key={record.id} value={record.id}>
                  {label(record)}
                  {record.trip_label ? ` · ${record.trip_label}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !selected}>
            {busy ? "Linking…" : "Link document"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function ActionDialog({ config, onClose, onSaved }) {
  const [values, setValues] = useState(
    Object.fromEntries(
      config.fields.map((field) => [
        field.key,
        field.default ?? (field.type === "checkbox" ? false : ""),
      ]),
    ),
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(config.record.version);
  const [latest, setLatest] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await command(
        config.resource,
        { ...config.record, version },
        config.action,
        values,
      );
      onSaved(result);
      onClose();
    } catch (failure) {
      setError(failure);
      if (failure.status === 409) {
        try {
          setLatest(await api(`/api/${config.resource}/${config.record.id}/`));
        } catch {
          /* Original inputs remain available. */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={human(config.action)}
      subtitle={config.record.reference || label(config.record)}
      onClose={onClose}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error} />
        {latest ? (
          <div className="conflict">
            <h3>Latest saved information</h3>
            {["status", "name", "price", "rate", "actual_km", "notes", "reason"]
              .filter((key) => latest[key] !== undefined)
              .map((key) => (
                <p key={key}>
                  <strong>{human(key)}:</strong>{" "}
                  {String(latest[key] ?? "Not yet known")}
                </p>
              ))}
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setVersion(latest.version);
                setLatest(null);
                setError(null);
              }}
            >
              I reviewed this — retry with my inputs
            </button>
          </div>
        ) : null}
        <div className="form-grid">
          {config.fields.map((field) => (
            <label
              className={`field ${field.type === "textarea" ? "field-wide" : ""} ${field.type === "checkbox" ? "field-check" : ""}`}
              key={field.key}
            >
              {field.type === "checkbox" ? (
                <>
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(event) =>
                      setValues((previous) => ({
                        ...previous,
                        [field.key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{field.label}</span>
                </>
              ) : (
                <>
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  {field.type === "select" ? (
                    <select
                      required={field.required}
                      value={values[field.key]}
                      onChange={(event) =>
                        setValues((previous) => ({
                          ...previous,
                          [field.key]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose…</option>
                      {field.options?.map(([value, title]) => (
                        <option key={value} value={value}>
                          {title}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      required={field.required}
                      value={values[field.key]}
                      onChange={(event) =>
                        setValues((previous) => ({
                          ...previous,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <input
                      required={field.required}
                      value={values[field.key]}
                      onChange={(event) =>
                        setValues((previous) => ({
                          ...previous,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </>
              )}
            </label>
          ))}
        </div>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || Boolean(latest)}>
            {busy ? "Recording…" : "Record action"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function UploadDialog({ document, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await api(`/api/documents/${document.id}/upload/`, {
        method: "POST",
        body,
      });
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Add a file or new version"
      subtitle={document.title}
      onClose={onClose}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error} />
        <label className="upload-zone">
          <FileText size={30} />
          <strong>{file ? file.name : "Choose a document"}</strong>
          <span>PDF, image or Word · up to 30 MB</span>
          <input
            aria-label="Document file"
            required
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.bmp,.doc,.docx,.odt"
            onChange={(event) => setFile(event.target.files[0])}
          />
        </label>
        <p className="panel-note">
          Previous files remain available when you add a signed, corrected or
          renewed version.
        </p>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!file || busy}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState({ count: 0, change: null });
  const [catalog, setCatalog] = useState({});
  const [form, setForm] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [deletedCount, setDeletedCount] = useState(0);
  const [action, setAction] = useState(null);
  const [upload, setUpload] = useState(null);
  const [linkDocument, setLinkDocument] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState("");
  const [working, setWorking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notebookFilters, setNotebookFilters] = useState(
    defaultNotebookFilters,
  );
  const [resource, id] = useRoute();
  useEffect(() => {
    setMenuOpen(false);
  }, [resource, id]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector("#workspace-navigation a")?.focus();
    const close = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    const desktop = window.matchMedia("(min-width: 801px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      desktop.removeEventListener("change", closeOnDesktop);
      document.getElementById("navigation-toggle")?.focus();
    };
  }, [menuOpen]);
  useEffect(() => {
    let active = true;
    api("/api/auth/me/")
      .then((value) => {
        if (active) setUser(value);
      })
      .catch((failure) => {
        if (active && failure.status !== 401 && failure.status !== 403)
          setError(failure);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      ...basicCatalogs.map((key) => all(key)),
      all("orders", { status: "draft,confirmed,in_progress" }),
      all("trips", { status: "planned,in_progress,interrupted" }),
    ])
      .then((values) => {
        if (active)
          setCatalog(
            Object.fromEntries(
              [...basicCatalogs, "orders", "trips"].map((key, index) => [
                key,
                values[index],
              ]),
            ),
          );
      })
      .catch((failure) => {
        if (active) setError(failure);
      });
    return () => {
      active = false;
    };
  }, [user, revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = (change = null) => {
    setRevision((value) => ({
      count: value.count + 1,
      change: change?.resource && change?.record ? change : null,
    }));
    setError(null);
  };
  const notify = (message) => setToast(message);
  const edit = (target, record = null, options = {}) =>
    setForm({ resource: target, record, ...options });
  const direct = async (target, record, operation, values = {}) => {
    if (working) return null;
    setWorking(true);
    try {
      const result = await command(target, record, operation, values);
      refresh({ resource: target, record: result });
      notify("Action recorded.");
      return result;
    } catch (failure) {
      setError(failure);
      return null;
    } finally {
      setWorking(false);
    }
  };
  const run = (target, record, operation, fields = []) => {
    if (fields.length)
      setAction({ resource: target, record, action: operation, fields });
    else direct(target, record, operation);
  };
  const saved = async (result) => {
    if (form?.documentLinks)
      for (const link of form.documentLinks)
        await api(`/api/documents/${result.id}/link/`, {
          method: "POST",
          body: link,
        });
    refresh();
    notify(result.warnings?.join(" ") || "Changes saved.");
    if (!form?.record && ["orders", "trips"].includes(form?.resource))
      location.hash = `#/${form.resource}/${result.id}`;
    if (form?.resource === "documents" && !form.record) setUpload(result);
  };
  if (checking) return <Loading />;
  if (!user)
    return (
      <>
        <ErrorBox error={error} />
        <Login onLogin={setUser} />
      </>
    );
  const current = schemas[resource] || { title: "Overview" };
  const props = {
    revision,
    refresh,
    edit,
    catalog,
    run,
    direct,
    user,
    upload: setUpload,
    linkDocument: setLinkDocument,
    notify,
    remove: (target, record) => setDeletion({ resource: target, record }),
  };
  let screen;
  if (resource === "dashboard") screen = <Dashboard {...props} />;
  else if (
    !schemas[resource] ||
    (resource === "users" && user.role !== "manager")
  )
    screen = (
      <Empty
        title="This page isn’t available"
        text="Choose an item from the navigation."
      />
    );
  else if (id && resource === "orders")
    screen = <OrderDetail key={id} id={id} {...props} />;
  else if (id && resource === "trips")
    screen = <TripDetail key={id} id={id} {...props} />;
  else if (resource === "orders" && !id)
    screen = (
      <OrdersNotebook
        {...props}
        filters={notebookFilters}
        setFilters={setNotebookFilters}
      />
    );
  else if (id && !["history", "reviews"].includes(resource))
    screen = (
      <ProfileDetail
        key={`${resource}-${id}`}
        resource={resource}
        id={id}
        {...props}
      />
    );
  else
    screen = (
      <ResourceList
        key={`${resource}-${deletedCount}`}
        resource={resource}
        {...props}
      />
    );
  return (
    <CountryDirectory
      countries={catalog.countries || []}
      onCreated={(country) =>
        setCatalog((previous) => ({
          ...previous,
          countries: [
            ...(previous.countries || []).filter(
              (item) => item.id !== country.id,
            ),
            country,
          ].sort((a, b) => a.name.localeCompare(b.name)),
        }))
      }
    >
      <div className="app-layout">
        {menuOpen ? (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <aside
          className={`sidebar ${menuOpen ? "is-open" : ""}`}
          id="workspace-navigation"
          aria-label="Workspace navigation"
          onKeyDown={(event) => {
            if (!menuOpen || event.key !== "Tab") return;
            const controls = [
              ...event.currentTarget.querySelectorAll("a, button"),
            ].filter((element) => element.getClientRects().length);
            const first = controls[0],
              last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="sidebar-brand">
            <a href="#/dashboard" className="brand">
              <span className="brand-icon">
                <Route size={23} />
              </span>
              Dispatch
            </a>
            <button
              className="icon-button mobile-nav-close"
              aria-label="Close navigation"
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="workspace-label">
            <Building2 size={17} />
            <span>Company workspace</span>
          </div>
          <nav aria-label="Main navigation">
            {navigationGroups.map(([group, keys]) => (
              <div className="nav-group" key={group}>
                <span className="nav-label">{group}</span>
                {keys
                  .map((key) => navigation.find((item) => item[0] === key))
                  .filter(([key]) => key !== "users" || user.role === "manager")
                  .map(([key, title, Icon]) => (
                    <a
                      key={key}
                      href={`#/${key}`}
                      className={
                        resource === key ? "nav-item active" : "nav-item"
                      }
                      aria-current={resource === key ? "page" : undefined}
                      aria-label={title}
                      title={title}
                    >
                      <Icon size={18} />
                      <span>{title}</span>
                    </a>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="workspace-avatar">
              <Users size={17} />
            </div>
            <div>
              <strong>One team. One workspace.</strong>
              <small>Shared orders, trips and fleet</small>
            </div>
          </div>
        </aside>
        <div className="workspace" inert={menuOpen || undefined}>
          <header className="topbar">
            <div className="topbar-location">
              <button
                id="navigation-toggle"
                className="icon-button mobile-nav-toggle"
                aria-label="Open navigation"
                aria-expanded={menuOpen}
                aria-controls="workspace-navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={21} />
              </button>
              <div className="breadcrumb">
                <span>Workspace</span> <ChevronRight size={14} />
                <strong>{current.title}</strong>
              </div>
            </div>
            <div className="topbar-actions">
              <span className="topbar-date">
                <CalendarDays size={15} />
                {new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date())}
              </span>
              <button
                className="icon-button"
                aria-label="Refresh workspace"
                onClick={refresh}
              >
                <RefreshCw size={17} />
              </button>
              <a
                className="icon-button"
                aria-label="Open manager reviews"
                href="#/reviews"
              >
                <Bell size={18} />
              </a>
              <span className="topbar-divider" />
              <div className="user-info">
                <span className="user-avatar">
                  {user.full_name?.slice(0, 1) || "D"}
                </span>
                <div>
                  <strong>{user.full_name}</strong>
                  <small>{human(user.role)}</small>
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await api("/api/auth/logout/", { method: "POST" });
                    setUser(null);
                    setCatalog({});
                  } catch (failure) {
                    setError(failure);
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </header>
          <main className="main-content" inert={working}>
            <ErrorBox error={error} />
            {error ? (
              <button className="text-button" onClick={refresh}>
                Refresh the latest records
              </button>
            ) : null}
            {screen}
          </main>
          <footer className="app-footer">
            Dispatch workspace
            <span>Company operations · EUR</span>
          </footer>
        </div>
        {working ? (
          <div className="command-progress" role="status">
            <RefreshCw size={15} className="spin" />
            Recording action…
          </div>
        ) : null}
        {form?.resource === "orders" && !form.record ? (
          <QuickOrderForm
            catalog={catalog}
            user={user}
            onClose={() => setForm(null)}
            onSaved={saved}
          />
        ) : form ? (
          <RecordForm
            key={`${form.resource}-${form.record?.id || "new"}`}
            {...form}
            catalog={{ ...catalog, ...form.extraCatalog }}
            manager={user.role === "manager"}
            defaults={{ dispatcher: user.id, ...form.defaults }}
            onClose={() => setForm(null)}
            onSaved={saved}
          />
        ) : null}
        {deletion ? (
          <DeleteDialog
            {...deletion}
            onClose={() => setDeletion(null)}
            onDeleted={(target) => {
              const deletedId = deletion.record.id;
              setDeletion(null);
              setDeletedCount((value) => value + 1);
              refresh();
              notify(`${human(schemas[target].singular)} deleted.`);
              if (resource === target && Number(id) === deletedId)
                location.hash = `#/${target}`;
            }}
          />
        ) : null}
        {action ? (
          <ActionDialog
            config={action}
            onClose={() => setAction(null)}
            onSaved={(record) => {
              refresh({ resource: action.resource, record });
              notify("Action recorded.");
            }}
          />
        ) : null}
        {upload ? (
          <UploadDialog
            document={upload}
            onClose={() => setUpload(null)}
            onSaved={() => {
              refresh();
              notify("File uploaded; earlier versions preserved.");
            }}
          />
        ) : null}
        {toast ? (
          <div role="status" className="toast">
            <Check size={17} />
            {toast}
          </div>
        ) : null}
        {linkDocument ? (
          <DocumentLinkDialog
            document={linkDocument}
            onClose={() => setLinkDocument(null)}
            onSaved={() => {
              refresh();
              notify("Document linked without duplicating the file.");
            }}
          />
        ) : null}
      </div>
    </CountryDirectory>
  );
}
