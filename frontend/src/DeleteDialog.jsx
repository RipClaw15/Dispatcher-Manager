import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { api, human } from "./api";
import { schemas } from "./schema";
import { Dialog, ErrorBox } from "./ui";

export default function DeleteDialog({ resource, record, onClose, onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const path = `/api/${resource}/${record.id}/`;
  const singular = schemas[resource].singular;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPreview(null);
    api(`${path}delete-preview/`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);

  const submit = async (event) => {
    event.preventDefault();
    if (!preview?.allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, {
        method: "DELETE",
        body: {
          version: preview.version,
          confirmation_token: preview.confirmation_token,
        },
      });
      onDeleted(resource);
    } catch (failure) {
      setError(failure);
      setPreview(null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Delete ${singular}?`}
      subtitle="Review the record and its links before confirming."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-body"
        onSubmit={submit}
        aria-busy={busy || loading}
      >
        <ErrorBox error={error} />
        {loading ? (
          <p className="delete-loading">
            <LoaderCircle className="spin" size={17} /> Checking linked records…
          </p>
        ) : null}
        {preview ? (
          <>
            <div className="delete-record">
              <Trash2 size={20} />
              <strong>{preview.label}</strong>
            </div>
            {preview.allowed ? (
              <>
                <p className="delete-description">
                  This permanently removes the following entries. It cannot be
                  undone.
                </p>
                <ul className="delete-summary">
                  {preview.items.map((item) => (
                    <li key={item.kind}>
                      <span>
                        {human(item.kind)}
                        {item.count === 1 ? "" : " entries"}
                      </span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                </ul>
                <p className="delete-description">
                  Change history retains the deleted details, who deleted them
                  and when.
                </p>
              </>
            ) : (
              <div className="delete-blocked">
                <h3>
                  <AlertTriangle size={17} /> This record must be kept
                </h3>
                <ul>
                  {preview.blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
        {!loading && !preview ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Review latest details
          </button>
        ) : null}
        <footer className="dialog-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {preview?.allowed ? "Keep record" : "Close"}
          </button>
          {preview?.allowed ? (
            <button className="button danger" disabled={busy || loading}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {busy ? "Deleting…" : `Delete ${singular}`}
            </button>
          ) : null}
        </footer>
      </form>
    </Dialog>
  );
}
