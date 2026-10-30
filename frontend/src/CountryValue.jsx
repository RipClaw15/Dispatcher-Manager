import CountryFlag from "./CountryFlag";
import { useCountryDirectory } from "./countryContext";
import { findCountry } from "./countryUtils";

export default function CountryValue({ value }) {
  const { countries } = useCountryDirectory();
  if (!value) return <span className="muted">—</span>;
  const country = findCountry(value, countries);
  return (
    <span className="country-value">
      <CountryFlag country={country || { name: value, code: "" }} />
      {country?.name || value}
    </span>
  );
}
