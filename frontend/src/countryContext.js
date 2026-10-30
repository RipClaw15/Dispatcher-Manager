import { createContext, useContext } from "react";
export const CountryDirectoryContext = createContext({
  countries: [],
  onCreated: () => {},
});
export function useCountryDirectory() {
  return useContext(CountryDirectoryContext);
}
