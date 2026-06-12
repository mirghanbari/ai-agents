import SaveButton from '../SaveButton';
import { Thumb } from './HotelCard';
import { formatMoney } from '../../lib/format';
import type { RentalCar } from '../../types/travel';

export default function CarCard({ car }: { car: RentalCar }) {
  const specs = [
    car.carCategory,
    car.transmission,
    car.seats !== undefined ? `${car.seats} seats` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Thumb url={car.thumbnailUrl} fallback="🚗" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-ink">{car.carName}</span>
          <span className="shrink-0 font-semibold text-ink">
            {formatMoney(car.pricePerDay, car.currency)}
            <span className="text-xs font-normal text-slate-400">/day</span>
          </span>
        </div>
        <div className="mt-0.5 text-sm text-slate-500">{car.supplier}</div>
        <div className="mt-0.5 text-xs capitalize text-slate-400">
          {specs}
          {car.bookingUrl && (
            <>
              {' · '}
              <a href={car.bookingUrl} target="_blank" rel="noreferrer" className="text-wayfarer-600 hover:underline">
                Book
              </a>
            </>
          )}
        </div>
      </div>
      <SaveButton type="car" data={car} />
    </div>
  );
}
