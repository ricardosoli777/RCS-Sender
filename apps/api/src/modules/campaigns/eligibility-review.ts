import type { PoolClient } from 'pg';
export type CachedEligibilityCounts = { total: number; blocked: number; eligible: number; ineligible: number; unknown: number; stale: number; unchecked: number };

/** Aggregate saved checks only; no provider calls and no recipient data returned. */
export async function readCachedEligibility(client: PoolClient,workspaceId: string,listId: string | null,connectionId: string | null,currentVersion: string | null,supportsEligibility: boolean,now: number): Promise<CachedEligibilityCounts> {
  return (await client.query<CachedEligibilityCounts>(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE category='blocked')::int AS blocked,
    count(*) FILTER (WHERE category='eligible')::int AS eligible,
    count(*) FILTER (WHERE category='ineligible')::int AS ineligible,
    count(*) FILTER (WHERE category='unknown')::int AS unknown,
    count(*) FILTER (WHERE category='stale')::int AS stale,
    count(*) FILTER (WHERE category='unchecked')::int AS unchecked
    FROM (SELECT CASE
      WHEN o.phone_normalized IS NOT NULL THEN 'blocked'
      WHEN e.contact_id IS NULL THEN 'unchecked'
      WHEN $4::text IS NULL OR e.credential_version<>$4 OR e.phone_normalized IS DISTINCT FROM c.phone_normalized OR e.expires_at <= $6 THEN 'stale'
      WHEN NOT $5::boolean OR e.status='unknown' THEN 'unknown'
      WHEN e.status='eligible' AND e.reason='provider_checked' THEN 'eligible'
      WHEN e.status='ineligible' AND e.reason='provider_checked' THEN 'ineligible'
      WHEN e.status='blocked' THEN 'blocked'
      ELSE 'unknown' END AS category
      FROM contact_list_members lm JOIN contacts c ON c.workspace_id=lm.workspace_id AND c.id=lm.contact_id
      LEFT JOIN opt_outs o ON o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized
      LEFT JOIN eligibility_checks e ON e.workspace_id=c.workspace_id AND e.contact_id=c.id AND e.connection_id=$3
      WHERE lm.workspace_id=$1 AND lm.list_id=$2) classified`,[workspaceId,listId,connectionId,currentVersion,supportsEligibility,new Date(now)])).rows[0]!;
}
