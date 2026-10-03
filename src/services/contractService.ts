import * as Crypto from 'expo-crypto';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { LEGAL_CONTENT } from '../constants/LegalContent';

export interface Contract {
  id: string;
  booking_id: string;
  creator_id: string;
  photographer_id?: string | null;
  client_id: string;
  model_id?: string | null;
  status: 'draft' | 'signed' | 'expired';
  contract_type: 'model_release' | 'shoot_agreement';
  content: string;
  content_hash: string;
  content_version: number;
  signature_method: 'authenticated_typed_acknowledgement';
  legal_approval_status: 'not_reviewed';
  creator_signature?: string | null;
  client_signature?: string | null;
  model_signature?: string | null;
  signed_at?: string | null;
  created_at: string;
}

type ContractType = Contract['contract_type'];
type SignerRole = 'creator' | 'client' | 'model';

// Keep a separate review snapshot: callers must not be able to mutate the signed hash.
const reviewedContracts = new Map<string, Readonly<Contract>>();
const MAX_REVIEWED_CONTRACTS = 100;
const DOCUMENT_FIELDS = [
  'id', 'booking_id', 'contract_type', 'content', 'content_hash', 'content_version',
  'creator_id', 'photographer_id', 'client_id', 'model_id', 'created_at',
] as const;

const requireId = (value: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A contract or booking ID is required.');
  return encodeURIComponent(value);
};

const requireToken = async () => {
  const token = await getApiAccessToken();
  if (typeof token !== 'string' || !token.trim()) {
    reviewedContracts.clear();
    throw new Error('Sign in to access booking contracts.');
  }
  return token;
};

const invalidResponse = () => new Error('The server returned an invalid authenticated contract.');

const optionalText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse();
  return value;
};

const normalizeContract = async (value: unknown, bookingId: string): Promise<Contract> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  const row = value as Record<string, unknown>;
  const { id, booking_id, creator_id, client_id, contract_type, content, content_hash,
    content_version, status, created_at } = row;
  if (
    typeof id !== 'string' || !id.trim() || booking_id !== bookingId ||
    typeof creator_id !== 'string' || !creator_id.trim() ||
    typeof client_id !== 'string' || !client_id.trim() || creator_id === client_id ||
    (contract_type !== 'model_release' && contract_type !== 'shoot_agreement') ||
    typeof content !== 'string' || !content.trim() || content.includes('\0') ||
    typeof content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(content_hash) ||
    typeof content_version !== 'number' || !Number.isSafeInteger(content_version) || content_version < 1 ||
    (status !== 'draft' && status !== 'signed' && status !== 'expired') ||
    typeof created_at !== 'string' || !Number.isFinite(Date.parse(created_at)) ||
    row.signature_method !== 'authenticated_typed_acknowledgement' || row.legal_approval_status !== 'not_reviewed'
  ) throw invalidResponse();

  const photographerId = optionalText(row.photographer_id);
  const modelId = optionalText(row.model_id);
  if (creator_id !== (photographerId ?? modelId) || client_id === photographerId || client_id === modelId) {
    throw invalidResponse();
  }
  const creatorSignature = optionalText(row.creator_signature);
  const clientSignature = optionalText(row.client_signature);
  const modelSignature = optionalText(row.model_signature);
  const signedAt = optionalText(row.signed_at);
  if (signedAt && !Number.isFinite(Date.parse(signedAt))) throw invalidResponse();
  if (status === 'signed' && (!creatorSignature || !clientSignature || (modelId && !modelSignature) || !signedAt)) {
    throw invalidResponse();
  }
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  if (digest !== content_hash) throw new Error('The contract content does not match its immutable hash.');

  // Legacy flags, aliases and per-party dates are not signature evidence.
  return {
    id, booking_id: bookingId, creator_id, photographer_id: photographerId, client_id, model_id: modelId,
    contract_type, content, content_hash, content_version, status, created_at,
    signature_method: 'authenticated_typed_acknowledgement', legal_approval_status: 'not_reviewed',
    creator_signature: creatorSignature, client_signature: clientSignature, model_signature: modelSignature,
    signed_at: signedAt,
  };
};

const rememberContract = (contract: Contract) => {
  reviewedContracts.delete(contract.id);
  reviewedContracts.set(contract.id, Object.freeze({ ...contract }));
  if (reviewedContracts.size > MAX_REVIEWED_CONTRACTS) {
    const oldest = reviewedContracts.keys().next().value;
    if (oldest !== undefined) reviewedContracts.delete(oldest);
  }
};

const readBookingContracts = async (bookingId: string, token: string): Promise<Contract[]> => {
  const data = await apiClient.get<unknown>(`/bookings/${requireId(bookingId)}/contracts`, { token });
  if (!Array.isArray(data)) throw invalidResponse();
  const contracts = await Promise.all(data.map(row => normalizeContract(row, bookingId)));
  if (new Set(contracts.map(contract => contract.id)).size !== contracts.length) throw invalidResponse();
  return contracts;
};

