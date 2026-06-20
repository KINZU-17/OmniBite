/**
 * Re-exported from the shared package so the backend and both PWAs use one set of
 * event names and room helpers. Kept as a local module path so existing relative
 * imports (`../realtime/events`) stay stable.
 */
export { Rooms, Events, InternalEvents } from '@omnibite/shared';
export type { RoundPaidEvent } from '@omnibite/shared';
