import { Client } from 'pg';
import { loadEnv } from '@/lib/read-model/db';

export type CrmStockRow = {
  plantCode: string;
  plantName: string;
  vendorCode: string;
  vendorName: string;
  materialCode: string;
  materialDescription: string;
  materialGroup: string;
  uom: string;
  crmQty: number;
};

/**
 * Queries CRM subcontractor stock levels for specific plant codes.
 */
export async function fetchCrmSubcontractorStock(plantCodes: string[]): Promise<CrmStockRow[]> {
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL;
  if (!url) {
    throw new Error('OLD_CRM_DATABASE_URL is not set in environment.');
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const res = await client.query(
      `SELECT 
         p.vsapplantcode AS plant_code,
         p.vcompanyname AS plant_name,
         c.vsapvendorcode AS vendor_code,
         c.vcompanyname AS vendor_name,
         i.vitemcode AS material_code,
         i.vname AS material_description,
         cat.vname AS material_group,
         u.vshortname AS uom,
         SUM(COALESCE(NULLIF(s.ngoodbal, '')::numeric, 0))::float AS crm_qty
       FROM crm_raw.mststkdt s
       JOIN crm_raw.mstoffice c ON c.ncode = s.nofficeid
       JOIN crm_raw.mstoffice p ON p.ncode = c.nunder
       JOIN crm_raw.mstitems i ON i.ncode = s.nitem
       LEFT JOIN crm_raw.mstitemcategory cat ON cat.ncode = i.nitemcategory
       LEFT JOIN crm_raw.mstunits u ON u.ncode = i.nunits
       WHERE c.vsapvendorcode IS NOT NULL AND c.vsapvendorcode <> ''
         AND p.vsapplantcode = ANY($1::text[])
       GROUP BY 
         p.vsapplantcode, p.vcompanyname,
         c.vsapvendorcode, c.vcompanyname,
         i.vitemcode, i.vname, cat.vname, u.vshortname`,
      [plantCodes]
    );

    return res.rows.map(row => ({
      plantCode: row.plant_code || '',
      plantName: row.plant_name || '',
      vendorCode: row.vendor_code || '',
      vendorName: row.vendor_name || '',
      materialCode: row.material_code || '',
      materialDescription: row.material_description || 'Unknown Item',
      materialGroup: row.material_group || 'Unknown',
      uom: row.uom || '',
      crmQty: row.crm_qty || 0,
    }));
  } finally {
    await client.end();
  }
}

export type CrmVendorPlant = {
  plantCode: string;
  plantName: string;
};

/**
 * Fetches the mapping from SAP vendor code to CRM parent plant info.
 */
export async function fetchCrmVendorPlantMap(): Promise<Map<string, CrmVendorPlant>> {
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL;
  if (!url) {
    throw new Error('OLD_CRM_DATABASE_URL is not set in environment.');
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const res = await client.query(
      `SELECT 
         c.vsapvendorcode AS vendor_code,
         p.vsapplantcode AS plant_code,
         p.vcompanyname AS plant_name
       FROM crm_raw.mstoffice c
       JOIN crm_raw.mstoffice p ON p.ncode = c.nunder
       WHERE c.vsapvendorcode IS NOT NULL AND c.vsapvendorcode <> ''`
    );

    const map = new Map<string, CrmVendorPlant>();
    for (const row of res.rows) {
      const normVendor = row.vendor_code.trim().replace(/^0+/, '');
      map.set(normVendor, {
        plantCode: row.plant_code || '',
        plantName: row.plant_name || '',
      });
    }
    return map;
  } finally {
    await client.end();
  }
}

export type CrmMetaItem = {
  code: string;
  name: string;
};

/**
 * Fetches all unique plants from CRM.
 */
export async function fetchCrmPlants(): Promise<CrmMetaItem[]> {
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL;
  if (!url) throw new Error('OLD_CRM_DATABASE_URL is not set.');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT p.vsapplantcode AS code, p.vcompanyname AS name
      FROM crm_raw.mstoffice c
      JOIN crm_raw.mstoffice p ON p.ncode = c.nunder
      WHERE c.vsapvendorcode IS NOT NULL AND c.vsapvendorcode <> ''
        AND p.vsapplantcode IS NOT NULL AND p.vsapplantcode <> ''
      ORDER BY p.vsapplantcode
    `);
    const unique = new Map<string, string>();
    for (const row of res.rows) {
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      if (code && !unique.has(code)) {
        unique.set(code, name);
      }
    }
    return Array.from(unique.entries()).map(([code, name]) => ({ code, name }));
  } finally {
    await client.end();
  }
}

/**
 * Fetches all unique vendors from CRM.
 */
export async function fetchCrmVendors(): Promise<CrmMetaItem[]> {
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL;
  if (!url) throw new Error('OLD_CRM_DATABASE_URL is not set.');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT vsapvendorcode AS code, vcompanyname AS name
      FROM crm_raw.mstoffice
      WHERE vsapvendorcode IS NOT NULL AND vsapvendorcode <> ''
      ORDER BY vsapvendorcode
    `);
    const unique = new Map<string, string>();
    for (const row of res.rows) {
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      if (code && !unique.has(code)) {
        unique.set(code, name);
      }
    }
    return Array.from(unique.entries()).map(([code, name]) => ({ code, name }));
  } finally {
    await client.end();
  }
}

/**
 * Fetches all active material items from CRM.
 */
export async function fetchCrmActiveMaterials(): Promise<CrmMetaItem[]> {
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL;
  if (!url) throw new Error('OLD_CRM_DATABASE_URL is not set.');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT i.vitemcode AS code, i.vname AS name
      FROM crm_raw.mstitems i
      WHERE i.vitemcode IS NOT NULL AND i.vitemcode <> ''
      ORDER BY i.vitemcode
    `);
    const unique = new Map<string, string>();
    for (const row of res.rows) {
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      if (code && !unique.has(code)) {
        unique.set(code, name);
      }
    }
    return Array.from(unique.entries()).map(([code, name]) => ({ code, name }));
  } finally {
    await client.end();
  }
}


