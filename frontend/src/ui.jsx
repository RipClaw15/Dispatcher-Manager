import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, FilePlus2, LoaderCircle, X } from "lucide-react";
import { api, driverChoiceLabel, human, label } from "./api";
import { formSections, schemas } from "./schema";
import CountrySelect from "./CountrySelect";
import PostcodeSearch from "./PostcodeSearch";

export function Pill({ value, children }) {
  return (
    <span className={`pill pill-${value || "neutral"}`}>
      {children || human(value)}
    </span>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={20} /> Loading dispatch information…
    </div>
  );
}
export function ErrorBox({ error }) {
  return error ? (
    <div role="alert" className="error">
      <AlertCircle size={17} />
      <span>{error.message || error}</span>
    </div>
  ) : null;
}
export function Empty({
  title = "Nothing here yet",
  text = "Add the first record to get started.",
  action,
  icon: Icon = FilePlus2,
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Dialog({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

const cargoFields = [
  ["quantity", "Quantity"],
  ["package_type", "Package type"],
  ["weight_kg", "Total gross weight · kg"],
  ["length_cm", "Unit length · cm"],
  ["width_cm", "Unit width · cm"],
  ["height_cm", "Unit height · cm"],
];
function CargoInput({ field, value = {}, onChange }) {
  const set = (key, val) => {
    const next = { ...value };
    if (val === "") delete next[key];
    else next[key] = val;
    onChange(next);
  };
  return (
    <fieldset className="cargo-input">
      <legend>{field.label}</legend>
      <div className="form-grid">
        {cargoFields.map(([key, title]) => (
          <label className="field" key={key}>
            <span>{title}</span>
            <input
              value={value[key] ?? ""}
              onChange={(event) => set(key, event.target.value)}
              placeholder="Unknown"
              type={key === "package_type" ? "text" : "number"}
              min="0"
              step="any"
            />
          </label>
        ))}
        <label className="field">
          <span>Stackable</span>
          <select
            value={value.stackable ?? ""}
            onChange={(event) => set("stackable", event.target.value)}
          >
            <option value="">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function localInstant(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function RecordForm({
  resource,
  record,
  fixed = {},
  defaults = {},
  catalog,
  onClose,
  onSaved,
  manager,
}) {
  const schema = schemas[resource];
  const initial = Object.fromEntries(
    schema.fields.map((field) => {
      let value =
        record?.[field.key] ??
        defaults[field.key] ??
        fixed[field.key] ??
        (typeof field.default === "function"
          ? field.default()
          : field.default) ??
        (field.type === "checkbox" ? false : field.type === "cargo" ? {} : "");
      if (field.type === "instant") value = localInstant(value);
      return [field.key, value];
    }),
  );
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(new Set());
  const [version, setVersion] = useState(record?.version);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const set = (key, value) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDirty((previous) => new Set(previous).add(key));
    if (resource === "trips" && key === "vehicle" && value) {
      const van = catalog.vehicles?.find((item) => item.id === Number(value));
      if (van) {
        setValues((previous) => ({ ...previous, rate: van.default_rate }));
        setDirty((previous) => new Set(previous).add("rate"));
      }
    }
  };
  const priceChanged =
    resource === "orders" &&
    record &&
    dirty.has("price") &&
    String(values.price) !== String(record.price);
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = { ...fixed };
      for (const field of schema.fields) {
        if (record && !dirty.has(field.key)) continue;
        let value = values[field.key];
        if (field.type === "password" && !value) continue;
        if (
          ["relation", "number", "date", "time", "instant"].includes(
            field.type,
          ) &&
          value === ""
        )
          value = null;
        if (field.type === "relation" && value !== null) value = Number(value);
        if (field.type === "instant" && value)
          value = new Date(value).toISOString();
        body[field.key] = value;
      }
      if (record) body.version = version;
      if (priceChanged) body.change_reason = values.change_reason;
      const result = await api(
        `/api/${resource}/${record ? `${record.id}/` : ""}`,
        { method: record ? "PATCH" : "POST", body },
      );
      await onSaved(result);
      onClose();
    } catch (failure) {
      setError(failure);
      if (failure.status === 409 && record) {
        try {
          setConflict(await api(`/api/${resource}/${record.id}/`));
        } catch {
          /* Keep the original error and all entered values. */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  const reviewConflict = () => {
    const latest = Object.fromEntries(
      schema.fields.map((field) => [
        field.key,
        field.type === "instant"
          ? localInstant(conflict[field.key])
          : (conflict[field.key] ?? initial[field.key]),
      ]),
    );
    setValues((previous) => ({
      ...latest,
      ...Object.fromEntries([...dirty].map((key) => [key, previous[key]])),
    }));
    setVersion(conflict.version);
    setConflict(null);
    setError(null);
  };
  return (
    <Dialog
      wide
      title={`${record ? "Edit" : "New"} ${schema.singular}`}
      subtitle={
        record?.reference ||
        (["orders", "vehicles", "drivers"].includes(resource)
          ? "Start with what you know. You can fill in the rest later."
          : "Changes are shared with your dispatching team.")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="dialog-body">
        <ErrorBox error={error} />
        {conflict ? (
          <section className="conflict">
            <h3>Review the latest saved changes</h3>
            <p>
              Your entries are still here. Review this record before reapplying
              your edits.
            </p>
            {schema.fields
              .filter(
                (field) =>
                  JSON.stringify(conflict[field.key]) !==
                  JSON.stringify(record[field.key]),
              )
              .map((field) => (
                <p key={field.key}>
                  <strong>{field.label}:</strong>{" "}
                  {JSON.stringify(record[field.key] ?? "blank")} →{" "}
                  {JSON.stringify(conflict[field.key] ?? "blank")}
                  {dirty.has(field.key)
                    ? ` · Your entry: ${JSON.stringify(values[field.key])}`
                    : ""}
                </p>
              ))}
            <button type="button" className="button" onClick={reviewConflict}>
              I reviewed this — reapply my edits
            </button>
          </section>
        ) : null}
        {resource === "stops" || resource === "visits" ? (
          <label className="field">
            <span>Copy a saved location (optional)</span>
            <select
              defaultValue=""
              onChange={(event) => {
                const location = catalog.locations?.find(
                  (item) => item.id === Number(event.target.value),
                );
                if (location) {
                  const updates = {
                    location_name: location.name,
                    ...Object.fromEntries(
                      [
                        "address",
                        "city",
                        "postal_code",
                        "country",
                        "timezone",
                        "contact_name",
                        "phone",
                        "instructions",
                      ].map((key) => [key, location[key] || ""]),
                    ),
                  };
                  setValues((previous) => ({ ...previous, ...updates }));
                  setDirty(
                    (previous) =>
                      new Set([...previous, ...Object.keys(updates)]),
                  );
                }
              }}
            >
              <option value="">Enter a one-off location</option>
              {catalog.locations
                ?.filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {["stops", "visits", "locations"].includes(resource) ? (
          <PostcodeSearch
            country={values.country}
            onSelect={(location) => {
              setValues((previous) => ({ ...previous, ...location }));
              setDirty(
                (previous) => new Set([...previous, ...Object.keys(location)]),
              );
            }}
          />
        ) : null}
        <div className="form-grid">
          {schema.fields
            .filter((field) => !(field.key in fixed))
            .map((field) => {
              if (field.key === "is_active" && !manager) return null;
              if (field.type === "cargo")
                return (
                  <CargoInput
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={(value) => set(field.key, value)}
                  />
                );
              const props = {
                id: `input-${field.key}`,
                name: field.key,
                required: field.required,
                value: values[field.key],
                onChange: (event) =>
                  set(
                    field.key,
                    field.type === "checkbox"
                      ? event.target.checked
                      : event.target.value,
                  ),
              };
              return (
                <Fragment key={field.key}>
                  {formSections[resource]?.[field.key] ? (
                    <h3 className="form-section-title">
                      {formSections[resource][field.key]}
                    </h3>
                  ) : null}
                  <label
                    className={`field ${field.type === "textarea" ? "field-wide" : ""} ${field.type === "checkbox" ? "field-check" : ""}`}
                    htmlFor={props.id}
                  >
                    {field.type === "checkbox" ? (
                      <>
                        <input
                          {...props}
                          type="checkbox"
                          checked={Boolean(values[field.key])}
                        />
                        <span>{field.label}</span>
                      </>
                    ) : (
                      <>
                        <span>
                          {field.label}
                          {field.required ? (
                            <b className="required"> *</b>
                          ) : null}
                        </span>
                        {field.type === "country" ? (
                          <CountrySelect
                            id={props.id}
                            name={field.key}
                            label={field.label}
                            required={field.required}
                            value={values[field.key]}
                            onChange={(value) => set(field.key, value)}
                          />
                        ) : field.type === "relation" ? (
                          <select {...props}>
                            <option value="">Not yet assigned</option>
                            {(catalog[field.resource] || [])
                              .filter(
                                (item) =>
                                  (!field.filter ||
                                    field.filter(item, values)) &&
                                  (item.is_active !== false ||
                                    item.id === Number(values[field.key])),
                              )
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {field.resource === "drivers"
                                    ? driverChoiceLabel(item)
                                    : label(item)}
                                </option>
                              ))}
                          </select>
                        ) : field.type === "select" ? (
                          <select {...props}>
                            {field.options
                              .filter(
                                ([value]) =>
                                  !(
                                    resource === "vehicles" &&
                                    !manager &&
                                    value === "inactive"
                                  ),
                              )
                              .map(([value, title]) => (
                                <option key={value} value={value}>
                                  {title}
                                </option>
                              ))}
                          </select>
                        ) : field.type === "textarea" ? (
                          <textarea {...props} rows="3" />
                        ) : (
                          <input
                            {...props}
                            type={
                              field.type === "instant"
                                ? "datetime-local"
                                : field.type
                            }
                            placeholder={
                              field.placeholder ||
                              (field.type === "number" && !field.required
                                ? "Unknown"
                                : "")
                            }
                            min={field.type === "number" ? "0" : undefined}
                            step={
                              field.step ||
                              (field.type === "number" ? "any" : undefined)
                            }
                            autoComplete={
                              field.type === "password"
                                ? "new-password"
                                : undefined
                            }
                          />
                        )}
                      </>
                    )}
                  </label>
                </Fragment>
              );
            })}
          {priceChanged ? (
            <label className="field field-wide">
              <span>Reason for agreed price change *</span>
              <textarea
                required
                value={values.change_reason || ""}
                onChange={(event) => set("change_reason", event.target.value)}
              />
            </label>
          ) : null}
        </div>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || Boolean(conflict)}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
