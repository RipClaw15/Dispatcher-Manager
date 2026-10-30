export function findCountry(value, countries = []) {
  const key = String(value || "")
    .trim()
    .toLocaleLowerCase();
  if (!key) return null;
  return (
    countries.find((item) =>
      [item.code, item.name, ...(item.aliases || [])].some(
        (text) => text && text.toLocaleLowerCase() === key,
      ),
    ) || null
  );
}

export function inferCountry(shortCode, countries = []) {
  const prefix = String(shortCode || "")
    .trim()
    .match(/^([A-Za-z]{2})(?=[\d\s-]|$)/);
  return prefix ? findCountry(prefix[1], countries) : null;
}

export function routeCountry(value, shortCode, countries = []) {
  const found = value
    ? findCountry(value, countries)
    : inferCountry(shortCode, countries);
  return found
    ? {
        name: found.name,
        code: found.code,
        key: found.code || `custom:${found.id}`,
      }
    : value
      ? { name: value, code: "", key: value.trim().toLowerCase() }
      : null;
}

export function compactRoute(points) {
  return points
    .filter((point) => point.code?.trim())
    .reduce((result, point) => {
      const previous = result.at(-1);
      if (
        !previous ||
        previous.code.trim().toLowerCase() !==
          point.code.trim().toLowerCase() ||
        (previous.country?.key || "") !== (point.country?.key || "")
      )
        result.push(point);
      return result;
    }, []);
}
