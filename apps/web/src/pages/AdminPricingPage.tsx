import { useState, useEffect } from 'react';
import { PricingTier, Branch, Client, ClientPricing } from '@weighbridge/shared';
import { DollarSign, Plus, Edit2, Search, TrendingUp } from 'lucide-react';

export default function AdminPricingPage() {
  const [view, setView] = useState<'standard' | 'client'>('standard');

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Pricing Management</h1>
          <p className="text-gray-600 mt-1">Manage standard and client-specific pricing</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setView('standard')}
            className={`flex-1 py-3 px-4 text-sm font-medium ${
              view === 'standard'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Standard Pricing
          </button>
          <button
            onClick={() => setView('client')}
            className={`flex-1 py-3 px-4 text-sm font-medium ${
              view === 'client'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Client-Specific Pricing
          </button>
        </div>
      </div>

      {view === 'standard' ? <StandardPricingView /> : <ClientPricingView />}
    </div>
  );
}

function StandardPricingView() {
  const [pricingTiers, setPricingTiers] = useState<(PricingTier & { branch: Branch })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTier, setEditingTier] = useState<PricingTier | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setPricingTiers([]);
      setBranches([]);
    } catch (error) {
      console.error('Error loading pricing tiers:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredTiers = pricingTiers.filter(
    (tier) =>
      tier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tier.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div className="text-center text-gray-600">Loading...</div>;
  }

  return (
    <>
      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search pricing tiers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => {
            setEditingTier(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Tier
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTiers.map((tier) => (
          <div key={tier.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex gap-2">
                {tier.is_default && (
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                    Default
                  </span>
                )}
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    tier.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {tier.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-1">{tier.name}</h3>
            <p className="text-sm text-gray-600 mb-4">{tier.description}</p>

            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Per Weighing:</span>
                <span className="font-semibold text-gray-900">${tier.price_per_weighing}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Per KG:</span>
                <span className="font-semibold text-gray-900">${tier.price_per_kg}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Minimum:</span>
                <span className="font-semibold text-gray-900">${tier.minimum_charge}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Branch:</span>
                <span className="text-gray-900">{tier.branch.name}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <button
                onClick={() => {
                  setEditingTier(tier);
                  setShowModal(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <PricingTierModal
          tier={editingTier}
          branches={branches}
          onClose={() => {
            setShowModal(false);
            setEditingTier(null);
          }}
          onSaved={loadData}
        />
      )}
    </>
  );
}

function ClientPricingView() {
  const [clientPricing, setClientPricing] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadClientPricing();
  }, []);

  async function loadClientPricing() {
    try {
      setClientPricing([]);
    } catch (error) {
      console.error('Error loading client pricing:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredPricing = clientPricing.filter(
    (cp) =>
      cp.client?.company_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div className="text-center text-gray-600">Loading...</div>;
  }

  return (
    <>
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search client pricing..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Client
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Per Weighing
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Per KG
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Minimum
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Discount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Effective From
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredPricing.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No client-specific pricing found
                </td>
              </tr>
            ) : (
              filteredPricing.map((cp) => (
                <tr key={cp.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{cp.client?.company_name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    ${cp.price_per_weighing || cp.pricing_tier?.price_per_weighing || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    ${cp.price_per_kg || cp.pricing_tier?.price_per_kg || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    ${cp.minimum_charge || cp.pricing_tier?.minimum_charge || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {cp.discount_percentage}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {new Date(cp.effective_from).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PricingTierModal({
  tier,
  branches,
  onClose,
  onSaved,
}: {
  tier: PricingTier | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formData, setFormData] = useState({
    name: tier?.name || '',
    description: tier?.description || '',
    branch_id: tier?.branch_id || '',
    price_per_weighing: tier?.price_per_weighing || 0,
    price_per_kg: tier?.price_per_kg || 0,
    minimum_charge: tier?.minimum_charge || 0,
    is_default: tier?.is_default || false,
    is_active: tier?.is_active ?? true,
    effective_from: tier?.effective_from || new Date().toISOString().split('T')[0],
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      console.log('Save pricing tier - API implementation pending');
      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving pricing tier:', error);
      alert('Failed to save pricing tier');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {tier ? 'Edit Pricing Tier' : 'Add Pricing Tier'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Branch *
            </label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Select Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Per Weighing ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price_per_weighing}
                onChange={(e) => setFormData({ ...formData, price_per_weighing: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Per KG ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price_per_kg}
                onChange={(e) => setFormData({ ...formData, price_per_kg: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minimum Charge ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.minimum_charge}
              onChange={(e) => setFormData({ ...formData, minimum_charge: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Effective From
            </label>
            <input
              type="date"
              value={formData.effective_from}
              onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="is_default" className="text-sm text-gray-700">
                Default Tier
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tier_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="tier_active" className="text-sm text-gray-700">
                Active
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
