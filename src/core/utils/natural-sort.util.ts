const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalSortPages(pages: string[]): string[] {
  return [...pages].sort((a, b) => collator.compare(a, b));
}
