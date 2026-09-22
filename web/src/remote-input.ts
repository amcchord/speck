/** Convert operator text to X11 keysyms used by Guacamole (including SSH). */
export function remoteTextKeys(text: string): number[] {
  return Array.from(text.replace(/\r\n?/g, "\n")).slice(0, 8192).map(character => {
    if (character === "\n") return 0xff0d;
    if (character === "\t") return 0xff09;
    const point = character.codePointAt(0)!;
    return point <= 255 ? point : 0x01000000 | point;
  });
}
