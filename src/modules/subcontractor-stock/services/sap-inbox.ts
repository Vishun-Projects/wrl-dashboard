import fs from 'fs';
import path from 'path';
import { parseSapMblbHtml } from './sap-parser';
import {
  getIstLocalDateStr,
  listSapMailLog,
  upsertSapMailLogEntry,
  type SapMailLogEntry,
} from './settings';
import { isSubcontractorVpsHost, resolveSubcontractorExtractDir } from './vps-host';

type ParsedMailHeaders = {
  subject: string;
  sender: string;
  receivedAt: Date;
};

// VPS Maildir paths are absolute (/home, /root/…). Without turbopackIgnore, NFT traces the whole repo into the serverless bundle and Vercel deploy fails.
function existsSync(p: string): boolean {
  return fs.existsSync(/*turbopackIgnore: true*/ p);
}
function readdirSync(p: string): string[] {
  return fs.readdirSync(/*turbopackIgnore: true*/ p);
}
function statSync(p: string): fs.Stats {
  return fs.statSync(/*turbopackIgnore: true*/ p);
}
function readFileSync(p: string): Buffer {
  return fs.readFileSync(/*turbopackIgnore: true*/ p);
}
function joinPath(...parts: string[]): string {
  return path.join(/*turbopackIgnore: true*/ parts[0] ?? '', ...parts.slice(1));
}
function resolvePath(p: string): string {
  return path.resolve(/*turbopackIgnore: true*/ p);
}

function findMaildirPaths(): string[] {
  const roots = ['/home', '/var/mail', '/root', '/var/spool/mail'];
  const found = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root)) {
        const candidate = joinPath(root, entry);
        if (!existsSync(candidate)) continue;
        const stat = statSync(candidate);
        if (!stat.isDirectory()) continue;
        if (existsSync(joinPath(candidate, 'new')) || existsSync(joinPath(candidate, 'cur'))) {
          found.add(resolvePath(candidate));
        }
        if (entry === 'Maildir' && root !== '/root') {
          const parent = path.dirname(candidate);
          if (existsSync(joinPath(parent, 'new')) || existsSync(joinPath(parent, 'cur'))) {
            found.add(resolvePath(parent));
          }
        }
      }
    } catch {
      // ponytail: skip unreadable mail roots on dev/local hosts
    }
  }

  if (existsSync('/root/Maildir')) {
    const rootMaildir = '/root/Maildir';
    if (existsSync(joinPath(rootMaildir, 'new')) || existsSync(joinPath(rootMaildir, 'cur'))) {
      found.add(resolvePath(rootMaildir));
    }
  }

  return [...found];
}

function unfoldHeaderLines(headerBlock: string): string[] {
  const lines: string[] = [];
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += ' ' + line.trim();
    } else if (line.trim()) {
      lines.push(line.trim());
    }
  }
  return lines;
}

function parseMailHeaders(raw: Buffer): ParsedMailHeaders {
  const slice = raw.subarray(0, Math.min(raw.length, 128_000));
  const text = slice.toString('binary');
  const headerEnd = text.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const lines = unfoldHeaderLines(headerBlock);

  let subject = '';
  let sender = '';
  let dateStr = '';

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('subject:')) {
      subject = line.slice(8).trim();
    } else if (lower.startsWith('from:')) {
      sender = line.slice(5).trim();
    } else if (lower.startsWith('date:')) {
      dateStr = line.slice(5).trim();
    }
  }

  const receivedAt = dateStr ? new Date(dateStr) : null;
  const safeDate =
    receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : new Date();

  return { subject, sender, receivedAt: safeDate };
}

function listExtractedAttachmentsForMail(
  extractDir: string,
  mailKey: string
): string[] {
  if (!existsSync(extractDir)) return [];
  const prefix = `${mailKey}_`;
  return readdirSync(extractDir).filter(
    (name) =>
      name.startsWith(prefix) &&
      (name.toLowerCase().endsWith('.htm') || name.toLowerCase().endsWith('.html'))
  );
}

function parsePlantCodesFromAttachments(
  extractDir: string,
  attachmentNames: string[]
): string[] {
  const plants = new Set<string>();
  for (const name of attachmentNames) {
    const filepath = joinPath(extractDir, name);
    if (!existsSync(filepath)) continue;
    try {
      const groups = parseSapMblbHtml(filepath);
      for (const group of groups) {
        for (const item of group.items) {
          if (item.plantCode) plants.add(item.plantCode);
        }
      }
    } catch {
      // ponytail: skip unparseable attachment during inbox sync; reconcile will surface errors
    }
  }
  return [...plants].sort();
}

