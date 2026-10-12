import { fallbackFilenameRegex, parseComicInfo } from './metadata-parser.util';

describe('metadata-parser', () => {
  it('parseComicInfo extrae campos canónicos', () => {
    const xml = `<ComicInfo><Title>El Eternauta - Tomo 1</Title><Series>El Eternauta</Series><Number>1</Number><Writer>Oesterheld</Writer><Year>1957</Year></ComicInfo>`;
    expect(parseComicInfo(xml)).toEqual({
      title: 'El Eternauta - Tomo 1',
      series: 'El Eternauta',
      issueNumber: 1,
      writer: 'Oesterheld',
      year: 1957,
    });
  });

  it('parseComicInfo sin ComicInfo retorna {}', () => {
    expect(parseComicInfo('<root/>')).toEqual({});
  });

  it('fallback "Serie #N - Título"', () => {
    expect(fallbackFilenameRegex('El Eternauta #1 - El Héroe.cbz')).toEqual({
      series: 'El Eternauta',
      issueNumber: 1,
      title: 'El Héroe',
    });
  });

  it('fallback sin título usa "Serie #N"', () => {
    expect(fallbackFilenameRegex('Saga 12.cbr')).toEqual({
      series: 'Saga',
      issueNumber: 12,
      title: 'Saga #12',
    });
  });

  it('fallback sin número → Sin Clasificar #1', () => {
    expect(fallbackFilenameRegex('random_file.cbz')).toEqual({
      title: 'random_file.cbz',
      series: 'Sin Clasificar',
      issueNumber: 1,
    });
  });

  it('fallback escena con guiones bajos y año', () => {
    expect(fallbackFilenameRegex('Witchblade_172_(2014)_(Digital)_(Darkness-Empire).cbr')).toEqual({
      series: 'Witchblade',
      issueNumber: 172,
      title: 'Witchblade #172',
      year: 2014,
    });
  });

  it('fallback escena con espacios y año', () => {
    expect(fallbackFilenameRegex('Witchblade 001 (1995) (digital-Empire).cbz')).toEqual({
      series: 'Witchblade',
      issueNumber: 1,
      title: 'Witchblade #001',
      year: 1995,
    });
  });

  it('fallback con volumen conserva vN en la serie', () => {
    expect(fallbackFilenameRegex('Green Lantern v2 002 (1960) (Digital).cbr')).toEqual({
      series: 'Green Lantern v2',
      issueNumber: 2,
      title: 'Green Lantern v2 #002',
      year: 1960,
    });
  });

  it('fallback "v2" pegado no se confunde con número', () => {
    expect(fallbackFilenameRegex('Green Lantern v2.cbr')).toEqual({
      title: 'Green Lantern v2.cbr',
      series: 'Sin Clasificar',
      issueNumber: 1,
    });
  });

  it('fallback título con tags entre paréntesis', () => {
    expect(fallbackFilenameRegex('Saga 7 - El Regreso (Digital).cbz')).toEqual({
      series: 'Saga',
      issueNumber: 7,
      title: 'El Regreso',
    });
  });
});
