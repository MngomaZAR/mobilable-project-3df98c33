"""Transactional fake + mocked provider protocol. This is NOT settlement evidence."""

import asyncio
import base64
import copy
import hashlib
import hmac
import json
import unittest
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.config import Settings
from app import financial_operations as financial
from app.payments import checkout


class Store:
    def __init__(self):
        self.booking = {'id': 'booking', 'client_id': 'client', 'photographer_id': 'creator', 'model_id': None,
                        'status': 'completed', 'payment_status': 'paid', 'quote_amount': Decimal('100.00'), 'payout_amount': Decimal('80.00')}
        self.payment = {'id': 'payment', 'booking_id': 'booking', 'provider': 'payfast', 'currency': 'ZAR', 'provider_payment_id': 'source-123',
                        'amount': Decimal('100.00'), 'refunded_amount': Decimal('0'), 'status': 'completed', 'merchant_id': 'unit-merchant', 'provider_mode': 'sandbox'}
        self.earning = {'id': 'earning', 'booking_id': 'booking', 'user_id': 'creator', 'status': 'pending', 'amount': Decimal('80.00'), 'refunded_amount': Decimal('0'), 'paid_amount': Decimal('0')}
        self.payout_request = {'status': 'pending_delivery', 'user_id': 'creator', 'payout_method_id': None}
        self.profile = {'role': 'photographer', 'verified': True, 'kyc_status': 'approved'}
        self.users = {user: {'metadata': {}} for user in ('client', 'creator', 'admin', 'outsider')}
        self.operations, self.banks, self.methods, self.ledger, self.receipts = {}, {}, {}, {}, {}
        self.confirmed = True
        self.acceptance = None
        self.lock = asyncio.Lock()
        self.sql = []
        self.calls = []

    async def connect(self, settings):
        return Connection(self)


