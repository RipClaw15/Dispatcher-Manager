import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { api, command } from "./api";
import { Dialog, ErrorBox, Pill } from "./ui";

export default function CompleteShipmentDialog({ order, onClose, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setConfirmed(false);
    setError(null);
    api(`/api/orders/${order.id}/completion-preview/`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [order.id, revision]);
  const submit = async (event) => {
    event.preventDefault();
    if (!confirmed || !preview?.allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await command(
        "orders",
        { id: order.id, version: preview.version },
        "complete",
        {
          confirm_delivery: confirmed,
          confirmation_token: preview.confirmation_token,
          note,
        },
      );
      onSaved();
    } catch (failure) {
      setError(failure);
      setPreview(null);
      setConfirmed(false);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Complete shipment"
      subtitle={order.reference}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="dialog-body" onSubmit={submit}>
        <ErrorBox error={error} />
        {loading ? (
          <p className="delete-loading">
            <LoaderCircle className="spin" size={17} />
            Loading shipment stops…
          </p>
        ) : null}
        {preview?.allowed ? (
          <>
            <p className="completion-description">
              Confirm that all remaining collections and deliveries for this
              shipment are finished. Its status will become{" "}
              <strong>Delivered</strong>.
            </p>
            <ul className="completion-stop-list">
              {preview.stops.map((stop) => (
                <li key={stop.id}>
                  <div>
                    <strong>{stop.label}</strong>
                    {stop.detail ? <small>{stop.detail}</small> : null}
                  </div>
                  <Pill value={stop.status} />
                </li>
              ))}
            </ul>
            <label className="field field-check completion-confirm">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I confirm all goods have been collected and delivered.
              </span>
            </label>
            <label className="field">
              <span>Completion note (optional)</span>
              <textarea
                maxLength={4000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <p className="quick-help">
              Other shipments on the van stay open. Trip costs and recorded stop
              times stay as entered.
            </p>
          </>
        ) : preview ? (
          <div className="notice">
            <strong>This shipment cannot be completed yet</strong>
            <ul>
              {preview.blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!loading && !preview ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Review latest shipment
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
          {preview?.allowed ? (
            <button className="button primary" disabled={!confirmed || busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              {busy ? "Completing…" : "Complete shipment"}
            </button>
          ) : null}
        </footer>
      </form>
    </Dialog>
  );
}
