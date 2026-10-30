import { Globe } from "lucide-react";

const flags = import.meta.glob("../node_modules/flag-icons/flags/4x3/*.svg", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});

export default function CountryFlag({ country }) {
  if (!country) return null;
  const flag =
    flags[
      `../node_modules/flag-icons/flags/4x3/${(country.code || "").toLowerCase()}.svg`
    ];
  return (
    <span
      className="country-flag"
      role="img"
      aria-label={country.name || country.code}
      title={country.name || country.code}
    >
      {flag ? (
        <img src={flag} width="20" height="15" alt="" />
      ) : (
        <Globe size={15} aria-hidden="true" />
      )}
    </span>
  );
}
