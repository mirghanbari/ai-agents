import SaveButton from '../SaveButton';
import { formatMoney, formatTime } from '../../lib/format';
import type { Flight, FlightLeg } from '../../types/travel';

function stopLabel(stops: number): string {
  return stops === 0 ? 'Nonstop' : `${stops} stop${stops > 1 ? 's' : ''}`;
}

function Leg({ leg, label }: { leg: FlightLeg; label: string }) {
  return (
    <div className="mt-0.5">
      <div className="text-sm text-slate-500">
        <span className="text-slate-400">{label}</span> {leg.origin} → {leg.destination} ·{' '}
        {stopLabel(leg.stops)}
        {leg.duration && ` · ${leg.duration}`}
      </div>
      <div className="text-xs text-slate-400">
        {formatTime(leg.departTime)} – {formatTime(leg.arriveTime)}
        {leg.flightNumber && ` · ${leg.flightNumber}`}
      </div>
    </div>
  );
}

export default function FlightCard({ flight }: { flight: Flight }) {
  const roundTrip = Boolean(flight.returnLeg);
  const outbound: FlightLeg = {
    origin: flight.origin,
    destination: flight.destination,
    departTime: flight.departTime,
    arriveTime: flight.arriveTime,
    duration: flight.duration,
    stops: flight.stops,
    flightNumber: flight.flightNumber,
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid h-12 w-12 place-items-center rounded-lg bg-wayfarer-50 text-xl">✈️</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-ink">
            {flight.airline} {flight.flightNumber && `· ${flight.flightNumber}`}
          </span>
          <span className="shrink-0 text-right">
            <span className="font-semibold text-ink">{formatMoney(flight.price, flight.currency)}</span>
            {roundTrip && <span className="ml-1 text-xs text-slate-400">round trip</span>}
          </span>
        </div>
        {roundTrip ? (
          <>
            <Leg leg={outbound} label="Outbound" />
            <Leg leg={flight.returnLeg!} label="Return" />
          </>
        ) : (
          <>
            <div className="mt-0.5 text-sm text-slate-500">
              {flight.origin} → {flight.destination} · {stopLabel(flight.stops)}
              {flight.duration && ` · ${flight.duration}`}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {formatTime(flight.departTime)} – {formatTime(flight.arriveTime)}
            </div>
          </>
        )}
        {flight.bookingUrl && (
          <a
            href={flight.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block text-xs text-wayfarer-600 hover:underline"
          >
            Book
          </a>
        )}
      </div>
      <SaveButton type="flight" data={flight} />
    </div>
  );
}
