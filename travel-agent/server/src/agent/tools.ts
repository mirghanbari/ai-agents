import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SourceError } from '../lib/env';
import { searchFlights } from '../api/flights';
import { searchHotels } from '../api/hotels';
import { searchActivities } from '../api/activities';
import { searchEventTickets } from '../api/events';
import { searchAirbnb } from '../scrapers/airbnb';
import { searchVrbo } from '../scrapers/vrbo';
import { searchRentalCars } from '../scrapers/cars';
import type { SearchResults } from '../types/travel';

// ── Tool definitions exposed to Claude ───────────────────────────────────────

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_flights',
    description:
      'Search for available flights between two airports or cities for given dates and passenger count. Use when the user mentions flying, airports, or needs transportation between cities.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin city or IATA airport code' },
        destination: { type: 'string', description: 'Destination city or IATA airport code' },
        departDate: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Return date YYYY-MM-DD for round trips' },
        adults: { type: 'number' },
        cabin: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] },
      },
      required: ['origin', 'destination', 'departDate', 'adults'],
    },
  },
  {
    name: 'search_hotels',
    description: 'Search for hotel availability and pricing for a destination and date range.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        checkIn: { type: 'string', description: 'YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'YYYY-MM-DD' },
        adults: { type: 'number' },
        maxPricePerNight: { type: 'number' },
        minStars: { type: 'number', description: 'Minimum hotel star rating 1-5' },
      },
      required: ['destination', 'checkIn', 'checkOut', 'adults'],
    },
  },
  {
    name: 'search_airbnb',
    description:
      'Search Airbnb for vacation rental listings. Use when user wants a home, apartment, or unique stay instead of a hotel.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        guests: { type: 'number' },
        minBedrooms: { type: 'number' },
        maxPricePerNight: { type: 'number' },
        pets: {
          type: 'number',
          description: 'Number of pets traveling — filters to pet-friendly listings',
        },
      },
      required: ['location', 'checkIn', 'checkOut', 'guests'],
    },
  },
  {
    name: 'search_vrbo',
    description:
      'Search VRBO for vacation rentals. Use alongside or instead of Airbnb for vacation home options.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        guests: { type: 'number' },
        maxPricePerNight: { type: 'number' },
      },
      required: ['location', 'checkIn', 'checkOut', 'guests'],
    },
  },
  {
    name: 'search_rental_cars',
    description: 'Search for rental car availability at a destination.',
    input_schema: {
      type: 'object',
      properties: {
        pickupLocation: { type: 'string', description: 'Airport code or city' },
        pickupDate: { type: 'string', description: 'YYYY-MM-DD' },
        dropoffDate: { type: 'string', description: 'YYYY-MM-DD' },
        carCategory: {
          type: 'string',
          enum: ['economy', 'compact', 'midsize', 'suv', 'luxury', 'any'],
          description: 'Preferred car category',
        },
      },
      required: ['pickupLocation', 'pickupDate', 'dropoffDate'],
    },
  },
  {
    name: 'search_activities',
    description: 'Search for tours, experiences, and activities at a destination.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, or omit for general availability' },
        category: {
          type: 'string',
          description: "e.g. 'food tours', 'outdoor adventures', 'museums', 'nightlife'",
        },
        adults: { type: 'number' },
        maxPricePerPerson: { type: 'number' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'search_event_tickets',
    description:
      'Search live event tickets (sports games, concerts, theater) across SeatGeek and StubHub. ' +
      'Use when the user wants tickets to a specific match, game, team, artist, or show — ' +
      'e.g. "World Cup tickets", "Lakers vs Celtics", "Taylor Swift in Toronto". ' +
      'Returns events with per-ticket price ranges and how many listings are available.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Team, match, artist, or event, e.g. "USA World Cup" or "Lakers vs Celtics"',
        },
        city: { type: 'string', description: 'City to narrow the search (optional)' },
        dateFrom: { type: 'string', description: 'Earliest event date YYYY-MM-DD (optional)' },
        dateTo: { type: 'string', description: 'Latest event date YYYY-MM-DD (optional)' },
        quantity: { type: 'number', description: 'Number of tickets needed (filters for enough availability)' },
        maxPrice: { type: 'number', description: 'Maximum price per ticket' },
      },
      required: ['query'],
    },
  },
];

