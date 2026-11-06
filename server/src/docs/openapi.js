// OpenAPI 3.0 specification, served at /api/docs by swagger-ui-express.
const err = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (description, schema = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
const json = (schema, example) => ({ required: true, content: { 'application/json': { schema, ...(example ? { example } : {}) } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const sessionQ = { name: 'session', in: 'query', schema: { type: 'string', example: '2026-27' }, description: 'Defaults to the current round' };
const pageQ = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
];
const common = { 401: err('Missing, invalid or expired access token'), 403: err('Lacks the required permission or hostel scope') };
const v = { 422: err('Request validation failed') };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Hostel Room Allocation API',
    version: '1.0.0',
    description:
      'Two-round hostel allocation: Round 1 priority allocation from ranked preferences, Round 2 first-come open booking ' +
      'protected by a row-locking transaction. Every error uses the same shape: `{ error: { code, message, details?, requestId } }`.',
  },
  servers: [{ url: '/api/v1' }],
  tags: ['Auth', 'Hostels', 'Rounds', 'Allocations', 'Swaps', 'Reports', 'Admin'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'CONFLICT' },
              message: { type: 'string', example: 'No free bed left in room G-101' },
              details: {},
              requestId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['student', 'warden', 'admin'] },
          permissions: { type: 'array', items: { type: 'string' } }, studentId: { type: 'integer', nullable: true }, hostelId: { type: 'integer', nullable: true },
        },
      },
      Round: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, session: { type: 'string' }, name: { type: 'string' },
          status: { type: 'string', enum: ['DRAFT', 'PREFERENCES_OPEN', 'ALLOCATED', 'BOOKING_OPEN', 'CLOSED'] }, feeWindowDays: { type: 'integer' },
        },
      },
      Allocation: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, session: { type: 'string' }, studentId: { type: 'integer' }, bedId: { type: 'integer' },
          status: { type: 'string', enum: ['ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'VACATED', 'RELEASED', 'SWAPPED'] },
          source: { type: 'string', enum: ['PRIORITY', 'OPEN_BOOKING', 'SWAP', 'LEGACY'] }, feeDueAt: { type: 'string', format: 'date-time' },
          allowedNext: { type: 'array', items: { type: 'string' } },
        },
      },
      PageMeta: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' }, hasNext: { type: 'boolean' } },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'], security: [], summary: 'Log in; sets the refresh token as an httpOnly cookie',
        requestBody: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }, { email: 'admin@hostel.edu', password: 'Admin@123' }),
        responses: { 200: ok('Access token and user', { type: 'object', properties: { accessToken: { type: 'string' }, user: { $ref: '#/components/schemas/User' } } }), 401: err('Invalid email or password'), 429: err('Too many attempts'), ...v },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'], security: [], summary: 'Rotate the refresh cookie and get a new access token',
        responses: { 200: ok('New access token'), 401: err('Missing, expired, revoked or reused refresh token') },
      },
    },
    '/auth/logout': { post: { tags: ['Auth'], security: [], summary: 'Revoke the refresh token and clear the cookie', responses: { 204: { description: 'Logged out' } } } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user', responses: { 200: ok('User'), ...common } } },

    '/hostels': {
      get: {
        tags: ['Hostels'], summary: 'Hostels with bed and occupancy counts',
        parameters: [sessionQ, { name: 'eligible', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Students: only hostels they may live in' }],
        responses: { 200: ok('Hostel list'), ...common },
      },
    },
    '/hostels/{id}/rooms': {
      get: {
        tags: ['Hostels'], summary: 'Rooms of a hostel with free-bed counts (paginated)',
        parameters: [idParam, sessionQ, { name: 'floor', in: 'query', schema: { type: 'integer' } }, { name: 'available', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }, ...pageQ, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['roomNo', '-roomNo', 'floor', '-floor', 'freeBeds', '-freeBeds'] } }],
        responses: { 200: ok('Rooms page', { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { $ref: '#/components/schemas/PageMeta' } } }), 404: err('Hostel not found'), ...common, ...v },
      },
    },

    '/rounds': {
      get: { tags: ['Rounds'], summary: 'All allocation rounds', responses: { 200: ok('Rounds'), ...common } },
      post: {
        tags: ['Rounds'], summary: 'Create a round (admin)',
        requestBody: json({ type: 'object', required: ['session', 'name'], properties: { session: { type: 'string' }, name: { type: 'string' }, feeWindowDays: { type: 'integer' } } }, { session: '2027-28', name: 'Allocation 2027-28', feeWindowDays: 7 }),
        responses: { 201: ok('Created', { $ref: '#/components/schemas/Round' }), 409: err('Another round is still open, or session exists'), ...common, ...v },
      },
    },
    '/rounds/current': { get: { tags: ['Rounds'], summary: 'Current (not closed) round', responses: { 200: ok('Round'), 404: err('No round'), ...common } } },
    '/rounds/{id}/status': {
      patch: {
        tags: ['Rounds'], summary: 'Advance the round lifecycle (admin)',
        description: 'DRAFT → PREFERENCES_OPEN; ALLOCATED → BOOKING_OPEN | CLOSED; BOOKING_OPEN → CLOSED. PREFERENCES_OPEN → ALLOCATED only via /run.',
        parameters: [idParam],
        requestBody: json({ type: 'object', properties: { status: { type: 'string', enum: ['PREFERENCES_OPEN', 'BOOKING_OPEN', 'CLOSED'] } } }),
        responses: { 200: ok('Updated round'), 409: err('Invalid lifecycle transition'), ...common, ...v },
      },
    },
    '/rounds/{id}/preferences/me': { get: { tags: ['Rounds'], summary: "Student's ranked preferences", parameters: [idParam], responses: { 200: ok('Preferences'), ...common } } },
    '/rounds/{id}/preferences': {
      put: {
        tags: ['Rounds'], summary: 'Replace ranked preferences (student, max 5, eligible rooms only)', parameters: [idParam],
        requestBody: json({ type: 'object', properties: { roomIds: { type: 'array', items: { type: 'integer' }, maxItems: 5 } } }, { roomIds: [12, 15, 40] }),
        responses: { 200: ok('Saved'), 409: err('Preferences not open'), ...common, ...v },
      },
    },
    '/rounds/{id}/run': {
      post: {
        tags: ['Rounds'], summary: 'Run Round 1 priority allocation (admin)', parameters: [idParam],
        description: 'Students are ordered PwD first, then year (desc), then CGPA (desc); each gets the highest-ranked preference with a free bed. Runs in one transaction.',
        responses: { 200: ok('Summary: allocated, unallocated, allocatedByPreferenceRank'), 409: err('Round not in PREFERENCES_OPEN (e.g. already run)'), ...common },
      },
    },
    '/rounds/{id}/book': {
      post: {
        tags: ['Rounds'], summary: 'Round 2: book a free bed in a room (student)', parameters: [idParam],
        description: 'Transaction + SELECT … FOR UPDATE SKIP LOCKED + partial UNIQUE indexes. N concurrent requests for the last bed give exactly one 201 and N-1 409s.',
        requestBody: json({ type: 'object', required: ['roomId'], properties: { roomId: { type: 'integer' } } }, { roomId: 42 }),
        responses: { 201: ok('Allocation created', { $ref: '#/components/schemas/Allocation' }), 409: err('No free bed / already hold a bed / booking closed'), 404: err('Room not found'), ...common, ...v },
      },
    },

    '/allocations': {
      get: {
        tags: ['Allocations'], summary: 'List allocations (warden: own hostel only; admin: all)',
        parameters: [sessionQ, { name: 'hostelId', in: 'query', schema: { type: 'integer' } }, { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Roll number or name' }, ...pageQ, { name: 'sort', in: 'query', schema: { type: 'string', example: '-createdAt' } }],
        responses: { 200: ok('Page of allocations'), ...common, ...v },
      },
    },
    '/allocations/me': { get: { tags: ['Allocations'], summary: "Student's current allocation and history", responses: { 200: ok('Allocation or null'), ...common } } },
    '/allocations/{id}': { get: { tags: ['Allocations'], summary: 'One allocation', parameters: [idParam], responses: { 200: ok('Allocation'), 404: err('Not found'), ...common } } },
    '/allocations/{id}/status': {
      patch: {
        tags: ['Allocations'], summary: 'Move an allocation through its lifecycle (warden/admin)', parameters: [idParam],
        description: 'ALLOCATED → RELEASED; FEE_SUBMITTED → VERIFIED | ALLOCATED (receipt rejected); VERIFIED → CHECKED_IN; CHECKED_IN → VACATED.',
        requestBody: json({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['VERIFIED', 'ALLOCATED', 'CHECKED_IN', 'VACATED', 'RELEASED'] }, note: { type: 'string' } } }),
        responses: { 200: ok('Updated allocation'), 409: err('Invalid transition (response lists allowedNext)'), ...common, ...v },
      },
    },
    '/allocations/{id}/receipt': {
      post: {
        tags: ['Allocations'], summary: 'Upload fee receipt (student). PDF/JPEG/PNG, max 2 MB', parameters: [idParam],
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { receipt: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: ok('Receipt stored; allocation is FEE_SUBMITTED'), 409: err('Allocation not in ALLOCATED'), 413: err('File too large'), 415: err('Wrong file type or content'), ...common, ...v },
      },
      get: { tags: ['Allocations'], summary: 'Download the latest receipt (owner, hostel warden, admin)', parameters: [idParam], responses: { 200: { description: 'File stream' }, 404: err('No receipt'), ...common } },
    },

    '/swaps': {
      get: { tags: ['Swaps'], summary: 'Swap requests visible to the caller', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: ok('Swaps'), ...common } },
      post: {
        tags: ['Swaps'], summary: 'Request a swap with another student (student)',
        requestBody: json({ type: 'object', properties: { targetRollNo: { type: 'string' } } }, { targetRollNo: 'MCA25B0042' }),
        responses: { 201: ok('Swap created (PENDING_PEER)'), 409: err('No active allocation / pending swap exists'), 404: err('Roll number not found'), ...common, ...v },
      },
    },
    '/swaps/{id}/respond': { patch: { tags: ['Swaps'], summary: 'Other student accepts or declines', parameters: [idParam], requestBody: json({ type: 'object', properties: { accept: { type: 'boolean' } } }), responses: { 200: ok('Swap'), 409: err('Not PENDING_PEER'), ...common } } },
    '/swaps/{id}/cancel': { patch: { tags: ['Swaps'], summary: 'Requester withdraws', parameters: [idParam], responses: { 200: ok('Swap'), 409: err('Already decided'), ...common } } },
    '/swaps/{id}/decision': {
      patch: {
        tags: ['Swaps'], summary: 'Warden of BOTH hostels (or admin) approves/rejects', parameters: [idParam],
        description: 'Approval locks both allocations in ascending id order (deadlock-free), marks them SWAPPED and inserts two new allocations, all in one transaction.',
        requestBody: json({ type: 'object', properties: { approve: { type: 'boolean' } } }),
        responses: { 200: ok('Swap'), 409: err('Not awaiting approval / allocation no longer active'), ...common },
      },
    },

    '/reports/occupancy': { get: { tags: ['Reports'], summary: 'Per-hostel occupancy by status', parameters: [sessionQ], responses: { 200: ok('Report'), ...common } } },
    '/admin/jobs/release-unpaid': { post: { tags: ['Admin'], summary: 'Run the hourly release job now', responses: { 200: ok('Released allocations'), ...common } } },
    '/admin/audit-logs': { get: { tags: ['Admin'], summary: 'Audit trail from MongoDB', parameters: [{ name: 'entity', in: 'query', schema: { type: 'string' } }, { name: 'entityId', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok('Logs'), ...common } } },
    '/notifications/me': { get: { tags: ['Admin'], summary: "Caller's notifications (MongoDB)", responses: { 200: ok('Notifications'), ...common } } },
  },
};
