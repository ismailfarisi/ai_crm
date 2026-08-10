export function formatCSVRow(keys: string[], row: Record<string, any>): string {
  return keys
    .map((key) => {
      const val = row[key] ?? '';
      const stringVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const escaped = stringVal.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(',');
}

export function exportToJSONData<T>(data: T[]): string {
  return JSON.stringify(data, null, 2);
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV<T extends Record<string, any>>(data: T[], filename = 'export.csv') {
  if (!data || data.length === 0) return;
  const keys = Object.keys(data[0]);
  const headerRow = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(',');
  const dataRows = data.map((row) => formatCSVRow(keys, row));
  const csvContent = [headerRow, ...dataRows].join('\n');
  downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
}

export function exportToJSON<T>(data: T[], filename = 'export.json') {
  const jsonContent = exportToJSONData(data);
  downloadFile(jsonContent, filename, 'application/json');
}
