import { describe, expect, it, vi } from 'vitest';
import { GetListingInspectLinkUseCase } from './GetListingInspectLinkUseCase';

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

  it('queries Doppler phases using defIndex + paintIndex instead of appending | Phase to marketHashName', async () => {
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
      isStatTrak: false,
      isSouvenir: false,
    }));
  });

  it('synthesizes a valid phase inspect certificate for Ruby, Emerald, and Black Pearl when YouPin has no cached assets', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, assets: [] });
    const useCase = new GetListingInspectLinkUseCase({ fetchPage });

    const emerald = await useCase.execute('★ M9 Bayonet | Gamma Doppler (Factory New) | Emerald');
    const blackPearl = await useCase.execute('★ Karambit | Doppler (Minimal Wear) | Black Pearl');

    expect(emerald).toMatch(/^steam:\/\/run\/730\/\+csgo_econ_action_preview\+00[0-9A-F]+$/);
    expect(blackPearl).toMatch(/^steam:\/\/run\/730\/\+csgo_econ_action_preview\+00[0-9A-F]+$/);
    expect(emerald).not.toBe(blackPearl);
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
});
