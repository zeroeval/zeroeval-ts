import { describe, it, expect } from 'vitest';
import { normalizePromptText, sha256Hex } from '../../src/utils/hash';

describe('hash utilities', () => {
  describe('normalizePromptText', () => {
    it('should normalize CRLF to LF', () => {
      const input = 'line1\r\nline2\r\nline3';
      const result = normalizePromptText(input);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should normalize CR to LF', () => {
      const input = 'line1\rline2\rline3';
      const result = normalizePromptText(input);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should strip trailing whitespace from each line', () => {
      const input = 'line1   \nline2  \nline3';
      const result = normalizePromptText(input);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should preserve leading whitespace', () => {
      const input = '  line1\n    line2\nline3';
      const result = normalizePromptText(input);
      expect(result).toBe('line1\n    line2\nline3');
    });

    it('should strip overall leading and trailing whitespace', () => {
      const input = '  \n  content  \n  ';
      const result = normalizePromptText(input);
      expect(result).toBe('content');
    });

    it('should preserve {{variable}} tokens', () => {
      const input = 'Hello {{name}}, your score is {{score}}.';
      const result = normalizePromptText(input);
      expect(result).toBe('Hello {{name}}, your score is {{score}}.');
    });

    it('should handle empty string', () => {
      const result = normalizePromptText('');
      expect(result).toBe('');
    });

    it('should convert non-string to string', () => {
      const result = normalizePromptText(123 as unknown as string);
      expect(result).toBe('123');
    });
  });

  describe('sha256Hex', () => {
    it('should return 64-character hex hash', async () => {
      const result = await sha256Hex('test content');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return consistent hash for same input', async () => {
      const result1 = await sha256Hex('hello world');
      const result2 = await sha256Hex('hello world');
      expect(result1).toBe(result2);
    });

    it('should return different hash for different input', async () => {
      const result1 = await sha256Hex('content1');
      const result2 = await sha256Hex('content2');
      expect(result1).not.toBe(result2);
    });

    it('should normalize before hashing', async () => {
      // Same content with different line endings should have same hash
      const result1 = await sha256Hex('line1\nline2');
      const result2 = await sha256Hex('line1\r\nline2');
      expect(result1).toBe(result2);
    });

    it('should handle empty string', async () => {
      const result = await sha256Hex('');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
