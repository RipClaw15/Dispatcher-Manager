import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { api } from "./api";
import CountryFlag from "./CountryFlag";
import { useCountryDirectory } from "./countryContext";
import { findCountry } from "./countryUtils";

export default function CountrySelect({
  value = "",
  onChange,
  label = "Country",
  id,
  name,
  required,
  disabled,
  allowCreate = true,
  placeholder = "Select or search…",
}) {
  const { countries, onCreated } = useCountryDirectory();
  const listId = `countries-${useId()}`;
  const root = useRef(null);
  const input = useRef(null);
  const committed = useRef(value);
  const display = (val) => findCountry(val, countries)?.name || val || "";
  const [query, setQuery] = useState(display(value));
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) {
      committed.current = value;
      setQuery(findCountry(value, countries)?.name || value || "");
    }
  }, [value, countries]);
  const matches = countries.filter(
    (country) =>
      !searching ||
      !query.trim() ||
      [country.name, country.code, ...(country.aliases || [])].some((text) =>
        text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
  );
  const exact = findCountry(query, countries);
  const canAdd = allowCreate && Boolean(query.trim()) && !exact;
  const optionsCount = matches.length + (canAdd ? 1 : 0);
  const selected = findCountry(value, countries);
  const choose = (country) => {
    const val =
      typeof country === "string" ? country : country.code || country.name;
    committed.current = val;
    setQuery(display(val) || country.name);
    onChange(val);
    setOpen(false);
    setAdding(false);
    setError("");
  };
  const beginAdd = () => {
    setNewName(query.trim());
    setNewCode("");
    setError("");
    setAdding(true);
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const country = await api("/api/countries/", {
        method: "POST",
        body: { name: newName.trim(), code: newCode.trim().toUpperCase() },
      });
      onCreated(country);
      committed.current = country.code || country.name;
      setQuery(country.name);
      onChange(committed.current);
      setAdding(false);
      input.current?.focus();
      setOpen(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const keyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery(display(committed.current));
      onChange(committed.current);
      setOpen(false);
      setAdding(false);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        Math.max(
          0,
          Math.min(
            optionsCount - 1,
            index + (event.key === "ArrowDown" ? 1 : -1),
          ),
        ),
      );
    }
    if (event.key === "Enter" && open && !adding) {
      event.preventDefault();
      if (matches[active]) choose(matches[active]);
      else if (canAdd) beginAdd();
    }
  };
  return (
    <div
      className="country-select"
      ref={root}
      onBlur={(event) => {
        if (root.current.contains(event.relatedTarget) || busy) return;
        if (exact) choose(exact);
        else {
          setQuery(display(committed.current));
          onChange(committed.current);
          setOpen(false);
          setAdding(false);
        }
      }}
    >
      <div className="country-select-input">
        <CountryFlag country={selected} />
        <input
          ref={input}
          id={id}
          name={name}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={
            open && !adding && optionsCount
              ? `${listId}-${Math.min(active, optionsCount - 1)}`
              : undefined
          }
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setSearching(false);
            setActive(
              Math.max(
                0,
                countries.findIndex((item) => item.id === selected?.id),
              ),
            );
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearching(true);
            if (!event.target.value) committed.current = "";
            onChange("");
            setOpen(true);
            setAdding(false);
            const exactMatch = findCountry(event.target.value, countries);
            const filtered = countries.filter((item) =>
              [item.name, item.code, ...(item.aliases || [])].some((text) =>
                text
                  ?.toLowerCase()
                  .includes(event.target.value.trim().toLowerCase()),
              ),
            );
            setActive(
              Math.max(
                0,
                filtered.findIndex((item) => item.id === exactMatch?.id),
              ),
            );
          }}
          onKeyDown={keyDown}
        />
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      {open && !disabled ? (
        <div className="country-select-popup">
          {adding ? (
            <div
              className="country-create"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!busy && newName.trim()) create();
                }
              }}
            >
              <strong>Add a country</strong>
              <input
                aria-label="New country name"
                value={newName}
                maxLength={80}
                onChange={(event) => setNewName(event.target.value)}
              />
              <input
                aria-label="New country code (optional)"
                placeholder="e.g. GB or GB-SCT, if known"
                value={newCode}
                maxLength={6}
                onChange={(event) =>
                  setNewCode(event.target.value.toUpperCase())
                }
              />
              {error ? <p role="alert">{error}</p> : null}
              <small>
                Custom entries without a recognised flag use a globe.
              </small>
              <div>
                <button
                  type="button"
                  className="button small secondary"
                  disabled={busy}
                  onClick={() => setAdding(false)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button small primary"
                  disabled={busy || !newName.trim()}
                  onClick={create}
                >
                  {busy ? "Saving…" : "Save country"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="country-options"
                role="listbox"
                id={listId}
                aria-label="Countries"
              >
                {matches.map((country, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    id={`${listId}-${index}`}
                    key={country.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(country)}
                  >
                    <CountryFlag country={country} />
                    <span>{country.name}</span>
                    <small>{country.code}</small>
                  </button>
                ))}
                {canAdd ? (
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${matches.length}`}
                    aria-selected={active === matches.length}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={beginAdd}
                  >
                    <Plus size={15} />
                    <span>Add “{query.trim()}”</span>
                  </button>
                ) : null}
                {!optionsCount ? <p>No saved countries.</p> : null}
              </div>
              <div className="country-select-footer">
                Type a country name or code to search.
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
