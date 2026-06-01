/**
 * Pincode-only location audit verification for sample fraud calls.
 * Run: npx tsx scripts/verify-location-audit-pincodes.ts
 */
import { getIndiaPincode } from 'india-pincode';

function normalizePin(pin: string): string {
  const digits = String(pin ?? '').replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(0, 6) : digits;
}

function normalizeStateKey(state: string): string {
  return String(state ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function lookupPincodeAtCoords(
  lat: number,
  lng: number,
  opts?: { installPincode?: string; installState?: string }
) {
  const pin = getIndiaPincode();
  const installPin = normalizePin(opts?.installPincode ?? '');
  const installState = normalizeStateKey(opts?.installState ?? '');

  for (const radiusKm of [12, 25, 60]) {
    const res = pin.findNearby(lat, lng, radiusKm, 20);
    if (!res.success || !res.data?.length) continue;

    if (installPin) {
      const installHits = res.data.filter(
        (h) => normalizePin(h.pincode) === installPin && h.distanceKm <= 25
      );
      if (installHits.length) {
        return normalizePin(
          installHits.reduce((a, b) => (a.distanceKm < b.distanceKm ? a : b)).pincode
        );
      }
    }
    if (installState) {
      const stateHits = res.data.filter(
        (h) => normalizeStateKey(h.state) === installState && h.distanceKm <= 25
      );
      if (stateHits.length) {
        return normalizePin(
          stateHits.reduce((a, b) => (a.distanceKm < b.distanceKm ? a : b)).pincode
        );
      }
    }
    return normalizePin(res.data[0].pincode);
  }
  return '';
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

const cases = [
  {
    id: '26E271684',
    install: '276125',
    gps: { lat: 25.92792792792793, lng: 83.56434206521722 },
    expectedGpsPin: '275101',
    expectFraud: true,
  },
  {
    id: '26E23566',
    install: '387630',
    gps: { lat: 22.8915702, lng: 72.9844319 },
    /** Install pincode appears nearer than raw-first hit 387710 — not fraud */
    expectedGpsPin: '387630',
    expectFraud: false,
  },
];

const bahadurgarh = {
  id: '26E01306',
  install: '124507',
  state: 'HARYANA',
  gps: { lat: 28.69045, lng: 76.91435 },
  expectedGpsPin: '124507',
  expectFraud: false,
};

for (const c of [...cases, bahadurgarh]) {
  const atGps = lookupPincodeAtCoords(c.gps.lat, c.gps.lng, {
    installPincode: c.install,
    installState: 'state' in c ? (c as typeof bahadurgarh).state : undefined,
  });
  assert(atGps === c.expectedGpsPin, `${c.id} GPS maps to pincode ${c.expectedGpsPin} (got ${atGps})`);
  const expectFraud = 'expectFraud' in c ? (c as { expectFraud?: boolean }).expectFraud : true;
  if (expectFraud) {
    assert(
      normalizePin(c.install) !== atGps,
      `${c.id} install ${c.install} ≠ GPS pin ${atGps} → pincode fraud`
    );
  } else {
    assert(
      normalizePin(c.install) === atGps,
      `${c.id} install ${c.install} matches GPS area pincode`
    );
  }
}

console.log('\nAll pincode-only location audit checks passed.');
