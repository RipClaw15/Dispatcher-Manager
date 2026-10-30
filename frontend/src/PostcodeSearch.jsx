import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";

export default function PostcodeSearch({
  country,
  onSelect,
  label = "Find town or postcode",
}) {
  const listId = `postcodes-${useId()}`;
  const root = useRef(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(false);
  const [selectionNote, setSelectionNote] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 230 });
  useEffect(() => {
    if (!open) return;
    const dialog = root.current?.closest("dialog");
    const locate = (reveal = false) => {
      const lookup = root.current?.querySelector(".postcode-lookup");
      if (!lookup) return;
      const top =
        dialog?.querySelector(".dialog-header")?.getBoundingClientRect()
          .bottom || 8;
      const bottom =
        Math.min(
          window.visualViewport?.height || innerHeight,
          dialog?.getBoundingClientRect().bottom || innerHeight,
          dialog?.querySelector(".dialog-actions")?.getBoundingClientRect()
            .top || innerHeight,
        ) - 8;
      let bounds = lookup.getBoundingClientRect();
      if (reveal && dialog && (bounds.bottom > bottom || bounds.top < top)) {
        dialog.scrollTop += bounds.top - top - 24;
        bounds = lookup.getBoundingClientRect();
      }
      const before = bounds.top - top - 4;
      const after = bottom - bounds.bottom - 4;
      const above = after < 140 && before > after;
      setPlacement({
        above,
        height: Math.max(40, Math.min(230, above ? before : after)),
      });
    };
    const update = () => locate();
    locate(true);
    dialog?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      dialog?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [open, country]);
  useEffect(() => {
    setQuery("");
    setSelected(false);
    setSelectionNote("");
    setOpen(false);
  }, [country]);
  useEffect(() => {
    if (!country || selected) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setError(false);
      api(
        `/api/postcodes/?${new URLSearchParams({ country, q: query.trim() })}`,
        { signal: controller.signal },
      )
        .then((response) => {
          if (!controller.signal.aborted) setData({ country, query, response });
        })
        .catch((failure) => {
          if (!controller.signal.aborted && failure.name !== "AbortError")
            setError(true);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [country, query, selected]);
  if (!country) return null;
  const current = data?.country === country ? data.response : null;
  const results =
    data?.country === country && data.query === query
      ? data.response.results
      : [];
  const choose = (place) => {
    onSelect({
      ...(place.place_name ? { city: place.place_name } : {}),
      postal_code: place.postal_code,
    });
    setQuery(
      `${place.postal_code} — ${place.place_name || "Town not supplied"}`,
    );
    setSelected(true);
    setSelectionNote(
      place.place_name
        ? "Town and postcode filled. Street details remain editable."
        : "Postcode filled. The source has no town name; enter the town manually.",
    );
    setOpen(false);
  };
  return (
    <div
      className="postcode-search"
      ref={root}
      onBlur={(event) => {
        if (!root.current.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="postcode-lookup">
        <label className="field">
          <span>{label} (optional)</span>
          <input
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={Boolean(
              open && query.trim().length >= 2 && current?.available,
            )}
            aria-controls={listId}
            aria-activedescendant={
              open && results[active] ? `${listId}-${active}` : undefined
            }
            autoComplete="off"
            value={query}
            placeholder="Type a town name or postcode…"
            onFocus={() => {
              if (!selected) setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(false);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
              if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setOpen(true);
                setActive((index) =>
                  Math.max(
                    0,
                    Math.min(
                      results.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (event.key === "Enter" && open) {
                event.preventDefault();
                if (results[active]) choose(results[active]);
              }
            }}
          />
        </label>
        {open && query.trim().length >= 2 && current?.available ? (
          <div
            role="listbox"
            id={listId}
            aria-label="Postcode suggestions"
            className={`postcode-options${placement.above ? " above" : ""}`}
            style={{ maxHeight: placement.height }}
          >
            {results.map((place, index) => (
              <button
                key={place.id}
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(place)}
              >
                <strong>{place.postal_code}</strong>
                <span>
                  {place.place_name || "Town not supplied"}
                  {place.admin_name && place.admin_name !== place.place_name ? (
                    <small>{place.admin_name}</small>
                  ) : null}
                </span>
              </button>
            ))}
            {!results.length ? (
              <p>
                {data?.query !== query
                  ? "Searching…"
                  : "No matches. You can still enter the location manually."}
              </p>
            ) : null}
            {results.length === 20 ? (
              <p>Showing 20 matches. Add a postcode to narrow the results.</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <small role="status">
          Suggestions are unavailable. Manual entry is still available.
        </small>
      ) : current && !current.available ? (
        <small>
          No postcode dataset is loaded for this country. Enter the location
          manually.
        </small>
      ) : null}
      {current?.available ? (
        <small>
          {current.coverage_note ||
            (selected
              ? selectionNote
              : "Search by town or postcode; choose the correct postcode from the results.")}{" "}
          Place data:{" "}
          <a href={current.source_url} target="_blank" rel="noreferrer">
            {current.source}
          </a>{" "}
          · {current.license}.
        </small>
      ) : null}
    </div>
  );
}
