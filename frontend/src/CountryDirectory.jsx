import { CountryDirectoryContext } from "./countryContext";
export default function CountryDirectory({ countries, onCreated, children }) {
  return (
    <CountryDirectoryContext.Provider value={{ countries, onCreated }}>
      {children}
    </CountryDirectoryContext.Provider>
  );
}
