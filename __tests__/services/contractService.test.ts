import { createHash } from 'crypto';
import type { Contract } from '../../src/services/contractService';

jest.mock('../../src/config/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../../src/config/apiSession', () => ({ getApiAccessToken: jest.fn() }));
jest.mock('../../src/services/backendGateway', () => ({ backendDb: { from: jest.fn() } }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: jest.fn(async (_algorithm: string, content: string) =>
    require('crypto').createHash('sha256').update(content, 'utf8').digest('hex')),
}));

const hash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const makeContract = (overrides: Partial<Contract> & Record<string, unknown> = {}): Contract & Record<string, unknown> => {
  const content = overrides.content ?? 'Exact booking agreement\nWith a second line.\n';
  return {
    id: 'contract-1', booking_id: 'booking-1', creator_id: 'photographer-1', photographer_id: 'photographer-1',
    client_id: 'client-1', model_id: null, contract_type: 'shoot_agreement', status: 'draft',
    content, content_hash: hash(content), content_version: 1,
    signature_method: 'authenticated_typed_acknowledgement', legal_approval_status: 'not_reviewed',
    creator_signature: null, client_signature: null, model_signature: null, signed_at: null,
    created_at: '2026-10-04T10:00:00+00:00', ...overrides,
  };
};

describe('Authenticated booking contract service', () => {
  let service: typeof import('../../src/services/contractService');
  let api: { get: jest.Mock; post: jest.Mock };
  let getToken: jest.Mock;
  let digest: jest.Mock;
  let from: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    service = require('../../src/services/contractService');
    api = require('../../src/config/apiClient').apiClient;
    getToken = require('../../src/config/apiSession').getApiAccessToken;
    digest = require('expo-crypto').digestStringAsync;
    from = require('../../src/services/backendGateway').backendDb.from;
    getToken.mockResolvedValue('access-token');
  });

  afterEach(() => {
    expect(from).not.toHaveBeenCalled();
  });

  const loadReviewed = async (contract = makeContract()) => {
    api.get.mockResolvedValue([contract]);
    return (await service.fetchBookingContracts(contract.booking_id))[0];
  };

  it('fetches only the authenticated booking route and verifies exact UTF-8 content', async () => {
    const contract = makeContract({ booking_id: 'booking /?1', content: 'Agreement: caf\u00e9\r\nUnchanged whitespace.  \n' });
    api.get.mockResolvedValue([contract]);
    await expect(service.fetchBookingContracts(contract.booking_id)).resolves.toEqual([contract]);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/bookings/booking%20%2F%3F1/contracts', { token: 'access-token' });
    expect(digest).toHaveBeenCalledWith('SHA-256', contract.content, { encoding: 'hex' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preserves real signatures and server dates without inventing a photographer for a model', async () => {
    const contract = makeContract({
      creator_id: 'model-1', photographer_id: null, model_id: 'model-1', status: 'signed',
      creator_signature: 'Model Name', model_signature: 'Model Name', client_signature: 'Client Name',
      signed_at: '2026-10-04T11:00:00+00:00',
    });
    expect(await loadReviewed(contract)).toEqual(contract);
  });

  it('ignores legacy signed flags, aliases and per-party dates rather than fabricating signature evidence', async () => {
    const contract = makeContract({
      signed_by_client: true, signed_by_photographer: true, signed_by_model: true,
      client_signed_at: '2026-10-04T11:00:00Z', body: 'Legacy body', title: 'Model Release',
    });
    const result = await loadReviewed(contract);
    expect(result).toMatchObject({
      status: 'draft', contract_type: 'shoot_agreement', creator_signature: null,
      client_signature: null, model_signature: null, signed_at: null,
    });
    expect(result).not.toHaveProperty('signed_by_client');
    expect(result).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toContain('Signed in app');
  });

  it.each([
    { content_hash: undefined }, { content_hash: '0'.repeat(64) }, { content_version: undefined },
    { content_version: 0 }, { content_version: 1.5 }, { content_version: '1' },
    { signature_method: undefined }, { legal_approval_status: 'approved' },
    { booking_id: 'someone-elses-booking' }, { creator_id: 'someone-else' },
    { model_id: 'client-1' }, { contract_type: 'legacy_title' }, { created_at: 'invalid' },
    { status: 'signed', signed_by_client: true, signed_by_photographer: true },
  ])('rejects malformed/unmanaged or forged response fields: %j', async overrides => {
    api.get.mockResolvedValue([{ ...makeContract(), ...overrides }]);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toThrow();
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('review');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    { data: null }, { data: {} }, { data: { data: [] } }, { data: [makeContract(), makeContract()] },
  ])('rejects malformed contract collections: %j', async ({ data }) => {
    api.get.mockResolvedValue(data);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toThrow();
  });

  it('returns an actual empty collection without falling back to generic tables', async () => {
    api.get.mockResolvedValue([]);
    await expect(service.fetchBookingContracts('booking-1')).resolves.toEqual([]);
  });

  it.each([null, '', '   '])('requires a session before fetch or creation: %j', async token => {
    getToken.mockResolvedValue(token);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toThrow('Sign in');
    await expect(service.createContract('booking-1', 'shoot_agreement', 'Agreement')).rejects.toThrow('Sign in');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('propagates session refresh and read failures', async () => {
    const refreshError = new Error('Refresh unavailable');
    getToken.mockRejectedValueOnce(refreshError);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toBe(refreshError);
    expect(api.get).not.toHaveBeenCalled();
    const readError = Object.assign(new Error('Not a participant'), { status: 403 });
    api.get.mockRejectedValue(readError);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toBe(readError);
    await expect(service.ensureBookingContracts('booking-1')).rejects.toBe(readError);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates through the domain route with only type and exact content, leaving all parties to the server', async () => {
    const contract = makeContract({ booking_id: 'booking /1', content: '  Exact content\n' });
    api.post.mockResolvedValue(contract);
    await expect(service.createContract(contract.booking_id, 'shoot_agreement', contract.content)).resolves.toEqual(contract);
    expect(api.post).toHaveBeenCalledWith('/bookings/booking%20%2F1/contracts', {
      contract_type: 'shoot_agreement', content: '  Exact content\n',
    }, { token: 'access-token' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported', 'Agreement'], ['shoot_agreement', '   '],
    ['shoot_agreement', 'Contains\0null'], ['shoot_agreement', 'a'.repeat(50001)],
  ])('rejects invalid creation input without persistence (%s)', async (type, content) => {
    await expect(service.createContract('booking-1', type as Contract['contract_type'], content)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    null, makeContract({ booking_id: 'other-booking' }), makeContract({ contract_type: 'model_release' }),
    makeContract({ content: 'Other server document' }), makeContract({ content_hash: '0'.repeat(64) }),
  ])('rejects a successful HTTP creation response that does not confirm the exact requested document: %j', async data => {
    api.post.mockResolvedValue(data);
    await expect(service.createContract('booking-1', 'shoot_agreement', makeContract().content)).rejects.toThrow();
  });

  it('propagates creation permission/expiry errors without returning a success-shaped value', async () => {
    const error = Object.assign(new Error('Booking no longer open'), { status: 409 });
    api.post.mockRejectedValue(error);
    await expect(service.createContract('booking-1', 'shoot_agreement', 'Agreement')).rejects.toBe(error);
  });

  it('does not recreate existing documents', async () => {
    const contracts = [makeContract(), makeContract({ id: 'model-doc', contract_type: 'model_release' })];
    api.get.mockResolvedValue(contracts);
    await expect(service.ensureBookingContracts('booking-1')).resolves.toEqual(contracts);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates only the missing template and leaves the model release unchanged', async () => {
    const existing = makeContract();
    api.get.mockResolvedValue([existing]);
    api.post.mockImplementation(async (_path, body) => makeContract({ id: 'model-doc', ...body }));
    const contracts = await service.ensureBookingContracts('booking-1');
    expect(contracts).toHaveLength(2);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/bookings/booking-1/contracts', {
      contract_type: 'model_release', content: require('../../src/constants/LegalContent').LEGAL_CONTENT.MODEL_RELEASE,
    }, { token: 'access-token' });
  });

  it('removes the unsupported escrow assertion only from the shoot template', async () => {
    api.get.mockResolvedValue([makeContract({ contract_type: 'model_release' })]);
    api.post.mockImplementation(async (_path, body) => makeContract({ id: 'shoot-doc', ...body }));
    await service.ensureBookingContracts('booking-1');
    const content = api.post.mock.calls[0][1].content as string;
    expect(content).toContain('## Payment\n');
    expect(content).toContain("Payment is processed through the booking's payment flow.");
    expect(content).not.toMatch(/escrow|held\/settled/i);
    expect(content).toContain('Off-platform payment circumvention is prohibited.');
    expect(content).toContain('Republic of South Africa.');
  });

  it.each([1, 2])('propagates template creation failure at document %i instead of returning partial success', async failedDocument => {
    api.get.mockResolvedValue([]);
    const error = Object.assign(new Error('Creation forbidden'), { status: 403 });
    api.post.mockImplementation(async (_path, body) => {
      if (api.post.mock.calls.length === failedDocument) throw error;
      return makeContract({ id: 'created-model-doc', ...body });
    });
    await expect(service.ensureBookingContracts('booking-1')).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(failedDocument);
  });

  it.each(['client', 'creator', 'model'] as const)('signs as %s with the refreshed token and the reviewed hash/version only', async role => {
    const contract = makeContract({ id: 'contract /1', model_id: 'model-1', content_version: 2 });
    await loadReviewed(contract);
    getToken.mockResolvedValue('refreshed-token');
    api.post.mockResolvedValue({ ...contract, [`${role}_signature`]: 'Party Name' });
    await expect(service.signContract(contract.id, '  Party Name  ', role)).resolves.toBeUndefined();
    expect(api.get).toHaveBeenLastCalledWith('/bookings/booking-1/contracts', { token: 'refreshed-token' });
    expect(api.post).toHaveBeenCalledWith('/contracts/contract%20%2F1/sign', {
      signature: 'Party Name', role, content_hash: contract.content_hash, content_version: 2,
    }, { token: 'refreshed-token' });
    const payload = api.post.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['content_hash', 'content_version', 'role', 'signature']);
  });

  it('requires a reviewed document and never fetches arbitrary contract IDs or signs blindly', async () => {
    await expect(service.signContract('never-reviewed', 'Client Name', 'client')).rejects.toThrow('review');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('clears review bindings when signed out and requires a fresh authenticated review', async () => {
    await loadReviewed();
    getToken.mockResolvedValue(null);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('Sign in');
    getToken.mockResolvedValue('new-session-token');
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('review');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['outsider', 'admin', 'photographer-1'])('rejects arbitrary signer roles: %s', async role => {
    await loadReviewed();
    await expect(service.signContract('contract-1', 'Client Name', role as 'client')).rejects.toThrow('signer role');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([' ', 'A', 'Client\nName', 'Client\u0000Name', 'Client\u007fName', 'a'.repeat(201)])(
    'rejects invalid typed acknowledgements without a write: %j', async signature => {
      await loadReviewed();
      await expect(service.signContract('contract-1', signature, 'client')).rejects.toThrow('acknowledgement');
      expect(api.post).not.toHaveBeenCalled();
    },
  );

  it('keeps the original review binding even if caller-owned fields are mutated', async () => {
    const original = makeContract();
    const visible = await loadReviewed(original);
    visible.content = 'Forged replacement';
    visible.content_hash = hash(visible.content);
    visible.content_version = 99;
    visible.client_id = 'forged-signer';
    api.post.mockResolvedValue({ ...original, client_signature: 'Client Name' });
    await service.signContract(original.id, 'Client Name', 'client');
    expect(api.post.mock.calls[0][1]).toEqual({
      signature: 'Client Name', role: 'client', content_hash: original.content_hash, content_version: 1,
    });
  });

  it.each([
    { current: [] }, { current: [makeContract({ content: 'Changed immutable document' })] },
    { current: [makeContract({ content_version: 2 })] }, { current: [makeContract({ client_id: 'different-client' })] },
  ])('does not silently rebind to changed or missing documents before signing: %j', async ({ current }) => {
    await loadReviewed();
    api.get.mockResolvedValue(current);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('review');
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('review');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects a tampered hash on the authenticated pre-sign read', async () => {
    await loadReviewed();
    api.get.mockResolvedValue([makeContract({ content_hash: '0'.repeat(64) })]);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow('hash');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('propagates pre-sign participant denial without posting any acknowledgement', async () => {
    await loadReviewed();
    const error = Object.assign(new Error('Not a booking participant'), { status: 403 });
    api.get.mockRejectedValue(error);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toBe(error);
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([403, 409, 503])('propagates server signing rejection (status %i), including role/hash races', async status => {
    await loadReviewed();
    const error = Object.assign(new Error('Acknowledgement rejected'), { status });
    api.post.mockRejectedValue(error);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toBe(error);
  });

  it.each([
    null, makeContract({ signed_by_client: true }), makeContract({ client_signature: 'Different Name' }),
    makeContract({ id: 'different-contract', client_signature: 'Client Name' }),
    makeContract({ content: 'Different document', client_signature: 'Client Name' }),
    makeContract({ content_version: 2, client_signature: 'Client Name' }),
    makeContract({ client_id: 'different-client', client_signature: 'Client Name' }),
    makeContract({ content_hash: '0'.repeat(64), client_signature: 'Client Name' }),
  ])('does not report a successful signature for an unconfirmed/forged HTTP response: %j', async data => {
    await loadReviewed();
    api.post.mockResolvedValue(data);
    await expect(service.signContract('contract-1', 'Client Name', 'client')).rejects.toThrow();
  });

  it('accepts an exact idempotent retry with authoritative completed signatures', async () => {
    const contract = makeContract({
      creator_signature: 'Creator Name', client_signature: 'Client Name',
      status: 'signed', signed_at: '2026-10-04T11:00:00Z',
    });
    await loadReviewed(contract);
    api.post.mockResolvedValue(contract);
    await expect(service.signContract(contract.id, 'Client Name', 'client')).resolves.toBeUndefined();
    await expect(service.signContract(contract.id, 'Client Name', 'client')).resolves.toBeUndefined();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
  });

  it('propagates cryptographic verification failures without offering a signing fallback', async () => {
    const error = new Error('Secure hashing unavailable');
    digest.mockRejectedValue(error);
    api.get.mockResolvedValue([makeContract()]);
    await expect(service.fetchBookingContracts('booking-1')).rejects.toBe(error);
    expect(api.post).not.toHaveBeenCalled();
  });
});
