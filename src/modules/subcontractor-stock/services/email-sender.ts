import { sendHtmlEmail, type EmailAttachment } from '@/modules/mis-email';
import { listSubcontractorRecipients, getTodaySubcontractorRun, markSubcontractorRunEmailSent, getIstLocalDateStr } from './settings';
import { runTodayReconciliation } from './reconcile-runner';
import { generateReconciliationExcel } from './excel-generator';
import { ReconciledRow } from './reconciliation-engine';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function formatQty(val: number): string {
  if (val % 1 === 0) {
    return val.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  const rounded = Math.round(val * 1000) / 1000;
  return rounded.toLocaleString('en-IN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  });
}

export type TriggerEmailOptions = {
  force?: boolean;
  /** When set, send only to these recipient row ids. */
  recipientIds?: string[];
  /** Override all recipients with a single To (evening ops / test). */
  forceTo?: string;
};

export type TriggerEmailResult = {
  sentCount: number;
};

/**
 * Triggers subcontractor stock reconciliation emails to configured recipients.
 */
export async function triggerSubcontractorEmails(
  options: TriggerEmailOptions = {}
): Promise<TriggerEmailResult> {
  // 1. Get today's run data
  const dateStr = getIstLocalDateStr();
  let todayRun = await getTodaySubcontractorRun(dateStr);

  // If there's no run yet, trigger it on the fly
  let reconciledRows: ReconciledRow[] = [];
  if (!todayRun) {
    console.log(`No run record found for today (${dateStr}). Running reconciliation first...`);
    const result = await runTodayReconciliation();
    todayRun = result.run;
    reconciledRows = result.rows;
  } else {
    // Re-run today's reconciliation dynamically to fetch the memory list of rows
    const result = await runTodayReconciliation();
    reconciledRows = result.rows;
  }

  if (!todayRun) {
    throw new Error('Could not retrieve or generate subcontractor stock run for today.');
  }

  // 2. Check if already sent
  if (todayRun.emailSentAt && !options.force) {
    console.log(`Subcontractor stock reconciliation emails already sent for today (${dateStr}). Skipping.`);
    return { sentCount: 0 };
  }

  // 3. Fetch active recipients
  const forceTo = options.forceTo?.trim().toLowerCase() || '';
  const allRecipients = await listSubcontractorRecipients();
  let activeRecipients = allRecipients.filter((r) => r.enabled);

  if (options.recipientIds && options.recipientIds.length > 0) {
    const idSet = new Set(options.recipientIds);
    activeRecipients = activeRecipients.filter((r) => idSet.has(r.id));
  }

  if (forceTo) {
    // Probe mode: one synthetic recipient covering all plants seen in rows (or ALL).
    const plants = new Set<string>();
    for (const row of reconciledRows) {
      const code = String(row.plant ?? '').trim();
      if (code) plants.add(code);
    }
    if (plants.size === 0) plants.add('ALL');
    activeRecipients = [
      {
        id: 'force-to',
        email: forceTo,
        recipientName: 'Evening ops',
        plantCode: [...plants].join(','),
        reportFilter: 'all',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  if (activeRecipients.length === 0) {
    console.log('No enabled subcontractor stock recipients configured. Skipping email dispatch.');
    return { sentCount: 0 };
  }

  // 4. Group active recipients by unique email address
  const recipientsByEmail = new Map<string, {
    recipientName: string;
    plants: Map<string, 'all' | 'positive' | 'negative'>;
  }>();

  for (const r of activeRecipients) {
    const email = r.email.trim().toLowerCase();
    const name = r.recipientName.trim();
    const plants = r.plantCode.split(',').map((p) => p.trim()).filter(Boolean);
    const filter = r.reportFilter || 'all';

    let config = recipientsByEmail.get(email);
    if (!config) {
      config = {
        recipientName: name,
        plants: new Map<string, 'all' | 'positive' | 'negative'>(),
      };
      recipientsByEmail.set(email, config);
    }
    for (const plant of plants) {
      config.plants.set(plant, filter);
    }
  }

  // 5. Send consolidated email per unique recipient email
  let sentCount = 0;

  for (const [recipientEmail, config] of recipientsByEmail.entries()) {
    const plantCodes = Array.from(config.plants.keys());
    console.log(`Preparing consolidated report for: ${recipientEmail} with Plants: ${plantCodes.join(', ')}`);

    const attachments: EmailAttachment[] = [];
    const combinedFilteredRows: ReconciledRow[] = [];
    let plantsHtml = '';

    for (const plantCode of plantCodes) {
      const reportFilter = config.plants.get(plantCode) || 'all';
      const rawPlantRows = reconciledRows.filter((r) => r.plant === plantCode);

      // Filter rows based on reportFilter preference
      let filteredRows = rawPlantRows;
      if (reportFilter === 'positive') {
        filteredRows = rawPlantRows.filter((r) => r.difference > 0);
      } else if (reportFilter === 'negative') {
        filteredRows = rawPlantRows.filter((r) => r.difference < 0);
      }

      combinedFilteredRows.push(...filteredRows);

      const discrepancies = filteredRows.filter((r) => r.difference !== 0);

      // Generate plant-specific HTML content block
      let plantHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 12px 16px;">
            <h3 style="margin: 0 0 4px 0; color: #1f497d; font-size: 14px; font-weight: 600;">
              Plant ${plantCode} (Preference: ${reportFilter.toUpperCase()})
            </h3>
            <p style="margin: 0; font-size: 12px; color: #64748b;">
              Total Reconciled: <strong>${filteredRows.length}</strong> | 
              Matching: <strong>${filteredRows.length - discrepancies.length}</strong> | 
              Discrepant: <strong style="${discrepancies.length > 0 ? 'color: #ef4444;' : 'color: #10b981;'}">${discrepancies.length}</strong>
            </p>
          </div>
          <div style="padding: 16px;">
      `;

      if (discrepancies.length > 0) {
        // Group by Vendor & Material Group for the mail body
        const vendorGroupMap = new Map<string, {
          vendorName: string;
          vendorCode: string;
          sapQty: number;
          crmQty: number;
          difference: number;
          groups: Map<string, {
            groupName: string;
            sapQty: number;
            crmQty: number;
            difference: number;
          }>;
        }>();

        for (const row of filteredRows) {
          const vendorKey = row.vendor.trim();
          const materialGroup = (row.group || 'Unknown Group').trim();

          let vInfo = vendorGroupMap.get(vendorKey);
          if (!vInfo) {
            vInfo = {
              vendorName: row.vendorName,
              vendorCode: row.vendor,
              sapQty: 0,
              crmQty: 0,
              difference: 0,
              groups: new Map(),
            };
            vendorGroupMap.set(vendorKey, vInfo);
          }

          // Update Vendor Totals
          vInfo.sapQty += row.sapQty;
          vInfo.crmQty += row.crmQty;
          vInfo.difference += row.difference;

          // Update Group Totals
          let gInfo = vInfo.groups.get(materialGroup);
          if (!gInfo) {
            gInfo = {
              groupName: materialGroup,
              sapQty: 0,
              crmQty: 0,
              difference: 0,
            };
            vInfo.groups.set(materialGroup, gInfo);
          }
          gInfo.sapQty += row.sapQty;
          gInfo.crmQty += row.crmQty;
          gInfo.difference += row.difference;
        }

        // Keep vendor name ascending!
        const vendorDiscrepancies = Array.from(vendorGroupMap.values())
          .filter((v) => v.difference !== 0)
          .sort((a, b) => a.vendorName.localeCompare(b.vendorName));

        plantHtml += `
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background-color: #ef4444; color: #ffffff; font-weight: 600;">
                <th style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left;">Vendor / Material Group</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">SAP Qty</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">CRM Qty</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">Diff</th>
              </tr>
            </thead>
            <tbody>
        `;

        for (const v of vendorDiscrepancies.slice(0, 25)) {
          // Vendor header row
          plantHtml += `
            <tr style="background-color: #f1f5f9; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #e2e8f0;">
              <td colspan="4" style="padding: 8px 10px; font-weight: bold; color: #1e293b;">
                ${v.vendorName} (${v.vendorCode})
              </td>
            </tr>
          `;

          // Material groups under this vendor - sort them alphabetically ascending too
          const groups = Array.from(v.groups.values())
            .filter((g) => g.difference !== 0)
            .sort((a, b) => a.groupName.localeCompare(b.groupName));

          for (const g of groups) {
            plantHtml += `
              <tr style="border-bottom: 1px solid #f1f5f9; background-color: #ffffff;">
                <td style="padding: 6px 10px 6px 24px; color: #475569; font-style: italic;">
                  &bull; ${g.groupName}
                </td>
                <td style="padding: 6px 10px; text-align: right; font-family: monospace; color: #64748b;">${formatQty(g.sapQty)}</td>
                <td style="padding: 6px 10px; text-align: right; font-family: monospace; color: #64748b;">${formatQty(g.crmQty)}</td>
                <td style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 500; color: ${g.difference < 0 ? '#ef4444' : '#10b981'};">${formatQty(g.difference)}</td>
              </tr>
            `;
          }

          // Vendor total summary row
          plantHtml += `
            <tr style="background-color: #fdf2f2; border-bottom: 1px solid #cbd5e1; font-weight: 600;">
              <td style="padding: 6px 10px 6px 12px; color: #9c0006;">
                Total
              </td>
              <td style="padding: 6px 10px; text-align: right; font-family: monospace; color: #0f172a;">${formatQty(v.sapQty)}</td>
              <td style="padding: 6px 10px; text-align: right; font-family: monospace; color: #0f172a;">${formatQty(v.crmQty)}</td>
              <td style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: bold; color: #9c0006;">${formatQty(v.difference)}</td>
            </tr>
          `;
        }

        plantHtml += `
            </tbody>
          </table>
        `;

        if (vendorDiscrepancies.length > 25) {
          plantHtml += `<p style="font-size: 11px; color: #64748b; margin: 10px 0 0 0;">* Showing top 25 vendors with discrepancies. The complete list is in the attached Excel sheet.</p>`;
        }
      } else {
        plantHtml += `
          <div style="background-color: #ecfdf5; border: 1px solid #10b981; border-radius: 6px; padding: 12px; color: #065f46; font-size: 13px; font-weight: 500; text-align: center;">
            No subcontractor stock discrepancies detected for Plant ${plantCode} matching the preference.
          </div>
        `;
      }

      plantHtml += `
          </div>
        </div>
      `;

      plantsHtml += plantHtml;
    }

    // Now, compile a single Excel workbook for all rows
    if (combinedFilteredRows.length > 0) {
      // Sort combined rows by: Plant ascending, Vendor Name ascending, Material Group ascending, Material Code ascending
      combinedFilteredRows.sort((a, b) => {
        const pComp = a.plant.localeCompare(b.plant);
        if (pComp !== 0) return pComp;
        const vComp = a.vendorName.localeCompare(b.vendorName);
        if (vComp !== 0) return vComp;
        const gComp = (a.group || '').localeCompare(b.group || '');
        if (gComp !== 0) return gComp;
        return a.material.localeCompare(b.material);
      });

      const singleWorkbook = await generateReconciliationExcel(combinedFilteredRows);
      const buffer = Buffer.from(await singleWorkbook.xlsx.writeBuffer());

      attachments.push({
        filename: `subcontractor_stock_reconciliation_${dateStr}.xlsx`,
        content: buffer,
        contentType: XLSX_CONTENT_TYPE,
      });
    }

    // Generate dynamic subject title depending on number of plants
    let subject = '';
    if (plantCodes.length === 1) {
      subject = `[Reconciliation Alert] Subcontractor Stock Report - Plant ${plantCodes[0]} (${dateStr})`;
    } else if (plantCodes.length <= 5) {
      subject = `[Reconciliation Alert] Subcontractor Stock Report - Plants ${plantCodes.join(', ')} (${dateStr})`;
    } else {
      subject = `[Reconciliation Alert] Subcontractor Stock Report - Consolidated (${plantCodes.length} Plants) (${dateStr})`;
    }

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 700px; color: #333333; line-height: 1.5; font-size: 14px;">
        <div style="border-bottom: 2px solid #1f497d; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #1f497d; margin: 0; font-size: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Subcontractor Stock Reconciliation Report
          </h2>
        </div>
        
        <p style="margin: 0 0 20px 0;">Dear ${config.recipientName}, please find the daily subcontractor stock reconciliation reports for <strong>${dateStr}</strong> below. Filtered Excel report is attached.</p>
        
        ${plantsHtml}
        
        <p style="margin: 24px 0 0 0; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; line-height: 1.4;">
          This is an automated system email generated from subcontractor mirror tables and nightly SAP MBLB reports. Please do not reply directly to this message.
        </p>
      </div>
    `;

    await sendHtmlEmail({
      to: recipientEmail,
      subject,
      html: htmlContent,
      text: `Dear ${config.recipientName}, subcontractor stock reconciliation for ${dateStr}. Plants: ${plantCodes.join(', ')}. See attached Excel.`,
      attachments,
    });

    sentCount++;
  }

  // 7. Mark as email sent when dispatch covered all enabled recipients
  const enabledCount = allRecipients.filter((r) => r.enabled).length;
  const sentToAll =
    !options.recipientIds ||
    options.recipientIds.length === 0 ||
    (enabledCount > 0 && activeRecipients.length >= enabledCount);

  if (sentToAll && sentCount > 0) {
    await markSubcontractorRunEmailSent(dateStr);
  }

  return {
    sentCount,
  };
}