// ── Zod schemas (validated before execution) ─────────────────────────────────

export const flightsSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  departDate: z.string().min(1),
  returnDate: z.string().optional(),
  adults: z.number().int().positive(),
  cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
});

export const hotelsSchema = z.object({
  destination: z.string().min(1),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  adults: z.number().int().positive(),
  maxPricePerNight: z.number().positive().optional(),
  minStars: z.number().min(1).max(5).optional(),
});

export const staySchema = z.object({
  location: z.string().min(1),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  guests: z.number().int().positive(),
  minBedrooms: z.number().int().positive().optional(),
  maxPricePerNight: z.number().positive().optional(),
});

export const airbnbSchema = staySchema.extend({
  pets: z.number().int().positive().optional(),
});

export const carsSchema = z.object({
  pickupLocation: z.string().min(1),
  pickupDate: z.string().min(1),
  dropoffDate: z.string().min(1),
  carCategory: z.enum(['economy', 'compact', 'midsize', 'suv', 'luxury', 'any']).optional(),
});

export const activitiesSchema = z.object({
  destination: z.string().min(1),
  date: z.string().optional(),
  category: z.string().optional(),
  adults: z.number().int().positive().optional(),
  maxPricePerPerson: z.number().positive().optional(),
});

export const eventsSchema = z.object({
  query: z.string().min(1),
  city: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  maxPrice: z.number().positive().optional(),
});

// ── Dispatch ─────────────────────────────────────────────────────────────────

/** Map each tool to the SearchResults.errors key it reports under. */
const ERROR_KEY: Record<string, string> = {
  search_flights: 'flights',
  search_hotels: 'hotels',
  search_airbnb: 'airbnb',
  search_vrbo: 'vrbo',
  search_rental_cars: 'cars',
  search_activities: 'activities',
  search_event_tickets: 'events',
};

/**
 * Execute one tool call. Never throws — a failure (validation, missing key,
 * scraper block) is returned as a structured `errors` entry so one bad source
 * never aborts the whole search and Claude can narrate the gap.
 */
export async function executeToolCall(
  name: string,
  input: unknown,
): Promise<Partial<SearchResults>> {
  const errorKey = ERROR_KEY[name] ?? name;
  try {
    switch (name) {
      case 'search_flights': {
        const p = flightsSchema.parse(input);
        return { flights: await searchFlights(p) };
      }
      case 'search_hotels': {
        const p = hotelsSchema.parse(input);
        return { hotels: await searchHotels(p) };
      }
      case 'search_airbnb': {
        const p = airbnbSchema.parse(input);
        return { listings: await searchAirbnb(p) };
      }
      case 'search_vrbo': {
        const p = staySchema.parse(input);
        return { listings: await searchVrbo(p) };
      }
      case 'search_rental_cars': {
        const p = carsSchema.parse(input);
        return { cars: await searchRentalCars(p) };
      }
      case 'search_activities': {
        const p = activitiesSchema.parse(input);
        return { activities: await searchActivities(p) };
      }
      case 'search_event_tickets': {
        const p = eventsSchema.parse(input);
        return { events: await searchEventTickets(p) };
      }
      default:
        return { errors: { [errorKey]: `Unknown tool "${name}".` } };
    }
  } catch (err: unknown) {
    const message =
      err instanceof SourceError
        ? err.message
        : err instanceof z.ZodError
          ? `Invalid arguments: ${err.issues.map((i) => i.message).join('; ')}`
          : err instanceof Error
            ? err.message
            : 'Tool execution failed.';
    return { errors: { [errorKey]: message } };
  }
}
