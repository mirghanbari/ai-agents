import { describe, it, expect } from 'vitest';
import { isRecord, asArray, dig, pickString, pickNumber, pickInt, pickStringArray } from './coerce';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it('rejects null, arrays, and primitives', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(3)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('asArray', () => {
  it('passes arrays through', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
  it('coerces non-arrays to []', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray({ length: 2 })).toEqual([]);
    expect(asArray('ab')).toEqual([]);
  });
});

describe('dig', () => {
  const obj = { a: { b: [{ c: 'hit' }] } };
  it('reads a nested path through objects and arrays', () => {
    expect(dig(obj, 'a', 'b', 0, 'c')).toBe('hit');
  });
  it('returns undefined when any hop is absent', () => {
    expect(dig(obj, 'a', 'x', 'y')).toBeUndefined();
    expect(dig(obj, 'a', 'b', 5, 'c')).toBeUndefined();
  });
  it('returns undefined when a hop type mismatches the key type', () => {
    expect(dig(obj, 'a', 0)).toBeUndefined(); // numeric key into an object
    expect(dig(obj, 'a', 'b', 'c')).toBeUndefined(); // string key into an array
  });
});

describe('pickString', () => {
  it('returns strings as-is', () => {
    expect(pickString('hello')).toBe('hello');
    expect(pickString('')).toBe('');
  });
  it('stringifies finite numbers', () => {
    expect(pickString(42)).toBe('42');
    expect(pickString(0)).toBe('0');
  });
  it('rejects non-finite numbers and other types', () => {
    expect(pickString(NaN)).toBeUndefined();
    expect(pickString(Infinity)).toBeUndefined();
    expect(pickString(null)).toBeUndefined();
    expect(pickString({})).toBeUndefined();
  });
});

describe('pickNumber', () => {
  it('returns finite numbers as-is', () => {
    expect(pickNumber(12.5)).toBe(12.5);
    expect(pickNumber(0)).toBe(0);
    expect(pickNumber(-3)).toBe(-3);
  });
  it('strips currency symbols and separators from numeric strings', () => {
    expect(pickNumber('$1,234.50')).toBe(1234.5);
    expect(pickNumber('USD 99')).toBe(99);
    expect(pickNumber('-42')).toBe(-42);
  });
  it('rejects empty, sign-only, and non-numeric strings', () => {
    expect(pickNumber('')).toBeUndefined();
    expect(pickNumber('-')).toBeUndefined();
    expect(pickNumber('n/a')).toBeUndefined();
  });
  it('rejects non-finite numbers and other types', () => {
    expect(pickNumber(NaN)).toBeUndefined();
    expect(pickNumber(Infinity)).toBeUndefined();
    expect(pickNumber(null)).toBeUndefined();
  });
});

describe('pickInt', () => {
  it('truncates toward zero', () => {
    expect(pickInt(12.9)).toBe(12);
    expect(pickInt('7.6')).toBe(7);
    expect(pickInt(-3.2)).toBe(-3);
  });
  it('passes undefined through for unparseable input', () => {
    expect(pickInt('n/a')).toBeUndefined();
  });
});

describe('pickStringArray', () => {
  it('keeps string entries and drops undefined ones', () => {
    expect(pickStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(pickStringArray(['a', undefined, 'c'])).toEqual(['a', 'c']);
    expect(pickStringArray([1, 'b'])).toEqual(['1', 'b']); // numbers coerce via pickString
  });
  it('returns undefined for non-arrays and all-empty results', () => {
    expect(pickStringArray('a')).toBeUndefined();
    expect(pickStringArray(undefined)).toBeUndefined();
    expect(pickStringArray([undefined, null])).toBeUndefined();
  });
});
