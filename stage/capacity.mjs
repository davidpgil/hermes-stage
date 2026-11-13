/**
 * Capacity detection + admission control for Hermes Stage.
 *
 * The Stage room fans a message out to many profiles; a llama-server brain serves a
 * fixed number of slots. Sending more turns than slots just queues them behind a
 * multi-minute prefill (measured: ~95 s per 160K-token prompt at 1M ctx), which looks
 * like a freeze and starves every other Hermes client sharing that endpoint.
 *
 * This module answers two questions without touching Hermes core:
 *   1. How many turns can this endpoint actually take in parallel?  (/props total_slots)
 *   2. Which turns get admitted now, and which wait?
 *
 * Everything is pure so it can be unit-tested with a fake fetch.
 */

const DEFAULT_RESERVED_SLOTS = 1;

export function normalizeEndpoint(api) {
  const raw = String(api || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.replace(/\/v1$/i, '');
}

async function fetchJson(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Probe the model endpoint. Returns the number of parallel slots the brain can serve
 * and its context window. Throws on any probe failure; the caller must fall back to
 * the conservative single-slot assumption.
 */
export async function probeCapacity(endpoint, apiKey, fetchImpl = globalThis.fetch) {
  const base = normalizeEndpoint(endpoint);
  if (!base) throw new Error('no model endpoint');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  const props = await fetchJson(`${base}/props`, headers, fetchImpl);
  let slots = Number(props && props.total_slots);
  if (!Number.isFinite(slots) || slots < 1) slots = 1;
  const ctx = Number(props?.default_generation_settings?.n_ctx) || 0;

  let processing = 0;
  let queued = 0;
  try {
    const info = await fetchJson(`${base}/slots`, headers, fetchImpl);
    if (Array.isArray(info)) {
      processing = info.filter((s) => s && s.is_processing).length;
      queued = info.reduce((n, s) => n + (Number(s && s.n_queued) || 0), 0);
    }
  } catch {
    // /slots is optional: some backends do not expose it. Capacity comes from /props.
  }

  return { slots, ctx, processing, queued };
}

/**
 * One admission gate per model endpoint. ``max`` leaves ``reserved`` slots free for
 * stock Hermes / desktop clients sharing the same brain, but never drops below 1 —
 * Stage always admits at least one turn, otherwise the room would deadlock.
 */
export function makeGate(slots, reserved = DEFAULT_RESERVED_SLOTS) {
  const total = Number.isFinite(slots) && slots >= 1 ? slots : 1;
  const max = Math.max(1, total - Math.max(0, reserved));
  return { slots: total, max, inflight: new Set(), queue: [] };
}

/** True when the gate can admit this bot right now. */
export function admit(gate, name) {
  if (!gate || !name) return false;
  if (gate.inflight.has(name)) return false;
  if (gate.inflight.size >= gate.max) return false;
  gate.inflight.add(name);
  return true;
}

export function release(gate, name) {
  if (gate && name) gate.inflight.delete(name);
}

export function enqueue(gate, item) {
  gate.queue.push(item);
}

/**
 * Drain the waiting queue into free slots. Returns the items the caller must dispatch.
 */
export function pump(gate, isEligible = () => true) {
  const dispatched = [];
  while (gate.inflight.size < gate.max && gate.queue.length) {
    const item = gate.queue.shift();
    if (!item || !item.name || !isEligible(item)) continue;
    if (gate.inflight.has(item.name)) {
      gate.queue.unshift(item);
      break;
    }
    gate.inflight.add(item.name);
    dispatched.push(item);
  }
  return dispatched;
}

/** Room-wide mode: serial when the most constrained gate gives one turn at a time. */
export function roomMode(gates) {
  const list = [...gates.values()];
  if (!list.length) return 'serial';
  return Math.min(...list.map((g) => g.max)) <= 1 ? 'serial' : 'parallel';
}

/**
 * Cap how many members answer one room message. This is the degradation policy:
 * serial (one slot) admits exactly one responder; parallel admits up to the most
 * constrained gate's ``max``.
 */
export function responderLimit(requested, gates) {
  if (requested <= 0) return 0;
  const list = [...gates.values()];
  const cap = list.length ? Math.min(...list.map((g) => g.max)) : 1;
  return Math.max(1, Math.min(requested, cap));
}

/**
 * Pick responders deterministically: preferred (focused/default) first, then the
 * room order. Never mutates the input.
 */
export function pickResponders(bots, limit, preferredName) {
  if (!Array.isArray(bots)) return [];
  if (limit >= bots.length && !preferredName) return bots.slice();
  const preferred = bots.find((b) => b.name === preferredName);
  const out = [];
  if (preferred) out.push(preferred);
  for (const bot of bots) {
    if (out.length >= limit) break;
    if (bot !== preferred) out.push(bot);
  }
  return out;
}

export const LIVE_OCCUPANCY_TTL_MS = 3000;

/**
 * Live slot occupancy, so Stage can defer while another client (stock Hermes,
 * Desktop) is already inside the brain. ``/slots`` is optional; a failure means
 * "assume not busy" rather than blocking the room.
 */
export async function probeOccupancy(endpoint, apiKey, fetchImpl = globalThis.fetch) {
  const base = normalizeEndpoint(endpoint);
  if (!base) throw new Error('no model endpoint');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const info = await fetchJson(`${base}/slots`, headers, fetchImpl);
  const arr = Array.isArray(info) ? info : [];
  return {
    processing: arr.filter((s) => s && s.is_processing).length,
    slots: arr.length,
    at: Date.now(),
  };
}

/**
 * Whether the endpoint still has a slot for this gate after accounting for other
 * clients. ``live.processing`` counts every in-flight turn, including ours.
 */
export function foreignOccupancyLeavesRoom(gate, live) {
  if (!gate) return true;
  const own = gate.inflight.size;
  const processing = Number(live && live.processing) || 0;
  const slots = Number(live && live.slots) || gate.slots;
  const others = Math.max(0, processing - own);
  const free = Math.max(0, slots - own);
  return others < free;
}

export function resolveReserved(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RESERVED_SLOTS;
  return Math.floor(n);
}

