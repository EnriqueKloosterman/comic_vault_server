import { XMLParser } from 'fast-xml-parser';
import { ParsedComicMetadata } from '../../../core/interfaces/archive-extractor.interface';

const parser = new XMLParser({ ignoreAttributes: false });

export function parseComicInfo(xmlContent: string): ParsedComicMetadata {
  const parsed = parser.parse(xmlContent)?.ComicInfo;
  if (!parsed) return {};

  return {
    title: parsed.Title ?? undefined,
    series: parsed.Series ?? undefined,
    issueNumber: parsed.Number ? Number(parsed.Number) : undefined,
    writer: parsed.Writer ?? undefined,
    year: parsed.Year ? Number(parsed.Year) : undefined,
  };
}

/**
 * Fallback para archivos sin ComicInfo.xml. Entiende naming de escena:
 * `Witchblade_172_(2014)_(Digital)_(Darkness-Empire).cbr`,
 * `Witchblade 001 (1995) (digital-Empire).cbz`, `Serie v2 002 (1960).cbr`,
 * además del clásico `Serie #N - Título`.
 * - El año entre paréntesis va a `year` (luego `publicationYear`).
 * - El resto de grupos `(…)`, `[…]`, `{…}` son tags y se descartan.
 * - El número debe ir separado (` `, `#`, no pegado a letra: `v2` no es issue).
 */
export function fallbackFilenameRegex(filename: string): ParsedComicMetadata {
  const base = filename.replace(/\.(cbz|cbr)$/i, '');
  const yearMatch = base.match(/\((19|20)\d{2}\)/);
  const year = yearMatch ? Number(yearMatch[0].slice(1, 5)) : undefined;

  const clean = base
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s\-_]+$/, '');

  const withYear = year !== undefined ? { year } : {};
  const match = clean.match(/^(.*?)[\s#]+(\d+)(?:\s*-\s*(.*))?$/);
  if (!match) return { title: filename, series: 'Sin Clasificar', issueNumber: 1, ...withYear };

  const series = match[1]?.trim() || 'Sin Clasificar';
  return {
    series,
    issueNumber: parseInt(match[2], 10) || 1,
    title: match[3]?.trim() || `${series} #${match[2]}`,
    ...withYear,
  };
}
