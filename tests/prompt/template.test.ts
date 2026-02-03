import { describe, it, expect } from 'vitest';
import { renderTemplate, extractVariables } from '../../src/utils/template';
import { PromptRequestError } from '../../src/errors';

describe('template utilities', () => {
  describe('renderTemplate', () => {
    it('should interpolate single variable', () => {
      const result = renderTemplate('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should interpolate multiple variables', () => {
      const result = renderTemplate('{{greeting}} {{name}}!', {
        greeting: 'Hello',
        name: 'World',
      });
      expect(result).toBe('Hello World!');
    });

    it('should handle whitespace in variable placeholders', () => {
      const result = renderTemplate('Hello {{ name }}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should handle variables with underscores', () => {
      const result = renderTemplate('User: {{user_name}}', { user_name: 'John' });
      expect(result).toBe('User: John');
    });

    it('should handle numeric values', () => {
      const result = renderTemplate('Score: {{score}}', { score: 95 });
      expect(result).toBe('Score: 95');
    });

    it('should handle boolean values', () => {
      const result = renderTemplate('Active: {{active}}', { active: true });
      expect(result).toBe('Active: true');
    });

    it('should throw on missing variable with error mode', () => {
      expect(() =>
        renderTemplate('Hello {{name}}!', {}, { missing: 'error' })
      ).toThrow(PromptRequestError);
    });

    it('should leave placeholder on missing variable with leave mode', () => {
      const result = renderTemplate('Hello {{name}}!', {}, { missing: 'leave' });
      expect(result).toBe('Hello {{name}}!');
    });

    it('should preserve escaped braces', () => {
      const result = renderTemplate('Use \\{{variable}} syntax', { variable: 'test' });
      expect(result).toBe('Use {{variable}} syntax');
    });

    it('should handle empty variables object', () => {
      const result = renderTemplate('No variables here', {}, { missing: 'leave' });
      expect(result).toBe('No variables here');
    });

    it('should throw on invalid variable name', () => {
      expect(() => renderTemplate('{{name}}', { '123invalid': 'value' })).toThrow(
        'Invalid variable name'
      );
    });

    it('should handle content with no variables', () => {
      const result = renderTemplate('Plain text content', { name: 'unused' });
      expect(result).toBe('Plain text content');
    });
  });

  describe('extractVariables', () => {
    it('should extract single variable', () => {
      const result = extractVariables('Hello {{name}}!');
      expect(result).toEqual(new Set(['name']));
    });

    it('should extract multiple variables', () => {
      const result = extractVariables('{{greeting}} {{name}}!');
      expect(result).toEqual(new Set(['greeting', 'name']));
    });

    it('should handle duplicate variables', () => {
      const result = extractVariables('{{name}} and {{name}} again');
      expect(result).toEqual(new Set(['name']));
    });

    it('should ignore escaped braces', () => {
      const result = extractVariables('\\{{escaped}} but {{real}}');
      expect(result).toEqual(new Set(['real']));
    });

    it('should handle whitespace in placeholders', () => {
      const result = extractVariables('{{ name }} and {{  other  }}');
      expect(result).toEqual(new Set(['name', 'other']));
    });

    it('should return empty set for no variables', () => {
      const result = extractVariables('No variables here');
      expect(result).toEqual(new Set());
    });

    it('should handle underscores in variable names', () => {
      const result = extractVariables('{{user_name}} and {{_private}}');
      expect(result).toEqual(new Set(['user_name', '_private']));
    });
  });
});
