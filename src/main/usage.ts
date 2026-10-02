import type { Usage } from '../shared/types';

export function addUsage(u: Usage, d?: Usage): void {
  if (!d) return;
  if (d.costUsd !== undefined) u.costUsd = (u.costUsd ?? 0) + d.costUsd;
  if (d.tokens !== undefined) u.tokens = (u.tokens ?? 0) + d.tokens;
}