const sameDocument = (expected: Readonly<Contract>, actual: Contract) =>
  DOCUMENT_FIELDS.every(field => expected[field] === actual[field]);

const CONTRACT_TEMPLATES: Record<ContractType, string> = {
  model_release: LEGAL_CONTENT.MODEL_RELEASE,
  shoot_agreement: `# Papzii Shoot Agreement
**Last Updated: March 2026 - South African Law**

This agreement governs a booked shoot between Client, Photographer, and where applicable Model.

## Scope
- Session details are defined by booking package, schedule, and in-app notes.
- Parties must arrive on time and act professionally.

## Payment
- Payment is processed through the booking's payment flow.
- Off-platform payment circumvention is prohibited.

## Cancellation and No-show
- Cancellation windows and penalties follow Papzii Terms.
- No-shows may trigger penalties and platform enforcement.

## Conduct and Safety
- Harassment, coercion, or illegal conduct is prohibited.
- Parties must use in-app reporting for disputes or safety concerns.

## Usage and Rights
- Creative usage rights are governed by the model release and booking terms.
- Additional commercial usage requires explicit consent where applicable.

## Governing Law
Republic of South Africa.
`,
};

export const fetchBookingContracts = async (bookingId: string): Promise<Contract[]> => {
  requireId(bookingId);
  const contracts = await readBookingContracts(bookingId, await requireToken());
  for (const [id, contract] of reviewedContracts) {
    if (contract.booking_id === bookingId) reviewedContracts.delete(id);
  }
  contracts.forEach(rememberContract);
  return contracts;
};

export const createContract = async (bookingId: string, type: ContractType, content: string): Promise<Contract> => {
  const pathId = requireId(bookingId);
  if (type !== 'model_release' && type !== 'shoot_agreement') throw new Error('Unsupported contract type.');
  if (typeof content !== 'string' || !content.trim() || content.length > 50000 || content.includes('\0')) {
    throw new Error('Provide nonblank contract content of at most 50000 characters.');
  }
  const token = await requireToken();
  const data = await apiClient.post<unknown>(`/bookings/${pathId}/contracts`, {
    contract_type: type, content,
  }, { token });
  const contract = await normalizeContract(data, bookingId);
  if (contract.contract_type !== type || contract.content !== content) throw invalidResponse();
  rememberContract(contract);
  return contract;
};

export const ensureBookingContracts = async (bookingId: string): Promise<Contract[]> => {
  const existing = await fetchBookingContracts(bookingId);
  const have = new Set(existing.map(contract => contract.contract_type));

  const missing: ContractType[] = [];
  if (!have.has('model_release')) missing.push('model_release');
  if (!have.has('shoot_agreement')) missing.push('shoot_agreement');

  if (missing.length === 0) return existing;

  const created: Contract[] = [];
  for (const type of missing) {
    created.push(await createContract(bookingId, type, CONTRACT_TEMPLATES[type]));
  }

  return [...existing, ...created];
};

export const signContract = async (contractId: string, signature: string, role: SignerRole): Promise<void> => {
  const pathId = requireId(contractId);
  if (role !== 'creator' && role !== 'client' && role !== 'model') throw new Error('Unsupported contract signer role.');
  if (typeof signature !== 'string') throw new Error('Provide a single-line typed acknowledgement.');
  const acknowledgement = signature.trim();
  const hasControlCharacters = Array.from(acknowledgement).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (acknowledgement.length < 2 || acknowledgement.length > 200 || hasControlCharacters) {
    throw new Error('Provide a single-line typed acknowledgement of 2 to 200 characters.');
  }
  const token = await requireToken();
  const reviewed = reviewedContracts.get(contractId);
  if (!reviewed) throw new Error('Load and review this contract before signing.');

  // Reauthenticate the read without rebinding to a document the screen has not reviewed.
  const current = (await readBookingContracts(reviewed.booking_id, token)).find(contract => contract.id === contractId);
  if (!current || !sameDocument(reviewed, current)) {
    reviewedContracts.delete(contractId);
    throw new Error('The contract changed. Load and review it again before signing.');
  }
  const data = await apiClient.post<unknown>(`/contracts/${pathId}/sign`, {
    signature: acknowledgement, role, content_hash: reviewed.content_hash, content_version: reviewed.content_version,
  }, { token });
  const signed = await normalizeContract(data, reviewed.booking_id);
  if (!sameDocument(reviewed, signed) || signed[`${role}_signature`] !== acknowledgement) {
    throw new Error('The server did not confirm this contract acknowledgement.');
  }
  rememberContract(signed);
};
