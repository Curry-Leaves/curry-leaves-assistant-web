/** Auth (numeric PIN lock). */
import { j } from './http';

export const authApi = {
  authStatus: () => j<{ configured: boolean; identityName: string }>('/auth/status'),
  login: (pin: string) => j<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => j<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  authVerify: () => j<{ ok: boolean }>('/auth/verify'),
};
