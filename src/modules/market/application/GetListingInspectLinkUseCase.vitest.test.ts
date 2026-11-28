import { describe, expect, it, vi } from 'vitest';
import { FloatRateLimitWaitTimeoutError } from './FloatRateLimiter';
import { resolvePaintIndexForPhase } from './floatSyncHelpers';
import { GetListingInspectLinkUseCase, resolveItemDefIndex } from './GetListingInspectLinkUseCase';

describe('GetListingInspectLinkUseCase', () => {
  it('returns a certificate-based Steam link and caches the lookup', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      assets: [{
        markethashname: 'Sticker | Test',
        certificate: 'abcdef0123456789abcdef0123456789',
      }],
    });
    const useCase = new GetListingInspectLinkUseCase({ fetchPage }, 10 * 60 * 1000);

    const first = await useCase.execute('Sticker | Test');
    const second = await useCase.execute('Sticker | Test');

    expect(first).toBe('steam://run/730//+csgo_econ_action_preview%20abcdef0123456789abcdef0123456789');
    expect(second).toBe(first);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('returns null when SteamWebAPI does not provide a valid certificate', async () => {
    const useCase = new GetListingInspectLinkUseCase({
      fetchPage: vi.fn().mockResolvedValue({ ok: true, assets: [{ certificate: '' }] }),
    });

    await expect(useCase.execute('Case | Test')).resolves.toBeNull();
  });

  it('queries Doppler phases globally using defIndex + paintIndex without restricting to onlyMarketId', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      assets: [{
        markethashname: '★ Butterfly Knife | Doppler (Factory New)',
        paintindex: 415,
        phase: 'ruby',
        certificate: 'abcdef0123456789abcdef0123456789',
      }],
    });
    const useCase = new GetListingInspectLinkUseCase({ fetchPage });

    const result = await useCase.execute('★ Butterfly Knife | Doppler (Factory New) | Ruby');

    expect(result).toBe('steam://run/730//+csgo_econ_action_preview%20abcdef0123456789abcdef0123456789');
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({
      defIndex: 515,
      paintIndex: 415,
      wear: 'fn',
    }));
    expect(fetchPage.mock.calls[0]?.[0]?.source).toBeUndefined();
    expect(fetchPage.mock.calls[0]?.[0]?.onlyMarketId).toBeUndefined();
  });

  it('synthesizes canonical CS2 inspect links (// + %20) for Ruby, Emerald, Sapphire, and Black Pearl across knife families', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, assets: [] });
    const useCase = new GetListingInspectLinkUseCase({ fetchPage });

    const emerald = await useCase.execute('★ M9 Bayonet | Gamma Doppler (Factory New) | Emerald');
    const trailingWearEmerald = await useCase.execute('★ Karambit | Gamma Doppler | Emerald (Factory New)');
    const bfkSapphire = await useCase.execute('★ Butterfly Knife | Doppler (Factory New) | Sapphire');
    const bfkBlackPearl = await useCase.execute('★ StatTrak™ Butterfly Knife | Doppler (Factory New) | Black Pearl');
    const glockEmerald = await useCase.execute('Glock-18 | Gamma Doppler (Factory New) | Emerald');

    for (const link of [emerald, trailingWearEmerald, bfkSapphire, bfkBlackPearl, glockEmerald]) {
      expect(link).toMatch(/^steam:\/\/run\/730\/\/\+csgo_econ_action_preview%2000[0-9A-F]+$/);
    }
    expect(emerald).not.toBe(bfkSapphire);
    // StatTrak certificate includes killeater fields 9=0 (4800) and 10=0 (5000) before 4-byte CRC trailer
    expect(bfkBlackPearl).toMatch(/48005000[0-9A-F]{8}$/);

    // Knife-specific CS2 paint_index ground truth
    expect(resolvePaintIndexForPhase('Sapphire', '★ Butterfly Knife | Doppler (Factory New)')).toBe(619);
    expect(resolvePaintIndexForPhase('Black Pearl', '★ Butterfly Knife | Doppler (Factory New)')).toBe(617);
    expect(resolvePaintIndexForPhase('Phase 2', '★ Shadow Daggers | Doppler (Factory New)')).toBe(618);
    expect(resolvePaintIndexForPhase('Phase 1', '★ Talon Knife | Doppler (Factory New)')).toBe(852);
    expect(resolvePaintIndexForPhase('Phase 4', '★ Talon Knife | Doppler (Factory New)')).toBe(855);
    expect(resolvePaintIndexForPhase('Emerald', '★ Karambit | Gamma Doppler (Factory New)')).toBe(568);
    expect(resolvePaintIndexForPhase('Emerald', 'Glock-18 | Gamma Doppler (Factory New)')).toBe(1119);
  });

  it('skips short non-hex YouPin marketid certificates instead of emitting invalid M-links', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      assets: [
        {
          markethashname: 'AK-47 | Redline (Field-Tested)',
          marketid: '999999',
          assetid: '888888',
          certificate: '1234567890',
        },
        {
          markethashname: 'AK-47 | Redline (Field-Tested)',
          certificate: 'abcdef0123456789abcdef0123456789',
        },
      ],
    });
    const useCase = new GetListingInspectLinkUseCase({ fetchPage });

    const result = await useCase.execute('AK-47 | Redline (Field-Tested)');

    expect(result).toBe('steam://run/730//+csgo_econ_action_preview%20abcdef0123456789abcdef0123456789');
  });

  it('bounds rate-limiter wait to prevent VPS 504 timeouts and synthesizes certificate on FloatRateLimitWaitTimeoutError', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new FloatRateLimitWaitTimeoutError(3600));
    const useCase = new GetListingInspectLinkUseCase({ fetchPage });

    const ruby = await useCase.execute('★ Karambit | Doppler (Factory New) | Ruby');

    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({
      maxRateLimitWaitMs: 1500,
      requestTimeoutMs: 4000,
    }));
    expect(ruby).toMatch(/^steam:\/\/run\/730\/\/\+csgo_econ_action_preview%2000[0-9A-F]+$/);
    expect(resolveItemDefIndex('AK-47 | Redline (Field-Tested)')).toBe(7);
    expect(resolveItemDefIndex("★ Sport Gloves | Pandora's Box (Field-Tested)")).toBe(5030);
  });
});
