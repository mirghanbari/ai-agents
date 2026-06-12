import type {
  Activity,
  Flight,
  Hotel,
  ItineraryItem,
  Listing,
  RentalCar,
} from '../types/travel';

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Best-effort total cost contribution of a saved item. */
export function itemCost(item: ItineraryItem): { amount: number; currency: string } {
  const d = item.data;
  switch (item.type) {
    case 'flight':
      return { amount: (d as Flight).price, currency: d.currency };
    case 'hotel': {
      const h = d as Hotel;
      return { amount: h.totalPrice ?? h.pricePerNight, currency: h.currency };
    }
    case 'listing': {
      const l = d as Listing;
      return { amount: l.totalPrice ?? l.pricePerNight, currency: l.currency };
    }
    case 'car': {
      const c = d as RentalCar;
      return { amount: c.totalPrice ?? c.pricePerDay, currency: c.currency };
    }
    case 'activity':
      return { amount: (d as Activity).price, currency: d.currency };
  }
}

export function itemTitle(item: ItineraryItem): string {
  const d = item.data;
  switch (item.type) {
    case 'flight': {
      const f = d as Flight;
      return `${f.airline} ${f.origin}→${f.destination}`;
    }
    case 'hotel':
      return (d as Hotel).name;
    case 'listing':
      return (d as Listing).title;
    case 'car': {
      const c = d as RentalCar;
      return `${c.supplier} ${c.carName}`;
    }
    case 'activity':
      return (d as Activity).title;
  }
}

const TYPE_LABEL: Record<ItineraryItem['type'], string> = {
  flight: '✈️ Flight',
  hotel: '🏨 Hotel',
  listing: '🏠 Stay',
  car: '🚗 Car',
  activity: '🎯 Activity',
};

export function typeLabel(type: ItineraryItem['type']): string {
  return TYPE_LABEL[type];
}

const ORDER: ItineraryItem['type'][] = ['flight', 'hotel', 'listing', 'car', 'activity'];

export function exportItineraryMarkdown(items: ItineraryItem[]): string {
  if (items.length === 0) return '_Your itinerary is empty._';
  const lines: string[] = ['# Trip itinerary', ''];
  for (const type of ORDER) {
    const group = items.filter((it) => it.type === type);
    if (group.length === 0) continue;
    lines.push(`## ${typeLabel(type)}`);
    for (const it of group) {
      const { amount, currency } = itemCost(it);
      lines.push(`- **${itemTitle(it)}** — ${formatMoney(amount, currency)}`);
    }
    lines.push('');
  }
  let total = 0;
  let currency = 'USD';
  for (const it of items) {
    const c = itemCost(it);
    total += c.amount;
    currency = c.currency;
  }
  lines.push(`**Estimated total: ${formatMoney(total, currency)}**`);
  return lines.join('\n');
}
