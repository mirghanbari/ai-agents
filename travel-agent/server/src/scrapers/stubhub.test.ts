import { describe, it, expect } from 'vitest';
import { to24h, parseCard } from './stubhub';

describe('to24h', () => {
  it('converts PM times past noon', () => {
    expect(to24h('7:00 PM')).toBe('19:00');
    expect(to24h('11:59 PM')).toBe('23:59');
  });
  it('handles the 12-hour edge cases', () => {
    expect(to24h('12:00 AM')).toBe('00:00');
    expect(to24h('12:30 PM')).toBe('12:30');
  });
  it('tolerates missing spaces and lowercase meridiem', () => {
    expect(to24h('9:05pm')).toBe('21:05');
  });
  it('returns empty string for missing or unparseable input', () => {
    expect(to24h(undefined)).toBe('');
    expect(to24h('noon')).toBe('');
  });
});

describe('parseCard', () => {
  it('parses a World Cup card: title, city, venue, and slug date', () => {
    const card = parseCard({
      id: '778899',
      href: 'https://www.stubhub.com/usa-vs-wales-tickets-6-23-2026/event/778899/',
      text: 'USA vs Wales\nMon, Jun 23  7:00 PM  Houston, TX, USA NRG Stadium\n1,234 listings',
    });
    expect(card).toEqual({
      id: 'sh-778899',
      source: 'stubhub',
      title: 'USA vs Wales',
      venue: 'NRG Stadium', // "USA" no longer leaks a leading "A" into the venue
      city: 'Houston',
      datetime: '2026-06-23T19:00:00',
      url: 'https://www.stubhub.com/usa-vs-wales-tickets-6-23-2026/event/778899/',
      currency: 'USD',
      thumbnailUrl: '',
      category: 'tickets',
    });
  });

  it('parses a non-US host city via the same location pattern', () => {
    const card = parseCard({
      id: '5',
      href: 'https://www.stubhub.com/mexico-poland-6-18-2026/event/5/',
      text: 'Mexico vs Poland\n1:00 PM  Guadalajara, JAL, Mexico Estadio Akron',
    });
    expect(card?.city).toBe('Guadalajara');
    expect(card?.venue).toBe('Estadio Akron');
    expect(card?.datetime).toBe('2026-06-18T13:00:00');
  });

  it('falls back to the longest line for the title when there is no match', () => {
    const card = parseCard({
      id: '7',
      href: 'https://www.stubhub.com/coldplay-9-1-2026/event/7/',
      text: 'Coldplay Music of the Spheres World Tour\n8:00 PM  Austin, TX, USA Moody Center',
    });
    expect(card?.title).toBe('Coldplay Music of the Spheres World Tour');
  });

  it('leaves datetime empty when the href carries no date slug', () => {
    const card = parseCard({
      id: '9',
      href: 'https://www.stubhub.com/some-event/event/9/',
      text: 'Some Act\n8:00 PM  Denver, CO, USA Ball Arena',
    });
    expect(card?.datetime).toBe('');
  });
});
