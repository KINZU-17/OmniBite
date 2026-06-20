import { Station } from '@prisma/client';
import { resolveStation } from './station';

describe('resolveStation', () => {
  it('routes grill categories to GRILL', () => {
    expect(resolveStation('Grill')).toBe(Station.GRILL);
    expect(resolveStation('Nyama Choma')).toBe(Station.GRILL);
  });

  it('routes fried categories to FRY', () => {
    expect(resolveStation('Fries')).toBe(Station.FRY);
  });

  it('routes cold/dessert/drink categories to COLD', () => {
    expect(resolveStation('Cold Salads')).toBe(Station.COLD);
    expect(resolveStation('Desserts')).toBe(Station.COLD);
    expect(resolveStation('Drinks')).toBe(Station.COLD);
  });

  it('falls back to PASS for unknown or missing categories', () => {
    expect(resolveStation('Mystery')).toBe(Station.PASS);
    expect(resolveStation(null)).toBe(Station.PASS);
    expect(resolveStation(undefined)).toBe(Station.PASS);
  });
});
