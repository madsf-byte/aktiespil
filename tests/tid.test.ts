import { describe, expect, it } from 'vitest';
import { boersstatus, datoKl, danskDato, tzOffset } from '../supabase/functions/_shared/tid.ts';

const sek = (iso: string) => Date.parse(iso) / 1000;
// Tirsdag 6. okt. 2026, København 9:00–17:00 CEST.
const cph = { sessionStart: sek('2026-10-06T07:00:00Z'), sessionEnd: sek('2026-10-06T15:00:00Z'), timezone: 'Europe/Copenhagen' };

describe('boersstatus', () => {
  it('er åben inden for handelsperioden', () => {
    expect(boersstatus(cph, sek('2026-10-06T10:00:00Z'))).toEqual({ open: true, nextOpen: null });
  });
  it('åbner senere samme dag før åbning', () => {
    expect(boersstatus(cph, sek('2026-10-06T05:00:00Z'))).toEqual({ open: false, nextOpen: cph.sessionStart });
  });
  it('åbner næste hverdag efter lukketid', () => {
    expect(boersstatus(cph, sek('2026-10-06T16:00:00Z')).nextOpen).toBe(sek('2026-10-07T07:00:00Z'));
  });
  it('springer weekenden over', () => {
    const fre = { ...cph, sessionStart: sek('2026-10-09T07:00:00Z'), sessionEnd: sek('2026-10-09T15:00:00Z') };
    expect(boersstatus(fre, sek('2026-10-10T12:00:00Z')).nextOpen).toBe(sek('2026-10-12T07:00:00Z'));
  });
  it('holder lokal åbningstid hen over skift til vintertid', () => {
    // Fredag 23. okt. 9:00 CEST; næste åbning mandag 26. okt. 9:00 CET = 08:00Z.
    const fre = { ...cph, sessionStart: sek('2026-10-23T07:00:00Z'), sessionEnd: sek('2026-10-23T15:00:00Z') };
    expect(boersstatus(fre, sek('2026-10-24T12:00:00Z')).nextOpen).toBe(sek('2026-10-26T08:00:00Z'));
  });
});

describe('datoer', () => {
  it('tzOffset kender sommertid', () => {
    expect(tzOffset('Europe/Copenhagen', sek('2026-07-01T12:00:00Z'))).toBe(7200);
    expect(tzOffset('Europe/Copenhagen', sek('2026-12-01T12:00:00Z'))).toBe(3600);
  });
  it('datoKl giver 17:00 dansk tid', () => {
    expect(datoKl('2027-04-06')).toBe('2027-04-06T15:00:00.000Z');
    expect(datoKl('2027-01-06')).toBe('2027-01-06T16:00:00.000Z');
  });
  it('danskDato bruger dansk tid', () => {
    expect(danskDato('2026-10-06T22:30:00Z')).toBe('2026-10-07');
  });
});
