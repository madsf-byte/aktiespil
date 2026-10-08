import { describe, expect, it } from 'vitest';
import {
  beregnHandel, efterKoeb, efterSalg, graense, ledigGraense, maxAntalKoeb, tjekKoeb, tjekSalg,
} from '../supabase/functions/_shared/regler.ts';
import type { Holding, Satser } from '../supabase/functions/_shared/types.ts';

const s: Satser = {
  start_capital: 100000, fee_dk_pct: 0.1, fee_dk_min: 29, fee_int_pct: 0.15, fee_int_min: 49, fx_pct: 0.25, max_pct: 20,
};

describe('beregnHandel', () => {
  it('bruger minimumskurtage på små danske handler', () => {
    expect(beregnHandel(s, 'buy', 10, 712.4, 1, 'DKK')).toEqual({ valueDkk: 7124, fee: 29, fxFee: 0, total: 7153 });
  });
  it('bruger procentsats på store danske handler', () => {
    expect(beregnHandel(s, 'buy', 100, 500, 1, 'DKK')).toEqual({ valueDkk: 50000, fee: 50, fxFee: 0, total: 50050 });
  });
  it('lægger valutatillæg på udenlandske køb', () => {
    // 10 × 200 USD × 6,5 = 13.000 kr. Kurtage max(49, 19,5)=49. Valuta 32,5.
    expect(beregnHandel(s, 'buy', 10, 200, 6.5, 'USD')).toEqual({ valueDkk: 13000, fee: 49, fxFee: 32.5, total: 13081.5 });
  });
  it('trækker kurtage og valutatillæg fra ved salg', () => {
    expect(beregnHandel(s, 'sell', 100, 200, 6.5, 'USD')).toEqual({ valueDkk: 130000, fee: 195, fxFee: 325, total: 129480 });
  });
});

describe('tjekKoeb', () => {
  it('afviser når kontanterne ikke rækker', () => {
    expect(tjekKoeb(s, { cash: 1000, invested: 0, pendingEst: 0 }, 990, 1019)).toMatch(/ikke nok kontanter/);
  });
  it('afviser når grænsen pr. aktie overskrides, og fortæller hvor meget der er tilbage', () => {
    expect(graense(s)).toBe(20000);
    const fejl = tjekKoeb(s, { cash: 90000, invested: 15000, pendingEst: 1000 }, 5000, 5029);
    expect(fejl).toMatch(/4\.000,00 kr\. mere/);
  });
  it('tillader køb præcis op til grænsen', () => {
    expect(tjekKoeb(s, { cash: 90000, invested: 15000, pendingEst: 0 }, 5000, 5029)).toBeNull();
  });
  it('ledigGraense bliver aldrig negativ', () => {
    expect(ledigGraense(s, 25000, 0)).toBe(0);
  });
});

describe('maxAntalKoeb', () => {
  it('begrænses af grænsen pr. aktie', () => {
    expect(maxAntalKoeb(s, { cash: 100000, invested: 0, pendingEst: 0 }, 300, 1, 'DKK')).toBe(66);
  });
  it('begrænses af kontanter inkl. kurtage', () => {
    // 10 × 100 = 1000 + 29 > 1020 → 9 stk.
    expect(maxAntalKoeb(s, { cash: 1020, invested: 0, pendingEst: 0 }, 100, 1, 'DKK')).toBe(9);
  });
  it('tager højde for buffer ved ventende ordrer', () => {
    expect(maxAntalKoeb(s, { cash: 1200, invested: 0, pendingEst: 0 }, 100, 1, 'DKK', 1.1)).toBe(10);
  });
});

describe('tjekSalg', () => {
  it('afviser salg af flere end man ejer', () => {
    expect(tjekSalg(5, 6, 100)).toMatch(/højst sælge 5/);
    expect(tjekSalg(0, 1, 100)).toMatch(/ingen ledige/);
  });
  it('afviser salg hvor kurtagen er større end beløbet', () => {
    expect(tjekSalg(5, 1, -10)).toMatch(/kurtagen/);
  });
});

describe('gennemsnitlig købspris', () => {
  const h: Holding = {
    player_id: 'p', game_id: 'g', symbol: 'X', name: 'X', currency: 'DKK', exchange: 'CPH',
    qty: 0, qty_reserved: 0, invested_dkk: 0, split_ts: 0,
  };
  it('lægger værdien til ved køb og trækker forholdsmæssigt fra ved salg', () => {
    const a = efterKoeb(efterKoeb(h, 10, 1000), 10, 3000);
    expect(a).toMatchObject({ qty: 20, invested_dkk: 4000 });
    expect(efterSalg(a, 5)).toMatchObject({ qty: 15, invested_dkk: 3000 });
    expect(efterSalg(a, 20)).toMatchObject({ qty: 0, invested_dkk: 0 });
  });
});
