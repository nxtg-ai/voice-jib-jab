import { ClaimVerificationService } from '../../services/ClaimVerificationService.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeScanResponse(overrides: {
  claims?: Array<{ id: string; text: string; type: 'fact' | 'opinion' | 'interpretation'; importance: number }>;
  verifications?: Record<string, { claimId: string; status: string; explanation: string }>;
  overallRisk?: string;
}) {
  return {
    claims: overrides.claims ?? [],
    verifications: overrides.verifications ?? {},
    overallRisk: overrides.overallRisk ?? 'low',
  };
}

function mockFetch(body: unknown, status = 200): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

function mockFetchError(message: string): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error(message));
}

// ── Shared fixtures ────────────────────────────────────────────────────────

const FACT_CLAIM_HIGH = { id: 'c1', text: 'The vaccine is 95% effective.', type: 'fact' as const, importance: 5 };
const FACT_CLAIM_MED  = { id: 'c2', text: 'Side effects are rare.',         type: 'fact' as const, importance: 3 };
const FACT_CLAIM_LOW  = { id: 'c3', text: 'Minor claim.',                   type: 'fact' as const, importance: 2 };
const OPINION_CLAIM   = { id: 'c4', text: 'It is the best vaccine.',        type: 'opinion' as const, importance: 5 };

const BASE_URL = 'http://localhost:3001';
const API_KEY  = 'fp-key-test';

