'use client';

// Shared CHF-based FX rates (finance stores every amount in CHF). Fetched
// once per session; consumers re-render via the storage tick when it lands.

import { emitStorageChange } from './storage';

export type Rates = { CHF: number; USD: number; EUR: number; GBP: number };

let rates: Rates = { CHF: 1, USD: 1, EUR: 1, GBP: 1 };
let requested = false;

export function getRates(): Rates {
  return rates;
}

export function ensureRates() {
  if (requested || typeof window === 'undefined') return;
  requested = true;
  fetch('https://open.er-api.com/v6/latest/CHF')
    .then((r) => r.json())
    .then((data) => {
      if (data && data.rates) {
        rates = {
          CHF: 1,
          USD: data.rates.USD || 1,
          EUR: data.rates.EUR || 1,
          GBP: data.rates.GBP || 1,
        };
        emitStorageChange();
      }
    })
    .catch(() => {});
}

export function fmtMoney(amountCHF: number, currency: string): string {
  const rate = rates[currency as keyof Rates] || 1;
  const num = (Number(amountCHF) || 0) * rate;
  return `${currency} ${num.toLocaleString('en-US', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
