import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { api, driverChoiceLabel, human, money } from "./api";
import { Dialog, ErrorBox } from "./ui";
import CountrySelect from "./CountrySelect";

export default function OrderDispatchForm({
  order,
  catalog,
  onClose,
  onSaved,
}) {
  const [context, setContext] = useState(null);
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState({
    vehicle: "",
    driver: "",
    starting_code: "",
    starting_country: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");
  const path = `/api/orders/${order.id}/dispatch-details/`;
  const fill = (trip) =>
    setValues({
      vehicle: trip?.vehicle ?? "",
      driver: trip?.driver ?? "",
      starting_code: trip?.starting_code || "",
      starting_country: trip?.starting_country || "",
    });
  useEffect(() => {
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const trip =
          data.trips.find(
            (item) => item.id === order.dispatch_summary?.trip_id,
          ) || data.trips.at(-1);
        setContext(data);
        setSelected(trip?.id ?? null);
        fill(trip);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [path, order.dispatch_summary?.trip_id]);
  const trip = context?.trips.find((item) => item.id === selected);
  const van = catalog.vehicles?.find(
    (item) => item.id === Number(values.vehicle),
  );
  const set = (key, value) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const changeVan = (value) => {
    const nextVan = catalog.vehicles?.find((item) => item.id === Number(value));
    const driver = catalog.drivers?.find(
      (item) => item.id === Number(values.driver),
    );
    const incompatible =
      nextVan?.partner && driver?.partner && nextVan.partner !== driver.partner;
    setValues((previous) => ({
      ...previous,
      vehicle: value,
      ...(incompatible ? { driver: "" } : {}),
    }));
    setMessage(
      incompatible
        ? "The previous driver belongs to another transport partner. Choose the driver for this van, or leave the driver unassigned."
        : "",
    );
  };
  const review = async () => {
    setBusy(true);
    try {
      const data = await api(path);
      setContext(data);
      if (!data.trips.some((item) => item.id === selected))
        setSelected(data.trips.at(-1)?.id ?? null);
      setStale(false);
      setError(null);
      setMessage(
        "Latest assignment versions loaded. Your entries are preserved; review them before saving.",
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!context || busy || stale) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(path, {
        method: "POST",
        body: {
          version: context.version,
          trip: selected,
          ...(trip ? { trip_version: trip.version } : {}),
          vehicle: values.vehicle ? Number(values.vehicle) : null,
          driver: values.driver ? Number(values.driver) : null,
          starting_code: values.starting_code,
          starting_country: values.starting_country,
        },
      });
      onSaved(result);
    } catch (failure) {
      setError(failure);
      if (failure.status === 409) setStale(true);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Edit dispatch details"
      subtitle={order.reference}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error} />
        {!context && !error ? (
          <p className="delete-loading">
            <LoaderCircle size={17} className="spin" />
            Loading the current assignment…
          </p>
        ) : null}
        {stale ? (
          <div className="notice">
            This order or trip changed. Your entries are preserved.{" "}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={review}
            >
              Review latest assignment
            </button>
          </div>
        ) : null}
        {message ? (
          <p className="quick-help" role="status">
            {message}
          </p>
        ) : null}
        {context ? (
          <>
            {context.trips.length > 1 ? (
              <label className="field dispatch-trip-picker">
                <span>Trip to correct</span>
                <select
                  aria-label="Trip to correct"
                  value={selected ?? ""}
                  onChange={(event) => {
                    const target = context.trips.find(
                      (item) => item.id === Number(event.target.value),
                    );
                    setSelected(target.id);
                    fill(target);
                    setStale(false);
                    setMessage("");
                  }}
                >
                  {context.trips.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.reference} ·{" "}
                      {item.vehicle_label || "Van not assigned"} ·{" "}
                      {human(item.status)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {trip?.order_references.length > 1 ? (
              <div className="notice">
                <strong>
                  Shared trip: {trip.order_references.length} orders
                </strong>
                <p>
                  These changes apply to {trip.order_references.join(", ")}.
                </p>
              </div>
            ) : null}
            {trip && trip.status !== "planned" ? (
              <p className="quick-help dispatch-edit-note">
                Correct the recorded assignment here. A physical transfer of
                goods to another van should be recorded as a handover.
              </p>
            ) : null}
            <div className="form-grid">
              <label className="field field-wide">
                <span>Van registration</span>
                <select
                  aria-label="Van registration"
                  value={values.vehicle}
                  onChange={(event) => changeVan(event.target.value)}
                >
                  <option value="">Not assigned</option>
                  {(catalog.vehicles || [])
                    .filter(
                      (item) =>
                        item.status === "active" ||
                        item.id === Number(values.vehicle),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.registration}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field field-wide">
                <span>Assigned driver</span>
                <select
                  aria-label="Assigned driver"
                  value={values.driver}
                  onChange={(event) => set("driver", event.target.value)}
                >
                  <option value="">Not assigned</option>
                  {(catalog.drivers || [])
                    .filter(
                      (item) =>
                        item.id === Number(values.driver) ||
                        (item.is_active &&
                          (!van?.partner ||
                            !item.partner ||
                            item.partner === van.partner)),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {driverChoiceLabel(item)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field field-wide">
                <span>Starting position code</span>
                <input
                  maxLength={40}
                  value={values.starting_code}
                  placeholder="e.g. FR95"
                  onChange={(event) => set("starting_code", event.target.value)}
                />
              </label>
              <label className="field field-wide">
                <span>Starting country</span>
                <CountrySelect
                  label="Starting country"
                  value={values.starting_country}
                  onChange={(value) => set("starting_country", value)}
                />
              </label>
            </div>
            <p className="quick-help">
              {trip?.rate != null
                ? `The agreed trip rate stays at ${money(trip.rate)}/km. Use Trip plan & rate to change the agreed rate separately.`
                : "The selected van’s default rate will be used when no trip rate has been agreed yet."}
            </p>
          </>
        ) : null}
        <footer className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!context || busy || stale}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {busy ? "Saving…" : "Save dispatch details"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
