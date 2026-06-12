import SaveButton from '../SaveButton';
import { Thumb } from './HotelCard';
import { formatMoney } from '../../lib/format';
import type { Listing } from '../../types/travel';

export default function ListingCard({ listing }: { listing: Listing }) {
  const specs = [
    listing.bedrooms !== undefined ? `${listing.bedrooms} BR` : null,
    listing.beds !== undefined ? `${listing.beds} beds` : null,
    listing.maxGuests !== undefined ? `sleeps ${listing.maxGuests}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Thumb url={listing.thumbnailUrl} fallback={listing.source === 'vrbo' ? '🏡' : '🏠'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={listing.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-ink hover:text-wayfarer-600"
          >
            {listing.title}
          </a>
          <span className="shrink-0 font-semibold text-ink">
            {formatMoney(listing.pricePerNight, listing.currency)}
            <span className="text-xs font-normal text-slate-400">/night</span>
          </span>
        </div>
        <div className="mt-0.5 text-sm text-slate-500">
          <span className="uppercase tracking-wide text-[10px] text-slate-400">{listing.source}</span>
          {specs && ` · ${specs}`}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {listing.rating ? `⭐ ${listing.rating.toFixed(2)}` : 'No rating'}
          {listing.reviewCount ? ` (${listing.reviewCount})` : ''}
        </div>
      </div>
      <SaveButton type="listing" data={listing} />
    </div>
  );
}
