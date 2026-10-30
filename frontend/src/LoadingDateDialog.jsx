import { useEffect, useState } from "react";
import { api } from "./api";
import { Dialog, ErrorBox } from "./ui";

export default function LoadingDateDialog({ order, onClose, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [date, setDate] = useState(order.loading_date || "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/orders/${order.id}/loading-date/`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setPreview(data);
        if (!revision) setDate(data.stop?.planned_date || "");
        setStale(false);
        setError(null);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [order.id, revision]);
  const submit = async (event) => {
    event.preventDefault();
    if (!preview?.stop || busy || stale) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${order.id}/loading-date/`, {
        method: "POST",
        body: {
          version: preview.version,
          stop: preview.stop.id,
          stop_version: preview.stop.version,
          planned_date: date || null,
        },
      });
      onSaved();
    } catch (failure) {
      setError(failure);
      if (failure.status === 409) setStale(true);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="First loading date"
      subtitle={order.reference}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error} />
        {preview?.stop ? (
          <>
            <p className="quick-help">
              {preview.stop.label}. This date determines the shipment's day in
              the orders notebook.
            </p>
            <label className="field">
              <span>Loading date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            {!date && (preview.stop.time_from || preview.stop.time_to) ? (
              <p className="notice">
                Clearing the date also clears its planned time window.
              </p>
            ) : null}
            <p className="quick-help">
              An unknown date stays in No loading date. Recorded arrival and
              completion times stay unchanged.
            </p>
          </>
        ) : (
          <p className="quick-help">
            {preview
              ? "Add a collection stop in shipment details before setting its loading date."
              : "Loading the first collection…"}
          </p>
        )}
        {stale ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Review latest loading stop
          </button>
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
          {preview?.stop ? (
            <button className="button primary" disabled={busy || stale}>
              {busy ? "Saving…" : "Save loading date"}
            </button>
          ) : null}
        </footer>
      </form>
    </Dialog>
  );
}
