export function formatModalNumber(value: number): string {
  if (value === 0) {
    return "0";
  }
  const absValue = Math.abs(value);
  if (absValue < 1e-3 || absValue >= 1e4) {
    return value.toExponential(4);
  }
  return value.toPrecision(6);
}

export function downloadCsv(filename: string, columns: string[], rows: number[][]) {
  const csv = [
    columns.map(formatCsvCell).join(","),
    ...rows.map((row) => row.map(formatCsvCell).join(",")),
  ].join("\n");
  const blob = new Blob([`${csv}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatCsvCell(value: number | string): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
