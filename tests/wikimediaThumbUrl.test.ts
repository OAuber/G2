import { describe, expect, it } from 'vitest';
import { snapWikimediaThumbRequestWidth, wikimediaUploadThumbUrl } from '../utils/wikimediaThumbUrl';

describe('snapWikimediaThumbRequestWidth', () => {
  it('maps to largest bucket <= desired', () => {
    expect(snapWikimediaThumbRequestWidth(900)).toBe(500);
    expect(snapWikimediaThumbRequestWidth(384)).toBe(330);
    expect(snapWikimediaThumbRequestWidth(330)).toBe(330);
    expect(snapWikimediaThumbRequestWidth(220)).toBe(120);
    expect(snapWikimediaThumbRequestWidth(100)).toBe(60);
    expect(snapWikimediaThumbRequestWidth(1)).toBe(40);
  });
});

describe('wikimediaUploadThumbUrl', () => {
  it('rewrites commons raster URL using a supported thumb width', () => {
    const raw =
      'https://upload.wikimedia.org/wikipedia/commons/6/69/Margarite-181325.jpg';
    expect(wikimediaUploadThumbUrl(raw, 220)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Margarite-181325.jpg/120px-Margarite-181325.jpg',
    );
  });

  it('supports wikipedia project prefix (en)', () => {
    const raw = 'https://upload.wikimedia.org/wikipedia/en/3/3a/Example.png';
    expect(wikimediaUploadThumbUrl(raw, 400)).toBe(
      'https://upload.wikimedia.org/wikipedia/en/thumb/3/3a/Example.png/330px-Example.png',
    );
  });

  it('preserves query and hash', () => {
    const raw =
      'https://upload.wikimedia.org/wikipedia/commons/1/1e/Foo.jpeg?use=1#frag';
    const out = wikimediaUploadThumbUrl(raw, 100);
    expect(out).toContain('?use=1#frag');
    expect(out).toContain('/thumb/');
    expect(out).toContain('60px-Foo.jpeg');
  });

  it('idempotent for already-thumb URLs', () => {
    const thumb =
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Elizabeth_II_in_March_2015.jpg/220px-Elizabeth_II_in_March_2015.jpg';
    expect(wikimediaUploadThumbUrl(thumb, 500)).toBe(thumb);
  });

  it('leaves non-upload hosts unchanged', () => {
    expect(wikimediaUploadThumbUrl('https://example.com/a.jpg', 220)).toBe('https://example.com/a.jpg');
  });

  it('leaves SVG unchanged (thumb suffix non standard)', () => {
    const svg = 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Flag_of_France.svg';
    expect(wikimediaUploadThumbUrl(svg, 220)).toBe(svg);
  });

  it('returns original on invalid URL', () => {
    expect(wikimediaUploadThumbUrl('not-a-url', 220)).toBe('not-a-url');
  });
});
