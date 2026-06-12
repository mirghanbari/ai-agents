import SaveButton from '../SaveButton';
import { Thumb } from './HotelCard';
import { formatMoney } from '../../lib/format';
import type { Activity } from '../../types/travel';

export default function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Thumb url={activity.thumbnailUrl} fallback="🎯" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={activity.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-ink hover:text-wayfarer-600"
          >
            {activity.title}
          </a>
          <span className="shrink-0 font-semibold text-ink">
            {activity.price > 0 ? formatMoney(activity.price, activity.currency) : '—'}
            {activity.price > 0 && <span className="text-xs font-normal text-slate-400">/person</span>}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-slate-500">
          {activity.category ?? 'Experience'}
          {activity.duration && ` · ${activity.duration}`}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {activity.rating ? `⭐ ${activity.rating.toFixed(1)}` : 'No rating'}
          {activity.reviewCount ? ` (${activity.reviewCount})` : ''}
        </div>
      </div>
      <SaveButton type="activity" data={activity} />
    </div>
  );
}
