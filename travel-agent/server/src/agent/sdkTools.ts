import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { executeToolCall } from './tools';
import type { SearchResults } from '../types/travel';

// Bridge the seven existing search tools into Claude Agent SDK "in-process" MCP
// tools. Each one delegates to the same executeToolCall dispatcher used by the
// API-key path (routes/chat.ts), so behavior, validation, and error-isolation
// are identical — only the transport and auth differ. The SDK runs the agent
// loop against a Claude Code subscription (CLAUDE_CODE_OAUTH_TOKEN) instead of
// billing API credits.

/** Called with each source's partial result as tools complete, for streaming to the UI. */
export type ResultSink = (partial: Partial<SearchResults>) => void;

/**
 * Build the in-process MCP server exposing all seven searches. A fresh server
 * is created per request so its `onResult` callback (and the accumulator behind
 * it) stays request-local — a module-level singleton would cross-wire
 * concurrent requests.
 */
export function createWayfarerServer(onResult: ResultSink) {
  // executeToolCall never throws — a failed source comes back as a structured
  // `errors` entry — so we always return its JSON as the tool result and also
  // hand the partial to onResult for live streaming + final accumulation.
  const runTool = async (
    name: string,
    args: unknown,
  ): Promise<{ content: { type: 'text'; text: string }[] }> => {
    const result = await executeToolCall(name, args);
    onResult(result);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  };

  // Shapes mirror the Zod schemas in tools.ts. The SDK generates the JSON schema
  // Claude sees from these, so keep descriptions aligned with toolDefinitions.
  const tools = [
    tool(
      'search_flights',
      'Search available flights between two cities/airports for given dates and passenger count.',
      {
        origin: z.string().describe('Origin city or IATA airport code'),
        destination: z.string().describe('Destination city or IATA airport code'),
        departDate: z.string().describe('Departure date YYYY-MM-DD'),
        returnDate: z.string().optional().describe('Return date YYYY-MM-DD for round trips'),
        adults: z.number().int().positive(),
        cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
      },
      (args) => runTool('search_flights', args),
    ),
    tool(
      'search_hotels',
      'Search hotel availability and pricing for a destination and date range.',
      {
        destination: z.string(),
        checkIn: z.string().describe('YYYY-MM-DD'),
        checkOut: z.string().describe('YYYY-MM-DD'),
        adults: z.number().int().positive(),
        maxPricePerNight: z.number().positive().optional(),
        minStars: z.number().min(1).max(5).optional(),
      },
      (args) => runTool('search_hotels', args),
    ),
    tool(
      'search_airbnb',
      'Search Airbnb for vacation rental listings (home/apartment/unique stay).',
      {
        location: z.string(),
        checkIn: z.string(),
        checkOut: z.string(),
        guests: z.number().int().positive(),
        minBedrooms: z.number().int().positive().optional(),
        maxPricePerNight: z.number().positive().optional(),
        pets: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Pets traveling — filters to pet-friendly listings'),
      },
      (args) => runTool('search_airbnb', args),
    ),
    tool(
      'search_vrbo',
      'Search VRBO for vacation rentals; use alongside or instead of Airbnb.',
      {
        location: z.string(),
        checkIn: z.string(),
        checkOut: z.string(),
        guests: z.number().int().positive(),
        maxPricePerNight: z.number().positive().optional(),
      },
      (args) => runTool('search_vrbo', args),
    ),
    tool(
      'search_rental_cars',
      'Search rental car availability at a destination.',
      {
        pickupLocation: z.string().describe('Airport code or city'),
        pickupDate: z.string().describe('YYYY-MM-DD'),
        dropoffDate: z.string().describe('YYYY-MM-DD'),
        carCategory: z.enum(['economy', 'compact', 'midsize', 'suv', 'luxury', 'any']).optional(),
      },
      (args) => runTool('search_rental_cars', args),
    ),
    tool(
      'search_activities',
      'Search tours, experiences, and activities at a destination.',
      {
        destination: z.string(),
        date: z.string().optional().describe('YYYY-MM-DD, or omit for general availability'),
        category: z.string().optional().describe("e.g. 'food tours', 'museums', 'nightlife'"),
        adults: z.number().int().positive().optional(),
        maxPricePerPerson: z.number().positive().optional(),
      },
      (args) => runTool('search_activities', args),
    ),
    tool(
      'search_event_tickets',
      'Search live event tickets (sports, concerts, theater) across SeatGeek and StubHub.',
      {
        query: z.string().describe('Team, match, artist, or event'),
        city: z.string().optional(),
        dateFrom: z.string().optional().describe('Earliest event date YYYY-MM-DD'),
        dateTo: z.string().optional().describe('Latest event date YYYY-MM-DD'),
        quantity: z.number().int().positive().optional(),
        maxPrice: z.number().positive().optional(),
      },
      (args) => runTool('search_event_tickets', args),
    ),
  ];

  return createSdkMcpServer({ name: 'wayfarer-search', version: '1.0.0', tools });
}

/**
 * Fully-qualified tool names as the Agent SDK exposes them. SDK MCP tools are
 * namespaced `mcp__<serverName>__<toolName>`; listing them in `allowedTools`
 * auto-approves the searches so the agent runs unattended (no permission
 * prompts, which a headless server can't answer).
 */
export const wayfarerToolNames = [
  'search_flights',
  'search_hotels',
  'search_airbnb',
  'search_vrbo',
  'search_rental_cars',
  'search_activities',
  'search_event_tickets',
].map((n) => `mcp__wayfarer-search__${n}`);
