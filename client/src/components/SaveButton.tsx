import { useItinerary } from '../hooks/useItinerary';
import type {
  Activity,
  Flight,
  Hotel,
  ItineraryItemType,
  Listing,
  RentalCar,
} from '../types/travel';

interface SaveButtonProps {
  type: ItineraryItemType;
  data: Flight | Hotel | Listing | RentalCar | Activity;
}

/** Heart toggle that saves/removes an item from the itinerary. */
export default function SaveButton({ type, data }: SaveButtonProps) {
  const saved = useItinerary((s) => s.items.some((it) => it.id === data.id));
  const add = useItinerary((s) => s.add);
  const remove = useItinerary((s) => s.remove);

  return (
    <button
      type="button"
      onClick={() => (saved ? remove(data.id) : add(type, data))}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from itinerary' : 'Save to itinerary'}
      title={saved ? 'Saved — click to remove' : 'Save to itinerary'}
      className={`shrink-0 rounded-full p-2 text-lg transition ${
        saved ? 'bg-rose-50 text-rose-500' : 'bg-slate-100 text-slate-400 hover:text-rose-400'
      }`}
    >
      {saved ? '♥' : '♡'}
    </button>
  );
}
