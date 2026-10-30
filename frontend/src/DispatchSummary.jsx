import { money } from "./api";
import RoutePreview from "./RoutePreview";
import CountryValue from "./CountryValue";

export default function DispatchSummary({ value, showDriver = false }) {
  if (!value)
    return <span className="muted">Shipment details not entered</span>;
  const profitLabel = value.shared
    ? "shared trip profit"
    : value.trip_count > 1
      ? "current trip profit"
      : "profit";
  return (
    <span className="dispatch-summary">
      <span className="dispatch-summary-route">
        <strong>{value.vehicle_label || "Van not assigned"}</strong>
        <RoutePreview
          points={value.display_route}
          fallback={value.route_label || "Route not entered"}
        />
      </span>
      {showDriver ? (
        <span className="dispatch-driver">
          Driver: {value.driver_label || "Not assigned"}
          {value.driver_label ? (
            <>
              {" "}
              · Citizenship:{" "}
              {value.driver_citizenship ? (
                <CountryValue value={value.driver_citizenship} />
              ) : (
                "Not recorded"
              )}
            </>
          ) : null}
        </span>
      ) : null}
      <span className="dispatch-summary-figures">
        <span>{value.client_label || "Client not assigned"}</span>
        <span>
          {value.price === null ? "Price pending" : money(value.price)}
        </span>
        <span>
          {value.km === null
            ? "Distance pending"
            : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(Number(value.km))} km${value.shared ? " · whole trip" : ""}`}
        </span>
        <span
          className={
            value.margin !== null && Number(value.margin) < 0
              ? "negative"
              : "summary-profit"
          }
        >
          {value.margin === null
            ? "Profit pending"
            : `${money(value.margin)} ${value.provisional ? "est. " : ""}${profitLabel}`}
        </span>
      </span>
      {value.trip_count > 1 ? (
        <span className="subtext">
          {value.trip_count} trips / handover history · showing the latest
          assignment
        </span>
      ) : null}
    </span>
  );
}
