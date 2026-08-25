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
});
