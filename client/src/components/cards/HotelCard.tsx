import SaveButton from '../SaveButton';
import { formatMoney } from '../../lib/format';
import type { Hotel } from '../../types/travel';

export default function HotelCard({ hotel }: { hotel: Hotel }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Thumb url={hotel.thumbnailUrl} fallback="🏨" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={hotel.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-ink hover:text-wayfarer-600"
          >
            {hotel.name}
          </a>
          <span className="shrink-0 font-semibold text-ink">
            {formatMoney(hotel.pricePerNight, hotel.currency)}
            <span className="text-xs font-normal text-slate-400">/night</span>
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm text-slate-500">{hotel.address}</div>
        <div className="mt-0.5 text-xs text-slate-400">
          {hotel.stars ? `${'★'.repeat(Math.round(hotel.stars))} · ` : ''}
          {hotel.rating ? `⭐ ${hotel.rating.toFixed(1)}` : 'No rating'}
          {hotel.reviewCount ? ` (${hotel.reviewCount})` : ''}
        </div>
      </div>
      <SaveButton type="hotel" data={hotel} />
    </div>
  );
}

export function Thumb({ url, fallback }: { url: string; fallback: string }) {
  if (!url) {
    return <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-2xl">{fallback}</div>;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-16 w-16 shrink-0 rounded-lg object-cover"
    />
  );
}
