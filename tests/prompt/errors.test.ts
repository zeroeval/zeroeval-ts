import { describe, it, expect } from 'vitest';
import { PromptNotFoundError, PromptRequestError } from '../../src/errors';

describe('Prompt Errors', () => {
  describe('PromptNotFoundError', () => {
    it('should create error with slug only', () => {
      const error = new PromptNotFoundError('my-prompt');

      expect(error.name).toBe('PromptNotFoundError');
      expect(error.message).toBe('Prompt not found: my-prompt');
      expect(error.slug).toBe('my-prompt');
      expect(error.version).toBeUndefined();
      expect(error.tag).toBeUndefined();
    });

    it('should create error with version', () => {
      const error = new PromptNotFoundError('my-prompt', 5);

      expect(error.message).toBe('Prompt not found: my-prompt v5');
      expect(error.version).toBe(5);
    });

    it('should create error with tag', () => {
      const error = new PromptNotFoundError('my-prompt', undefined, 'latest');

      expect(error.message).toBe('Prompt not found: my-prompt tag=latest');
      expect(error.tag).toBe('latest');
    });

    it('should create error with version and tag', () => {
      const error = new PromptNotFoundError('my-prompt', 3, 'production');

      expect(error.message).toBe('Prompt not found: my-prompt v3 tag=production');
      expect(error.version).toBe(3);
      expect(error.tag).toBe('production');
    });

    it('should be instanceof Error', () => {
      const error = new PromptNotFoundError('test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PromptNotFoundError);
    });
  });

  describe('PromptRequestError', () => {
    it('should create error with message and status', () => {
      const error = new PromptRequestError('Request failed', 500);

      expect(error.name).toBe('PromptRequestError');
      expect(error.message).toBe('Request failed');
      expect(error.status).toBe(500);
      expect(error.response).toBeUndefined();
    });

    it('should create error with null status', () => {
      const error = new PromptRequestError('Network error', null);

      expect(error.status).toBeNull();
    });

    it('should create error with response', () => {
      const responseBody = { error: 'Invalid request' };
      const error = new PromptRequestError('Bad request', 400, responseBody);

      expect(error.status).toBe(400);
      expect(error.response).toEqual({ error: 'Invalid request' });
    });

    it('should be instanceof Error', () => {
      const error = new PromptRequestError('test', null);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PromptRequestError);
    });
  });
});
