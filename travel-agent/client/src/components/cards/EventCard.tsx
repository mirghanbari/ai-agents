import SaveButton from '../SaveButton';
import { Thumb } from './HotelCard';
import { formatMoney, formatTime } from '../../lib/format';
import type { EventTicket } from '../../types/travel';

const SOURCE_LABEL: Record<EventTicket['source'], string> = {
  seatgeek: 'SeatGeek',
  stubhub: 'StubHub',
};

export default function EventCard({ event }: { event: EventTicket }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Thumb url={event.thumbnailUrl} fallback="🎟️" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={event.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-ink hover:text-wayfarer-600"
          >
            {event.title}
          </a>
          <span className="shrink-0 font-semibold text-ink">
            {event.lowestPrice ? (
              <>
                <span className="text-xs font-normal text-slate-400">from </span>
                {formatMoney(event.lowestPrice, event.currency)}
                <span className="text-xs font-normal text-slate-400">/ticket</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm text-slate-500">
          {event.venue}
          {event.city && `, ${event.city}`}
          {event.datetime && ` · ${formatTime(event.datetime)}`}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {SOURCE_LABEL[event.source]}
          {event.listingCount ? ` · ${event.listingCount} listings` : ''}
          {event.highestPrice ? ` · up to ${formatMoney(event.highestPrice, event.currency)}` : ''}
        </div>
      </div>
      <SaveButton type="event" data={event} />
    </div>
  );
}
