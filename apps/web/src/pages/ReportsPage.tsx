import { FileText } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-8 h-8 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">API Implementation Pending</h2>
        <p className="text-blue-800">
          This page has been migrated to the new PostgreSQL + Express backend.
          The reports API endpoints need to be implemented.
        </p>
        <p className="text-blue-700 mt-2 text-sm">
          Required endpoints: GET /api/reports, POST /api/reports/generate
        </p>
      </div>
    </div>
  );
}
