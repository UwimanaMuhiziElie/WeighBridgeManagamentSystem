import { ReportFilter } from '../types';

export function generateReportTitle(filter: ReportFilter): string {
  const typeLabels = {
    customer: 'Customer Report',
    periodic: 'Periodic Report',
    operator: 'Operator Report',
    vehicle: 'Vehicle Report',
    revenue: 'Revenue Report',
    outstanding_invoices: 'Outstanding Invoices Report',
    branch: 'Branch Report',
    consolidated: 'Consolidated Report',
  };

  return typeLabels[filter.reportType];
}

export function formatDateRange(dateFrom: string, dateTo: string): string {
  const from = new Date(dateFrom).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const to = new Date(dateTo).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return `${from} - ${to}`;
}

export function exportToCSV(data: any[], filename: string): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map((row) =>
      headers.map((header) => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      }).join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function printReport(elementId: string): void {
  const printContent = document.getElementById(elementId);
  if (!printContent) return;

  const printWindow = window.open('', '', 'height=600,width=800');
  if (!printWindow) return;

  printWindow.document.write('<html><head><title>Print Report</title>');
  printWindow.document.write('<style>');
  printWindow.document.write(`
    body { font-family: Arial, sans-serif; padding: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f3f4f6; font-weight: bold; }
    .report-header { margin-bottom: 20px; }
    .report-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .report-summary { background-color: #f9fafb; padding: 15px; margin: 20px 0; }
    @media print {
      button { display: none; }
    }
  `);
  printWindow.document.write('</style></head><body>');
  printWindow.document.write(printContent.innerHTML);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
}

export function generatePDF(elementId: string, filename: string): void {
  printReport(elementId);
}