class Connection:
    def __init__(self, store):
        self.store = store

    async def close(self):
        pass

    @asynccontextmanager
    async def transaction(self):
        async with self.store.lock:
            fields = ['booking', 'payment', 'earning', 'payout_request', 'users', 'operations', 'banks', 'methods', 'ledger', 'receipts']
            before = {field: copy.deepcopy(getattr(self.store, field)) for field in fields}
            try:
                yield
            except BaseException:
                for field, value in before.items():
                    setattr(self.store, field, value)
                raise

    async def fetchval(self, sql, *args):
        if 'financial_operations WHERE method_id=$1' in sql:
            referenced = [op for op in self.store.operations.values() if op['method_id'] == args[0]]
            if 'status=ANY' in sql:
                return any(op['status'] in args[1] for op in referenced)
            legacy = self.store.payout_request
            return bool(referenced or (legacy and legacy['payout_method_id'] == args[0]))
        if 'coalesce(status' in sql and 'payout_requests' in sql:
            row = self.store.payout_request
            terminal = ('paid', 'completed', 'cancelled', 'rejected', 'failed', 'reversed')
            return bool(row and row['status'] not in terminal and (row['payout_method_id'] == args[0] or (row['user_id'] == args[1] and row['payout_method_id'] is None)))
        if 'financial_provider_acceptance' in sql:
            return args == self.store.acceptance
        if 'payment_events' in sql:
            return self.store.confirmed
        if 'attempt_count=1' in sql:
            return any(op['booking_id'] == args[0] and op['kind'] == 'payout' and op['attempt_count'] == 1 for op in self.store.operations.values())
        if 'sum(amount)' in sql:
            kind = 'refund' if "kind='refund'" in sql else 'payout'
            return sum((op['amount'] for op in self.store.operations.values() if op['booking_id'] == args[0] and op['kind'] == kind and op['status'] in args[1]), Decimal(0))
        raise AssertionError(sql)

    async def fetchrow(self, sql, *args):
        self.store.sql.append(sql)
        self.store.calls.append((sql, args))
        if sql.startswith('SELECT'):
            if 'FROM api_users' in sql:
                return copy.deepcopy(self.store.users.get(args[0]))
            if 'financial_operations' in sql:
                if 'actor_id=$1' in sql:
                    return copy.deepcopy(next((row for row in self.store.operations.values() if row['actor_id'] == args[0] and row['idempotency_key'] == args[1]), None))
                return copy.deepcopy(self.store.operations.get(args[0]))
            if 'financial_webhook_receipts' in sql:
                return copy.deepcopy(self.store.receipts.get(args if len(args) == 2 else ('stitch', args[0])))
            if 'financial_bank_accounts' in sql:
                return copy.deepcopy(self.store.banks.get(args[0]))
            if 'profiles' in sql:
                return dict(self.store.profile)
            if 'bookings' in sql:
                return dict(self.store.booking) if args[0] == self.store.booking['id'] else None
            if 'payments' in sql:
                if "status='pending'" in sql:
                    return dict(self.store.payment) if self.store.payment['status'] == 'pending' else None
                return dict(self.store.payment) if args[0] in ('booking', 'payment') else None
            if 'earnings' in sql:
                return dict(self.store.earning) if self.store.earning else None
            if 'payout_requests' in sql:
                return dict(self.store.payout_request) if self.store.payout_request else None
            if 'payout_methods' in sql:
                row = self.store.methods.get(args[0])
                return dict(row) if row and row['user_id'] == args[1] else None
        if sql.startswith('INSERT INTO financial_operations'):
            columns = ['id', 'kind', 'actor_id', 'user_id', 'booking_id', 'payment_id', 'method_id', 'method_digest', 'amount', 'idempotency_key', 'request_fingerprint', 'reason', 'provider']
            row = dict(zip(columns, args))
            row.update(status='pending_approval', currency='ZAR', created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
                       attempt_count=0, provider_reference=None, provider_account=None, provider_mode=None, baseline=None, proof=None)
            self.store.operations[row['id']] = row
            return dict(row)
        if sql.startswith('UPDATE financial_operations'):
            row = self.store.operations[args[0]]
            if "status='unknown'" in sql:
                if row['status'] not in ('executing', 'unknown', 'submitted', 'paused'):
                    return None
                row.update(status='unknown', error_code='provider_unconfirmed')
            elif "status='failed'" in sql:
                row.update(status='failed', error_code='provider_preflight_failed')
            elif "status='executing'" in sql:
                row.update(status='executing', attempt_count=1, provider_account=args[1], provider_mode=args[2])
            elif 'proof=' in sql:
                row.update(status=args[1], proof=json.loads(args[2]), provider_reference=row['provider_reference'] or args[3])
            else:
                row.update(status=args[1], approved_by=args[2], approval_reference=args[3])
            return dict(row)
        if sql.startswith('UPDATE payout_methods'):
            row = self.store.methods.get(args[0])
            if row and row['user_id'] == args[1]:
                row['is_default'] = True
                return dict(row)
            return None
        raise AssertionError(sql)

    async def fetch(self, sql, *args):
        if 'FROM payout_methods m' not in sql:
            raise AssertionError(sql)
        rows = []
        for method in self.store.methods.values():
            bank = self.store.banks.get(method.get('id'))
            if method['user_id'] != args[0] or not method.get('bank_name') or not method.get('account_masked') or (bank and bank['revoked_at']):
                continue
            verified = bool(bank and bank['user_id'] == method['user_id'] and bank['verified_at'] and bank['verified_digest'] == bank['details_digest'])
            rows.append({**method, 'verified': verified})
        return rows

    async def execute(self, sql, *args):
        self.store.sql.append(sql)
        self.store.calls.append((sql, args))
        if 'pg_advisory_xact_lock' in sql:
            return
        if sql.startswith('INSERT INTO payout_methods'):
            self.store.methods[args[0]] = {'id': args[0], 'user_id': args[1], 'bank_name': args[2], 'account_masked': args[3], 'verified': False, 'is_default': False}
        elif sql.startswith('INSERT INTO financial_bank_accounts'):
            self.store.banks[args[0]] = dict(zip(['method_id', 'user_id', 'encrypted_details', 'details_digest'], args))
            self.store.banks[args[0]].update(verified_at=None, verified_digest=None, revoked_at=None,
                review_decision=None, review_reference=None, reviewed_by=None, reviewed_at=None)
        elif sql.startswith('UPDATE financial_bank_accounts'):
            row = self.store.banks.get(args[0])
            if row and "review_decision='rejected'" in sql:
                row.update(review_decision='rejected', review_reference=args[1], reviewed_by=args[2], reviewed_at=datetime.now(UTC))
            elif row and 'revoked_at=' in sql:
                row.update(revoked_at=datetime.now(UTC), verified_digest=None, verified_at=None)
            elif row:
                row.update(verified_digest=row['details_digest'], verified_by=args[1], verification_reference=args[2], verified_at=datetime.now(UTC),
                    review_decision='verified', review_reference=args[2], reviewed_by=args[1], reviewed_at=datetime.now(UTC))
        elif sql.startswith('UPDATE payout_methods'):
            if 'SET is_default=false' in sql:
                for method in self.store.methods.values():
                    if (len(args) == 1 and method['user_id'] == args[0]) or (len(args) == 2 and method['id'] == args[0] and method['user_id'] == args[1]):
                        method['is_default'] = False
            elif 'SET verified=false' in sql:
                self.store.methods[args[0]].update(verified=False, account_holder=None, branch_code=None, account_type=None, bank_name=None, account_masked=None)
            else:
                self.store.methods[args[0]]['verified'] = True
        elif sql.startswith('UPDATE financial_operations'):
            self.store.operations[args[0]]['baseline' if 'baseline=' in sql else 'provider_reference'] = json.loads(args[1]) if 'baseline=' in sql else args[1]
        elif sql.startswith('INSERT INTO financial_ledger'):
            self.store.ledger.setdefault((args[1], args[4]), dict(zip(['id', 'operation_id', 'booking_id', 'user_id', 'entry_type', 'amount'], args)))
        elif sql.startswith('UPDATE payments'):
            self.store.payment['refunded_amount'] = args[1]
        elif sql.startswith('UPDATE earnings'):
            row = self.store.earning
            if 'paid_amount=paid_amount+' in sql:
                row['paid_amount'] += args[1]
                row['status'] = 'paid' if row['paid_amount'] == row['amount'] - row['refunded_amount'] else 'partially_paid'
            elif 'paid_amount=paid_amount-' in sql:
                row['paid_amount'] -= args[1]
                row['status'] = 'pending'
            else:
                row['refunded_amount'] = args[1]
        elif sql.startswith('UPDATE bookings'):
            self.store.booking['payment_status'] = 'refunded'
        elif sql.startswith('UPDATE payout_requests'):
            if self.store.payout_request:
                self.store.payout_request['status'] = args[1]
        elif sql.startswith('INSERT INTO financial_webhook_receipts'):
            self.store.receipts[args[:2]] = dict(zip(['provider', 'event_id', 'payload_digest', 'operation_id'], args))
        elif sql.startswith('DELETE FROM financial_bank_accounts'):
            self.store.banks.pop(args[0], None)
        elif sql.startswith('DELETE FROM payout_methods'):
            method = self.store.methods.get(args[0])
            if method and method['user_id'] == args[1]:
                self.store.methods.pop(args[0])
        else:
            raise AssertionError(sql)


class FinancialTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.store = Store()
        self.settings = Settings(_env_file=None, ADMIN_USER_IDS='admin', PAYFAST_MERCHANT_ID='unit-merchant', PAYFAST_PASSPHRASE='unit phrase', PAYFAST_SANDBOX=True)
        self.config = financial.FinancialConfig(bank_encryption_key=Fernet.generate_key().decode(), stitch_client_id='unit-client',
            stitch_client_secret='unit secret', stitch_webhook_secret='whsec_' + base64.b64encode(b'x' * 32).decode(), stitch_mode='sandbox')
        self.patch = patch('app.financial_operations.connect', self.store.connect)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.admin = {'id': 'admin'}

    async def bank(self, owner='creator'):
        row = await financial.add_bank_method(self.settings, self.config, {'id': owner}, {
            'account_holder': 'Unit Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'})
        await financial.verify_bank_method(self.settings, self.config, self.admin, row['id'], 'private-proof/owner-verification')
        return row['id']

    async def operation(self, kind='refund', amount='20.00', key='key', **fields):
        payload = {'booking_id': 'booking', 'amount': amount, 'reason': 'Unit refund reason', 'idempotency_key': key, **fields}
        return await financial.request_operation(self.settings, self.config, {'id': 'client' if kind == 'refund' else 'creator'}, kind, payload)

    async def approve(self, row):
        return await financial.decide_operation(self.settings, self.admin, row['id'], 'approve', 'private-proof/delivery-approval')

    def gateway(self, *, lost=False, completed=True):
        self.posts = 0
        self.refunded = False
        self.payout_document = None
        self.fail_lookup = False

        def handle(request):
            if request.url.host == 'secure.stitch.money':
                return httpx.Response(200, json={'access_token': 'unit-only', 'token_type': 'Bearer', 'scope': 'client_disbursement'})
            if request.url.host == 'api.payfast.co.za':
                if request.url.path.startswith('/refunds/query/'):
                    return httpx.Response(200, json={'amount_original': 10000, 'amount_available_for_refund': 10000,
                        'status': 'REFUNDABLE', 'refund_partial': {'method': 'PAYMENT_SOURCE'}, 'refund_full': {'method': 'PAYMENT_SOURCE'}})
                if request.method == 'POST':
                    self.posts += 1
                    body = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
                    fields = {key: request.headers[key] for key in ('merchant-id', 'version', 'timestamp')}
                    expected = hashlib.md5(urlencode(sorted({**fields, **body, 'passphrase': 'unit phrase'}.items())).encode()).hexdigest()
                    self.assertEqual(request.headers['signature'], expected)
                    self.assertEqual(request.url.params['testing'], 'true')
                    self.assertNotIn('passphrase', request.content.decode())
                    self.refunded = completed
                    if lost:
                        raise httpx.ReadTimeout('unit response lost', request=request)
                    return httpx.Response(200, json={'code': 200, 'status': 'success', 'data': {'response': True}})
                refunds = [{'amount': '-2000', 'date': '2026-10-03 10:00:00', 'type': 'Funds Received (Refund)'}] if self.refunded else []
                return httpx.Response(200, json={'code': 200, 'status': 'success', 'data': {'response': {'available_balance': 8000 if self.refunded else 10000, 'transactions': refunds}}})
            self.assertEqual(request.url.host, 'api.stitch.money')
            if request.url.path == '/graphql':
                edges = [{'node': {'id': self.payout_document['id'], 'nonce': self.payout_document['nonce']}}] if self.payout_document else []
                return httpx.Response(200, json={'data': {'client': {'disbursements': {'edges': edges}}}})
            if request.method == 'POST':
                self.posts += 1
                payload = json.loads(request.content)
                self.payout_document = {**payload, 'id': 'unit/provider-id', 'status': 'completed' if completed else 'pending'}
                if lost:
                    raise httpx.ReadTimeout('unit response lost', request=request)
                return httpx.Response(201, json=self.payout_document)
            if self.fail_lookup:
                raise httpx.ReadTimeout('unit readback unavailable', request=request)
            return httpx.Response(200, json=self.payout_document)
        return httpx.AsyncClient(transport=httpx.MockTransport(handle))

    @asynccontextmanager
    async def authorized_gateway(self, **options):
        # Deliberately mocked acceptance, never a deployment evidence row.
        with patch('app.financial_operations._ready', return_value=True):
            async with self.gateway(**options) as client:
                yield client

    async def test_decimal_rejects_invalid_and_fractional_cents(self):
        for value in (True, None, 'NaN', 'Infinity', '0', '-1', '1.001', '1e99'):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                financial.zar(value)
        self.assertEqual(financial.zar('1.10'), Decimal('1.10'))

    async def test_capabilities_require_real_matching_independent_acceptance(self):
        self.assertEqual(await financial.capabilities(self.settings, self.config), {'refund_execution': False, 'creator_payout_execution': False})
        configured = replace(self.config, payfast_refunds_enabled=True, refund_acceptance_id='evidence')
        self.assertFalse((await financial.capabilities(self.settings, configured))['refund_execution'])
        self.store.acceptance = ('evidence', 'payfast', 'refund', 'different-merchant', 'sandbox')
        self.assertFalse((await financial.capabilities(self.settings, configured))['refund_execution'])

    async def test_identical_concurrent_replay_has_one_reservation(self):
        results = await asyncio.gather(*(self.operation() for _ in range(15)))
        self.assertEqual(len({row['id'] for row in results}), 1)
        self.assertEqual(len(self.store.operations), 1)
        self.assertEqual(self.store.payment['refunded_amount'], 0)
        self.assertTrue(any('pg_advisory_xact_lock' in sql for sql in self.store.sql))

    async def test_key_conflict_and_refund_balance(self):
        await self.operation()
        with self.assertRaises(HTTPException) as error:
            await self.operation(amount='21.00')
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            await self.operation(amount='90.00', key='another')
        self.assertEqual(len(self.store.operations), 1)

    async def test_booking_owner_and_original_confirmation_required(self):
        with self.assertRaises(HTTPException) as error:
            await financial.request_operation(self.settings, self.config, {'id': 'outsider'}, 'refund',
                {'booking_id': 'booking', 'amount': '20', 'reason': 'Unit reason', 'idempotency_key': 'bad'})
        self.assertEqual(error.exception.status_code, 403)
        self.store.confirmed = False
        with self.assertRaises(HTTPException):
            await self.operation()

    async def test_only_server_admin_can_decide_and_execute(self):
        row = await self.operation()
        fake_admin = {'id': 'client', 'user_metadata': {'role': 'admin'}}
        with self.assertRaises(HTTPException):
            await financial.decide_operation(self.settings, fake_admin, row['id'], 'approve', 'private-proof/reference')
        with self.assertRaises(HTTPException):
            await financial.execute_operation(self.settings, self.config, fake_admin, row['id'])
        with self.assertRaises(HTTPException) as error:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'])
        self.assertEqual(error.exception.status_code, 409)

    async def test_disabled_execution_has_no_attempt_or_ledger(self):
        row = await self.operation()
        await self.approve(row)
        with self.assertRaises(HTTPException) as error:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'])
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.store.operations[row['id']]['attempt_count'], 0)
        self.assertFalse(self.store.ledger)

    async def test_bank_is_encrypted_masked_and_verification_bound(self):
        method_id = await self.bank()
        row = self.store.banks[method_id]
        self.assertNotIn(b'1234567890', row['encrypted_details'])
        self.assertNotIn('account_holder', self.store.methods[method_id])
        self.assertEqual(self.store.methods[method_id]['account_masked'], '****7890')
        await self.operation('payout', method_id=method_id)
        row['details_digest'] = 'tampered'
        with self.assertRaises(HTTPException):
            await self.operation('payout', key='another', method_id=method_id)

    async def test_legacy_verified_method_does_not_authorize_transfer(self):
        self.store.methods['legacy'] = {'verified': True, 'user_id': 'creator'}
        with self.assertRaises(HTTPException):
            await self.operation('payout', method_id='legacy')
        self.assertFalse(self.store.operations)

    async def test_method_ownership_and_creator_kyc(self):
        method_id = await self.bank('client')
        with self.assertRaises(HTTPException):
            await self.operation('payout', method_id=method_id)
        method_id = await self.bank()
        self.store.profile['kyc_status'] = 'pending'
        with self.assertRaises(HTTPException):
            await self.operation('payout', method_id=method_id)

    async def test_payout_reservations_prevent_double_spending(self):
        method_id = await self.bank()
        results = await asyncio.gather(*(self.operation('payout', amount='50.00', key=f'key-{i}', method_id=method_id) for i in range(8)), return_exceptions=True)
        self.assertEqual(sum(isinstance(row, dict) for row in results), 1)
        self.assertEqual(len(self.store.operations), 1)
        with self.assertRaises(HTTPException):
            await self.operation('refund')

    async def test_partial_refund_net_creator_share_and_same_cent_rounding(self):
        self.store.payment['refunded_amount'] = Decimal('25.00')
        method_id = await self.bank()
        with self.assertRaises(HTTPException):
            await self.operation('payout', amount='60.01', method_id=method_id)
        await self.operation('payout', amount='60.00', method_id=method_id)
        self.assertEqual(self.store.earning['refunded_amount'], Decimal('20.00'))
        self.assertEqual(financial.creator_share(self.store.booking, self.store.payment, Decimal('0.01')), Decimal('0.01'))

    async def test_refund_post_acceptance_is_not_ledger_confirmation(self):
        row = await self.operation()
        await self.approve(row)
        async with self.authorized_gateway(completed=False) as client:
            result = await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(result['status'], 'unknown')
        self.assertFalse(self.store.ledger)
        self.assertEqual(self.store.payment['refunded_amount'], 0)

    async def test_refund_timeout_readback_reverses_ledger_once_without_second_post(self):
        row = await self.operation()
        await self.approve(row)
        async with self.authorized_gateway(lost=True) as client:
            self.assertEqual((await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client))['status'], 'unknown')
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.store.payment['refunded_amount'], Decimal('20.00'))
        self.assertEqual(self.store.earning['refunded_amount'], Decimal('16.00'))
        self.assertEqual(len(self.store.ledger), 3)
        self.assertEqual(self.store.ledger[(row['id'], 'creator_refund')]['user_id'], 'creator')

    async def test_ambiguous_refund_history_is_not_proof(self):
        baseline = {'available_balance': 10000, 'refunds': []}
        current = {'available_balance': 8000, 'refunds': [{'amount': -1000, 'date': 'x'}, {'amount': -1000, 'date': 'y'}]}
        self.assertIsNone(financial.prove_refund(baseline, current, Decimal('20.00')))

    async def test_payout_readback_and_reversal_are_idempotent(self):
        row = await self.operation('payout', amount='20.00', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway() as client:
            result = await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.assertEqual(result['status'], 'completed')
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.payout_document['status'] = 'reversed'
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.store.earning['paid_amount'], Decimal('0'))
        self.assertEqual(len(self.store.ledger), 2)
        self.assertNotIn('1234567890', json.dumps(self.store.operations[row['id']]['proof']))

    async def test_payout_pending_and_timeout_keep_reservation(self):
        method_id = await self.bank()
        row = await self.operation('payout', amount='60.00', method_id=method_id)
        await self.approve(row)
        async with self.authorized_gateway(lost=True, completed=False) as client:
            result = await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.assertEqual(result['status'], 'unknown')
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(self.posts, 1)
        self.assertFalse(self.store.ledger)
        with self.assertRaises(HTTPException):
            await self.operation('payout', amount='30.00', key='new', method_id=method_id)

    async def test_wrong_provider_nonce_amount_bank_or_currency_never_settles(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway(completed=False) as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            original = copy.deepcopy(self.payout_document)
            for field, value in [('nonce', 'foreign-nonce'), ('id', 'foreign-id'), ('currency', 'USD'), ('quantity', '21.00'), ('accountNumber', '9999999999')]:
                with self.subTest(field=field):
                    self.payout_document = copy.deepcopy(original)
                    self.payout_document['status'] = 'completed'
                    target = self.payout_document['amount'] if field in ('currency', 'quantity') else self.payout_document['beneficiary'] if field == 'accountNumber' else self.payout_document
                    target[field] = value
                    await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
                    self.assertFalse(self.store.ledger)
        self.assertFalse(self.store.ledger)
        self.assertEqual(self.store.earning['paid_amount'], 0)

    async def test_account_environment_switch_prevents_reconciliation(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway(completed=False) as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            with self.assertRaises(HTTPException):
                await financial.reconcile_operation(self.settings, replace(self.config, stitch_mode='live'), self.admin, row['id'], client=client)

    async def test_checkout_does_not_reuse_another_merchant_pending_payment(self):
        self.store.booking['status'] = 'accepted'
        self.store.payment.update(status='pending', merchant_id='different-merchant')
        settings = Settings(_env_file=None, PAYFAST_MERCHANT_ID='unit-merchant', PAYFAST_MERCHANT_KEY='unit-key', PAYFAST_PASSPHRASE='unit phrase', API_PUBLIC_URL='https://unit.invalid')
        with patch('app.payments.connect', self.store.connect), self.assertRaises(HTTPException) as error:
            await checkout(settings, 'booking', {'id': 'client'})
        self.assertEqual(error.exception.status_code, 409)

    async def test_svix_reference_vector_and_tamper_timestamp(self):
        config = replace(self.config, stitch_webhook_secret='whsec_plJ3nmyCDGBKInavdOK15jsl')
        raw = b'{"event_type":"ping","data":{"success":true}}'
        headers = {'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='}
        # Official Svix vector verifies the HMAC; this is not a disbursement payload.
        signed = f"{headers['svix-id']}.{headers['svix-timestamp']}.".encode() + raw
        expected = base64.b64encode(hmac.new(base64.b64decode(config.stitch_webhook_secret[6:]), signed, hashlib.sha256).digest()).decode()
        self.assertEqual(headers['svix-signature'], f'v1,{expected}')
        for changed, now in ((raw + b' ', 1731705121), (raw, 1731705522)):
            with self.assertRaises(HTTPException):
                financial.verify_stitch_webhook(config, changed, headers, now=now)

    async def test_signed_webhook_recovers_timeout_id_and_dedupes_receipts(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway(lost=True) as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            node = {'id': self.payout_document['id'], 'nonce': row['id'], 'amount': self.payout_document['amount'], 'status': {'__typename': 'DisbursementCompleted'}}
            raw = financial.canonical({'data': {'client': {'disbursements': {'node': node}}}})
            stamp = str(int(datetime.now(UTC).timestamp()))
            signed = f'event-1.{stamp}.'.encode() + raw
            signature = base64.b64encode(hmac.new(b'x' * 32, signed, hashlib.sha256).digest()).decode()
            headers = {'svix-id': 'event-1', 'svix-timestamp': stamp, 'svix-signature': f'v1,{signature}'}
            await financial.stitch_webhook(self.settings, self.config, raw, headers, client=client)
            await financial.stitch_webhook(self.settings, self.config, raw, headers, client=client)
        self.assertEqual(self.posts, 1)
        self.assertEqual(len(self.store.receipts), 1)
        self.assertEqual(len(self.store.ledger), 1)
        self.assertEqual(self.store.earning['paid_amount'], Decimal('20.00'))

    async def test_payout_nonce_readback_recovers_lost_id_without_second_transfer(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway(lost=True) as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            result = await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.store.earning['paid_amount'], Decimal('20.00'))

    async def test_rejection_releases_reservation_without_touching_ledger(self):
        row = await self.operation('payout', amount='80.00', method_id=await self.bank())
        await financial.decide_operation(self.settings, self.admin, row['id'], 'reject', 'private-proof/rejected-request')
        await self.operation('refund')
        self.assertFalse(self.store.ledger)

    async def test_refund_cannot_recall_a_paid_creator_balance(self):
        self.store.earning['paid_amount'] = Decimal('1.00')
        with self.assertRaises(HTTPException):
            await self.operation('refund')

    async def test_operation_read_is_private_and_never_returns_bank_or_proof(self):
        row = await self.operation('payout', method_id=await self.bank())
        self.store.operations[row['id']]['proof'] = {'private': 'not-public'}
        result = await financial.get_operation(self.settings, {'id': 'creator'}, row['id'])
        self.assertNotIn('proof', result)
        self.assertNotIn('method_digest', result)
        with self.assertRaises(HTTPException) as error:
            await financial.get_operation(self.settings, {'id': 'outsider'}, row['id'])
        self.assertEqual(error.exception.status_code, 404)

    async def test_original_merchant_binding_is_required_before_refund_execution(self):
        row = await self.operation()
        await self.approve(row)
        self.store.payment['merchant_id'] = 'foreign-merchant'
        with self.assertRaises(HTTPException) as error:
            async with self.authorized_gateway() as client:
                await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.posts, 0)

    async def test_admin_can_cancel_approved_but_unattempted_reservation(self):
        row = await self.operation()
        await self.approve(row)
        result = await financial.decide_operation(self.settings, self.admin, row['id'], 'reject', 'private-proof/cancel-before-send')
        self.assertEqual(result['status'], 'rejected')
        await self.operation(key='replacement')

    async def test_late_payout_reversal_can_be_verified_after_private_bank_purge(self):
        method_id = await self.bank()
        row = await self.operation('payout', method_id=method_id)
        await self.approve(row)
        async with self.authorized_gateway() as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            del self.store.banks[method_id]
            self.payout_document['status'] = 'reversed'
            result = await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(result['status'], 'reversed')
        self.assertEqual(self.store.earning['paid_amount'], 0)

    async def test_completed_operation_does_not_ack_a_reversal_without_readback(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway() as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            node = {'id': self.payout_document['id'], 'nonce': row['id'], 'amount': self.payout_document['amount'], 'status': {'__typename': 'DisbursementReversed'}}
            raw = financial.canonical({'data': {'client': {'disbursements': {'node': node}}}})
            stamp = str(int(datetime.now(UTC).timestamp()))
            signature = base64.b64encode(hmac.new(b'x' * 32, f'event-reversal.{stamp}.'.encode() + raw, hashlib.sha256).digest()).decode()
            headers = {'svix-id': 'event-reversal', 'svix-timestamp': stamp, 'svix-signature': f'v1,{signature}'}
            for unavailable in (False, True):
                self.fail_lookup = unavailable
                with self.assertRaises(HTTPException) as error:
                    await financial.stitch_webhook(self.settings, self.config, raw, headers, client=client)
                self.assertEqual(error.exception.status_code, 503)
                self.assertFalse(self.store.receipts)
            self.fail_lookup = False
            self.payout_document['status'] = 'reversed'
            await financial.stitch_webhook(self.settings, self.config, raw, headers, client=client)
        self.assertEqual(self.store.earning['paid_amount'], 0)

    async def test_transient_status_does_not_replace_completed_proof(self):
        row = await self.operation('payout', method_id=await self.bank())
        await self.approve(row)
        async with self.authorized_gateway() as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.payout_document['status'] = 'pending'
            await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(self.store.operations[row['id']]['proof']['status'], 'completed')
        self.assertEqual(self.store.earning['paid_amount'], Decimal('20.00'))

    async def test_legacy_paid_earning_with_zero_migrated_counter_is_not_spendable(self):
        method_id = await self.bank()
        self.store.earning['status'] = 'paid'
        with self.assertRaises(HTTPException) as error:
            await self.operation('payout', method_id=method_id)
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(self.store.operations)

    async def test_legacy_payout_markers_require_reconciliation(self):
        method_id = await self.bank()
        for status in ('pending', 'processing', 'paid', 'completed', 'unknown'):
            self.store.payout_request['status'] = status
            with self.assertRaises(HTTPException) as error:
                await self.operation('payout', method_id=method_id)
            self.assertEqual(error.exception.status_code, 409)
            self.assertFalse(self.store.operations)

    async def test_legacy_refunded_booking_with_zero_migrated_counter_is_not_refundable(self):
        self.store.booking['payment_status'] = 'refunded'
        with self.assertRaises(HTTPException) as error:
            await self.operation()
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(self.store.operations)

    async def test_bank_list_is_owner_only_masked_and_uses_private_verification(self):
        method_id = await self.bank()
        await self.bank('client')
        self.store.methods[method_id].update(account_masked='1234567890', account_holder='Not public', branch_code='123456')
        self.store.methods['legacy'] = {'id': 'legacy', 'user_id': 'creator', 'bank_name': 'ABSA',
            'account_masked': '****4321', 'verified': True, 'is_default': False}
        rows = await financial.list_bank_methods(self.settings, {'id': 'creator'})
        self.assertEqual({row['id'] for row in rows}, {method_id, 'legacy'})
        current = next(row for row in rows if row['id'] == method_id)
        self.assertEqual(current['account_masked'], '****7890')
        self.assertTrue(current['verified'])
        self.assertFalse(next(row for row in rows if row['id'] == 'legacy')['verified'])
        self.assertEqual(set(current), {'id', 'bank_name', 'account_masked', 'verified', 'is_default'})
        self.assertNotIn('1234567890', json.dumps(rows))
        self.assertNotIn('Not public', json.dumps(rows))
        self.assertEqual(await financial.list_bank_methods(self.settings, self.admin), [])

    async def test_bank_default_switch_is_atomic_idempotent_and_owner_only(self):
        first, second, other = await self.bank(), await self.bank(), await self.bank('client')
        self.store.methods[other]['is_default'] = True
        await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, first)
        row = await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, second)
        replay = await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, second)
        self.assertEqual(row, replay)
        self.assertTrue(row['is_default'])
        self.assertEqual([m['id'] for m in self.store.methods.values() if m['user_id'] == 'creator' and m['is_default']], [second])
        self.assertTrue(self.store.methods[other]['is_default'])

    async def test_bank_commands_reject_invalid_missing_and_cross_user_ids(self):
        method_id = await self.bank()
        for value in (None, [], '', 'x' * 121, 'bad\n'):
            for command in (
                lambda: financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, value),
                lambda: financial.revoke_bank_method(self.settings, {'id': 'creator'}, value),
            ):
                with self.assertRaises(HTTPException) as error:
                    await command()
                self.assertEqual(error.exception.status_code, 400)
        for user, target in (({'id': 'client'}, method_id), (self.admin, method_id), ({'id': 'creator'}, 'missing')):
            for command in (
                lambda: financial.set_default_bank_method(self.settings, self.config, user, target),
                lambda: financial.revoke_bank_method(self.settings, user, target),
            ):
                with self.assertRaises(HTTPException) as error:
                    await command()
                self.assertEqual(error.exception.status_code, 404)
        self.assertIn(method_id, self.store.banks)

    async def test_default_rejects_unverified_legacy_and_unconfigured_methods(self):
        verified = await self.bank()
        pending = await financial.add_bank_method(self.settings, self.config, {'id': 'creator'}, {
            'account_holder': 'Unit Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'})
        self.store.methods['legacy'] = {'id': 'legacy', 'user_id': 'creator', 'bank_name': 'ABSA',
            'account_masked': '****4321', 'verified': True, 'is_default': False}
        for method_id in (pending['id'], 'legacy'):
            with self.assertRaises(HTTPException) as error:
                await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, method_id)
            self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as error:
            await financial.set_default_bank_method(self.settings, replace(self.config, bank_encryption_key=''), {'id': 'creator'}, verified)
        self.assertEqual(error.exception.status_code, 503)
        self.assertFalse(any(m['is_default'] for m in self.store.methods.values()))

    async def test_default_missing_schema_fails_closed_without_clearing_existing_default(self):
        first, second = await self.bank(), await self.bank()
        self.store.methods[first]['is_default'] = True
        self.store.methods[second].pop('is_default')
        with self.assertRaises(HTTPException) as error:
            await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, second)
        self.assertEqual(error.exception.status_code, 503)
        self.assertTrue(self.store.methods[first]['is_default'])

    async def test_concurrent_default_changes_leave_exactly_one_owner_default(self):
        first, second = await self.bank(), await self.bank()
        results = await asyncio.gather(*(financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, method) for method in (first, second) * 4))
        self.assertTrue(all(row['is_default'] for row in results))
        self.assertEqual(sum(m['is_default'] for m in self.store.methods.values()), 1)

    async def test_unreferenced_revocation_removes_private_and_public_rows(self):
        method_id = await self.bank()
        self.store.payout_request['status'] = 'cancelled'
        self.store.methods[method_id]['is_default'] = True
        result = await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        self.assertEqual(result, {'id': method_id, 'revoked': True})
        self.assertNotIn(method_id, self.store.banks)
        self.assertNotIn(method_id, self.store.methods)
        self.assertEqual(await financial.list_bank_methods(self.settings, {'id': 'creator'}), [])
        self.assertFalse(any((await financial.capabilities(self.settings, self.config)).values()))

    async def test_revocation_rejects_every_active_financial_state_without_mutation(self):
        method_id = await self.bank()
        row = await self.operation('payout', method_id=method_id)
        self.store.payout_request['status'] = 'failed'
        original = copy.deepcopy(self.store.banks[method_id])
        for status in financial.ACTIVE:
            self.store.operations[row['id']]['status'] = status
            with self.assertRaises(HTTPException) as error:
                await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(self.store.banks[method_id], original)

    async def test_revocation_blocks_pending_legacy_and_unassigned_owner_payouts(self):
        method_id = await self.bank()
        for linked_method in (None, method_id):
            for status in (None, 'pending_delivery', 'pending', 'processing', 'submitted', 'executing', 'unknown', 'paused'):
                self.store.payout_request.update(status=status, payout_method_id=linked_method)
                with self.assertRaises(HTTPException) as error:
                    await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
                self.assertEqual(error.exception.status_code, 409)
                self.assertIsNone(self.store.banks[method_id]['revoked_at'])

    async def test_other_users_unassigned_payout_does_not_block_revocation(self):
        method_id = await self.bank()
        self.store.payout_request['user_id'] = 'client'
        await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        self.assertNotIn(method_id, self.store.banks)

    async def test_historical_reference_revokes_but_retains_ciphertext_and_identity(self):
        method_id = await self.bank()
        row = await self.operation('payout', method_id=method_id)
        self.store.operations[row['id']]['status'] = 'rejected'
        self.store.payout_request['status'] = 'rejected'
        encrypted = self.store.banks[method_id]['encrypted_details']
        self.store.methods[method_id]['is_default'] = True
        await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        replay = await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        self.assertTrue(replay['revoked'])
        self.assertEqual(self.store.banks[method_id]['encrypted_details'], encrypted)
        self.assertIsNotNone(self.store.banks[method_id]['revoked_at'])
        self.assertIsNone(self.store.banks[method_id]['verified_digest'])
        self.assertFalse(self.store.methods[method_id]['is_default'])
        self.assertEqual(self.store.operations[row['id']]['method_id'], method_id)
        self.assertEqual(await financial.list_bank_methods(self.settings, {'id': 'creator'}), [])
        with self.assertRaises(HTTPException) as error:
            await financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, method_id)
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            await financial.verify_bank_method(self.settings, self.config, self.admin, method_id, 'private-proof/reverify')

    async def test_terminal_legacy_reference_retains_private_details(self):
        method_id = await self.bank()
        self.store.payout_request.update(status='paid', payout_method_id=method_id)
        await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        self.assertIn(method_id, self.store.methods)
        self.assertIn(method_id, self.store.banks)
        self.assertIsNotNone(self.store.banks[method_id]['revoked_at'])

    async def test_legacy_method_without_private_details_can_be_revoked_without_fabrication(self):
        self.store.methods['legacy'] = {'id': 'legacy', 'user_id': 'creator', 'bank_name': 'ABSA',
            'account_masked': '****4321', 'account_holder': 'Not public', 'branch_code': '123456', 'verified': True, 'is_default': True}
        self.store.payout_request.update(status='paid', payout_method_id='legacy')
        await financial.revoke_bank_method(self.settings, {'id': 'creator'}, 'legacy')
        self.assertNotIn('legacy', self.store.banks)
        self.assertIsNone(self.store.methods['legacy']['account_holder'])
        self.assertIsNone(self.store.methods['legacy']['branch_code'])
        self.assertEqual(await financial.list_bank_methods(self.settings, {'id': 'creator'}), [])

    async def test_reservation_and_revocation_races_cannot_both_succeed(self):
        for revoke_first in (False, True):
            self.store.operations.clear()
            self.store.payout_request = None
            method_id = await self.bank()
            reservation = self.operation('payout', key=f'race-{revoke_first}', method_id=method_id)
            revocation = financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
            tasks = (revocation, reservation) if revoke_first else (reservation, revocation)
            results = await asyncio.gather(*tasks, return_exceptions=True)
            self.assertEqual(sum(not isinstance(result, Exception) for result in results), 1)
            if self.store.operations:
                self.assertIn(method_id, self.store.banks)
                self.assertIsNone(self.store.banks[method_id]['revoked_at'])
            else:
                self.assertNotIn(method_id, self.store.banks)

    async def test_bank_owner_lock_precedes_reservation_and_bank_row_locks(self):
        method_id = await self.bank()
        self.store.calls.clear()
        await self.operation('payout', method_id=method_id)
        owner_lock = next(index for index, (sql, args) in enumerate(self.store.calls) if 'pg_advisory_xact_lock' in sql and args == ('financial-bank:creator',))
        account_lock = next(index for index, (sql, _) in enumerate(self.store.calls) if 'FROM api_users' in sql and 'FOR UPDATE' in sql)
        first_row_lock = next(index for index, (sql, _) in enumerate(self.store.calls) if 'FOR UPDATE' in sql and 'FROM api_users' not in sql)
        self.assertLess(account_lock, owner_lock)
        self.assertLess(owner_lock, first_row_lock)
        self.store.calls.clear()
        with self.assertRaises(HTTPException):
            await financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id)
        owner_lock = next(index for index, (sql, args) in enumerate(self.store.calls) if 'pg_advisory_xact_lock' in sql and args == ('financial-bank:creator',))
        account_lock = next(index for index, (sql, _) in enumerate(self.store.calls) if 'FROM api_users' in sql and 'FOR UPDATE' in sql)
        first_row_lock = next(index for index, (sql, _) in enumerate(self.store.calls) if 'FOR UPDATE' in sql and 'FROM api_users' not in sql)
        self.assertLess(account_lock, owner_lock)
        self.assertLess(owner_lock, first_row_lock)

    async def test_unknown_and_deprecated_bank_codes_are_rejected_before_insert(self):
        payload = {'account_holder': 'Unit Recipient', 'account_number': '1234567890', 'account_type': 'savings'}
        for bank_id in ('foobar', 'za_bank_windhoek', 'za_nedbank_namibia', 'za_bnp_paribas', 'za_ithala_bank', 'ABSA'):
            with self.assertRaises(HTTPException) as error:
                await financial.add_bank_method(self.settings, self.config, {'id': 'creator'}, {**payload, 'bank_id': bank_id})
            self.assertEqual(error.exception.status_code, 400)
        self.assertFalse(self.store.banks)
        for bank_id in ('absa', 'capitec', 'fnb', 'nedbank', 'standard_bank', 'african_bank', 'discovery_bank', 'investec'):
            await financial.add_bank_method(self.settings, self.config, {'id': 'creator'}, {**payload, 'bank_id': bank_id})
        self.assertEqual(len(self.store.banks), 8)

    async def test_deletion_state_blocks_new_bank_mutations_and_missing_owner(self):
        method_id = await self.bank()
        self.store.payout_request = None
        payload = {'account_holder': 'Unit Recipient', 'account_number': '1234567890', 'bank_id': 'absa', 'account_type': 'savings'}
        for status in ('pending', 'blocked', 'processing', 'completed'):
            self.store.users['creator']['metadata'] = {'deletion_status': status}
            for command in (
                lambda: financial.add_bank_method(self.settings, self.config, {'id': 'creator'}, payload),
                lambda: financial.set_default_bank_method(self.settings, self.config, {'id': 'creator'}, method_id),
                lambda: financial.revoke_bank_method(self.settings, {'id': 'creator'}, method_id),
            ):
                with self.assertRaises(HTTPException) as error:
                    await command()
                self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as error:
            await financial.add_bank_method(self.settings, self.config, {'id': 'missing'}, payload)
        self.assertEqual(error.exception.status_code, 403)
        self.assertIsNone(self.store.banks[method_id]['revoked_at'])

    async def test_pending_deletion_can_resolve_balances_but_purge_state_cannot_reserve(self):
        method_id = await self.bank()
        self.store.users['creator']['metadata'] = {'deletion_status': 'pending'}
        row = await self.operation('payout', method_id=method_id)
        await self.approve(row)
        self.store.users['creator']['metadata'] = {'deletion_status': 'processing'}
        with self.assertRaises(HTTPException) as error:
            await self.operation('payout', key='after-purge-start', method_id=method_id)
        self.assertEqual(error.exception.status_code, 409)
        async with self.authorized_gateway() as client:
            with self.assertRaises(HTTPException) as error:
                await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.posts, 0)

    async def test_late_reversal_can_settle_against_deleted_owner_tombstone(self):
        method_id = await self.bank()
        row = await self.operation('payout', method_id=method_id)
        await self.approve(row)
        async with self.authorized_gateway() as client:
            await financial.execute_operation(self.settings, self.config, self.admin, row['id'], client=client)
            self.store.users['creator']['metadata'] = {'deletion_status': 'completed'}
            del self.store.banks[method_id]
            self.payout_document['status'] = 'reversed'
            result = await financial.reconcile_operation(self.settings, self.config, self.admin, row['id'], client=client)
        self.assertEqual(result['status'], 'reversed')
        self.assertEqual(self.store.earning['paid_amount'], 0)

    async def test_admin_rejection_is_independent_audited_and_never_verifies(self):
        method_id = await self.bank()
        self.store.payout_request = None
        for admin in ({'id': 'creator'}, {'id': 'outsider'}):
            with self.assertRaises(HTTPException) as error:
                await financial.reject_bank_method(self.settings, admin, method_id, 'private-proof/rejected')
            self.assertEqual(error.exception.status_code, 403)
        with self.assertRaises(HTTPException) as error:
            await financial.reject_bank_method(self.settings.model_copy(update={'admin_user_ids': 'creator'}), {'id': 'creator'}, method_id, 'private-proof/rejected')
        self.assertEqual(error.exception.status_code, 403)
        with self.assertRaises(HTTPException) as error:
            await financial.reject_bank_method(self.settings, self.admin, method_id, 'short')
        self.assertEqual(error.exception.status_code, 400)
        result = await financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/rejected')
        self.assertEqual(result, {'id': method_id, 'verified': False, 'revoked': True})
        private = self.store.banks[method_id]
        self.assertEqual(private['review_decision'], 'rejected')
        self.assertEqual(private['review_reference'], 'private-proof/rejected')
        self.assertEqual(private['reviewed_by'], 'admin')
        self.assertIsNotNone(private['reviewed_at'])
        self.assertIsNone(private['verified_at'])
        self.assertFalse(self.store.methods[method_id]['verified'])
        self.assertEqual(await financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/rejected'), result)
        with self.assertRaises(HTTPException) as error:
            await financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/different')
        self.assertEqual(error.exception.status_code, 409)

    async def test_admin_rejection_blocks_active_and_pending_legacy_holds(self):
        method_id = await self.bank()
        with self.assertRaises(HTTPException) as error:
            await financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/rejected')
        self.assertEqual(error.exception.status_code, 409)
        row = await self.operation('payout', method_id=method_id)
        self.store.payout_request = None
        for status in financial.ACTIVE:
            self.store.operations[row['id']]['status'] = status
            with self.assertRaises(HTTPException) as error:
                await financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/rejected')
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(self.store.banks[method_id]['review_decision'], 'verified')

    async def test_admin_review_missing_migration_fails_closed(self):
        method_id = await self.bank()
        self.store.payout_request = None
        self.store.banks[method_id].pop('review_decision')
        for command in (
            lambda: financial.verify_bank_method(self.settings, self.config, self.admin, method_id, 'private-proof/verified'),
            lambda: financial.reject_bank_method(self.settings, self.admin, method_id, 'private-proof/rejected'),
        ):
            with self.assertRaises(HTTPException) as error:
                await command()
            self.assertEqual(error.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
