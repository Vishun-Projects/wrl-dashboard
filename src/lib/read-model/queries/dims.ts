import { prisma } from '@/lib/prisma';

export async function queryOfficesFromPostgres(assignedOffices: string[], isHod: boolean) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ncode: number; vcompanyname: string | null; nunder: number | null }>
  >(
    `
    SELECT ncode, vcompanyname, nunder
    FROM dim_offices
    ORDER BY vcompanyname ASC
    `
  );

  const mapped = rows.map((row) => ({
    ncode: String(row.ncode),
    vcompanyname: row.vcompanyname,
    nunder: row.nunder != null ? String(row.nunder) : null,
  }));

  if (isHod) return mapped;
  return mapped.filter(
    (o) =>
      assignedOffices.includes(o.ncode) ||
      (o.nunder != null && assignedOffices.includes(o.nunder))
  );
}

export async function queryCallTypesFromPostgres() {
  const rows = await prisma.$queryRawUnsafe<Array<{ display_value: string }>>(
    `
    SELECT DISTINCT call_type AS display_value
    FROM calls_latest_hot
    WHERE call_type IS NOT NULL
      AND btrim(call_type) <> ''
    ORDER BY display_value ASC
    `
  );
  return rows.map((row) => row.display_value);
}

export async function queryEngineersFromPostgres(branchName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ vname: string }>>(
    `
    SELECT DISTINCT e.vname
    FROM dim_engineers e
    JOIN dim_offices o ON o.ncode = e.nofficeid
    WHERE o.vcompanyname = $1
      AND e.vname <> ''
    ORDER BY e.vname ASC
    `,
    branchName
  );
  return rows.map((row) => row.vname);
}
