export function withBranch(endpoint: string, branchId: string) {
  const b = String(branchId || '').trim();
  if (!b) return endpoint;

  const hasQuery = endpoint.includes('?');
  const hasBranchAlready = endpoint.includes('branch_id=');

  if (hasBranchAlready) return endpoint;

  return endpoint + (hasQuery ? '&' : '?') + `branch_id=${encodeURIComponent(b)}`;
}
