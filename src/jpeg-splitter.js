// Separa um fluxo contínuo de JPEGs concatenados (saída `-f image2pipe` do FFmpeg)
// em quadros individuais. Cada quadro vai de FFD8 (SOI) até FFD9 (EOI); dentro dos
// dados JPEG todo 0xFF é seguido de 0x00 ou de um marcador RSTn, então FFD9 só
// aparece no fim do quadro.
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export function createJpegSplitter(onFrame) {
  let buf = Buffer.alloc(0);

  return function push(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const start = buf.indexOf(SOI);
      if (start < 0) {
        buf = buf.subarray(Math.max(0, buf.length - 1)); // guarda um possível 0xFF final
        return;
      }
      if (start > 0) buf = buf.subarray(start);
      const end = buf.indexOf(EOI, 2);
      if (end < 0) {
        if (buf.length > MAX_FRAME_BYTES) buf = Buffer.alloc(0); // lixo: descarta e ressincroniza
        return;
      }
      onFrame(buf.subarray(0, end + 2));
      buf = buf.subarray(end + 2);
    }
  };
}
