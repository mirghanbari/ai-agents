import SaveButton from '../SaveButton';
import { formatMoney, formatTime } from '../../lib/format';
import type { Flight } from '../../types/travel';

export default function FlightCard({ flight }: { flight: Flight }) {
  const stops = flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid h-12 w-12 place-items-center rounded-lg bg-wayfarer-50 text-xl">✈️</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-ink">
            {flight.airline} {flight.flightNumber && `· ${flight.flightNumber}`}
          </span>
          <span className="shrink-0 font-semibold text-ink">
            {formatMoney(flight.price, flight.currency)}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-slate-500">
          {flight.origin} → {flight.destination} · {stops}
          {flight.duration && ` · ${flight.duration}`}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {formatTime(flight.departTime)} – {formatTime(flight.arriveTime)}
          {flight.bookingUrl && (
            <>
              {' · '}
              <a href={flight.bookingUrl} target="_blank" rel="noreferrer" className="text-wayfarer-600 hover:underline">
                Book
              </a>
            </>
          )}
        </div>
      </div>
      <SaveButton type="flight" data={flight} />
    </div>
  );
}
