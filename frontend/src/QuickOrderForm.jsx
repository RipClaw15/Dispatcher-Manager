import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  LoaderCircle,
  Plus,
  Route,
  Trash2,
  Truck,
} from "lucide-react";
import { api, human, money } from "./api";
import { Dialog, ErrorBox } from "./ui";
import CountrySelect from "./CountrySelect";
import PostcodeSearch from "./PostcodeSearch";
import RoutePreview from "./RoutePreview";
import { compactRoute, inferCountry, routeCountry } from "./countryUtils";

const blankPoint = (key, kind) => ({
  key,
  kind,
  short_code: "",
  location_name: "",
  address: "",
  city: "",
  postal_code: "",
  country: "",
  countryAuto: true,
});
const optionalNumber = (value) => (value === "" ? null : value);

export default function QuickOrderForm({ catalog, user, onClose, onSaved }) {
  const sequence = useRef(2);
  const [points, setPoints] = useState([
    blankPoint(0, "collection"),
    blankPoint(1, "delivery"),
  ]);
  const [values, setValues] = useState({
    vehicle: "",
    client: "",
    trip: "",
    starting_code: "",
    starting_country: "",
    countryAuto: true,
    price: "",
    estimated_km: "",
    rate: "",
    rate_reason: "",
    client_reference: "",
    date_received: new Date().toLocaleDateString("en-CA"),
    loading_date: new Date().toLocaleDateString("en-CA"),
    dispatcher: user.id,
    notes: "",
    cargo_description: "",
    booking_contact: "",
  });
  const [tripOverride, setTripOverride] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const trip =
    tripOverride?.id === Number(values.trip)
      ? tripOverride
      : catalog.trips?.find((item) => item.id === Number(values.trip));
  const tripOptions = (catalog.trips || []).filter(
    (item) =>
      ["planned", "in_progress"].includes(item.status) &&
      (item.vehicle || null) ===
        (values.vehicle ? Number(values.vehicle) : null),
  );
  const van = catalog.vehicles?.find(
    (item) => item.id === Number(values.vehicle),
  );
  const set = (key, value) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const changeVan = (value) => {
    const selected = catalog.vehicles?.find(
      (item) => item.id === Number(value),
    );
    setValues((previous) => ({
      ...previous,
      vehicle: value,
      trip: "",
      rate: selected?.default_rate ?? "",
      rate_reason: "",
    }));
    setStale(false);
  };
  const applyTrip = (selected) =>
    setValues((previous) => ({
      ...previous,
      trip: selected?.id || "",
      starting_code: selected?.starting_code || "",
      starting_country: selected?.starting_country || "",
      countryAuto: !selected,
      estimated_km: selected?.estimated_km ?? "",
      rate: selected ? (selected.rate ?? "") : (van?.default_rate ?? ""),
      rate_reason: selected?.rate_reason || "",
    }));
  const updatePoint = (key, field, value) =>
    setPoints((previous) =>
      previous.map((point) =>
        point.key === key
          ? {
              ...point,
              [field]: value,
              ...(field === "country" ? { countryAuto: false } : {}),
              ...(field === "short_code" && point.countryAuto
                ? {
                    country: inferCountry(value, catalog.countries)?.code || "",
                  }
                : {}),
            }
          : point,
      ),
    );
  const move = (index, direction) =>
    setPoints((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  const hasNumbers =
    values.estimated_km !== "" &&
    values.rate !== "" &&
    Number.isFinite(Number(values.estimated_km)) &&
    Number.isFinite(Number(values.rate));
  const km = trip?.actual_km ?? values.estimated_km;
  const cost = hasNumbers
    ? Math.round(Number(km) * Number(values.rate) * 100) / 100 +
      Number(trip?.financials?.extras || 0)
    : null;
  const revenue =
    values.price === ""
      ? null
      : Number(values.price) + Number(trip?.financials?.revenue || 0);
  const margin =
    cost !== null &&
    revenue !== null &&
    trip?.financials?.revenue_complete !== false
      ? revenue - cost
      : null;
  const cargoSimple =
    points.filter((point) => point.kind === "collection").length === 1 &&
    points.filter((point) => point.kind === "delivery").length === 1;
  const displayRoute = compactRoute([
    {
      code: values.starting_code,
      country: routeCountry(
        values.starting_country,
        values.starting_code,
        catalog.countries,
      ),
    },
    ...points.map((point) => ({
      code: point.short_code || point.postal_code || point.city,
      country: routeCountry(point.country, point.short_code, catalog.countries),
    })),
  ]);
  const routeLabel = displayRoute.map((point) => point.code).join(" → ");
  const specialRate =
    !trip &&
    van &&
    values.rate !== "" &&
    Number(values.rate) !== Number(van.default_rate);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || stale) return;
    setBusy(true);
    setError(null);
    const datedCollection = (
      points.find(
        (point) =>
          point.kind === "collection" &&
          [
            "short_code",
            "location_name",
            "address",
            "city",
            "postal_code",
            "country",
          ].some((field) => point[field]?.trim()),
      ) || points.find((point) => point.kind === "collection")
    )?.key;
    try {
      const result = await api("/api/orders/quick-entry/", {
        method: "POST",
        body: {
          ...Object.fromEntries(
            Object.entries(values).filter(
              ([key]) => !["countryAuto", "loading_date"].includes(key),
            ),
          ),
          vehicle: values.vehicle ? Number(values.vehicle) : null,
          client: values.client ? Number(values.client) : null,
          trip: values.trip ? Number(values.trip) : null,
          ...(trip ? { trip_version: trip.version } : {}),
          dispatcher: Number(values.dispatcher),
          booking_contact: values.booking_contact
            ? Number(values.booking_contact)
            : null,
          price: optionalNumber(values.price),
          estimated_km: optionalNumber(values.estimated_km),
          rate: optionalNumber(values.rate),
          cargo_description: cargoSimple ? values.cargo_description : "",
          route: points.map(({ key, countryAuto, ...point }) => ({
            ...point,
            ...(key === datedCollection
              ? { planned_date: values.loading_date || null }
              : {}),
          })),
        },
      });
      await onSaved(result);
      onClose();
    } catch (failure) {
      setError(failure);
      if (failure.status === 409 && trip) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  const refreshTrip = async () => {
    setBusy(true);
    try {
      const latest = await api(`/api/trips/${trip.id}/`);
      setTripOverride(latest);
      setValues((previous) => ({
        ...previous,
        starting_code: latest.starting_code || "",
        starting_country: latest.starting_country || "",
        rate: latest.rate ?? "",
        rate_reason: latest.rate_reason || "",
      }));
      setStale(false);
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title="New order"
      subtitle="Van, route, client and price. Start with the essentials."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-body quick-order-form"
        onSubmit={submit}
        onInvalid={(event) => {
          let parent = event.target.parentElement;
          while (parent) {
            if (parent.tagName === "DETAILS") parent.open = true;
            parent = parent.parentElement;
          }
        }}
      >
        <ErrorBox error={error} />
        {stale ? (
          <div className="notice">
            The trip changed while you were entering this order. Your entries
            are preserved.{" "}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={refreshTrip}
            >
              Review latest trip figures
            </button>
          </div>
        ) : null}
        {tripOverride && tripOverride.id === Number(values.trip) && !stale ? (
          <p className="quick-help">
            Latest saved trip distance: {tripOverride.estimated_km ?? "unknown"}{" "}
            km. Your distance entry is preserved; review it before saving.
          </p>
        ) : null}
        <section aria-labelledby="quick-booking-heading">
          <h3 id="quick-booking-heading" className="quick-section-title">
            Booking details
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>First loading date (optional)</span>
              <input
                type="date"
                value={values.loading_date}
                onChange={(event) => set("loading_date", event.target.value)}
              />
              <small>
                Used for the daily orders notebook. Clear it if the date is
                unknown.
              </small>
            </label>
            <label className="field">
              <span>Van registration</span>
              <select
                aria-label="Van registration"
                value={values.vehicle}
                onChange={(event) => changeVan(event.target.value)}
              >
                <option value="">Assign a van later</option>
                {(catalog.vehicles || [])
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.registration}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Ordering client (optional for draft)</span>
              <select
                aria-label="Ordering client (optional for draft)"
                value={values.client}
                onChange={(event) => {
                  set("client", event.target.value);
                  set("booking_contact", "");
                }}
              >
                <option value="">Add the client later</option>
                {(catalog.clients || [])
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {tripOptions.length > 0 ? (
            <label className="field quick-trip-choice">
              <span>Journey for this order</span>
              <select
                aria-label="Journey for this order"
                value={values.trip}
                onChange={(event) => {
                  applyTrip(
                    tripOptions.find(
                      (item) => item.id === Number(event.target.value),
                    ),
                  );
                  setStale(false);
                }}
              >
                <option value="">Create a new trip</option>
                {tripOptions.map((item) => (
                  <option value={item.id} key={item.id}>
                    Add to {item.reference}
                    {item.name ? ` · ${item.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>
        <section
          className="quick-route-section"
          aria-labelledby="quick-route-heading"
        >
          <div className="quick-section-heading">
            <h3 id="quick-route-heading">Route</h3>
            <small>Short codes now. Full addresses when you have them.</small>
          </div>
          <div className="quick-route-grid">
            <div className="quick-route-point route-origin">
              <div className="route-point-heading">
                <Truck size={15} />
                <strong>Starting position</strong>
              </div>
              <label className="field">
                <span className="sr-only">Starting position code</span>
                <input
                  maxLength={40}
                  placeholder="e.g. FR95"
                  value={values.starting_code}
                  readOnly={Boolean(trip)}
                  onChange={(event) => {
                    const code = event.target.value;
                    setValues((previous) => ({
                      ...previous,
                      starting_code: code,
                      ...(previous.countryAuto
                        ? {
                            starting_country:
                              inferCountry(code, catalog.countries)?.code || "",
                          }
                        : {}),
                    }));
                  }}
                />
              </label>
              <label className="field route-country-field">
                <span>Country (optional)</span>
                <CountrySelect
                  label="Starting country"
                  value={values.starting_country}
                  disabled={Boolean(trip)}
                  onChange={(value) =>
                    setValues((previous) => ({
                      ...previous,
                      starting_country: value,
                      countryAuto: false,
                    }))
                  }
                />
              </label>
              <small>
                {trip
                  ? "From the existing trip"
                  : "Includes the empty run to collection"}
              </small>
            </div>
            {points.map((point, index) => {
              const nth = points
                .slice(0, index + 1)
                .filter((item) => item.kind === point.kind).length;
              const title = `${human(point.kind)} code${nth > 1 ? ` ${nth}` : ""}`;
              return (
                <div
                  className={`quick-route-point route-${point.kind}`}
                  key={point.key}
                >
                  <div className="route-point-heading">
                    <span className="route-point-index">{index + 1}</span>
                    <select
                      aria-label={`Point ${index + 1} type`}
                      value={point.kind}
                      onChange={(event) =>
                        updatePoint(point.key, "kind", event.target.value)
                      }
                    >
                      {["collection", "customs", "delivery"].map((kind) => (
                        <option key={kind} value={kind}>
                          {human(kind)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="field">
                    <span className="sr-only">{title}</span>
                    <input
                      maxLength={40}
                      placeholder={
                        point.kind === "collection"
                          ? "e.g. FR93"
                          : point.kind === "delivery"
                            ? "e.g. SL42"
                            : "Checkpoint code"
                      }
                      value={point.short_code}
                      onChange={(event) =>
                        updatePoint(point.key, "short_code", event.target.value)
                      }
                    />
                  </label>
                  <div className="route-point-actions">
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move point ${index + 1} earlier`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === points.length - 1}
                      aria-label={`Move point ${index + 1} later`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Remove point ${index + 1}`}
                      onClick={() =>
                        setPoints((previous) =>
                          previous.filter((item) => item.key !== point.key),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label className="field route-country-field">
                    <span>Country (optional)</span>
                    <CountrySelect
                      label={`Country for point ${index + 1}`}
                      value={point.country}
                      onChange={(value) =>
                        updatePoint(point.key, "country", value)
                      }
                    />
                  </label>
                  <PostcodeSearch
                    country={point.country}
                    label={`Find town or postcode for point ${index + 1}`}
                    onSelect={(location) =>
                      setPoints((previous) =>
                        previous.map((item) =>
                          item.key === point.key
                            ? { ...item, ...location }
                            : item,
                        ),
                      )
                    }
                  />
                  <details className="point-location-details">
                    <summary>Full location details</summary>
                    {[
                      ["location_name", "Site name"],
                      ["address", "Street address"],
                      ["city", "Town / region"],
                      ["postal_code", "Full postal code"],
                    ].map(([key, label]) => (
                      <label className="field" key={key}>
                        <span>{label}</span>
                        <input
                          aria-label={`${label} for point ${index + 1}`}
                          value={point[key]}
                          onChange={(event) =>
                            updatePoint(point.key, key, event.target.value)
                          }
                        />
                      </label>
                    ))}
                  </details>
                </div>
              );
            })}
          </div>
          <div className="route-add-actions">
            {["collection", "customs", "delivery"].map((kind) => (
              <button
                type="button"
                className="text-button"
                key={kind}
                disabled={points.length >= 40}
                onClick={() => {
                  const point = blankPoint(sequence.current++, kind);
                  setPoints((previous) => {
                    const index =
                      kind === "delivery"
                        ? -1
                        : previous.findIndex((item) =>
                            kind === "collection"
                              ? item.kind !== "collection"
                              : item.kind === "delivery",
                          );
                    if (index < 0) return [...previous, point];
                    return [
                      ...previous.slice(0, index),
                      point,
                      ...previous.slice(index),
                    ];
                  });
                }}
              >
                <Plus size={15} />
                Add {kind}
              </button>
            ))}
          </div>
        </section>
        <section
          className="quick-finance-section"
          aria-labelledby="quick-finance-heading"
        >
          <h3 id="quick-finance-heading" className="quick-section-title">
            Price & distance
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>Order price · EUR</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="650"
                value={values.price}
                onChange={(event) => set("price", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Whole trip payable km</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="1280"
                value={values.estimated_km}
                onChange={(event) => set("estimated_km", event.target.value)}
              />
            </label>
          </div>
          {trip ? (
            <p className="quick-help">
              This adds an order to the same trip. Enter the new total trip
              distance, including empty travel; its van cost is counted once.
            </p>
          ) : null}
          <div className="quick-profit-preview" aria-live="polite">
            <div>
              <span>Trip rate</span>
              <strong>
                {values.rate === ""
                  ? "Awaiting van / rate"
                  : `€${Number(values.rate).toFixed(2)} / km`}
              </strong>
            </div>
            <div>
              <span>Estimated trip cost</span>
              <strong>{cost === null ? "—" : money(cost)}</strong>
            </div>
            <div>
              <span>
                {trip ? "Estimated shared trip profit" : "Estimated profit"}
              </span>
              <strong
                className={margin !== null && margin < 0 ? "negative" : ""}
              >
                {margin === null ? "—" : money(margin)}
              </strong>
            </div>
          </div>
        </section>
        <details className="quick-extra-details">
          <summary>
            <ChevronRight size={16} />
            Shipment details{" "}
            <small>Optional · cargo, references and notes</small>
          </summary>
          <div className="form-grid">
            <label className="field">
              <span>Agreed whole-trip rate · EUR/km</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                readOnly={Boolean(trip)}
                value={values.rate}
                onChange={(event) => set("rate", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Reason for a different rate{specialRate ? " *" : ""}</span>
              <input
                required={Boolean(specialRate)}
                readOnly={Boolean(trip)}
                value={values.rate_reason}
                onChange={(event) => set("rate_reason", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Client order reference</span>
              <input
                maxLength={180}
                value={values.client_reference}
                onChange={(event) =>
                  set("client_reference", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Date received</span>
              <input
                type="date"
                value={values.date_received}
                onChange={(event) => set("date_received", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Responsible dispatcher</span>
              <select
                value={values.dispatcher}
                onChange={(event) => set("dispatcher", event.target.value)}
              >
                {(catalog.users || [])
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.full_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Booking contact</span>
              <select
                value={values.booking_contact}
                onChange={(event) => set("booking_contact", event.target.value)}
              >
                <option value="">Add later</option>
                {(catalog.contacts || [])
                  .filter(
                    (item) =>
                      values.client && item.client === Number(values.client),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            {cargoSimple ? (
              <label className="field field-wide">
                <span>Goods description (optional)</span>
                <input
                  maxLength={250}
                  value={values.cargo_description}
                  onChange={(event) =>
                    set("cargo_description", event.target.value)
                  }
                />
              </label>
            ) : (
              <p className="quick-help field-wide">
                Cargo can be linked to its collection and delivery points after
                saving.
              </p>
            )}
            <label className="field field-wide">
              <span>Internal notes</span>
              <textarea
                value={values.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </label>
          </div>
        </details>
        {van || routeLabel ? (
          <div className="quick-notebook-preview">
            <Route size={17} />
            <span>
              <strong>{van?.registration || "Van not assigned"}</strong>
              {routeLabel && (
                <small>
                  <RoutePreview points={displayRoute} />
                </small>
              )}
            </span>
          </div>
        ) : null}
        <footer className="dialog-actions">
          <small className="quick-save-hint">
            Saved as a draft. Details can follow.
          </small>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || stale}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {busy ? "Saving…" : "Save order"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