function scanMaildirMessage(
  filepath: string,
  extractDir: string
): {
  mailKey: string;
  subject: string;
  sender: string;
  receivedAt: Date;
  attachmentNames: string[];
  reportDate: string;
  plantCodes: string[];
  extractedAt: Date | null;
} | null {
  const mailKey = path.basename(filepath);
  if (!mailKey || mailKey.startsWith('.')) return null;

  let raw: Buffer;
  try {
    raw = readFileSync(filepath);
  } catch {
    return null;
  }

  const headers = parseMailHeaders(raw);
  const attachmentNames = listExtractedAttachmentsForMail(extractDir, mailKey);
  const receivedAt = headers.receivedAt;
  const reportDate = getIstLocalDateStr(receivedAt);
  const plantCodes =
    attachmentNames.length > 0
      ? parsePlantCodesFromAttachments(extractDir, attachmentNames)
      : [];

  let extractedAt: Date | null = null;
  if (attachmentNames.length > 0) {
    extractedAt = new Date(
      Math.max(
        ...attachmentNames.map((name) => statSync(joinPath(extractDir, name)).mtimeMs)
      )
    );
  }

  return {
    mailKey,
    subject: headers.subject || '(No Subject)',
    sender: headers.sender,
    receivedAt,
    attachmentNames,
    reportDate,
    plantCodes,
    extractedAt,
  };
}

/** Scan VPS Maildir + extracted_sap and upsert inbox rows. No-op on non-VPS without local maildir. */
export async function syncSapMailInbox(): Promise<{ upserted: number; entries: SapMailLogEntry[] }> {
  const extractDir = resolveSubcontractorExtractDir();
  const maildirs = isSubcontractorVpsHost() ? findMaildirPaths() : [];
  const seenKeys = new Set<string>();
  let upserted = 0;

  for (const maildir of maildirs) {
    for (const sub of ['new', 'cur'] as const) {
      const dirPath = joinPath(maildir, sub);
      if (!existsSync(dirPath)) continue;
      for (const entry of readdirSync(dirPath)) {
        const filepath = joinPath(dirPath, entry);
        if (!statSync(filepath).isFile()) continue;
        const parsed = scanMaildirMessage(filepath, extractDir);
        if (!parsed) continue;
        seenKeys.add(parsed.mailKey);
        await upsertSapMailLogEntry({
          mailKey: parsed.mailKey,
          subject: parsed.subject,
          sender: parsed.sender,
          receivedAt: parsed.receivedAt,
          extractedAt: parsed.extractedAt,
          attachmentNames: parsed.attachmentNames,
          reportDate: parsed.reportDate,
          plantCodes: parsed.plantCodes,
        });
        upserted++;
      }
    }
  }

  // Orphan extracted files (no Maildir parent on disk) — log by filename prefix
  if (existsSync(extractDir)) {
    for (const name of readdirSync(extractDir)) {
      if (
        !name.toLowerCase().endsWith('.htm') &&
        !name.toLowerCase().endsWith('.html')
      ) {
        continue;
      }
      const mailKeyMatch = name.match(/^(.+?)_[^/\\]+\.(htm|html)$/i);
      const mailKey = mailKeyMatch?.[1] ?? name;
      if (seenKeys.has(mailKey)) continue;
      seenKeys.add(mailKey);
      const stats = statSync(joinPath(extractDir, name));
      const reportDate = getIstLocalDateStr(stats.mtime);
      const attachmentNames = listExtractedAttachmentsForMail(extractDir, mailKey);
      const plantCodes = parsePlantCodesFromAttachments(extractDir, attachmentNames);
      await upsertSapMailLogEntry({
        mailKey,
        subject: `(Extracted file: ${name})`,
        sender: '',
        receivedAt: stats.mtime,
        extractedAt: stats.mtime,
        attachmentNames: attachmentNames.length > 0 ? attachmentNames : [name],
        reportDate,
        plantCodes,
      });
      upserted++;
    }
  }

  const entries = await listSapMailLog({ days: 14 });
  return { upserted, entries };
}

export async function getSapInboxDashboard(days = 14): Promise<{
  inbox: SapMailLogEntry[];
  todayMailCount: number;
  latestReceivedAt: string | null;
}> {
  const inbox = await listSapMailLog({ days });
  const today = getIstLocalDateStr();
  const todayMails = inbox.filter((e) => e.reportDate === today || getIstLocalDateStr(new Date(e.receivedAt)) === today);
  const latestReceivedAt =
    todayMails.length > 0
      ? todayMails.reduce((latest, e) =>
          new Date(e.receivedAt) > new Date(latest) ? e.receivedAt : latest
        , todayMails[0].receivedAt)
      : null;

  return {
    inbox,
    todayMailCount: todayMails.length,
    latestReceivedAt,
  };
}

/** Latest mtime among today's extracted SAP HTML files (ms since epoch). */
export function getLatestTodaySapFileMtimeMs(): number | null {
  const extractDir = resolveSubcontractorExtractDir();
  if (!existsSync(extractDir)) return null;

  const today = getIstLocalDateStr();
  let latest: number | null = null;

  for (const filename of readdirSync(extractDir)) {
    if (
      !filename.toLowerCase().endsWith('.htm') &&
      !filename.toLowerCase().endsWith('.html')
    ) {
      continue;
    }
    const filepath = joinPath(extractDir, filename);
    const match = filename.match(/^(\d+)\./);
    let dateStr: string;
    if (match) {
      dateStr = getIstLocalDateStr(new Date(parseInt(match[1], 10) * 1000));
    } else {
      dateStr = getIstLocalDateStr(statSync(filepath).mtime);
    }
    if (dateStr !== today) continue;
    const mtime = statSync(filepath).mtimeMs;
    if (latest === null || mtime > latest) latest = mtime;
  }

  return latest;
}
