import { describe, it, expect } from 'vitest';
import { decoratePrompt, extractZeroEvalMetadata } from '../../src/utils/metadata';
import type { PromptMetadata } from '../../src/types/prompt';

describe('metadata utilities', () => {
  describe('decoratePrompt', () => {
    it('should decorate prompt with task metadata', () => {
      const metadata: PromptMetadata = { task: 'test-task' };
      const result = decoratePrompt('Hello world', metadata);

      expect(result).toBe('<zeroeval>{"task":"test-task"}</zeroeval>Hello world');
    });

    it('should include variables in metadata', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        variables: { name: 'John', role: 'admin' },
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).toContain('"variables":{"name":"John","role":"admin"}');
      expect(result).toContain('"task":"test-task"');
    });

    it('should include prompt_slug', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        prompt_slug: 'customer-support',
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).toContain('"prompt_slug":"customer-support"');
    });

    it('should include prompt_version', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        prompt_version: 5,
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).toContain('"prompt_version":5');
    });

    it('should include prompt_version_id', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        prompt_version_id: 'uuid-123-456',
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).toContain('"prompt_version_id":"uuid-123-456"');
    });

    it('should include content_hash', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        content_hash: 'abc123def456',
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).toContain('"content_hash":"abc123def456"');
    });

    it('should not include empty variables', () => {
      const metadata: PromptMetadata = {
        task: 'test-task',
        variables: {},
      };
      const result = decoratePrompt('Content', metadata);

      expect(result).not.toContain('variables');
    });
  });

  describe('extractZeroEvalMetadata', () => {
    it('should extract metadata from decorated content', () => {
      const content = '<zeroeval>{"task":"test-task"}</zeroeval>Hello world';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata).toEqual({ task: 'test-task' });
      expect(cleanContent).toBe('Hello world');
    });

    it('should extract variables', () => {
      const content =
        '<zeroeval>{"task":"test","variables":{"name":"John"}}</zeroeval>Content';
      const { metadata } = extractZeroEvalMetadata(content);

      expect(metadata?.variables).toEqual({ name: 'John' });
    });

    it('should extract optional fields', () => {
      const content =
        '<zeroeval>{"task":"test","prompt_slug":"slug","prompt_version":3,"prompt_version_id":"id-123","content_hash":"hash"}</zeroeval>Content';
      const { metadata } = extractZeroEvalMetadata(content);

      expect(metadata?.prompt_slug).toBe('slug');
      expect(metadata?.prompt_version).toBe(3);
      expect(metadata?.prompt_version_id).toBe('id-123');
      expect(metadata?.content_hash).toBe('hash');
    });

    it('should return null metadata for content without tags', () => {
      const content = 'Plain content without tags';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata).toBeNull();
      expect(cleanContent).toBe('Plain content without tags');
    });

    it('should return null metadata for invalid JSON', () => {
      const content = '<zeroeval>{invalid json}</zeroeval>Content';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata).toBeNull();
      expect(cleanContent).toBe('<zeroeval>{invalid json}</zeroeval>Content');
    });

    it('should return null metadata for non-object JSON', () => {
      const content = '<zeroeval>"string"</zeroeval>Content';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata).toBeNull();
      expect(cleanContent).toBe('<zeroeval>"string"</zeroeval>Content');
    });

    it('should return null metadata for array JSON', () => {
      const content = '<zeroeval>[1, 2, 3]</zeroeval>Content';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata).toBeNull();
      expect(cleanContent).toBe('<zeroeval>[1, 2, 3]</zeroeval>Content');
    });

    it('should handle multiline content', () => {
      const content =
        '<zeroeval>{"task":"test"}</zeroeval>Line 1\nLine 2\nLine 3';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata?.task).toBe('test');
      expect(cleanContent).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should only extract first occurrence of tags', () => {
      const content =
        '<zeroeval>{"task":"first"}</zeroeval>Content<zeroeval>{"task":"second"}</zeroeval>';
      const { metadata, cleanContent } = extractZeroEvalMetadata(content);

      expect(metadata?.task).toBe('first');
      expect(cleanContent).toBe('Content<zeroeval>{"task":"second"}</zeroeval>');
    });

    it('should trim clean content', () => {
      const content = '<zeroeval>{"task":"test"}</zeroeval>   Content with spaces   ';
      const { cleanContent } = extractZeroEvalMetadata(content);

      expect(cleanContent).toBe('Content with spaces');
    });
  });

  describe('roundtrip', () => {
    it('should preserve metadata through decorate and extract', () => {
      const originalMetadata: PromptMetadata = {
        task: 'customer-support',
        variables: { tone: 'friendly', product: 'Widget' },
        prompt_slug: 'support-v2',
        prompt_version: 7,
        prompt_version_id: 'uuid-abc-123',
        content_hash: 'hash123',
      };
      const originalContent = 'You are a helpful assistant.';

      const decorated = decoratePrompt(originalContent, originalMetadata);
      const { metadata, cleanContent } = extractZeroEvalMetadata(decorated);

      expect(metadata).toEqual(originalMetadata);
      expect(cleanContent).toBe(originalContent);
    });
  });
});