function makeSvc(): ClaimVerificationService {
  return new ClaimVerificationService(BASE_URL, API_KEY);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ClaimVerificationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── scan() — request shape ───────────────────────────────────────────────

  describe('scan() request', () => {
    it('sends a POST request to baseUrl/scan', async () => {
      const spy = mockFetch(makeScanResponse({ claims: [FACT_CLAIM_HIGH], verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } } }));
      await makeSvc().scan('test text');

      expect(spy).toHaveBeenCalledWith(
        `${BASE_URL}/scan`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('sends x-api-key header with the configured key', async () => {
      const spy = mockFetch(makeScanResponse({ claims: [FACT_CLAIM_HIGH], verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } } }));
      await makeSvc().scan('test text');

      const init = spy.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);
    });

    it('sends Content-Type: application/json', async () => {
      const spy = mockFetch(makeScanResponse({ claims: [FACT_CLAIM_HIGH], verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } } }));
      await makeSvc().scan('test text');

      const init = spy.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('sends body with text and provider=mock', async () => {
      const spy = mockFetch(makeScanResponse({ claims: [FACT_CLAIM_HIGH], verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } } }));
      const inputText = 'Vaccines are very effective.';
      await makeSvc().scan(inputText);

      const init = spy.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ text: inputText, provider: 'mock' });
    });
  });

  // ── scan() — null when no qualifying claims ───────────────────────────────

  describe('scan() returns null when no qualifying fact claims', () => {
    it('returns null when claims array is empty', async () => {
      mockFetch(makeScanResponse({}));
      const result = await makeSvc().scan('no claims here');
      expect(result).toBeNull();
    });

    it('returns null when only opinion claims are present (any importance)', async () => {
      mockFetch(makeScanResponse({ claims: [OPINION_CLAIM], verifications: {} }));
      const result = await makeSvc().scan('opinions only');
      expect(result).toBeNull();
    });

    it('returns null when only fact claims with importance < 3 are present', async () => {
      mockFetch(makeScanResponse({ claims: [FACT_CLAIM_LOW], verifications: {} }));
      const result = await makeSvc().scan('minor claim');
      expect(result).toBeNull();
    });

    it('includes fact claims with importance exactly 3', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_MED],
        verifications: { c2: { claimId: 'c2', status: 'supported', explanation: '' } },
        overallRisk: 'low',
      }));
      const result = await makeSvc().scan('at threshold');
      expect(result).not.toBeNull();
      expect(result!.factClaims).toBe(1);
    });
  });

  // ── scan() — counting logic ──────────────────────────────────────────────

  describe('scan() counts', () => {
    it('filters opinion claims out of factClaims count', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH, OPINION_CLAIM],
        verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } },
        overallRisk: 'low',
      }));
      const result = await makeSvc().scan('mixed');
      expect(result!.factClaims).toBe(1);
    });

    it('counts verified (supported) correctly', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH, FACT_CLAIM_MED],
        verifications: {
          c1: { claimId: 'c1', status: 'supported', explanation: '' },
          c2: { claimId: 'c2', status: 'contradicted', explanation: '' },
        },
        overallRisk: 'high',
      }));
      const result = await makeSvc().scan('mixed statuses');
      expect(result!.verified).toBe(1);
    });

    it('counts contradicted correctly', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH, FACT_CLAIM_MED],
        verifications: {
          c1: { claimId: 'c1', status: 'contradicted', explanation: '' },
          c2: { claimId: 'c2', status: 'supported', explanation: '' },
        },
        overallRisk: 'high',
      }));
      const result = await makeSvc().scan('mixed statuses');
      expect(result!.contradicted).toBe(1);
    });

    it('counts unverified (mixed/unverified/skipped/loading) correctly', async () => {
      const claims = [
        { id: 'u1', text: 'A', type: 'fact' as const, importance: 3 },
        { id: 'u2', text: 'B', type: 'fact' as const, importance: 3 },
        { id: 'u3', text: 'C', type: 'fact' as const, importance: 3 },
        { id: 'u4', text: 'D', type: 'fact' as const, importance: 3 },
      ];
      mockFetch(makeScanResponse({
        claims,
        verifications: {
          u1: { claimId: 'u1', status: 'mixed',      explanation: '' },
          u2: { claimId: 'u2', status: 'unverified', explanation: '' },
          u3: { claimId: 'u3', status: 'skipped',    explanation: '' },
          u4: { claimId: 'u4', status: 'loading',    explanation: '' },
        },
        overallRisk: 'medium',
      }));
      const result = await makeSvc().scan('all unverified-ish');
      expect(result!.unverified).toBe(4);
      expect(result!.verified).toBe(0);
      expect(result!.contradicted).toBe(0);
    });

    it('treats missing verifications entry as unverified', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH],
        verifications: {}, // no entry for c1
        overallRisk: 'medium',
      }));
      const result = await makeSvc().scan('no verification entry');
      expect(result!.unverified).toBe(1);
      expect(result!.verified).toBe(0);
    });

    it('passes overallRisk through from API response', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH],
        verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } },
        overallRisk: 'critical',
      }));
      const result = await makeSvc().scan('critical risk');
      expect(result!.overallRisk).toBe('critical');
    });

    it('factClaims count matches filtered set (excludes opinion and low importance)', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH, FACT_CLAIM_MED, FACT_CLAIM_LOW, OPINION_CLAIM],
        verifications: {
          c1: { claimId: 'c1', status: 'supported', explanation: '' },
          c2: { claimId: 'c2', status: 'supported', explanation: '' },
        },
        overallRisk: 'low',
      }));
      const result = await makeSvc().scan('mixed types and importances');
      // Only FACT_CLAIM_HIGH (importance 5) and FACT_CLAIM_MED (importance 3) qualify
      expect(result!.factClaims).toBe(2);
    });
  });

  // ── scan() — highestRiskClaim ────────────────────────────────────────────

  describe('scan() highestRiskClaim', () => {
    it('is the text of the highest importance contradicted claim', async () => {
      const claims = [
        { id: 'h1', text: 'Lower importance contradicted.', type: 'fact' as const, importance: 3 },
        { id: 'h2', text: 'Higher importance contradicted.', type: 'fact' as const, importance: 5 },
      ];
      mockFetch(makeScanResponse({
        claims,
        verifications: {
          h1: { claimId: 'h1', status: 'contradicted', explanation: '' },
          h2: { claimId: 'h2', status: 'contradicted', explanation: '' },
        },
        overallRisk: 'high',
      }));
      const result = await makeSvc().scan('two contradicted');
      expect(result!.highestRiskClaim).toBe('Higher importance contradicted.');
    });

    it('falls back to unverified claim when no contradicted claims exist', async () => {
      const claims = [
        { id: 'v1', text: 'Supported claim.', type: 'fact' as const, importance: 5 },
        { id: 'v2', text: 'Unverified claim.', type: 'fact' as const, importance: 4 },
      ];
      mockFetch(makeScanResponse({
        claims,
        verifications: {
          v1: { claimId: 'v1', status: 'supported', explanation: '' },
          v2: { claimId: 'v2', status: 'unverified', explanation: '' },
        },
        overallRisk: 'medium',
      }));
      const result = await makeSvc().scan('no contradicted');
      expect(result!.highestRiskClaim).toBe('Unverified claim.');
    });

    it('is undefined when all claims are supported', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH],
        verifications: { c1: { claimId: 'c1', status: 'supported', explanation: '' } },
        overallRisk: 'low',
      }));
      const result = await makeSvc().scan('all supported');
      expect(result!.highestRiskClaim).toBeUndefined();
    });
  });

  // ── scan() — spoken field ────────────────────────────────────────────────

  describe('scan() spoken field', () => {
    it('spoken field on result contains formatted string', async () => {
      mockFetch(makeScanResponse({
        claims: [FACT_CLAIM_HIGH, FACT_CLAIM_MED],
        verifications: {
          c1: { claimId: 'c1', status: 'supported', explanation: '' },
          c2: { claimId: 'c2', status: 'unverified', explanation: '' },
        },
        overallRisk: 'medium',
      }));
      const result = await makeSvc().scan('two claims');
      expect(typeof result!.spoken).toBe('string');
      expect(result!.spoken.length).toBeGreaterThan(0);
    });
  });

  // ── scan() — error paths ─────────────────────────────────────────────────

  describe('scan() error handling', () => {
    it('throws when API returns non-200 status', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );
      await expect(makeSvc().scan('text')).rejects.toThrow('500');
    });

    it('throws on network error', async () => {
      mockFetchError('Network failure');
      await expect(makeSvc().scan('text')).rejects.toThrow('Network failure');
    });
  });

  // ── formatSpoken() ───────────────────────────────────────────────────────

  describe('formatSpoken()', () => {
    function svc() {
      return makeSvc();
    }

    it('uses plural "I found N claims" for multiple claims', () => {
      const spoken = svc().formatSpoken({
        factClaims: 3, verified: 2, contradicted: 0, unverified: 1, overallRisk: 'medium',
      });
      expect(spoken).toContain('I found 3 claims');
    });

    it('uses singular "That claim" path when factClaims === 1 and supported', () => {
      const spoken = svc().formatSpoken({
        factClaims: 1, verified: 1, contradicted: 0, unverified: 0, overallRisk: 'low',
      });
      expect(spoken).toContain('That claim appears to be supported');
    });

    it('uses "That claim is unverified" when factClaims === 1 and unverified', () => {
      const spoken = svc().formatSpoken({
        factClaims: 1, verified: 0, contradicted: 0, unverified: 1, overallRisk: 'medium',
      });
      expect(spoken).toContain('That claim is unverified');
    });

    it('"All N claims check out" when contradicted and unverified are both 0', () => {
      const spoken = svc().formatSpoken({
        factClaims: 4, verified: 4, contradicted: 0, unverified: 0, overallRisk: 'low',
      });
      expect(spoken).toContain('All 4 claims check out');
    });

    it('includes "Warning:" prefix when contradicted > 0', () => {
      const spoken = svc().formatSpoken({
        factClaims: 3, verified: 1, contradicted: 2, unverified: 0, overallRisk: 'high',
      });
      expect(spoken).toContain('Warning:');
    });

    it('appends highestRiskClaim text when contradicted > 0', () => {
      const disputed = 'Vaccines cause autism.';
      const spoken = svc().formatSpoken({
        factClaims: 2, verified: 1, contradicted: 1, unverified: 0, overallRisk: 'high',
        highestRiskClaim: disputed,
      });
      expect(spoken).toContain(`The disputed claim is: ${disputed}`);
    });

    it('does NOT append disputed claim text when none is provided', () => {
      const spoken = svc().formatSpoken({
        factClaims: 2, verified: 1, contradicted: 1, unverified: 0, overallRisk: 'high',
      });
      expect(spoken).not.toContain('The disputed claim is:');
    });

    it('includes risk level in output', () => {
      const spoken = svc().formatSpoken({
        factClaims: 2, verified: 2, contradicted: 0, unverified: 0, overallRisk: 'low',
      });
      expect(spoken).toContain('Risk level: low');
    });

    it('handles zero verified (all unverified)', () => {
      const spoken = svc().formatSpoken({
        factClaims: 3, verified: 0, contradicted: 0, unverified: 3, overallRisk: 'medium',
      });
      expect(spoken).toContain('unverified');
      expect(spoken).not.toContain('supported');
    });

    it('single contradicted claim uses Warning prefix', () => {
      const spoken = svc().formatSpoken({
        factClaims: 1, verified: 0, contradicted: 1, unverified: 0, overallRisk: 'critical',
        highestRiskClaim: 'The earth is flat.',
      });
      expect(spoken).toContain('Warning:');
      expect(spoken).toContain('The earth is flat.');
    });
  });
});
