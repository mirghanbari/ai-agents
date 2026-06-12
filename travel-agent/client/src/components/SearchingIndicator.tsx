const SEARCH_LABELS: Record<string, string> = {
  search_flights: '✈️ Searching flights',
  search_hotels: '🏨 Searching hotels',
  search_airbnb: '🏠 Searching Airbnb',
  search_vrbo: '🏡 Searching VRBO',
  search_rental_cars: '🚗 Searching rental cars',
  search_activities: '🎯 Finding activities',
};

interface SearchingIndicatorProps {
  activeSearches: string[];
}

export default function SearchingIndicator({ activeSearches }: SearchingIndicatorProps) {
  if (activeSearches.length === 0) return null;
  const label = activeSearches.map((t) => SEARCH_LABELS[t] ?? t).join(' · ');
  return (
    <div className="flex items-center gap-2 rounded-xl bg-wayfarer-50 px-4 py-2 text-sm text-wayfarer-700">
      <span className="inline-flex gap-1">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      <span>{label}…</span>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-2 w-2 animate-pulse rounded-full bg-wayfarer-500"
      style={{ animationDelay: delay }}
    />
  );
}
