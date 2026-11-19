import qrcode from 'qrcode-generator';

export type QrCells = { n: number; cells: [number, number][] };

/** The dark squares of a QR code for a value. Shared by the on-screen code and the receipt picture. */
export function qrCells(value: string): QrCells {
  const q = qrcode(0, 'M');
  q.addData(value);
  q.make();
  const n = q.getModuleCount();
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) cells.push([x, y]);
  return { n, cells };
}
