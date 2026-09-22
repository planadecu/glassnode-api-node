import { describe, it, expect } from 'vitest';
import { BulkResponseSchema, MetricMetadataSchema } from '../src/types/metadata';
import { mockRawMetricMetadataResponse } from './mocks/metadata.mock';

/**
 * Pins the documented timestamp representation (see README "Timestamps"):
 * `MetricMetadata.modified` is a `Date`; every other time field stays unix seconds.
 */
describe('timestamp representation', () => {
  describe('MetricMetadata.modified', () => {
    it('converts unix seconds into a Date', () => {
      const result = MetricMetadataSchema.parse({
        ...mockRawMetricMetadataResponse,
        modified: 1733829848,
      });
      expect(result.modified).toBeInstanceOf(Date);
      expect(result.modified!.getTime()).toBe(1733829848 * 1000);
      expect(result.modified!.toISOString()).toBe('2024-12-10T11:24:08.000Z');
    });

    it('is undefined when the field is absent', () => {
      const raw: Record<string, unknown> = { ...mockRawMetricMetadataResponse };
      delete raw.modified;
      const result = MetricMetadataSchema.parse(raw);
      expect(result.modified).toBeUndefined();
    });

    it('is undefined (not the 1970 epoch) when the API sends 0', () => {
      const result = MetricMetadataSchema.parse({ ...mockRawMetricMetadataResponse, modified: 0 });
      expect(result.modified).toBeUndefined();
    });
  });

  it('keeps MetricMetadata.timerange bounds as unix-second numbers', () => {
    const result = MetricMetadataSchema.parse({
      ...mockRawMetricMetadataResponse,
      timerange: { min: 1230940800, max: 1733788800 },
    });
    expect(result.timerange).toEqual({ min: 1230940800, max: 1733788800 });
    expect(typeof result.timerange!.min).toBe('number');
    expect(typeof result.timerange!.max).toBe('number');
  });

  it('keeps bulk entry timestamps as unix-second numbers', () => {
    const result = BulkResponseSchema.parse([{ t: 1609459200, bulk: [{ a: 'BTC', v: 1 }] }]);
    expect(result[0].t).toBe(1609459200);
    expect(typeof result[0].t).toBe('number');
  });
});
