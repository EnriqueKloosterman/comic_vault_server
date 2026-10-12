import { naturalSortPages } from './natural-sort.util';

describe('naturalSortPages', () => {
  it('ordena secuencias sin relleno en orden humano', () => {
    expect(naturalSortPages(['p10.jpg', 'p2.jpg', 'p1.jpg'])).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
  });

  it('no muta el array original', () => {
    const input = ['b.jpg', 'a.jpg'];
    naturalSortPages(input);
    expect(input).toEqual(['b.jpg', 'a.jpg']);
  });

  it('respeta subdirectorios y extensiones mixtas', () => {
    expect(naturalSortPages(['ch/10.png', 'ch/2.png', 'ch/1.png'])).toEqual([
      'ch/1.png',
      'ch/2.png',
      'ch/10.png',
    ]);
  });
});
