import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

export const paystack = {
  initialize: (data: { amount: number; email: string; reference?: string; callback_url?: string; channels?: Array<'card'|'bank'|'ussd'|'qr'|'mobile_money'|'bank_transfer'>; metadata?: Record<string, unknown> }) =>
    client.post('/transaction/initialize', data).then(r => r.data),
  verify: (reference: string) => client.get(`/transaction/verify/${reference}`).then(r => r.data),
  chargeAuthorization: (data: { authorization_code: string; email: string; amount: number; reference?: string; metadata?: Record<string, unknown> }) =>
    client.post('/transaction/charge_authorization', data).then(r => r.data),
  createPlan: (data: { name: string; amount: number; interval: 'weekly'|'monthly'|'quarterly'|'biannually'|'annually' }) =>
    client.post('/plan', data).then(r => r.data),
  subscribe: (data: { customer: string; plan: string; authorization?: string }) =>
    client.post('/subscription', data).then(r => r.data),
  // Transfers (withdrawals)
  listBanks: (country = 'NG') => client.get(`/bank?country=${country}`).then(r => r.data),
  resolveAccount: (account_number: string, bank_code: string) =>
    client.get(`/bank/resolve`, { params: { account_number, bank_code } }).then(r => r.data),
  createRecipient: (data: { type: 'nuban'; name: string; account_number: string; bank_code: string; currency?: 'NGN' }) =>
    client.post(`/transferrecipient`, data).then(r => r.data),
  initiateTransfer: (data: { source: 'balance'; amount: number; recipient: string; reason?: string; reference?: string; currency?: 'NGN' }) =>
    client.post(`/transfer`, data).then(r => r.data),
  finalizeTransfer: (data: { transfer_code: string; otp: string }) =>
    client.post(`/transfer/finalize_transfer`, data).then(r => r.data),
};


