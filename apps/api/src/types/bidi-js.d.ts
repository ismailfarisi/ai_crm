declare module 'bidi-js' {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  interface Bidi {
    getEmbeddingLevels(
      text: string,
      explicitDirection?: 'ltr' | 'rtl',
    ): EmbeddingLevels;
    getMirroredCharacter(char: string): string | null;
  }
  export default function bidiFactory(): Bidi;
}
