import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAuthHeaders, authFetch } from './client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => vi.clearAllMocks());

describe('buildAuthHeaders', () => {
  it('includes Authorization header when token is provided', () => {
    const headers = buildAuthHeaders('my-token');
    expect(headers['Authorization']).toBe('Bearer my-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization header when token is null', () => {
    const headers = buildAuthHeaders(null);
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('authFetch', () => {
  it('calls fetch with Authorization header and correct URL', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await authFetch('/api/topics', 'test-token');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/topics'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );
  });

  it('calls fetch without Authorization when token is null', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await authFetch('/api/topics', null);

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });

  it('passes method and body from init', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await authFetch('/api/topics', 'tok', {
      method: 'POST',
      body: JSON.stringify({ title: 'test' }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'test' }) })
    );
  });
});
