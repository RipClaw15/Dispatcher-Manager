import { Fragment } from "react";
import { MoveRight } from "lucide-react";
import CountryFlag from "./CountryFlag";

export default function RoutePreview({
  points = [],
  fallback = "Route not entered",
}) {
  if (!points.length) return <span>{fallback}</span>;
  return (
    <span className="route-preview">
      {points.map((point, index) => (
        <Fragment key={`${index}-${point.code}`}>
          {index > 0 ? (
            <span aria-hidden="true" className="route-preview-arrow">
              <MoveRight size={20} strokeWidth={2.25} />
              <span className="sr-only">{" → "}</span>
            </span>
          ) : null}
          <span className="route-code">
            <CountryFlag country={point.country} />
            <span>{point.code}</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
