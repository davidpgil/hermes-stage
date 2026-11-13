import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_WATCH_LEAD_MS = 120000;
export const DEFAULT_WATCH_HOLD_MS = 300000;
export const DEFAULT_WATCH_INTERVAL_MS = 60000;
const PAUSED_STATES = new Set(['paused', 'disabled']);

export function readCronJobs(home) {
  try {
    const raw = readFileSync(join(home, 'cron', 'jobs.json'), 'utf8');
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data) ? data : (data && Array.isArray(data.jobs) ? data.jobs : []);
    return jobs.filter((job) => job && typeof job === 'object');
  } catch {
    return [];
  }
}

export function isActiveJob(job) {
  if (!job || job.enabled === false) return false;
  if (job.state && PAUSED_STATES.has(String(job.state).toLowerCase())) return false;
  return true;
}

export function nextCronJob(jobs, now = Date.now()) {
  let best = null;
  for (const job of jobs || []) {
    if (!isActiveJob(job)) continue;
    const at = Date.parse(job.next_run_at || '');
    if (!Number.isFinite(at) || at <= now) continue;
    if (!best || at < best.at) best = { at, job };
  }
  return best;
}

export function wakeDelay(at, now = Date.now(), leadMs = DEFAULT_WATCH_LEAD_MS) {
  return Math.max(0, at - leadMs - now);
}

/**
 * Non-LLM cron watcher. It reads the profile cron stores, schedules the next
 * due job, and wakes the profile only in a bounded window around that job.
 * It never calls a model or runs the cron job itself.
 */
export class CronWatcher {
  constructor({ profiles, onWake, onError, leadMs = DEFAULT_WATCH_LEAD_MS, intervalMs = DEFAULT_WATCH_INTERVAL_MS }) {
    this.profiles = profiles || [];
    this.onWake = onWake;
    this.onError = onError;
    this.leadMs = leadMs;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.interval = null;
    this.woken = new Set();
    this.stopped = false;
  }

  start() {
    if (this.stopped) return;
    this.refresh();
    this.interval = setInterval(() => this.refresh(), this.intervalMs);
    if (this.interval.unref) this.interval.unref();
  }

  refresh() {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = Date.now();
    let best = null;
    for (const profile of this.profiles) {
      const job = nextCronJob(readCronJobs(profile.home), now);
      if (!job) continue;
      const key = `${profile.name}:${job.job.id || job.job.name || 'job'}:${job.at}`;
      if (this.woken.has(key)) continue;
      if (!best || job.at < best.at) {
        best = { profile, at: job.at, key };
      }
    }
    if (!best) return;
    const delay = wakeDelay(best.at, now, this.leadMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      this.woken.add(best.key);
      Promise.resolve(this.onWake(best.profile))
        .catch((e) => { if (this.onError) this.onError(e); })
        .finally(() => this.refresh());
    }, delay);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }
}
