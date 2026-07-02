// Canonical domain types shared by client and server.
// `server/src/types/travel.ts` and `client/src/types/travel.ts` re-export from here.

// ── Search intent parsed by the AI agent ────────────────────────────────────

export interface TripIntent {
  origin?: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
  budget?: {
    flightMax?: number;
    accommodationPerNight?: number;
    carPerDay?: number;
  };
  accommodationType?: ('hotel' | 'airbnb' | 'vrbo')[];
  needsCar?: boolean;
  tripType?: 'leisure' | 'business' | 'adventure';
  rawQuery: string;
}

// ── Result entities ─────────────────────────────────────────────────────────

/** One direction of travel. The outbound is flattened onto Flight; the return,
 * when present, lives in Flight.returnLeg. */
export interface FlightLeg {
  origin: string;
  destination: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  stops: number;
  flightNumber: string;
}

export interface Flight {
  id: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  stops: number;
  price: number; // for round trips this is the total round-trip price
  currency: string;
  bookingUrl: string;
  cabin?: 'economy' | 'premium_economy' | 'business' | 'first';
  returnLeg?: FlightLeg; // present only for round-trip offers
}

export interface Hotel {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  address: string;
  pricePerNight: number;
  totalPrice?: number;
  currency: string;
  rating?: number;
  reviewCount?: number;
  stars?: number;
  amenities?: string[];
  coordinates?: { lat: number; lng: number };
}

export interface Listing {
  id: string;
  source: 'airbnb' | 'vrbo';
  title: string;
  url: string;
  thumbnailUrl: string;
  pricePerNight: number;
  totalPrice?: number;
  currency: string;
  rating?: number;
  reviewCount?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  maxGuests?: number;
  badges?: string[];
  coordinates?: { lat: number; lng: number };
}

export interface RentalCar {
  id: string;
  supplier: string;
  carName: string;
  carCategory: string; // 'economy' | 'compact' | 'suv' | 'luxury' etc.
  thumbnailUrl: string;
  pricePerDay: number;
  totalPrice?: number;
  currency: string;
  seats?: number;
  transmission?: 'automatic' | 'manual';
  features?: string[];
  bookingUrl: string;
}

export interface Activity {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  duration?: string;
  price: number;
  currency: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
  bookingUrl: string;
}

export interface EventTicket {
  id: string;
  source: 'seatgeek' | 'stubhub';
  title: string; // e.g. "USA vs. Wales — FIFA World Cup"
  venue: string;
  city?: string;
  datetime: string; // ISO local datetime of the event
  url: string; // deep link to buy
  lowestPrice?: number; // per-ticket "get-in" price
  highestPrice?: number;
  averagePrice?: number;
  currency: string;
  listingCount?: number; // tickets/listings currently available
  performers?: string[]; // teams / artists
  category?: string; // 'sports' | 'concert' | 'theater' etc.
  thumbnailUrl: string;
}

// ── Aggregated search results ───────────────────────────────────────────────

export interface SearchResults {
  flights?: Flight[];
  hotels?: Hotel[];
  listings?: Listing[];
  cars?: RentalCar[];
  activities?: Activity[];
  events?: EventTicket[];
  searchedAt: string;
  durationMs: number;
  errors?: Record<string, string>; // per-source errors without failing the whole search
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  results?: SearchResults; // attached to assistant messages that triggered searches
  timestamp: string;
}

// ── Itinerary builder ───────────────────────────────────────────────────────

export type ItineraryItemType = 'flight' | 'hotel' | 'listing' | 'car' | 'activity' | 'event';

export interface ItineraryItem {
  id: string;
  type: ItineraryItemType;
  data: Flight | Hotel | Listing | RentalCar | Activity | EventTicket;
  savedAt: string;
  notes?: string;
}

// ── Direct (non-AI) search params for POST /api/search ───────────────────────

export type SearchSource =
  | 'flights'
  | 'hotels'
  | 'airbnb'
  | 'vrbo'
  | 'cars'
  | 'activities'
  | 'events';

export interface SearchParams {
  sources: SearchSource[];
  origin?: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
  maxPricePerNight?: number;
  minStars?: number;
  pets?: number; // traveling pets — stays filter to pet-friendly listings
  carCategory?: 'economy' | 'compact' | 'midsize' | 'suv' | 'luxury' | 'any';
  cabin?: 'economy' | 'premium_economy' | 'business' | 'first';
  activityCategory?: string;
  // Event tickets
  eventQuery?: string; // team / match / artist, e.g. "USA World Cup"
  ticketQuantity?: number;
  maxTicketPrice?: number; // per ticket
}
